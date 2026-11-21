// Item Insights (reached at /api/item, rewritten to api/erp.js: the Hobby plan allows 12 functions, so this is a helper).
//   GET /api/item?q=<code or words>            search: up to 12 matching items (code start, or every word in the name)
//   GET /api/item?code=<SKU or design>&months=6  the full report for one item: sales, stores, stock, sizes, bought-with,
//                                              who sells it, and a ranked "what to do now" list written in plain words
// A code without a size (793905C01) covers every size of that design; with a size (793905C01-52) only that size.
// Who: super admin and Overseers (brand manager, CEO), and anyone the super admin adds on User Access Privileges.
// Sources (nothing new is stored): Pandora Dashboards sales lines (dash/), the last ERP stock balance read (stock/),
// Staff Performance months (data/) for "who sells it", and the last Refill Order for pieces already on order.
const store = require('./_store');
const { whoami } = require('./_auth');
const { dashRows } = require('./_sales');
const { cairoNow } = require('./_cairo');
const { storeKey } = require('./_storekey');

const LEAD_WEEKS = 8;        // a Pandora order takes about 2 months to arrive
const AFTER_WEEKS = 8;       // and should then last about 2 more months
const DAY = 86400000;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const up = v => String(v == null ? '' : v).trim().toUpperCase().replace(/\.0$/, '');
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const design = v => up(v).split('-')[0].replace(/\s+/g, '');
// the size is the short part after the design ("583050C00-18" -> 18); an EAN ("-5700303193359") is not a size
const sizeOf = v => { const p = up(v).split('-'); return p.length > 1 && /^[A-Z0-9]{1,4}$/.test(p[1]) && !/^\d{5,}$/.test(p[1]) ? p[1] : ''; };
const isCode = v => /^[A-Z0-9]{4,16}$/.test(v) && /\d/.test(v);
const pretty = v => String(v || '').replace(/^\s*pandora\s+/i, '').replace(/\s+-\s+[A-Za-z]{1,5}\s*$/, '').trim() || String(v || '');
const plain = v => pretty(v).toLowerCase().replace(/[^a-z0-9]+/g, '');
const skeyOf = v => storeKey(v) || plain(v);
const dayN = iso => Math.round(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / DAY);
const isoOf = n => new Date(n * DAY).toISOString().slice(0, 10);
const NOT_SELLING = /warehouse|samples?\b|\bmain\b|\btest|transit|damage|defect|reject|return/i;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// the same categories as the Category explorer (no "Other" for jewellery; services and packaging are not items)
function catOf(c, name) {
  if (c === 'Necklaces') return 'Necklace and Pendant';
  if (/services|packaging|maintenance/i.test(c || '')) return '';
  if (c && c !== 'Other') return c;
  const n = String(name || '').toLowerCase();
  if (/packaging|gift\s*box|bag\b|service/.test(n)) return '';
  if (/safety/.test(n)) return 'Charms';
  if (/bracelet|bangle/.test(n)) return 'Bracelets';
  if (/pendant|necklace|collier/.test(n)) return 'Necklace and Pendant';
  if (/charm|clip|dangle|spacer|medallion|murano/.test(n)) return 'Charms';
  if (/earring|stud|hoop|huggie/.test(n)) return 'Earrings';
  if (/\bring/.test(n)) return 'Rings';
  return c || 'Other';
}
const payOf = v => /valu/i.test(v || '') ? 'Valu' : /cash/i.test(v || '') ? 'Cash' : v ? 'Visa' : '';

