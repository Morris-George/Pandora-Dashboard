// Sales Intelligence (reached at /api/insights, rewritten to api/erp.js: the Hobby plan allows 12 functions, so this is a helper).
//   GET  /api/insights?from=YYYY-MM-DD&to=YYYY-MM-DD&store=<name|ALL>   super admin, brand manager, area managers (their zone only)
//   POST /api/insights?op=ai&from=&to=&store=                         a written brief by Claude (needs ANTHROPIC_API_KEY in Vercel)
// It reads what the site already keeps: Pandora Dashboards sales lines (dash/), Staff Performance months (data/m/) and the last
// ERP stock balance read (stock/r/), and turns them into findings with an estimated EGP value, ranked into one action plan.
const store = require('./_store');
const { whoami } = require('./_auth');
const { dashRows } = require('./_sales');
const ex = require('./_exclude');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_MIN = 20;
const ADJ = 'Returns & adjustments';

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const r2 = n => Math.round((n || 0) * 100) / 100;
const dayN = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const isoOf = n => new Date(n * 86400000).toISOString().slice(0, 10);
// "793905C01-5700303193359" and "793905C01-52" are the same design: sizes and EANs are ignored
const design = v => String(v || '').toUpperCase().split('-')[0].replace(/\s+/g, '').trim();
// store names differ between reports ("Pandora City Stars - AN", "City Stars"): compare a plain key
const skey = v => String(v || '').toLowerCase().replace(/\bpandora\b/g, '').replace(/\s-\s[a-z]{1,4}$/, '').replace(/[^a-z0-9]/g, '');
const pretty = v => String(v || '').replace(/^\s*pandora\s+/i, '').replace(/\s+-\s+[A-Z]{1,4}$/, '').trim() || String(v || '');
const fmtE = n => 'EGP ' + r0(n).toLocaleString('en-US');
const pct = (a, b) => (b ? (a / b - 1) * 100 : null);
const isCode = v => /^[A-Z0-9]{5,16}$/.test(v) && /\d/.test(v);
const sameStore = (a, b) => { const x = skey(a), y = skey(b); return !!x && !!y && (x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)))); };

function catOfGroup(g, name) {
  const low = (String(g || '') + ' ').toLowerCase(), n = String(name || '').toLowerCase();
  if (/packaging|services|maintenance/.test(low)) return '';
  if (/earring/.test(low)) return 'Earrings';
  if (/ ring/.test(low) || /\bring/.test(low)) return 'Rings';
  if (/bracelet|bangle/.test(low)) return 'Bracelets';
  if (/necklace|pendant/.test(low)) return 'Necklace and Pendant';
  if (/charm|clip|dangle|medallion|spacer|safety/.test(low)) return 'Charms';
  if (/safety/.test(n)) return 'Charms';
  if (/bracelet|bangle/.test(n)) return 'Bracelets';
  if (/pendant|necklace|collier/.test(n)) return 'Necklace and Pendant';
  if (/charm|clip|dangle|spacer|medallion|murano/.test(n)) return 'Charms';
  if (/earring|stud|hoop|huggie/.test(n)) return 'Earrings';
  if (/\bring/.test(n)) return 'Rings';
  return 'Other';
}
function recat(c, name) {
  if (c === 'Necklaces') return 'Necklace and Pendant';
  if (c === 'Services') return '';
  if (c && c !== 'Other') return c;
  return catOfGroup('', name);
}

// ---------------------------------------------------------------------------------------------------------------------------
async function latestStock() {
  try {
    const idx = (await store.getJSON('stock/index.json')) || [];
    for (let i = idx.length - 1; i >= 0; i--) {
      const c = await store.getJSON(idx[i]);
      if (c && Array.isArray(c.rows) && c.rows.length) return c;
    }
    const x = await store.getJSON('stock/current.json');
    if (x && Array.isArray(x.rows) && x.rows.length) return { at: x.uploadedAt, rows: x.rows, excel: true };
  } catch (_) {}
  return null;
}