// ---- saved data, kept warm for a few minutes per server instance ----
let MEM = null;
async function salesRows() {
  if (MEM && Date.now() - MEM.at < 10 * 60 * 1000) return MEM;
  const rows = await dashRows();
  let maxD = '';
  for (const r of rows) { const d = String(r[0] || '').slice(0, 10); if (d > maxD) maxD = d; }
  MEM = { at: Date.now(), rows, maxD, index: null };
  return MEM;
}
async function latestStock() {
  try {
    const idx = (await store.getJSON('stock/index.json')) || [];
    for (let i = idx.length - 1; i >= 0; i--) {
      const c = await store.getJSON(idx[i]);
      if (c && Array.isArray(c.rows) && c.rows.length) return { at: c.at, rows: c.rows };
    }
    const x = await store.getJSON('stock/current.json');
    if (x && Array.isArray(x.rows) && x.rows.length) return { at: x.uploadedAt || x.asOf || '', rows: x.rows, excel: true };
  } catch (_) {}
  return null;
}
// stock row: [item code, item name, item group, warehouse, opening, in, out, balance qty, value, description]
const stockDesign = r => { const a = design(r[0]), b = design(r[1]); return isCode(b) ? b : a; };
const stockSize = r => sizeOf(r[1]) || sizeOf(r[0]);

// ---- search ----
async function buildIndex(mem) {
  if (mem.index) return mem.index;
  const map = new Map(), from90 = isoOf(dayN(mem.maxD || cairoNow().toISOString()) - 90);
  for (const r of mem.rows) {
    const d = design(r[5]); if (!isCode(d)) continue;
    const cat = catOf(r[8], r[6]); if (!cat) continue;
    const e = map.get(d) || { code: d, name: '', cat, coll: '', u90: 0, units: 0, last: '' };
    const q = Number(r[2]) || 0, dt = String(r[0] || '').slice(0, 10);
    e.units += q; if (dt >= from90) e.u90 += q;
    if (q > 0 && dt > e.last) { e.last = dt; if (r[6]) e.name = str(r[6], 140); }
    if (!e.name && r[6]) e.name = str(r[6], 140);
    if (!e.coll && r[10]) e.coll = str(r[10], 40);
    map.set(d, e);
  }
  const st = await latestStock();
  if (st) for (const r of st.rows) {
    const d = stockDesign(r); if (!isCode(d)) continue;
    const e = map.get(d) || { code: d, name: '', cat: catOf('', r[9] || r[2]) || 'Other', coll: '', u90: 0, units: 0, last: '', stock: 0 };
    if (!e.name || e.name === e.code) e.name = str(r[9], 140) || e.name;
    e.stock = (e.stock || 0) + (NOT_SELLING.test(r[3]) ? 0 : Number(r[7]) || 0);
    map.set(d, e);
  }
  mem.index = [...map.values()].map(e => ({ ...e, u90: r0(e.u90), units: r0(e.units), stock: r0(e.stock), hay: (e.code + ' ' + e.name + ' ' + e.cat + ' ' + e.coll).toLowerCase() }));
  return mem.index;
}
function search(index, q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return [];
  const code = design(t), words = t.split(/\s+/).filter(Boolean);
  const out = [];
  for (const e of index) {
    let s = 0;
    if (e.code === code.toUpperCase()) s = 1000;
    else if (isCode(code.toUpperCase()) && e.code.startsWith(code.toUpperCase())) s = 500;
    else if (words.every(w => e.hay.includes(w))) s = 100;
    else continue;
    out.push([s + Math.min(99, Math.log10(1 + e.u90) * 30), e]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, 12).map(([, e]) => ({ code: e.code, name: e.name || e.code, cat: e.cat, coll: e.coll, u90: e.u90, stock: e.stock || 0, last: e.last }));
}

// ---- the report ----
async function report(code, months) {
  const mem = await salesRows();
  const want = up(code), dv = design(want), oneSize = sizeOf(want);
  const hit = s => design(s) === dv && (!oneSize || sizeOf(s) === oneSize);
  const asOf = mem.maxD || cairoNow().toISOString().slice(0, 10), endN = dayN(asOf);
  const fromN = endN - Math.round(months * 30.44) + 1, from = isoOf(fromN);
  const d30 = endN - 29, p30 = endN - 59, d90 = endN - 89;

  // pass 1: the item's own lines (every month on file) and the whole business in the window (for ranks)
  const mine = [], designUnits = new Map(), designCat = new Map();
  let name = '', cat = '', coll = '', firstD = '', lastD = '', priceD = '', price = 0, minP = 0, maxP = 0;
  for (const r of mem.rows) {
    const s = r[5], dt = String(r[0] || '').slice(0, 10), q = Number(r[2]) || 0;
    if (hit(s)) {
      mine.push(r);
      if (q > 0) { if (!firstD || dt < firstD) firstD = dt; if (dt > lastD) lastD = dt; }
      if (!cat) { const c = catOf(r[8], r[6]); if (c) cat = c; }
      if (r[6] && (!name || dt >= lastD)) name = str(r[6], 140);
      if (r[10] && !coll) coll = str(r[10], 40);
      const g = Number(r[4]) || 0;
      if (q > 0 && g > 0) { const p = Math.round(g / q); if (dt >= priceD) { priceD = dt; price = p; } if (dt >= from) { minP = minP ? Math.min(minP, p) : p; maxP = Math.max(maxP, p); } }
    }
    if (dayN(dt) >= fromN) {
      const d = design(s); if (!isCode(d)) continue;
      const c = catOf(r[8], r[6]); if (!c) continue;
      designUnits.set(d, (designUnits.get(d) || 0) + q); if (!designCat.has(d)) designCat.set(d, c);
    }
  }
  const st = await latestStock();
  const stockRows = st ? st.rows.filter(r => stockDesign(r) === dv && (!oneSize || stockSize(r) === oneSize)) : [];
  if (!mine.length && !stockRows.length) return null;
  if (!name && stockRows.length) name = str(stockRows[0][9], 140) || str(stockRows[0][1], 140);
  if (!cat) cat = catOf('', name) || 'Other';

  // ---- totals over the window ----
  const inWin = mine.filter(r => dayN(r[0]) >= fromN);
  let units = 0, rev = 0, gross = 0, retU = 0, u30 = 0, u60 = 0, u90 = 0;
  const invs = new Set(), wday = [0, 0, 0, 0, 0, 0, 0], pay = {};
  for (const r of inWin) {
    const q = Number(r[2]) || 0, n = dayN(r[0]);
    units += q; rev += Number(r[3]) || 0; gross += Number(r[4]) || 0;
    if (q < 0) retU += -q; else if (q > 0) { invs.add(r[1]); wday[new Date(n * DAY).getUTCDay()] += q; }
    const p = payOf(r[9]); if (p && q > 0) pay[p] = (pay[p] || 0) + q;
  }
  for (const r of mine) { const q = Number(r[2]) || 0, n = dayN(r[0]); if (n >= d30) u30 += q; else if (n >= p30) u60 += q; if (n >= d90) u90 += q; }
  const soldPieces = units + retU;
  // selling speed: pieces a week over the last 90 days (or since the first sale, when that is more recent)
  const spanDays = firstD ? Math.max(14, Math.min(90, endN - dayN(firstD) + 1)) : 90;
  const perWeek = Math.max(0, u90) / spanDays * 7;

  // ---- months (the last 12 on file) and weeks (the last 12) ----
  const monthly = [];
  { const e = new Date(endN * DAY); for (let k = 11; k >= 0; k--) monthly.push({ m: new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - k, 1)).toISOString().slice(0, 7), units: 0, rev: 0 }); }
  const weekly = Array.from({ length: 12 }, (_, i) => ({ end: isoOf(endN - (11 - i) * 7), units: 0 }));
  for (const r of mine) {
    const q = Number(r[2]) || 0, m = String(r[0]).slice(0, 7), n = dayN(r[0]);
    const mo = monthly.find(x => x.m === m); if (mo) { mo.units += q; mo.rev += Number(r[3]) || 0; }
    const w = 11 - Math.floor((endN - n) / 7); if (w >= 0 && w < 12) weekly[w].units += q;
  }
  monthly.forEach(x => { x.units = r0(x.units); x.rev = r0(x.rev); });
  weekly.forEach(x => { x.units = r0(x.units); });

  // ---- stores: sales joined with stock ----
  const S = new Map();
  const sOf = (key, label) => { let s = S.get(key); if (!s) { s = { store: label, units: 0, rev: 0, u30: 0, p30: 0, u90: 0, last: '', stock: 0, sizes: {} }; S.set(key, s); } else if (label && label.length < s.store.length) s.store = label; return s; };
  for (const r of mine) {
    if (!r[7]) continue;
    const s = sOf(skeyOf(r[7]), pretty(r[7])), q = Number(r[2]) || 0, n = dayN(r[0]), dt = String(r[0]).slice(0, 10);
    if (n >= fromN) { s.units += q; s.rev += Number(r[3]) || 0; }
    if (n >= d30) s.u30 += q; else if (n >= p30) s.p30 += q;
    if (n >= d90) s.u90 += q;
    if (q > 0 && dt > s.last) s.last = dt;
  }
  let stockAll = 0, stockElse = 0, stockWh = 0; const sizeStock = {};
  for (const r of stockRows) {
    const q = Number(r[7]) || 0; if (!q) continue;
    if (NOT_SELLING.test(r[3])) { stockElse += q; if (/warehouse|\bmain\b/i.test(r[3]) && !/sample|damage|defect|reject|transit|return/i.test(r[3])) stockWh += q; continue; }
    const s = sOf(skeyOf(r[3]), pretty(r[3])); s.stock += q; stockAll += q;
    const z = stockSize(r) || '—'; s.sizes[z] = (s.sizes[z] || 0) + q; sizeStock[z] = (sizeStock[z] || 0) + q;
  }
  for (const s of S.values()) s.stock = Math.max(0, s.stock); // ERP can hold a negative balance after a missed receipt: it is zero pieces on the shelf
  stockAll = [...S.values()].reduce((t, s) => t + s.stock, 0);
  const stores = [...S.values()].filter(s => s.units || s.stock || s.u90 || s.last).map(s => {
    const vel = Math.max(0, s.u90) / spanDays * 7, idle = s.last ? endN - dayN(s.last) : null;
    const cover = vel > 0 ? s.stock / vel : null;
    let status = 'ok';
    if (s.stock <= 0 && s.u90 > 0) status = 'out';
    else if (s.stock > 0 && (idle === null || idle > 60)) status = 'idle';
    else if (cover !== null && cover < 4) status = 'low';
    else if (vel >= perWeek / Math.max(1, S.size) * 1.5 && vel > 0.4) status = 'hot';
    else if (s.stock <= 0 && !s.u90) status = 'none';
    return { store: s.store, units: r0(s.units), rev: r0(s.rev), share: units > 0 ? r1(Math.max(0, s.units) / units * 100) : 0, u30: r0(s.u30), p30: r0(s.p30), u90: r0(s.u90), perWeek: r1(vel), last: s.last, idle, stock: r0(s.stock), cover: cover === null ? null : r1(cover), status, sizes: s.sizes };
  }).sort((a, b) => b.units - a.units || b.stock - a.stock);

  // ---- sizes ----
  const SZ = new Map();
  for (const r of inWin) { const z = sizeOf(r[5]) || '—'; SZ.set(z, (SZ.get(z) || 0) + (Number(r[2]) || 0)); }
  for (const z of Object.keys(sizeStock)) if (!SZ.has(z)) SZ.set(z, 0);
  const sizes = [...SZ.entries()].map(([size, u]) => ({ size, units: r0(u), share: units > 0 ? r1(Math.max(0, u) / units * 100) : 0, stock: r0(sizeStock[size] || 0), outIn: stores.filter(s => s.u90 > 0 && !(s.sizes[size] > 0)).map(s => s.store) }))
    .sort((a, b) => { const na = Number(a.size), nb = Number(b.size); return isFinite(na) && isFinite(nb) ? na - nb : String(a.size).localeCompare(String(b.size)); });
  stores.forEach(s => { delete s.sizes; });

  // ---- rank in its category and in the whole business (pieces in the window) ----
  const inCat = [...designUnits.entries()].filter(([d]) => designCat.get(d) === cat).sort((a, b) => b[1] - a[1]);
  const all = [...designUnits.entries()].sort((a, b) => b[1] - a[1]);
  const catUnits = inCat.reduce((t, [, u]) => t + Math.max(0, u), 0);
  const rank = { cat, inCat: designUnits.has(dv) && units > 0 ? inCat.findIndex(([d]) => d === dv) + 1 : null, ofCat: inCat.length, overall: designUnits.has(dv) && units > 0 ? all.findIndex(([d]) => d === dv) + 1 : null, ofAll: all.length, catShare: catUnits ? r1(Math.max(0, units) / catUnits * 100) : 0 };

  // ---- bought together: other items on the same receipts ----
  const myInv = new Set(inWin.filter(r => (Number(r[2]) || 0) > 0).map(r => String(r[1])));
  const withMap = new Map(), withCat = new Map(), others = new Map();
  if (myInv.size) for (const r of mem.rows) {
    const iv = String(r[1]); if (!myInv.has(iv) || !(Number(r[2]) > 0)) continue;
    const d = design(r[5]); if (d === dv || !isCode(d)) continue;
    const c = catOf(r[8], r[6]); if (!c) continue;
    const e = withMap.get(d) || { code: d, name: str(r[6], 120), cat: c, inv: new Set(), units: 0 }; e.inv.add(iv); e.units += Number(r[2]) || 0; withMap.set(d, e);
    if (!withCat.has(c)) withCat.set(c, new Set()); withCat.get(c).add(iv);
    others.set(iv, (others.get(iv) || 0) + (Number(r[2]) || 0));
  }
  const basket = {
    receipts: myInv.size,
    alone: myInv.size ? r0((myInv.size - others.size) / myInv.size * 100) : 0,
    extra: myInv.size ? r1([...others.values()].reduce((t, v) => t + v, 0) / myInv.size) : 0,
    items: [...withMap.values()].map(e => ({ code: e.code, name: e.name, cat: e.cat, receipts: e.inv.size, pct: r0(e.inv.size / myInv.size * 100) })).sort((a, b) => b.receipts - a.receipts).slice(0, 8),
    cats: [...withCat.entries()].map(([c, s]) => ({ cat: c, pct: r0(s.size / myInv.size * 100) })).sort((a, b) => b.pct - a.pct).slice(0, 5)
  };

  // ---- who sells it best (Staff Performance lines carry the item) ----
  let people = [];
  try {
    const cur = await store.getJSON('data/current.json');
    if (cur) {
      const { loadData } = require('./data');
      const sd = await loadData(new URLSearchParams({ from, to: asOf }), cur);
      if (sd && Array.isArray(sd.rows) && Array.isArray(sd.items)) {
        const ok = (sd.items || []).map(it => { const a = Array.isArray(it) ? it : [it, '']; return [a[1], a[0]].some(v => hit(v) || design(v) === dv && !oneSize); });
        const P = new Map();
        for (const r of sd.rows) { if (r[6] == null || !ok[r[6]]) continue; const p = sd.people[r[0]]; if (!p || /returns|sales\s*team/i.test(p[0])) continue; const k = r[0]; const e = P.get(k) || { name: p[0], store: pretty(sd.stores[p[1]]), units: 0 }; e.units += Number(r[3]) || 0; P.set(k, e); }
        people = [...P.values()].filter(p => p.units > 0).sort((a, b) => b.units - a.units).slice(0, 6).map(p => ({ ...p, units: r0(p.units) }));
      }
    }
  } catch (_) { people = []; }

  // ---- pieces already on the last Refill Order ----
  let onOrder = 0, orderName = '';
  try {
    const idx = (await store.getJSON('rf/orders/index.json')) || [];
    const last = idx.length ? await store.getJSON('rf/orders/' + idx[idx.length - 1].id + '.json') : null;
    if (last && !/received|closed/i.test(last.status || '')) {
      const lines = last.approved ? last.approved.lines.map(l => [l[0], l[2]]) : Object.entries(last.fb || {});
      for (const [s, q] of lines) if (hit(s)) onOrder += Number(q) || 0;
      if (onOrder) orderName = str(last.name, 60) + (last.status ? ' (' + str(last.status, 20) + ')' : '');
    }
  } catch (_) {}

  // ---- the verdict ----
  const idleAll = lastD ? endN - dayN(lastD) : null;
  const trend = u60 > 0 ? r0((u30 / u60 - 1) * 100) : (u30 > 0 ? 100 : 0);
  const cover = perWeek > 0 ? stockAll / perWeek : null;
  const top10 = rank.inCat && rank.ofCat ? rank.inCat <= Math.max(3, Math.ceil(rank.ofCat * 0.1)) : false;
  let status = 'steady';
  if (!lastD) status = 'never';
  else if (firstD && endN - dayN(firstD) <= 45) status = 'new';
  else if (idleAll > 60) status = 'slow';
  else if (top10) status = 'best';
  else if (trend >= 25 && u30 >= 3) status = 'rising';
  else if (trend <= -25 && u60 >= 3) status = 'slowing';
  const LABEL = { never: 'Not sold yet', new: 'New arrival', slow: 'Slow moving', best: 'Best seller', rising: 'Rising', slowing: 'Slowing down', steady: 'Steady seller' };

  // ---- what to do now ----
  const acts = [], wk = n => r1(n) + (r1(n) === 1 ? ' week' : ' weeks'), pcs = n => r0(n) + (r0(n) === 1 ? ' piece' : ' pieces');
  const add = (p, type, title, text, extra) => acts.push({ p, type, title, text, ...(extra || {}) });
  // 1. stock moves: from stores where it sits to stores that sell it and run short
  const givers = stores.filter(s => s.stock > 0 && (s.status === 'idle' || (s.cover !== null && s.cover > 26))).map(s => ({ s, spare: s.status === 'idle' ? Math.max(0, s.stock - 1) : Math.floor(s.stock - s.perWeek * 8) }));
  const takers = stores.filter(s => s.perWeek > 0 && (s.stock <= 0 || (s.cover !== null && s.cover < 4))).map(s => ({ s, need: Math.max(1, Math.ceil(s.perWeek * 8 - s.stock)) })).sort((a, b) => b.s.perWeek - a.s.perWeek);
  const moves = [];
  for (const t of takers) for (const g of givers) {
    if (t.need <= 0) break; if (g.spare <= 0 || g.s === t.s) continue;
    const n = Math.min(g.spare, t.need); g.spare -= n; t.need -= n; moves.push({ from: g.s.store, to: t.s.store, qty: n });
  }
  // what the stores still need comes from the main warehouse, when it holds some
  // shared by need when there is not enough for everyone (the fastest-selling stores first for any piece left over)
  {
    const open = takers.filter(t => t.need > 0), tot = open.reduce((a, t) => a + t.need, 0);
    if (stockWh > 0 && tot > 0) {
      const give = open.map(t => Math.min(t.need, Math.floor(stockWh * t.need / tot)));
      let left = Math.min(stockWh, tot) - give.reduce((a, n) => a + n, 0);
      for (let i = 0; left > 0 && i < open.length * 3; i++) { const k = i % open.length; if (give[k] < open[k].need) { give[k]++; left--; } }
      open.forEach((t, k) => { if (give[k] > 0) { t.need -= give[k]; moves.push({ from: 'Main warehouse', to: t.s.store, qty: give[k] }); } });
    }
  }
  if (moves.length) add(1, 'transfer', 'Move stock to where it sells', moves.map(m => `${pcs(m.qty)} from ${m.from} to ${m.to}`).join(' · ') + '. These stores sell it and are short' + (moves.some(m => m.from !== 'Main warehouse') ? '; the giving stores are not selling it.' : '.'), { moves });
  // 2. out of stock where it sold (that a transfer does not already fix)
  const outs = stores.filter(s => s.status === 'out' && !moves.some(m => m.to === s.store));
  if (outs.length) add(1, 'out', 'Out of stock where customers buy it', outs.map(s => `${s.store} (sold ${s.u90} in 90 days)`).join(', ') + ' — every day without it is a lost sale. Refill these stores first.');
  // 3. reorder from Pandora
  if (perWeek > 0 && status !== 'slow') {
    const target = Math.ceil(perWeek * (LEAD_WEEKS + AFTER_WEEKS)), need = target - stockAll - stockElse - onOrder;
    if (cover !== null && cover < LEAD_WEEKS + 4 && need > 0) add(1, 'reorder', 'Reorder now', `Order about ${pcs(need)}. You sell about ${r1(perWeek)} a week and the stock lasts about ${wk(cover)}; an order takes about 2 months to arrive, so ordering later means empty shelves.` + (onOrder ? ` (${pcs(onOrder)} already on ${orderName}.)` : ''), { qty: need });
    else if (cover !== null && cover > 52) add(2, 'noorder', 'Do not reorder', `There is more than a year of stock (${pcs(stockAll)} at about ${r1(perWeek)} a week). Sell it down first.`);
  }
  // 4. sitting stock
  if (status === 'slow' || status === 'never') {
    if (stockAll > 0) add(1, 'clear', status === 'never' ? 'Get it seen' : 'Wake it up', `${pcs(stockAll)} in the stores` + (idleAll !== null ? ` and no sale for ${idleAll} days` : ' and no sale on file') + '. Put it in a front display or the window, show it with a best seller from the same collection, and include it in the next promotion. If it still does not sell in 30 days, move it to the store that sells this category best.');
  } else {
    const idleS = stores.filter(s => s.status === 'idle' && !moves.some(m => m.from === s.store));
    if (idleS.length) add(2, 'idle', 'Not moving in some stores', idleS.map(s => `${s.store}: ${pcs(s.stock)}, ` + (s.idle === null ? 'never sold there' : `no sale for ${s.idle} days`)).join(' · ') + '. Check it is on display and the team knows it; it sells in other stores.');
  }
  // 5. size gaps
  if (sizes.length > 1 && units >= 6) {
    const gaps = sizes.filter(z => z.size !== '—' && z.share >= 20 && z.outIn.length);
    if (gaps.length) add(2, 'size', 'Missing the sizes that sell', gaps.map(z => `size ${z.size} is ${r0(z.share)}% of sales but missing in ${z.outIn.join(', ')}`).join(' · ') + '. A customer without her size leaves without buying.');
  }
  // 6. trend
  if (status !== 'new' && status !== 'never') {
    if (trend >= 25 && u30 >= 3) add(2, 'up', 'Sales are rising', `Up ${trend}% in the last 30 days (${u30} pieces vs ${u60}). Keep it in a front display in every store and make sure no store runs out.`);
    else if (trend <= -25 && u60 >= 3) add(2, 'down', 'Sales are dropping', `Down ${-trend}% in the last 30 days (${u30} pieces vs ${u60}). Check the display, the sizes in stock and the price; brief the team to show it again.`);
  }
  // 7. a store that sells far less than the others although it has stock
  const selling = stores.filter(s => s.u90 > 0), avg90 = selling.length ? selling.reduce((t, s) => t + s.u90, 0) / selling.length : 0;
  if (avg90 >= 3 && selling.length >= 2) {
    const weak = stores.filter(s => s.stock >= 2 && s.status !== 'idle' && s.u90 < avg90 * 0.4);
    if (weak.length) add(2, 'weak', 'Weak in some stores', weak.map(s => `${s.store} sold ${s.u90} in 90 days vs ${r0(avg90)} average`).join(' · ') + ' — the stock is there. Move it to a better spot and ask the team to offer it.');
  }
  // 8. sell it as a pair
  const mate = basket.items[0];
  if (mate && mate.pct >= 8 && mate.receipts >= 3) add(3, 'pair', 'Sell it as a pair', `${mate.pct}% of the customers who bought it also took ${mate.name || mate.code}. Display them side by side and suggest it at the till.`, { code: mate.code });
  else if (basket.receipts >= 5 && basket.alone >= 70) {
    const tip = cat === 'Bracelets' ? 'offer charms to start the bracelet' : cat === 'Charms' ? 'offer a safety chain or a second charm' : cat === 'Rings' ? 'offer a stacking ring' : cat === 'Earrings' ? 'offer the matching necklace' : 'offer the matching earrings';
    add(3, 'pair', 'Add a second piece', `${basket.alone}% of the receipts with this item have nothing else on them: ${tip}.`);
  }
  // 9. learn from the best seller
  if (people.length && people[0].units >= 3) add(3, 'coach', 'Learn from who sells it best', `${people[0].name} (${people[0].store}) sold ${pcs(people[0].units)}` + (people[1] ? `, then ${people[1].name} (${people[1].units})` : '') + '. Ask them how they present it and share it with the team.');
  // 10. the best day
  const wTot = wday.reduce((t, v) => t + v, 0), wBest = wday.indexOf(Math.max(...wday));
  if (wTot >= 10 && wday[wBest] > wTot / 7 * 1.3) add(3, 'day', `${WD[wBest]} is its best day`, `${r0(wday[wBest] / wTot * 100)}% of its pieces sell on ${WD[wBest]}s. Make sure it is on display and in stock before then.`);
  acts.sort((a, b) => a.p - b.p);

  // one sentence a manager can read in five seconds
  let verdict;
  if (status === 'never') verdict = stockAll > 0 ? `In stock (${pcs(stockAll)}) but no sale on file yet.` : 'No sales and no stock on file for this item.';
  else {
    verdict = `${LABEL[status]}` + (rank.inCat ? ` — #${rank.inCat} of ${rank.ofCat} in ${cat}` : '') + `, about ${r1(perWeek)} pieces a week.`;
    if (cover !== null) verdict += cover < 4 ? ` Stock lasts only ${wk(cover)}.` : cover > 52 ? ' More than a year of stock.' : ` Stock lasts about ${wk(cover)}.`;
    else if (stockAll <= 0 && status !== 'slow') verdict += ' No stock left in the stores.';
    if (status === 'slow') verdict = `Slow moving — no sale for ${idleAll} days` + (stockAll > 0 ? `, ${pcs(stockAll)} waiting in the stores.` : '.');
  }

  return {
    item: { code: oneSize ? dv + '-' + oneSize : dv, design: dv, size: oneSize, name: name || dv, cat, coll, price, priceMin: minP, priceMax: maxP, firstSale: firstD, lastSale: lastD, sizes: sizes.length },
    period: { from, to: asOf, months },
    status, label: LABEL[status], verdict,
    kpi: { units: r0(units), sold: r0(soldPieces), returns: r0(retU), rev: r0(rev), gross: r0(gross), receipts: invs.size, avgPrice: units > 0 ? r0(gross / Math.max(1, soldPieces)) : price, perMonth: r1(units / months), perWeek: r1(perWeek), u30: r0(u30), p30: r0(u60), u90: r0(u90), trend, idle: idleAll, stock: r0(stockAll), stockElse: r0(stockElse), stockWh: r0(stockWh), cover: cover === null ? null : r1(cover), onOrder: r0(onOrder), orderName },
    rank, monthly, weekly, weekday: wday.map(r0), pay, stores, sizes, basket, people, actions: acts,
    stockAsOf: st ? st.at : '', stockFrom: st ? (st.excel ? 'excel' : 'erp') : ''
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'env' && who.info && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Item Insights is for the super admin and the Overseers. Ask the super admin for access.' });
  const u = new URL(req.url, 'https://x.invalid');
  try {
    const q = u.searchParams.get('q');
    if (q != null) {
      const mem = await salesRows();
      return send(res, 200, { ok: true, results: search(await buildIndex(mem), str(q, 80)) });
    }
    const code = up(str(u.searchParams.get('code'), 40));
    if (!code || !isCode(design(code))) return send(res, 400, { ok: false, error: 'Type an item code, for example 790725C00.' });
    const months = [1, 3, 6, 12].includes(Number(u.searchParams.get('months'))) ? Number(u.searchParams.get('months')) : 6;
    const r = await report(code, months);
    if (!r) {
      const mem = await salesRows();
      return send(res, 404, { ok: false, error: 'No sales and no stock found for ' + code + '.', results: search(await buildIndex(mem), code.slice(0, 6)) });
    }
    return send(res, 200, { ok: true, ...r });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 300) });
  }
};
module.exports.report = report;
module.exports.search = search;