async function staffData(from, to) {
  try {
    const cur = await store.getJSON('data/current.json');
    if (!cur) return null;
    const { loadData } = require('./data');
    return await loadData(new URLSearchParams({ from, to }), cur);
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function build(opt) {
  const { zoneRx } = opt;
  const inZone = b => !zoneRx || zoneRx.some(x => x.test(String(b || '')));
  const all0 = (await dashRows()).filter(r => r && r[0] && inZone(r[7]));
  if (!all0.length) return { ok: true, empty: true };
  let maxD = '', minD = '9999';
  for (const r of all0) { if (r[0] > maxD) maxD = r[0]; if (r[0] < minD) minD = r[0]; }
  let to = ISO.test(opt.to || '') ? opt.to : maxD;
  let from = ISO.test(opt.from || '') ? opt.from : isoOf(dayN(to) - 29);
  if (from > to) { const x = from; from = to; to = x; }
  const days = dayN(to) - dayN(from) + 1;
  const prevTo = isoOf(dayN(from) - 1), prevFrom = isoOf(dayN(from) - days);
  const storesAll = [...new Set(all0.map(r => r[7]))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const pick = opt.store && opt.store !== 'ALL' && storesAll.includes(opt.store) ? opt.store : 'ALL';
  const line = r => ({ d: r[0], inv: r[1], q: +r[2] || 0, net: +r[3] || 0, sku: r[5] || '', name: r[6] || '', br: r[7] || 'Unspecified', cat: recat(r[8], r[6]), pay: r[9] || 'Cash', coll: r[10] || '' });
  const cur = [], prev = [];
  const names = new Map(); // design -> product name
  for (const r of all0) {
    const L = line(r);
    if (!L.cat) continue; // services and packaging carry no product
    const k = design(L.sku);
    if (k && L.name && !names.has(k)) names.set(k, L.name);
    if (L.d >= from && L.d <= to) cur.push(L); else if (L.d >= prevFrom && L.d <= prevTo) prev.push(L);
  }
  const chainCur = cur, scopeCur = pick === 'ALL' ? cur : cur.filter(l => l.br === pick), scopePrev = pick === 'ALL' ? prev : prev.filter(l => l.br === pick);

  // ---- headline numbers ----
  function totals(lines) {
    const inv = new Map();
    let rev = 0, units = 0;
    for (const l of lines) { rev += l.net; units += l.q; const o = inv.get(l.inv) || { rev: 0, q: 0 }; o.rev += l.net; o.q += l.q; inv.set(l.inv, o); }
    let orders = 0, multi = 0;
    for (const o of inv.values()) if (o.rev > 0 && o.q > 0) { orders++; if (o.q >= 2) multi++; }
    return { rev, units, orders, atv: orders ? rev / orders : 0, upt: orders ? units / orders : 0, asp: units ? rev / units : 0, multi: orders ? multi / orders : 0 };
  }
  const T = totals(scopeCur), P = totals(scopePrev);
  const daily = new Array(days).fill(0), prevDaily = new Array(days).fill(0);
  const d0 = dayN(from), p0 = dayN(prevFrom);
  for (const l of scopeCur) daily[dayN(l.d) - d0] += l.net;
  for (const l of scopePrev) { const i = dayN(l.d) - p0; if (i >= 0 && i < days) prevDaily[i] += l.net; }

  // ---- stores ----
  const storeTable = storesAll.map(b => {
    const c = totals(chainCur.filter(l => l.br === b)), p = totals(prev.filter(l => l.br === b));
    return { name: b, rev: r0(c.rev), prev: r0(p.rev), growth: pct(c.rev, p.rev), orders: c.orders, atv: r0(c.atv), upt: r2(c.upt), multi: r1(c.multi * 100), share: 0 };
  }).filter(s => s.rev || s.prev);
  const chainRev = storeTable.reduce((t, s) => t + s.rev, 0);
  storeTable.forEach(s => { s.share = chainRev ? r1(s.rev / chainRev * 100) : 0; if (s.growth != null) s.growth = r1(s.growth); });
  storeTable.sort((a, b) => b.rev - a.rev);

  // ---- items (design level) ----
  const B = 8, bucket = d => Math.min(B - 1, Math.floor((dayN(d) - d0) * B / days));
  function itemAgg(lines, withSpark) {
    const m = new Map();
    for (const l of lines) {
      const k = design(l.sku) || l.name; if (!k) continue;
      let o = m.get(k);
      if (!o) m.set(k, o = { key: k, name: names.get(k) || l.name || k, cat: l.cat, coll: l.coll, units: 0, rev: 0, inv: new Set(), br: new Map(), brRev: new Map(), spark: withSpark ? new Array(B).fill(0) : null });
      o.units += l.q; o.rev += l.net; o.inv.add(l.inv); o.br.set(l.br, (o.br.get(l.br) || 0) + l.q); o.brRev.set(l.br, (o.brRev.get(l.br) || 0) + l.net);
      if (!o.coll && l.coll) o.coll = l.coll;
      if (withSpark) o.spark[bucket(l.d)] += l.q;
    }
    return m;
  }
  const IC = itemAgg(scopeCur, true), IP = itemAgg(scopePrev, false);
  const chainItems = pick === 'ALL' ? IC : itemAgg(chainCur, false);
  const chainPrev = pick === 'ALL' ? IP : itemAgg(prev, false);
  const storeSplit = key => {
    const c = chainItems.get(key), p = chainPrev.get(key), names2 = new Set([...(c ? c.br.keys() : []), ...(p ? p.br.keys() : [])]);
    return [...names2].map(n => ({ name: n, units: r0(c ? c.br.get(n) || 0 : 0), rev: r0(c ? c.brRev.get(n) || 0 : 0), prev: r0(p ? p.br.get(n) || 0 : 0) })).filter(x => x.units || x.prev).sort((a, b) => b.rev - a.rev || b.units - a.units);
  };
  const itemOut = o => {
    const p = IP.get(o.key);
    return { br: storeSplit(o.key), key: o.key, name: o.name, cat: o.cat, coll: o.coll, units: r0(o.units), rev: r0(o.rev), asp: o.units ? r0(o.rev / o.units) : 0, prevUnits: p ? r0(p.units) : 0, growth: p && p.units > 0 ? r1(pct(o.units, p.units)) : null, stores: [...o.br.values()].filter(v => v > 0).length, spark: o.spark };
  };
  const items = [...IC.values()].filter(o => o.units > 0);
  const best = items.slice().sort((a, b) => b.rev - a.rev).slice(0, 15).map(itemOut);
  const minU = Math.max(3, Math.round(days / 10));
  const rising = items.filter(o => o.units >= minU).map(o => ({ o, gain: o.units - ((IP.get(o.key) || {}).units || 0) }))
    .filter(x => x.gain >= Math.max(2, x.o.units * 0.3)).sort((a, b) => b.gain * (b.o.rev / b.o.units) - a.gain * (a.o.rev / a.o.units)).slice(0, 10).map(x => ({ ...itemOut(x.o), gain: r0(x.gain) }));
  const falling = [...IP.values()].filter(p => p.units >= minU).map(p => { const c = IC.get(p.key); return { p, c, loss: p.units - (c ? c.units : 0) }; })
    .filter(x => x.loss >= Math.max(2, x.p.units * 0.35)).sort((a, b) => b.loss * (b.p.rev / b.p.units) - a.loss * (a.p.rev / a.p.units)).slice(0, 10)
    .map(x => ({ br: storeSplit(x.p.key), key: x.p.key, name: names.get(x.p.key) || x.p.name, cat: x.p.cat, coll: x.p.coll, units: x.c ? r0(x.c.units) : 0, prevUnits: r0(x.p.units), growth: r1(pct(x.c ? x.c.units : 0, x.p.units)), asp: r0(x.p.rev / x.p.units), loss: r0(x.loss) }));

  // ---- categories & collections ----
  const grp = (lines, f) => { const m = new Map(); for (const l of lines) { const k = f(l) || 'Not classified'; m.set(k, (m.get(k) || 0) + l.net); } return m; };
  const mix = (f) => { const c = grp(scopeCur, f), p = grp(scopePrev, f); return [...c.entries()].map(([name, rev]) => ({ name, rev: r0(rev), share: T.rev ? r1(rev / T.rev * 100) : 0, growth: p.get(name) ? r1(pct(rev, p.get(name))) : null })).sort((a, b) => b.rev - a.rev); };
  const categories = mix(l => l.cat), collections = mix(l => l.coll).slice(0, 12);

  // ---- weekday & payment ----
  const wdNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const wdCount = new Array(7).fill(0);
  for (let n = d0; n < d0 + days; n++) wdCount[(new Date(n * 86400000).getUTCDay() + 6) % 7]++;
  function weekday(lines) { const v = new Array(7).fill(0); for (const l of lines) v[(new Date(l.d + 'T00:00:00Z').getUTCDay() + 6) % 7] += l.net; const per = v.map((x, i) => wdCount[i] ? x / wdCount[i] : 0); const avg = per.reduce((a, b) => a + b, 0) / 7 || 1; return per.map(x => r0(x / avg * 100)); }
  const weekdayChain = weekday(scopeCur);
  const weekdayStores = (pick === 'ALL' ? storeTable.map(s => s.name) : [pick]).map(n => ({ name: n, idx: weekday(chainCur.filter(l => l.br === n)) }));
  const payInv = new Map();
  for (const l of scopeCur) { const o = payInv.get(l.inv) || { rev: 0, pay: l.pay }; o.rev += l.net; payInv.set(l.inv, o); }
  const payM = new Map();
  for (const o of payInv.values()) { if (o.rev <= 0) continue; const p = payM.get(o.pay) || { name: o.pay, rev: 0, orders: 0 }; p.rev += o.rev; p.orders++; payM.set(o.pay, p); }
  const payment = [...payM.values()].map(p => ({ name: p.name, rev: r0(p.rev), orders: p.orders, atv: r0(p.rev / p.orders), share: T.rev ? r1(p.rev / T.rev * 100) : 0 })).sort((a, b) => b.rev - a.rev);

  // ---- baskets ----
  const invs = new Map();
  for (const l of scopeCur) {
    let o = invs.get(l.inv);
    if (!o) invs.set(l.inv, o = { br: l.br, d: new Set(), cats: new Map(), q: 0, rev: 0 });
    const k = design(l.sku); if (k) o.d.add(k);
    o.cats.set(l.cat, (o.cats.get(l.cat) || 0) + l.q); o.q += l.q; o.rev += l.net;
  }
  const good = [...invs.values()].filter(o => o.rev > 0 && o.q > 0);
  const charmPrice = (() => { let r = 0, q = 0; for (const l of scopeCur) if (l.cat === 'Charms' && l.q > 0) { r += l.net; q += l.q; } return q ? r / q : 0; })();
  const attachOf = list => { const b = list.filter(o => (o.cats.get('Bracelets') || 0) > 0); const w = b.filter(o => (o.cats.get('Charms') || 0) > 0); return { orders: b.length, withCharm: w.length, rate: b.length ? w.length / b.length : 0 }; };
  const chainAttach = attachOf([...(pick === 'ALL' ? good : (() => { const m = new Map(); for (const l of chainCur) { let o = m.get(l.inv); if (!o) m.set(l.inv, o = { br: l.br, cats: new Map(), q: 0, rev: 0 }); o.cats.set(l.cat, (o.cats.get(l.cat) || 0) + l.q); o.q += l.q; o.rev += l.net; } return [...m.values()].filter(o => o.rev > 0 && o.q > 0); })())]);
  const attachStores = (pick === 'ALL' ? storeTable.map(s => s.name) : [pick]).map(n => ({ name: n, ...attachOf(good.filter(o => o.br === n)) })).filter(a => a.orders >= 5)
    .map(a => ({ ...a, rate: r1(a.rate * 100), gapValue: a.rate < chainAttach.rate ? r0((chainAttach.rate - a.rate) * a.orders * charmPrice) : 0 }));
  // pairs bought together (design level)
  const cnt = new Map(), pair = new Map();
  for (const o of good) { if (o.d.size < 1 || o.d.size > 12) continue; for (const k of o.d) cnt.set(k, (cnt.get(k) || 0) + 1); }
  for (const o of good) {
    if (o.d.size < 2 || o.d.size > 12) continue;
    const ks = [...o.d].filter(k => (cnt.get(k) || 0) >= 3).sort();
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const pk = ks[i] + '|' + ks[j]; pair.set(pk, (pair.get(pk) || 0) + 1); }
  }
  const N = good.length || 1;
  const pairs = [...pair.entries()].filter(([, c]) => c >= 3).map(([k, c]) => { const [a, b] = k.split('|'); return { a, b, an: names.get(a) || a, bn: names.get(b) || b, count: c, lift: r1(c * N / (cnt.get(a) * cnt.get(b))) }; })
    .filter(p => p.lift >= 1.5).sort((x, y) => y.count * Math.log(1 + y.lift) - x.count * Math.log(1 + x.lift)).slice(0, 12);
  const basket = { orders: good.length, multi: r1(T.multi * 100), prevMulti: r1(P.multi * 100), upt: r2(T.upt), charmPrice: r0(charmPrice), chainAttach: r1(chainAttach.rate * 100), attachStores, pairs };

  // ---- stock: run-out risk, transfers, slow stock, range gaps ----
  const st = await latestStock();
  const stockOut = { available: false };
  let stockOf = () => null; // { pcs: pieces in stores, wh: warehouse pieces } for a design, once the stock is read
  const actions = [];
  if (st) {
    const sRows = st.rows.filter(r => inZone(r[3]) || /warehouse/i.test(r[3]));
    const isWh = w => /warehouse|store\s*room|main\s*stock/i.test(w) && !/sample/i.test(w);
    const SB = new Map(); // design -> Map(storeName -> pieces) for real stores
    const WH = new Map(); // design -> pieces in the main warehouse(s)
    const sName = new Map(), sVal = new Map();
    for (const r of sRows) {
      const k = isCode(design(r[1])) ? design(r[1]) : design(r[0]); if (!k) continue;
      if (r[9] && !names.has(k)) sName.set(k, String(r[9]));
      const q = +r[7] || 0; if (q <= 0) continue;
      sVal.set(k, (sVal.get(k) || 0) + (+r[8] || 0));
      if (/sample/i.test(r[3])) continue;
      if (isWh(r[3])) { WH.set(k, (WH.get(k) || 0) + q); continue; }
      const br = storesAll.find(b => sameStore(b, r[3]));
      if (!br) continue;
      let m = SB.get(k); if (!m) SB.set(k, m = new Map());
      m.set(br, (m.get(br) || 0) + q);
    }
    const nameOf = k => names.get(k) || sName.get(k) || k;
    stockOf = k => { const m = SB.get(k); let t = 0; if (m) for (const q of m.values()) t += q; return { pcs: r0(t), wh: r0(WH.get(k) || 0) }; };
    for (const it of [...best, ...rising, ...falling]) { // stock on hand per store, shown in the item popup and next to every item
      const m = SB.get(it.key); it.stock = m ? Object.fromEntries([...m.entries()].map(([b, q]) => [b, r0(q)])) : {}; it.hasStock = true;
      Object.assign(it, stockOf(it.key));
      it.out = (it.br || []).filter(b => b.units > 0 && !(it.stock[b.name] > 0)).length; // stores that sell it but hold none
    }
    // cooling items: is the fall a stock problem, or is the stock there and the item simply not moving?
    for (const it of falling) {
      const prevTot = it.br.reduce((t, b) => t + b.prev, 0) || 1;
      const emptied = it.br.filter(b => b.prev > 0 && !(it.stock[b.name] > 0));
      const share = emptied.reduce((t, b) => t + b.prev, 0) / prevTot;
      if (it.pcs === 0 && it.wh === 0) it.diag = { type: 'stock', text: 'Nothing left in any store or the warehouse – reorder.' };
      else if (it.pcs === 0) it.diag = { type: 'stock', text: `No stock in stores, ${it.wh} in the warehouse – send it out.` };
      else if (share >= 0.4) it.diag = { type: 'stock', text: `Empty in ${emptied.length} store${emptied.length === 1 ? '' : 's'} that sold ${r0(share * 100)}% of it before: ${emptied.slice(0, 3).map(b => pretty(b.name)).join(', ')}.` };
      else it.diag = { type: 'display', text: `${it.pcs} pieces on hand, so it is available – check where it sits in the store, the price, and whether the team is offering it.` };
    }
    const chainIC = chainItems; // design -> sales in the period (all stores)
    const scopeStores = pick === 'ALL' ? storeTable.map(s => s.name) : [pick];
    const restock = [], transfers = [], gaps = [], under = [];
    const used = new Map(); // design|store -> pieces already promised away
    const free = (k, b, pieces) => pieces - (used.get(k + '|' + b) || 0);
    const asp = k => { const o = chainIC.get(k); return o && o.units ? o.rev / o.units : 0; };
    const topKeys = [...chainIC.values()].filter(o => o.units > 0).sort((a, b) => b.rev - a.rev).slice(0, 250).map(o => o.key);
    for (const k of topKeys) {
      const o = chainIC.get(k), sb = SB.get(k) || new Map();
      for (const b of scopeStores) {
        const sold = o.br.get(b) || 0, have = sb.get(b) || 0;
        const rate = sold / days; // pieces per day
        if (sold >= 2 && rate * 7 >= 0.75) {
          const cover = rate ? have / rate : 999;
          if (cover < 14) {
            const need = Math.max(1, Math.ceil(rate * 30) - have);
            let src = null, qty = 0;
            const wh = (WH.get(k) || 0) - (used.get(k + '|WH') || 0);
            if (wh > 0) { qty = Math.min(need, wh); src = 'Main warehouse'; used.set(k + '|WH', (used.get(k + '|WH') || 0) + qty); }
            else {
              // a store holding more than 60 days of its own sales can spare the rest
              const donors = [...sb.entries()].filter(([s]) => s !== b).map(([s, q]) => { const r = (o.br.get(s) || 0) / days; const spare = Math.floor(free(k, s, q) - Math.ceil(r * 60)); return { s, spare }; }).filter(x => x.spare > 0).sort((a, c) => c.spare - a.spare);
              if (donors.length) { qty = Math.min(need, donors[0].spare); src = donors[0].s; used.set(k + '|' + src, (used.get(k + '|' + src) || 0) + qty); }
            }
            const rec = { key: k, name: nameOf(k), cat: o.cat, store: b, stock: have, perWeek: r1(rate * 7), cover: have ? r0(cover) : 0, need, source: src, qty, value: r0(Math.min(need, Math.max(qty, have === 0 ? need : qty)) * asp(k)) };
            if (src && src !== 'Main warehouse') transfers.push({ key: k, name: nameOf(k), cat: o.cat, from: src, to: b, qty, perWeekTo: r1(rate * 7), value: r0(qty * asp(k)) });
            restock.push(rec);
          }
        }
      }
      // range gap: most stores sell it, this store has none and sold none
      const sellers = [...o.br.entries()].filter(([, q]) => q > 0);
      if (storeTable.length >= 3 && sellers.length >= Math.max(2, Math.ceil(storeTable.length * 0.6))) {
        const avgSeller = sellers.reduce((t, [, q]) => t + q, 0) / sellers.length;
        for (const b of scopeStores) {
          if ((o.br.get(b) || 0) > 0 || (sb.get(b) || 0) > 0) continue;
          if (/online/i.test(b)) continue;
          gaps.push({ key: k, name: nameOf(k), cat: o.cat, store: b, sellers: sellers.length, avgUnits: r1(avgSeller), whStock: WH.get(k) || 0, value: r0(avgSeller * asp(k)) });
        }
        // under-selling: stock on hand but well below what the store's size predicts
        for (const b of scopeStores) {
          const sold = o.br.get(b) || 0, have = sb.get(b) || 0, share = (storeTable.find(s => s.name === b) || {}).share || 0;
          const expected = o.units * share / 100;
          if (have >= 2 && expected >= 4 && sold < expected * 0.4) under.push({ key: k, name: nameOf(k), cat: o.cat, store: b, sold, expected: r1(expected), stock: have, value: r0((expected - sold) * asp(k)) });
        }
      }
    }
    const prevIS = new Map(); for (const l of prev) { const kk = design(l.sku) + '|' + l.br; prevIS.set(kk, (prevIS.get(kk) || 0) + l.q); }
    // slow stock: pieces that did not sell in this store for two periods while other stores sell them -> move them
    const moves = [];
    for (const [k, sb] of SB) {
      const o = chainIC.get(k), pO = IP.get(k);
      for (const [b, q] of sb) {
        if (!scopeStores.includes(b) && pick !== 'ALL') continue;
        const soldHere = (o && o.br.get(b)) || 0, prevHere = prevIS.get(k + '|' + b) || 0;
        if (soldHere > 0 || prevHere > 0 || q < 2 || !o) continue;
        const best = [...o.br.entries()].filter(([s, u]) => s !== b && u >= 2).sort((a, c) => c[1] - a[1])[0];
        if (!best) continue;
        const spare = free(k, b, q); if (spare < 2) continue;
        const qty = Math.min(spare, Math.max(2, Math.ceil(best[1] / days * 30)));
        used.set(k + '|' + b, (used.get(k + '|' + b) || 0) + qty);
        moves.push({ key: k, name: nameOf(k), cat: o.cat, from: b, to: best[0], qty, soldAtTo: best[1], value: r0(qty * asp(k)) });
      }
    }
    // dead stock: no sales anywhere in either period
    const dead = [];
    const prevChain = new Set(prev.map(l => design(l.sku)));
    for (const [k, sb] of SB) {
      if (chainIC.has(k) || prevChain.has(k)) continue;
      let pieces = 0; const where = [];
      for (const [b, q] of sb) if (scopeStores.includes(b)) { pieces += q; where.push(b); }
      if (pieces < 2) continue;
      dead.push({ key: k, name: nameOf(k), pieces, stores: where.length, value: opt.canSeeValue ? r0((sVal.get(k) || 0) * (pieces / ([...sb.values()].reduce((a, c) => a + c, 0) + (WH.get(k) || 0) || pieces))) : 0 });
    }
    dead.sort((a, b) => (b.value || b.pieces) - (a.value || a.pieces));
    restock.sort((a, b) => b.value - a.value);
    gaps.sort((a, b) => b.value - a.value); under.sort((a, b) => b.value - a.value);
    const allMoves = transfers.concat(moves).sort((a, b) => b.value - a.value);
    Object.assign(stockOut, {
      available: true, at: st.at, excel: !!st.excel,
      restock: restock.slice(0, 30), restockCount: restock.length, outOfStock: restock.filter(r => r.stock === 0).length, atRiskValue: r0(restock.reduce((t, r) => t + r.value, 0)),
      transfers: allMoves.slice(0, 30), gaps: gaps.slice(0, 30), under: under.slice(0, 25),
      dead: dead.slice(0, 25), deadPieces: dead.reduce((t, d) => t + d.pieces, 0), deadValue: r0(dead.reduce((t, d) => t + (d.value || 0), 0)), deadItems: dead.length
    });
    for (const r of restock.slice(0, 12)) actions.push({ kind: 'restock', store: r.store, value: r.value, title: (r.stock === 0 ? 'Out of stock: ' : 'Restock now: ') + r.name, why: `Sells about ${r.perWeek} a week at ${pretty(r.store)} and ${r.stock === 0 ? 'none are left' : 'only ' + r.stock + ' left (' + r.cover + ' days)'}.`, items: [{ key: r.key, name: r.name }], todo: r.source ? `Send ${r.qty} from ${pretty(r.source)}${r.qty < r.need ? ', and order ' + (r.need - r.qty) + ' more' : ''}.` : `Order ${r.need} – no spare stock in the warehouse or other stores.`, item: r.key });
    for (const m of moves.slice(0, 8)) actions.push({ kind: 'move', store: m.from, value: m.value, title: `Move ${m.qty} × ${m.name}`, why: `Not one sold at ${pretty(m.from)} in ${days * 2} days, while ${pretty(m.to)} sold ${m.soldAtTo}.`, todo: `Transfer ${m.qty} pieces from ${pretty(m.from)} to ${pretty(m.to)}.`, items: [{ key: m.key, name: m.name }] });
    for (const g of gaps.slice(0, 8)) actions.push({ kind: 'range', store: g.store, value: g.value, title: `Range gap: ${g.name}`, why: `${g.sellers} stores sell it (about ${g.avgUnits} each in this period); ${pretty(g.store)} has none on hand.`, todo: g.whStock ? `Send it from the main warehouse (${g.whStock} available).` : 'Add it to the next refill order.', items: [{ key: g.key, name: g.name }] });
    for (const u of under.slice(0, 6)) actions.push({ kind: 'push', store: u.store, value: u.value, title: `Push ${u.name} at ${pretty(u.store)}`, why: `${u.stock} in stock, sold ${u.sold} where the store's size predicts about ${u.expected}.`, todo: 'Move it to the front tray or window and brief the team today.', items: [{ key: u.key, name: u.name }] });
  }

  if (stockOut.available) {
    for (const p of pairs) { const a = stockOf(p.a), b = stockOf(p.b); p.pa = a.pcs; p.pb = b.pcs; p.wa = a.wh; p.wb = b.wh; }
  }

  // ---- sales team ----
  const team = { available: false };
  const sd = await staffData(from, to);
  if (sd && Array.isArray(sd.rows) && sd.rows.length) {
    const exG = new Set((sd.ex || []).map(g => sd.groups.indexOf(g)).filter(i => i >= 0));
    const gCat = sd.groups.map(g => catOfGroup(g, ''));
    const itemDesign = (sd.items || []).map(it => { const n = Array.isArray(it) ? it[0] : it, c = Array.isArray(it) ? it[1] : ''; const dn = design(n); return /^[A-Z0-9]{5,}$/.test(dn) && /\d/.test(dn) ? dn : design(c); });
    const people = sd.people.map(([name, si]) => ({ name, store: sd.stores[si], inv: new Map(), rev: 0, q: 0, cat: new Map(), items: new Map() }));
    for (const r of sd.rows) {
      if (exG.has(r[1]) || !gCat[r[1]]) continue;
      const p = people[r[0]]; if (!p || p.name === ADJ) continue;
      const o = p.inv.get(r[2]) || { q: 0, a: 0, cats: new Set() }; o.q += r[3]; o.a += r[4]; o.cats.add(gCat[r[1]]); p.inv.set(r[2], o);
      p.rev += r[4]; p.q += r[3];
      p.cat.set(gCat[r[1]], (p.cat.get(gCat[r[1]]) || 0) + r[4]);
      if (r[6] != null && itemDesign[r[6]]) p.items.set(itemDesign[r[6]], (p.items.get(itemDesign[r[6]]) || 0) + r[3]);
    }
    const act = people.filter(p => p.name !== ADJ && inZone(p.store) && (pick === 'ALL' || sameStore(p.store, pick)));
    const stat = p => { let orders = 0, units = 0, rev = 0, multi = 0, brc = 0, brcCharm = 0; for (const o of p.inv.values()) { if (o.a <= 0 || o.q <= 0) continue; orders++; units += o.q; rev += o.a; if (o.q >= 2) multi++; if (o.cats.has('Bracelets')) { brc++; if (o.cats.has('Charms')) brcCharm++; } } return { orders, units, rev, multi, brc, brcCharm }; };
    const byStore = new Map();
    for (const p of act) { p.s = stat(p); const k = p.store; const a = byStore.get(k) || { orders: 0, units: 0, rev: 0, multi: 0, brc: 0, brcCharm: 0, cat: new Map(), n: 0 }; for (const f of ['orders', 'units', 'rev', 'multi', 'brc', 'brcCharm']) a[f] += p.s[f]; for (const [c, v] of p.cat) a.cat.set(c, (a.cat.get(c) || 0) + v); a.n++; byStore.set(k, a); }
    const tips = {
      upt: 'Aim for a second piece in every sale: offer a matching charm, a safety chain or a clip before the bill.',
      attach: 'Every bracelet sale is a charm moment: ask what the bracelet is for and suggest a charm that tells that story.',
      atv: 'Lead with the full look: show the bracelet with two or three charms on it, and present Moments sets and gift sets first.',
      multi: 'Build the gift: when someone buys one piece, show the earrings or necklace that complete it.'
    };
    const list = [], pairUse = new Map();
    for (const p of act) {
      const s = p.s; if (s.orders < 5) continue;
      const a = byStore.get(p.store);
      const sUpt = a.orders ? a.units / a.orders : 0, sAtv = a.orders ? a.rev / a.orders : 0, sAttach = a.brc ? a.brcCharm / a.brc : 0;
      const upt = s.units / s.orders, atv = s.rev / s.orders, unit = s.units ? s.rev / s.units : 0, attach = s.brc ? s.brcCharm / s.brc : null;
      const opp = [];
      if (upt < sUpt) opp.push({ k: 'upt', v: (sUpt - upt) * s.orders * unit, txt: `UPT ${r2(upt)} vs store ${r2(sUpt)}` });
      if (attach !== null && s.brc >= 4 && attach < sAttach) opp.push({ k: 'attach', v: (sAttach - attach) * s.brc * (charmPrice || unit), txt: `Charm with bracelet ${r0(attach * 100)}% vs store ${r0(sAttach * 100)}%` });
      if (atv < sAtv && upt >= sUpt) opp.push({ k: 'atv', v: (sAtv - atv) * s.orders * 0.5, txt: `ATV ${fmtE(atv)} vs store ${fmtE(sAtv)}` });
      // category blind spot: a category the store sells a lot of that this person rarely sells
      let blind = null;
      for (const [c, v] of a.cat) { const sShare = a.rev ? v / a.rev : 0, mShare = s.rev ? (p.cat.get(c) || 0) / s.rev : 0; if (sShare >= 0.08 && mShare < sShare * 0.5 && (!blind || sShare - mShare > blind.gap)) blind = { cat: c, store: r0(sShare * 100), me: r0(mShare * 100), gap: sShare - mShare }; }
      let strong = null;
      for (const [c, v] of p.cat) { const sShare = a.rev ? (a.cat.get(c) || 0) / a.rev : 0, mShare = s.rev ? v / s.rev : 0; if (mShare >= 0.1 && mShare > sShare * 1.3 && (!strong || mShare - sShare > strong.gap)) strong = { cat: c, me: r0(mShare * 100), store: r0(sShare * 100), gap: mShare - sShare }; }
      opp.sort((x, y) => y.v - x.v);
      const main = opp[0];
      const top = [...p.items.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, q]) => ({ key: k, name: names.get(k) || k, units: r0(q), ...(stockOut.available ? stockOf(k) : {}) }));
      // make the tip about this person: the pair that goes with what they already sell best
      const topK = top.map(t => t.key);
      // the pair where they sell one side well and the other side rarely, not reused too often across the team
      let mate = null, ms = -1e9;
      for (const pp of pairs) {
        const qa = p.items.get(pp.a) || 0, qb = p.items.get(pp.b) || 0; if (!qa && !qb) continue;
        const sc = Math.abs(qa - qb) - (pairUse.get(pp.a + '|' + pp.b) || 0) * 3;
        if (sc > ms) { ms = sc; mate = { ...pp, flip: qb > qa }; }
      }
      if (mate) pairUse.set(mate.a + '|' + mate.b, (pairUse.get(mate.a + '|' + mate.b) || 0) + 1);
      let tip = main ? tips[main.k] : blind ? `Grow ${blind.cat}: it is ${blind.store}% of the store's sales but ${blind.me}% of yours. Show it with every sale.` : 'Keep doing what works and share it with the team in the morning briefing.';
      if (main && main.k === 'attach') tip = `Only ${r0(attach * 100)}% of their bracelet sales leave with a charm (store ${r0(sAttach * 100)}%). ` + tips.attach;
      else if (main && main.k === 'upt' && mate) { const has = mate.flip ? [mate.bn, mate.an] : [mate.an, mate.bn]; tip = `Second piece: with every ${has[0]} (they sell it well) offer ${has[1]} – customers buy them together ${mate.lift}× more than chance.`; }
      else if (main && main.k === 'upt' && blind) tip = `Second piece from ${blind.cat}: it is ${blind.store}% of the store's sales but only ${blind.me}% of theirs – suggest one with every sale.`;
      else if (main && main.k === 'atv' && strong) tip = `Trade up: open with ${strong.cat} (their strength) in the higher price band, and show sets before single pieces.`;
      list.push({
        name: p.name, store: p.store, rev: r0(s.rev), orders: s.orders, atv: r0(atv), upt: r2(upt), multi: r0(s.multi / s.orders * 100), attach: attach === null ? null : r0(attach * 100),
        storeUpt: r2(sUpt), storeAtv: r0(sAtv), storeAttach: r0(sAttach * 100),
        opportunity: r0(opp.reduce((t, o) => t + o.v, 0)), gaps: opp.map(o => o.txt), blind, strong, top,
        tip,
        focus: main ? main.k : blind ? 'cat' : 'keep'
      });
    }
    list.sort((a, b) => b.rev - a.rev);
    list.forEach((p, i) => { p.rank = i + 1; });
    const coach = list.filter(p => p.opportunity > 0).sort((a, b) => b.opportunity - a.opportunity);
    const storesTeam = [...byStore.entries()].filter(([k]) => pick === 'ALL' || sameStore(k, pick)).map(([k, a]) => ({ store: k, people: a.n, upt: a.orders ? r2(a.units / a.orders) : 0, atv: a.orders ? r0(a.rev / a.orders) : 0, attach: a.brc ? r0(a.brcCharm / a.brc * 100) : null }));
    Object.assign(team, { available: true, period: sd.period, people: list, coachTotal: r0(coach.reduce((t, p) => t + p.opportunity, 0)), stores: storesTeam });
    for (const p of coach.slice(0, 8)) actions.push({ kind: 'coach', store: p.store, value: p.opportunity, title: `Coach ${p.name} (${pretty(p.store)})`, why: p.gaps.join(' · ') || (p.blind ? `${p.blind.cat}: ${p.blind.me}% of sales vs store ${p.blind.store}%` : ''), todo: p.tip });
  }
  for (const a of attachStores.filter(a => a.gapValue > 0).sort((x, y) => y.gapValue - x.gapValue).slice(0, 4)) {
    actions.push({ kind: 'attach', store: a.name, value: a.gapValue, title: `Charm attach at ${pretty(a.name)}`, why: `${a.rate}% of bracelet sales leave with a charm; the chain does ${basket.chainAttach}%.`, todo: 'Pre-style bracelets with 2–3 charms on the counter and make "which charm tells your story?" the standard question.' });
  }
  if (pairs.length) { const p = pairs[0]; actions.push({ kind: 'bundle', store: pick === 'ALL' ? '' : pick, value: r0(p.count * 0.5 * T.asp), title: `Pair them: ${p.an} + ${p.bn}`, why: `Bought together ${p.count} times – ${p.lift}× more often than chance.`, todo: 'Display them side by side and suggest one whenever the other is picked up.', items: [{ key: p.a, name: p.an }, { key: p.b, name: p.bn }] }); }
  // a balanced plan: the best few of each kind, then ranked by value
  const CAP = { restock: 5, coach: 4, move: 3, range: 3, push: 2, attach: 2, bundle: 1 }, seen = {};
  actions.sort((a, b) => b.value - a.value);
  const plan = actions.filter(a => { seen[a.kind] = (seen[a.kind] || 0) + 1; return seen[a.kind] <= (CAP[a.kind] || 2) && a.value > 0; });
  actions.length = 0; actions.push(...plan);
  if (stockOut.available) for (const a of actions) for (const it of (a.items || [])) Object.assign(it, stockOf(it.key));

  // ---- headlines ----
  const H = [];
  const g = pct(T.rev, P.rev);
  H.push({ tone: g == null ? 'info' : g >= 0 ? 'good' : 'bad', text: `Revenue ${fmtE(T.rev)}${g == null ? '' : `, ${g >= 0 ? 'up' : 'down'} ${Math.abs(r1(g))}% on the previous ${days} days`} · ${T.orders.toLocaleString('en-US')} orders · ATV ${fmtE(T.atv)} · UPT ${r2(T.upt)}.` });
  const uptG = P.upt ? T.upt - P.upt : 0, atvG = pct(T.atv, P.atv);
  if (atvG != null && Math.abs(atvG) >= 3) H.push({ tone: atvG > 0 ? 'good' : 'bad', text: `Average ticket ${atvG > 0 ? 'rose' : 'fell'} ${Math.abs(r1(atvG))}% (UPT ${r2(P.upt)} → ${r2(T.upt)}). ${atvG < 0 ? 'Fewer pieces per customer is the first thing to fix: it is the cheapest sales you can get.' : 'Bigger baskets are driving the result.'}` });
  if (pick === 'ALL' && storeTable.length > 1) {
    const gr = storeTable.filter(s => s.growth != null && s.prev > 0);
    if (gr.length) { const up = gr.slice().sort((a, b) => b.growth - a.growth)[0], dn = gr.slice().sort((a, b) => a.growth - b.growth)[0]; if (up.growth > 0) H.push({ tone: 'good', text: `${pretty(up.name)} is the fastest-growing store (+${up.growth}%).` }); if (dn.growth < 0 && dn !== up) H.push({ tone: 'bad', text: `${pretty(dn.name)} is down ${Math.abs(dn.growth)}% – look at its actions first.` }); }
  }
  if (rising.length) H.push({ tone: 'good', item: { key: rising[0].key, name: rising[0].name }, text: `Rising star: ${rising[0].name} sold ${rising[0].units} (from ${rising[0].prevUnits}). Make sure every store has it in the window.` });
  if (stockOut.available && stockOut.restock.length) H.push({ tone: 'bad', item: { key: stockOut.restock[0].key, name: stockOut.restock[0].name }, text: `${stockOut.restockCount} best-seller/store pairs will run out within 14 days${stockOut.outOfStock ? ` (${stockOut.outOfStock} already at zero)` : ''}: about ${fmtE(stockOut.atRiskValue)} of sales at risk. Biggest: ${stockOut.restock[0].name} at ${pretty(stockOut.restock[0].store)}.` });
  if (stockOut.available && stockOut.transfers.length) H.push({ tone: 'info', text: `${stockOut.transfers.length >= 30 ? '30+' : stockOut.transfers.length} transfers between stores would put idle stock where it sells, without buying anything.` });
  if (basket.attachStores.length > 1) { const lo = basket.attachStores.slice().sort((a, b) => a.rate - b.rate)[0]; if (lo.rate < basket.chainAttach) H.push({ tone: 'bad', text: `Only ${lo.rate}% of bracelet buyers at ${pretty(lo.name)} take a charm (chain ${basket.chainAttach}%).` }); }
  if (team.available && team.coachTotal) H.push({ tone: 'info', text: `Bringing every sales person up to their own store's average is worth about ${fmtE(team.coachTotal)} in this period.` });
  if (stockOut.available) for (const h of H) if (h.item) Object.assign(h.item, stockOf(h.item.key));
  const totalValue = r0(actions.slice(0, 15).reduce((t, a) => t + a.value, 0));

  return {
    ok: true, from, to, prevFrom, prevTo, days, dataFrom: minD, dataTo: maxD, store: pick, stores: storesAll,
    kpi: { rev: r0(T.rev), prevRev: r0(P.rev), units: r0(T.units), prevUnits: r0(P.units), orders: T.orders, prevOrders: P.orders, atv: r0(T.atv), prevAtv: r0(P.atv), upt: r2(T.upt), prevUpt: r2(P.upt), asp: r0(T.asp), prevAsp: r0(P.asp), daily: daily.map(r0), prevDaily: prevDaily.map(r0) },
    headlines: H, actions: actions.slice(0, 15), actionsValue: totalValue,
    storeTable, items: { best, rising, falling }, categories, collections, weekday: { names: wdNames, chain: weekdayChain, stores: weekdayStores }, payment, basket, stock: stockOut, team,
    generatedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
async function aiBrief(d, store) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'no-key' };
  const facts = {
    period: d.from + ' to ' + d.to, compared_with: d.prevFrom + ' to ' + d.prevTo, store: store === 'ALL' ? 'All stores' : store,
    kpi: d.kpi && { ...d.kpi, daily: undefined, prevDaily: undefined }, stores: d.storeTable, headlines: d.headlines.map(h => h.text),
    actions: d.actions.map(a => ({ title: a.title, why: a.why, todo: a.todo, value_egp: a.value })),
    best_items: d.items.best.slice(0, 8).map(i => ({ name: i.name, units: i.units, rev: i.rev, growth: i.growth })), rising: d.items.rising.slice(0, 5).map(i => ({ name: i.name, units: i.units, prev: i.prevUnits })), falling: d.items.falling.slice(0, 5).map(i => ({ name: i.name, units: i.units, prev: i.prevUnits })),
    categories: d.categories, collections: d.collections.slice(0, 8), payment: d.payment, basket: { ...d.basket, pairs: d.basket.pairs.slice(0, 5).map(p => p.an + ' + ' + p.bn + ' (' + p.count + 'x, lift ' + p.lift + ')') },
    stock: d.stock.available ? { at_risk_value: d.stock.atRiskValue, out_of_stock: d.stock.outOfStock, transfers: d.stock.transfers.length, dead_items: d.stock.deadItems, dead_pieces: d.stock.deadPieces } : 'not available',
    team: d.team.available ? d.team.people.slice(0, 25).map(p => ({ name: p.name, store: p.store, rev: p.rev, atv: p.atv, upt: p.upt, store_upt: p.storeUpt, charm_attach: p.attach, opportunity: p.opportunity, gaps: p.gaps })) : 'not available'
  };
  const prompt = 'You are the retail sales director for Pandora jewellery stores in Egypt. From the facts below (all amounts are EGP before VAT), write a sharp management brief.\n' +
    'Format exactly:\n## The story in 30 seconds\n(3 sentences)\n## What is working\n(3 bullets)\n## What is costing us sales\n(3 bullets)\n## This week\'s 5 moves\n(numbered, each one concrete: who/where/what, with the EGP at stake)\n## Coaching notes\n(up to 4 bullets naming sales people and the one behaviour each should change)\n' +
    'Use only the facts given, quote the numbers, no generic advice, no preamble. Plain English a store manager understands.\n\nFACTS:\n' + JSON.stringify(facts);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.INSIGHTS_MODEL || 'claude-sonnet-5-5', max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(50000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: (j.error && j.error.message) || ('AI answered ' + r.status) };
  return { ok: true, text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), model: j.model };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (who.kind !== 'env') return send(res, 403, { ok: false, error: 'No access.' }); // super admin, brand manager, area managers
  const url = new URL(req.url, 'https://x.invalid'), q = url.searchParams;
  const zone = who.info.allow || null;
  const zoneRx = zone ? zone.map(s => new RegExp(s, 'i')) : null;
  const from = ISO.test(q.get('from') || '') ? q.get('from') : '', to = ISO.test(q.get('to') || '') ? q.get('to') : '', st = String(q.get('store') || 'ALL').slice(0, 80);
  const ck = 'insights/c/' + [from || 'auto', to || 'auto', st.replace(/[^A-Za-z0-9]+/g, '_'), zone ? who.info.role : 'all'].join('_') + '.json';
  let d = null;
  if (q.get('fresh') !== '1') { const c = await store.getJSON(ck).catch(() => null); if (c && c.ok && Date.now() - Date.parse(c.generatedAt) < CACHE_MIN * 60000) d = c; }
  if (!d) {
    try { d = await build({ from, to, store: st, zoneRx, canSeeValue: true }); }
    catch (e) { console.error('INSIGHTS_ERROR', e && e.stack || e); return send(res, 500, { ok: false, error: 'Could not build the report: ' + String(e && e.message || e).slice(0, 200) }); }
    if (d.ok && !d.empty) await store.putJSON(ck, d).catch(() => {});
  }
  if (req.method === 'POST' && q.get('op') === 'ai') {
    if (d.empty) return send(res, 200, { ok: false, error: 'No sales data yet.' });
    const ak = ck.replace('insights/c/', 'insights/ai/');
    const c = q.get('fresh') === '1' ? null : await store.getJSON(ak).catch(() => null);
    if (c && c.ok && c.basedOn === d.generatedAt) return send(res, 200, c);
    const a = await aiBrief(d, d.store).catch(e => ({ ok: false, error: String(e && e.message || e).slice(0, 200) }));
    if (a.ok) { a.basedOn = d.generatedAt; a.at = new Date().toISOString(); await store.putJSON(ak, a).catch(() => {}); }
    return send(res, 200, a);
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  return send(res, 200, { ...d, aiReady: !!process.env.ANTHROPIC_API_KEY, isAdmin: who.info.role === 'admin' && !who.info.overseer, zone: who.info.zone || null });
};
module.exports.build = build;
