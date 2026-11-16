// Pandora Assistant: the chat helper shown on every page (reached at /api/assistant, rewritten to api/vm.js: the plan limits the number of functions).
//   GET  /api/assistant   -> { ok, ready, mode }
//   POST /api/assistant   { messages: [{ role: 'user' | 'assistant', text, ctx? }] }  -> { ok, text, panels, ctx }
//
// FREE by default: the question is understood on the server by api/_askparse.js (dates, stores, categories, item code, what to split by),
// with no AI service, no key and no cost, and nothing leaves the server. The two lookups below (runSales, runStock) then work on the same
// saved sales lines as Pandora Dashboards and the same stock as Stock balance, and the answer is built from their figures.
// Optional: if ANTHROPIC_API_KEY is set in Vercel, Claude reads the question instead (it understands freer wording) and only chooses the
// same lookups; it never sees raw sales lines or works out a figure. If it fails (no credit, busy) the free engine answers. ASSISTANT_MODE=free forces the free engine.
//
// Who: the people who can open Pandora Dashboards (super admins, overseers, area managers). Area managers only ever get the stores of
// their zone, enforced in the lookups, whatever is asked. Nobody else gets the assistant, and it never changes anything (read only).
const store = require('./_store');
const { whoami } = require('./_auth');
const { dashRows } = require('./_sales');
const { sameStore, storeKey } = require('./_storekey');
const { cairoNow, cairoToday } = require('./_cairo');
const { tooMany } = require('./_ratelimit');

const API = 'https://api.anthropic.com/v1/messages';
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']; // first one the key can use; ASSISTANT_MODEL in Vercel overrides
const MAX_ROUNDS = 6, MAX_PANELS = 6, MAX_TURNS = 16;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CATS = ['Charms', 'Bracelets', 'Necklace and Pendant', 'Rings', 'Earrings', 'Accessories', 'Services'];
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_ORDER = [6, 0, 1, 2, 3, 4, 5]; // weeks start on Saturday, as on the dashboards
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  return b && typeof b === 'object' ? b : null;
}

// ---- who may use it (the same test decides whether api/site.js puts the button on the page) ----
function canUse(f) {
  const w = f && f.staff && f.staff.who;
  return !!(f && f.dash && !f.viewAs && !(f.hidden || []).includes('dashboards') && w && w.kind === 'env' && w.info && (w.info.role === 'admin' || w.info.allow));
}
function scopeOf(who) {
  const admin = who.info.role === 'admin';
  return { admin, rx: admin ? null : (who.info.allow || []).map(s => new RegExp(s, 'i')), zone: admin ? '' : String(who.info.zone || who.info.label || 'your zone') };
}

// ---- dates ----
const t = d => Date.parse(d + 'T00:00:00Z');
const addD = (d, n) => new Date(t(d) + n * 864e5).toISOString().slice(0, 10);
const diffD = (a, b) => Math.round((t(b) - t(a)) / 864e5);
function addM(d, n) { // the same day n months away; 31 March minus one month is 28 (or 29) February
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}
const fDay = d => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
function fRange(a, b) {
  if (a === b) return WD[new Date(t(a)).getUTCDay()].slice(0, 3) + ' ' + fDay(a);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${+a.slice(8)} to ${fDay(b)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${+a.slice(8)} ${MON[+a.slice(5, 7) - 1]} to ${fDay(b)}`;
  return `${fDay(a)} to ${fDay(b)}`;
}
const validDay = d => typeof d === 'string' && ISO.test(d) && !isNaN(t(d));

// ---- the sales lines, read once and kept for three minutes inside the running function ----
// Same rules as the Pandora Dashboards page (private/index.html): category names, payment names, what an order is.
function recat(c, name) {
  const n = String(name || '').toLowerCase(); c = String(c || '');
  if (c === 'Necklaces') return 'Necklace and Pendant';
  if (c && c !== 'Other' && c !== 'Unspecified') return c;
  if (/safety/.test(n)) return 'Charms'; if (/bracelet|bangle/.test(n)) return 'Bracelets'; if (/pendant|necklace|collier/.test(n)) return 'Necklace and Pendant';
  if (/charm|clip|dangle|spacer|medallion|murano/.test(n)) return 'Charms'; if (/earring|stud|hoop|huggie/.test(n)) return 'Earrings'; if (/\bring/.test(n)) return 'Rings';
  return 'Accessories';
}
const payOf = v => { const s = String(v || '').toLowerCase(); return /valu/.test(s) ? 'Valu' : /visa|card|master|credit|debit|pos/.test(s) ? 'Visa' : 'Cash'; };
let salesMemo = { at: 0, rows: null, pr: null };
function salesRows() {
  if (salesMemo.rows && Date.now() - salesMemo.at < 180000) return Promise.resolve(salesMemo.rows);
  if (!salesMemo.pr) {
    salesMemo.pr = dashRows().then(raw => {
      const out = [];
      for (const a of raw) {
        const d = String(a[0] || '').slice(0, 10); if (!ISO.test(d)) continue;
        const name = String(a[6] || '').trim();
        out.push({ d, inv: String(a[1]), q: Number(a[2]) || 0, net: Number(a[3]) || 0, gross: Number(a[4]) || 0, sku: String(a[5] || '').trim(), name, br: String(a[7] || '').trim() || 'Unspecified', cat: recat(a[8], name), pay: payOf(a[9]), col: String(a[10] || '').trim() });
      }
      out.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
      const vocab = new Set();
      for (const r of out) for (const w of (r.name + ' ' + r.col).toLowerCase().split(/[^a-z]+/)) if (w.length >= 3 && w.length <= 14) vocab.add(w);
      salesMemo = { at: Date.now(), rows: out, pr: null, vocab };
      return out;
    }, e => { salesMemo.pr = null; throw e; });
  }
  return salesMemo.pr;
}
const inScope = (rows, sc) => sc.rx ? rows.filter(r => sc.rx.some(x => x.test(r.br))) : rows;
// the stores this person may see that sold anything in the last 60 days of saved sales (a store with no sales in the answer still gets its card)
function liveStores(rows) {
  if (!rows.length) return [];
  const from = addD(rows[rows.length - 1].d, -60), s = new Set();
  for (let i = rows.length - 1; i >= 0 && rows[i].d >= from; i--) s.add(rows[i].br);
  return [...s].sort();
}

// An order = an invoice (per branch) whose sales and pieces are above zero: the rule of the dashboards.
function agg(rows, val) {
  let sales = 0, units = 0; const inv = new Map();
  for (const r of rows) {
    const v = val(r); sales += v; units += r.q;
    const k = r.br + '|' + r.inv; let o = inv.get(k); if (!o) inv.set(k, o = { v: 0, q: 0 }); o.v += v; o.q += r.q;
  }
  let orders = 0, ov = 0, oq = 0;
  for (const o of inv.values()) if (o.v > 0 && o.q > 0) { orders++; ov += o.v; oq += o.q; }
  return { sales, units, orders, atv: orders ? ov / orders : 0, upt: orders ? oq / orders : 0 };
}
const r0 = n => Math.round(n), r2 = n => Math.round(n * 100) / 100, r1 = n => Math.round(n * 10) / 10;
const chg = (a, b) => (b > 0 ? r1((a / b - 1) * 100) : null);
const words = s => String(s || '').toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(Boolean).slice(0, 8);
const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(x => String(x).trim()).filter(Boolean).slice(0, 12);

const DIMS = {
  store: r => r.br, category: r => r.cat, day: r => r.d, month: r => r.d.slice(0, 7), weekday: r => WD[new Date(t(r.d)).getUTCDay()],
  product: r => r.sku || r.name || 'No code', collection: r => r.col || 'Not classified', payment: r => r.pay
};
const DIM_LABEL = { store: 'by store', category: 'by category', day: 'day by day', month: 'month by month', weekday: 'by weekday', product: 'top products', collection: 'by collection', payment: 'by payment', none: '' };
const monthName = k => MON[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4);

function pickStores(wanted, known) {
  const hit = [], bad = [];
  for (const w of wanted) {
    const m = known.filter(b => sameStore(b, w));
    if (m.length) m.forEach(b => { if (!hit.includes(b)) hit.push(b); }); else bad.push(w);
  }
  return { hit, bad };
}
function pickCats(wanted) {
  const hit = [], bad = [];
  for (const w of wanted) {
    const s = w.toLowerCase();
    const c = CATS.find(c => c.toLowerCase() === s) || (/neck|pendant/.test(s) ? 'Necklace and Pendant' : /charm/.test(s) ? 'Charms' : /bracelet|bangle/.test(s) ? 'Bracelets' : /earring/.test(s) ? 'Earrings' : /ring/.test(s) ? 'Rings' : /access/.test(s) ? 'Accessories' : /service/.test(s) ? 'Services' : '');
    if (c) { if (!hit.includes(c)) hit.push(c); } else bad.push(w);
  }
  return { hit, bad };
}

// ---- tool: sales ----
function runSales(all, a, sc) {
  a = a || {};
  let from = a.from, to = a.to || a.from;
  if (!validDay(from) || !validDay(to)) return { error: 'Give "from" and "to" as YYYY-MM-DD.' };
  if (from > to) [from, to] = [to, from];
  const mine = inScope(all, sc);
  if (!mine.length) return { error: 'No sales are saved yet.' };
  const first = mine[0].d, last = mine[mine.length - 1].d;
  const basis = a.basis === 'gross' ? 'gross' : 'net';
  const val = basis === 'gross' ? r => r.gross : r => r.net;
  const by = DIMS[a.group_by] ? a.group_by : 'none';
  const then = DIMS[a.then_by] && a.then_by !== by && by !== 'none' ? a.then_by : '';
  const metric = ['units', 'orders', 'atv', 'upt'].includes(a.sort_by) ? a.sort_by : 'sales';
  const known = [...new Set(mine.map(r => r.br))];
  const st = pickStores(list(a.stores), known), ct = pickCats(list(a.categories));
  if (st.bad.length) return { error: 'Unknown store: ' + st.bad.join(', ') + '. The stores are: ' + liveStores(mine).join(', ') + '.' };
  if (ct.bad.length) return { error: 'Unknown category: ' + ct.bad.join(', ') + '. The categories are: ' + CATS.join(', ') + '.' };
  const q = words(a.search);
  const pass = r => (!st.hit.length || st.hit.includes(r.br)) && (!ct.hit.length || ct.hit.includes(r.cat)) &&
    (!q.length || (h => q.every(w => h.includes(w)))((r.sku + ' ' + r.name + ' ' + r.col).toLowerCase()));
  const cut = (f, e) => mine.filter(r => r.d >= f && r.d <= e && pass(r));
  const cur = cut(from, to);

  // what to compare with
  let cmp = null;
  const days = diffD(from, to) + 1;
  if (a.compare === 'previous_period') cmp = { f: addD(from, -days), e: addD(from, -1), text: days === 1 ? 'the day before' : 'the ' + days + ' days before' };
  else if (a.compare === 'last_week') cmp = { f: addD(from, -7), e: addD(to, -7), text: days === 1 ? 'the same day last week' : 'a week earlier' };
  else if (a.compare === 'last_month') cmp = { f: addM(from, -1), e: addM(to, -1), text: 'the same dates last month' };
  else if (a.compare === 'last_year') cmp = { f: addM(from, -12), e: addM(to, -12), text: 'the same dates last year' };
  else if (a.compare === 'custom' && validDay(a.cmp_from) && validDay(a.cmp_to)) { const f = a.cmp_from <= a.cmp_to ? a.cmp_from : a.cmp_to, e = a.cmp_from <= a.cmp_to ? a.cmp_to : a.cmp_from; cmp = { f, e, text: fRange(f, e) }; }
  const prev = cmp ? cut(cmp.f, cmp.e) : null;
  if (cmp && !prev.length) cmp.empty = true;

  const total = agg(cur, val), totalP = prev && prev.length ? agg(prev, val) : null;
  const group = (rows, dim) => { const m = new Map(), f = DIMS[dim]; for (const r of rows) { const k = f(r); let g = m.get(k); if (!g) m.set(k, g = []); g.push(r); } return m; };
  let groups = [], more = 0;
  if (by !== 'none') {
    const G = group(cur, by), P = prev && by !== 'day' && by !== 'month' ? group(prev, by) : null;
    if (by === 'store') for (const b of (st.hit.length ? st.hit : liveStores(mine))) if (!G.has(b)) G.set(b, []); // every store gets a card, sold or not
    if (by === 'day' && days <= 92) for (let d = from; d <= to; d = addD(d, 1)) if (!G.has(d) && d >= first && d <= last) G.set(d, []);
    for (const [k, rows] of G) {
      const x = agg(rows, val), p = P && P.get(k) ? agg(P.get(k), val) : null;
      const g = { key: k, name: k, sales: x.sales, units: x.units, orders: x.orders, atv: x.atv, upt: x.upt, share: total.sales > 0 ? x.sales / total.sales : 0 };
      if (P) { g.prev = p ? p.sales : 0; g.d = p ? chg(x.sales, p.sales) : null; }
      if (by === 'product') { const nm = new Map(); for (const r of rows) nm.set(r.name, (nm.get(r.name) || 0) + 1); g.name = [...nm.entries()].sort((a, b) => b[1] - a[1])[0][0] || k; g.sku = rows[0].sku; g.cat = rows[0].cat; }
      if (by === 'month') g.name = monthName(k);
      if (by === 'day') g.name = fDay(k).replace(/ \d{4}$/, '');
      if (then) {
        const S = [...group(rows, then).entries()].map(([sk, rr]) => { const y = agg(rr, val); return { name: then === 'month' ? monthName(sk) : then === 'product' ? (rr[0].name || sk) : sk, sku: then === 'product' ? rr[0].sku : undefined, sales: y.sales, units: y.units }; });
        S.sort((p1, p2) => (metric === 'units' ? p2.units - p1.units : p2.sales - p1.sales));
        g.sub = S.slice(0, then === 'category' || then === 'payment' ? 7 : 5);
      }
      groups.push(g);
    }
    if (by === 'day' || by === 'month') groups.sort((x, y) => (x.key < y.key ? -1 : 1));
    else if (by === 'weekday') groups.sort((x, y) => WD_ORDER.indexOf(WD.indexOf(x.key)) - WD_ORDER.indexOf(WD.indexOf(y.key)));
    else groups.sort((x, y) => y[metric] - x[metric] || y.sales - x.sales || String(x.name).localeCompare(String(y.name)));
    const lim = by === 'product' ? Math.min(50, Math.max(1, Number(a.limit) || 10)) : by === 'collection' ? Math.min(40, Math.max(1, Number(a.limit) || 12)) : by === 'day' ? 92 : 60;
    if (groups.length > lim) { more = groups.length - lim; groups = by === 'day' ? groups.slice(-lim) : groups.slice(0, lim); }
  }

  const filt = [st.hit.length ? st.hit.join(', ') : (sc.admin ? 'All stores' : sc.zone), ct.hit.length ? ct.hit.join(', ') : 'All categories'];
  if (q.length) filt.push('matching "' + String(a.search).trim().slice(0, 40) + '"');
  const notes = [];
  if (to > last) notes.push('Sales are saved up to ' + fDay(last) + '.');
  if (from < first) notes.push('Sales are saved from ' + fDay(first) + '.');
  if (!cur.length) notes.push('No sales lines match for these dates.');
  if (cmp && cmp.empty) notes.push('Nothing saved for ' + cmp.text + ', so there is no comparison.');
  if (more) notes.push(more + ' more not shown.');

  const auto = [q.length ? String(a.search).trim().slice(0, 30) + ' sales' : ct.hit.length === 1 ? ct.hit[0] : ct.hit.length ? ct.hit.length + ' categories' : 'Sales', DIM_LABEL[by]].filter(Boolean).join(' · ');
  const hash = new URLSearchParams(); hash.set('from', from); hash.set('to', to); if (ct.hit.length === 1) hash.set('cat', ct.hit[0]); if (basis === 'gross') hash.set('basis', 'gross');
  const panel = {
    type: 'sales', by, then, metric, title: String(a.title || auto).slice(0, 70), range: fRange(from, to), filters: filt.join(' · '), basis,
    cmp: cmp && !cmp.empty ? cmp.text : '', note: notes.join(' '), href: '/dashboards#' + hash.toString(),
    total: { sales: r2(total.sales), units: r2(total.units), orders: total.orders, atv: r2(total.atv), upt: r2(total.upt), prev: totalP ? r2(totalP.sales) : null, d: totalP ? chg(total.sales, totalP.sales) : null, pOrders: totalP ? totalP.orders : null, pAtv: totalP ? r2(totalP.atv) : null, pUpt: totalP ? r2(totalP.upt) : null, pUnits: totalP ? r2(totalP.units) : null },
    groups: groups.map(g => ({ name: String(g.name).slice(0, 90), key: by === 'day' ? g.key : undefined, sku: g.sku || undefined, cat: g.cat || undefined, sales: r2(g.sales), units: r2(g.units), orders: g.orders, atv: r2(g.atv), upt: r2(g.upt), share: Math.round(g.share * 1000) / 1000, d: g.d === undefined ? undefined : g.d, prev: g.prev === undefined ? undefined : r2(g.prev), sub: g.sub ? g.sub.map(s => ({ name: String(s.name).slice(0, 70), sku: s.sku, sales: r2(s.sales), units: r2(s.units) })) : undefined }))
  };
  // what Claude reads back: the same figures, rounded, short
  const forModel = {
    period: fRange(from, to), basis: basis === 'net' ? 'net sales in EGP, without VAT' : 'gross sales in EGP, with VAT', filters: filt.join(' · '),
    total: { sales_egp: r0(total.sales), pieces: r0(total.units), orders: total.orders, avg_order_egp: r0(total.atv), pieces_per_order: r2(total.upt), ...(totalP ? { compared_with: cmp.text, was_egp: r0(totalP.sales), change_pct: chg(total.sales, totalP.sales) } : {}) },
    ...(by !== 'none' ? { [by === 'product' ? 'products' : 'groups']: panel.groups.slice(0, 45).map(g => ({ name: g.name, ...(g.sku ? { sku: g.sku } : {}), sales_egp: r0(g.sales), pieces: r0(g.units), orders: g.orders, share_pct: r1(g.share * 100), ...(g.d != null ? { change_pct: g.d } : {}), ...(g.sub ? { [then]: g.sub.map(s => s.name + ': EGP ' + r0(s.sales) + ', ' + r0(s.units) + ' pcs') } : {}) })) } : {}),
    ...(notes.length ? { notes } : {})
  };
  return { panel, forModel };
}

// ---- tool: stock (the newest saved copy of the Stock balance; never asks ERP itself, so the answer is quick) ----
function stockCat(group, name) {
  const g = String(group || '').toLowerCase(), n = String(name || '').toLowerCase();
  let c = '';
  if (g.includes('maintenance') || g.includes('services')) c = 'Services';
  else if (g.includes('jewellery box') || g.includes('utility')) c = 'Accessories';
  else if (g.includes('earring')) c = 'Earrings'; else if (g.includes(' ring') || /^rings?$/.test(g)) c = 'Rings'; else if (g.includes('bracelet')) c = 'Bracelets'; else if (g.includes('necklace')) c = 'Necklace and Pendant';
  else if (['charm', 'clip', 'dangle', 'medallion', 'spacer'].some(x => g.includes(x))) c = 'Charms';
  if (c) return c;
  if (/safety/.test(n)) return 'Charms'; if (/bracelet|bangle/.test(n)) return 'Bracelets'; if (/pendant|necklace|collier/.test(n)) return 'Necklace and Pendant';
  if (/charm|clip|dangle|spacer|medallion|murano/.test(n)) return 'Charms'; if (/earring|stud|hoop|huggie/.test(n)) return 'Earrings'; if (/\bring/.test(n)) return 'Rings';
  return 'Other';
}
let stockMemo = { at: 0, v: null };
async function stockData() {
  if (stockMemo.v && Date.now() - stockMemo.at < 180000) return stockMemo.v;
  const today = cairoToday();
  let c = await store.getJSON('stock/r/' + today.slice(0, 8) + '01_' + today + '.json').catch(() => null), at = c && c.at;
  if (!c || !Array.isArray(c.rows) || !c.rows.length) {
    c = null;
    const idx = (await store.getJSON('stock/index.json').catch(() => null)) || [];
    let best = null;
    for (const k of idx.slice(-6)) { const x = await store.getJSON(k).catch(() => null); if (x && Array.isArray(x.rows) && x.rows.length && (!best || String(x.at) > String(best.at))) best = x; }
    if (best) { c = best; at = best.at; }
  }
  if (!c) { const snap = await store.getJSON('stock/current.json').catch(() => null); if (snap && Array.isArray(snap.rows) && snap.rows.length) { c = snap; at = snap.uploadedAt || snap.asOf || ''; } }
  if (!c) return null;
  // Row: [item code, item name, item group, warehouse, opening, in, out, balance qty, value, description]
  const rows = c.rows.map(r => ({ code: String(r[0] || '').trim(), name: String(r[9] || r[1] || '').trim(), design: String(r[1] || '').trim(), wh: String(r[3] || '').trim() || 'Unspecified', qty: Number(r[7]) || 0, cat: stockCat(r[2], r[9] || r[1]) }));
  stockMemo = { at: Date.now(), v: { rows, at: String(at || '') } };
  return stockMemo.v;
}
function runStock(data, a, sc) {
  a = a || {};
  if (!data) return { error: 'No stock balance is saved yet. Open the Stock balance page once so it reads ERP.' };
  let rows = sc.rx ? data.rows.filter(r => sc.rx.some(x => x.test(r.wh))) : data.rows;
  const known = [...new Set(rows.map(r => r.wh))].sort();
  const st = pickStores(list(a.stores), known), ct = pickCats(list(a.categories));
  if (st.bad.length) return { error: 'Unknown store: ' + st.bad.join(', ') + '. Stock is kept in: ' + known.join(', ') + '.' };
  if (ct.bad.length) return { error: 'Unknown category: ' + ct.bad.join(', ') + '.' };
  const q = words(a.search);
  rows = rows.filter(r => (!st.hit.length || st.hit.includes(r.wh)) && (!ct.hit.length || ct.hit.includes(r.cat)) && (!q.length || (h => q.every(w => h.includes(w)))((r.code + ' ' + r.design + ' ' + r.name).toLowerCase())));
  const by = ['store', 'item', 'category'].includes(a.group_by) ? a.group_by : 'store';
  const m = new Map();
  for (const r of rows) {
    const k = by === 'store' ? r.wh : by === 'category' ? r.cat : r.code || r.design;
    let g = m.get(k); if (!g) m.set(k, g = { name: by === 'item' ? (r.name || k) : k, sku: by === 'item' ? r.code : undefined, cat: by === 'item' ? r.cat : undefined, qty: 0, items: new Set(), wh: new Map() });
    g.qty += r.qty; if (r.qty > 0) g.items.add(r.code); if (by === 'item' && r.qty) g.wh.set(r.wh, (g.wh.get(r.wh) || 0) + r.qty);
  }
  if (by === 'store' && q.length) for (const w of (st.hit.length ? st.hit : known)) if (!m.has(w) && storeKey(w)) m.set(w, { name: w, qty: 0, items: new Set(), wh: new Map() }); // an item asked for: stores with none show 0
  let groups = [...m.values()];
  if (by === 'item' && a.in_stock_only !== false) groups = groups.filter(g => g.qty > 0);
  groups.sort((x, y) => y.qty - x.qty || String(x.name).localeCompare(String(y.name)));
  const lim = by === 'item' ? Math.min(50, Math.max(1, Number(a.limit) || 12)) : 40, more = Math.max(0, groups.length - lim);
  groups = groups.slice(0, lim);
  const total = rows.reduce((x, r) => x + r.qty, 0), items = new Set(rows.filter(r => r.qty > 0).map(r => r.code)).size;
  const filt = [st.hit.length ? st.hit.join(', ') : (sc.admin ? 'All stores and warehouses' : sc.zone), ct.hit.length ? ct.hit.join(', ') : 'All categories'];
  if (q.length) filt.push('matching "' + String(a.search).trim().slice(0, 40) + '"');
  const asOf = data.at ? (isNaN(Date.parse(data.at)) ? data.at : 'read ' + fDay(cairoNow(Date.parse(data.at)).toISOString().slice(0, 10)) + ' ' + cairoNow(Date.parse(data.at)).toISOString().slice(11, 16)) : '';
  const notes = []; if (!rows.length) notes.push('Nothing in stock matches.'); if (more) notes.push(more + ' more not shown.');
  const panel = {
    type: 'stock', by, title: String(a.title || ['Stock', q.length ? String(a.search).trim().slice(0, 30) : ct.hit.length === 1 ? ct.hit[0] : '', by === 'store' ? 'by store' : by === 'item' ? 'items' : 'by category'].filter(Boolean).join(' · ')).slice(0, 70),
    range: asOf, filters: filt.join(' · '), note: notes.join(' '), href: '/stock', total: { qty: r2(total), items },
    groups: groups.map(g => ({ name: String(g.name).slice(0, 90), sku: g.sku, cat: g.cat, qty: r2(g.qty), items: g.items.size, share: total > 0 ? Math.round(g.qty / total * 1000) / 1000 : 0, sub: by === 'item' ? [...g.wh.entries()].sort((x, y) => y[1] - x[1]).slice(0, 9).map(([n, v]) => ({ name: n, units: r2(v) })) : undefined }))
  };
  const forModel = { stock_as_of: asOf, filters: filt.join(' · '), total_pieces: r0(total), different_items_in_stock: items,
    [by === 'item' ? 'items' : 'groups']: panel.groups.slice(0, 45).map(g => ({ name: g.name, ...(g.sku ? { sku: g.sku } : {}), pieces: r0(g.qty), ...(by !== 'item' ? { different_items: g.items } : {}), ...(g.sub ? { where: g.sub.map(s => s.name + ': ' + r0(s.units)) } : {}) })), ...(notes.length ? { notes } : {}) };
  return { panel, forModel };
}

// ---- the tools Claude can call ----
const GROUPS = ['none', 'store', 'category', 'day', 'month', 'weekday', 'product', 'collection', 'payment'];
const TOOLS = [
  {
    name: 'sales',
    description: 'Look up Pandora Egypt sales from the saved sales lines (the same data as the Pandora Dashboards page). Returns the totals for the dates and, with group_by, one row per store / category / day / product and so on. Every call also shows the user a visual panel of exactly these figures (cards per store, a day chart, a product list with pictures), so call it once per thing the user should see. Money is EGP.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD. The same as "from" for one day.' },
        stores: { type: 'array', items: { type: 'string' }, description: 'Only these stores. Leave out for every store the user may see.' },
        categories: { type: 'array', items: { type: 'string', enum: CATS }, description: 'Only these categories. Leave out for all.' },
        search: { type: 'string', description: 'Only items whose code, name or collection contains these words (for example a SKU like 791725C01, or "heart").' },
        group_by: { type: 'string', enum: GROUPS, description: '"store" shows one card per store. "none" gives just the totals.' },
        then_by: { type: 'string', enum: GROUPS.slice(1), description: 'Optional second split shown inside each group, for example group_by store and then_by category.' },
        compare: { type: 'string', enum: ['none', 'previous_period', 'last_week', 'last_month', 'last_year', 'custom'], description: 'Adds the change against another period. For one day, last_week (the same weekday) is the fair comparison. custom = also give cmp_from and cmp_to.' },
        cmp_from: { type: 'string', description: 'With compare custom: first day of the other period, YYYY-MM-DD.' },
        cmp_to: { type: 'string', description: 'With compare custom: last day of the other period.' },
        basis: { type: 'string', enum: ['net', 'gross'], description: 'net = without VAT (the default everywhere on the site). gross = with VAT.' },
        sort_by: { type: 'string', enum: ['sales', 'units', 'orders', 'atv', 'upt'], description: 'What ranks the groups and is shown biggest. Default sales. atv = average order value, upt = pieces per order.' },
        limit: { type: 'integer', description: 'How many products or collections to list (default 10 and 12).' },
        title: { type: 'string', description: 'Short title for the panel, in the language of the user.' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'stock',
    description: 'Look up the stock on hand now (pieces) from the newest saved Stock balance. Use it for "how many do we have", "which store holds item X", "stock of charms in every store". Shows the user a visual panel. No money values.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Item code (or the start of it) or words from the item name.' },
        stores: { type: 'array', items: { type: 'string' } },
        categories: { type: 'array', items: { type: 'string', enum: CATS.concat('Other') } },
        group_by: { type: 'string', enum: ['store', 'item', 'category'], description: '"store": pieces in each store. "item": a list of items with pictures and where each one is.' },
        in_stock_only: { type: 'boolean', description: 'For group_by item: leave out items with zero pieces (default true).' },
        limit: { type: 'integer' },
        title: { type: 'string' }
      }
    }
  },
  {
    name: 'why',
    description: 'Explains WHY sales changed between a period and the one before it: orders vs average order, and the stores, categories and items that moved it most. Use for "why did sales drop/rise". Shows a visual panel.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, compare: { type: 'string', enum: ['previous_period', 'last_week', 'last_month', 'last_year'] }, stores: { type: 'array', items: { type: 'string' } }, categories: { type: 'array', items: { type: 'string', enum: CATS } }, search: { type: 'string' }, basis: { type: 'string', enum: ['net', 'gross'] } }, required: ['from', 'to'] }
  },
  {
    name: 'forecast',
    description: 'Estimates where a month will finish from the days saved so far and each weekday\'s recent average (an estimate with a likely range, not a promise). Say it is an estimate.',
    input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM. Default the current month.' }, stores: { type: 'array', items: { type: 'string' } }, categories: { type: 'array', items: { type: 'string', enum: CATS } }, search: { type: 'string' }, basis: { type: 'string', enum: ['net', 'gross'] } } }
  },
  {
    name: 'staff',
    description: 'Staff Performance: sales per sales person (or per store) from the Staff Performance data. Use for "who sold the most", "how is Ahmed doing", staff ranking. Sales before VAT unless basis gross. Only if the person can open Staff Performance.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, stores: { type: 'array', items: { type: 'string' } }, categories: { type: 'array', items: { type: 'string', enum: CATS } }, person: { type: 'string', description: 'Part of a sales person\'s name.' }, group_by: { type: 'string', enum: ['person', 'store'] }, sort_by: { type: 'string', enum: ['sales', 'units', 'orders', 'atv', 'upt'] }, compare: { type: 'string', enum: ['none', 'previous_period', 'last_week', 'last_month'] }, basis: { type: 'string', enum: ['net', 'gross'] }, limit: { type: 'integer' } }, required: ['from', 'to'] }
  },
  {
    name: 'slow_stock',
    description: 'The Slowmoving report: stock that is not selling, per store, item or category (pieces and age, never prices). Use for slow moving, stuck, dead stock, never sold. Only if the person can open Slowmoving.',
    input_schema: { type: 'object', properties: { stores: { type: 'array', items: { type: 'string' } }, categories: { type: 'array', items: { type: 'string', enum: CATS } }, search: { type: 'string' }, group_by: { type: 'string', enum: ['store', 'item', 'category'] }, limit: { type: 'integer' } } }
  },
  {
    name: 'restock',
    description: 'Items selling fast that have little stock left (days of cover from the last 28 days of sales and the saved stock). Use for "what should we reorder / restock / running out".',
    input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'Flag items with fewer than this many days of cover. Default 14.' }, stores: { type: 'array', items: { type: 'string' } }, categories: { type: 'array', items: { type: 'string', enum: CATS } }, search: { type: 'string' }, limit: { type: 'integer' } } }
  },
  {
    name: 'open_report',
    description: 'Show the user buttons that open pages of this site. Use it when another report answers the question better, or the user asks where to find something.',
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Report ids from the list in the instructions.' } }, required: ['ids'] }
  }
];

function systemPrompt(ctx) {
  const now = cairoNow(), today = now.toISOString().slice(0, 10);
  return [
    'You are the Pandora Assistant, the little robot mascot on the internal website of Pandora Egypt (jewellery stores), and you are powered by Claude, made by Anthropic. You are the personal AI of the management team: warm, quick, a little funny (one light joke at most, never at the cost of an exact answer). You answer questions about sales, stock, staff and slow stock exactly from the tools, and you also help with anything else they ask: writing messages, marketing and promotion ideas, planning, explaining, translating, brainstorming.',
    '',
    `Today is ${WD[now.getUTCDay()]} ${today} (Cairo). The week starts on Saturday. "Yesterday" is ${addD(today, -1)}.`,
    `You are talking to ${ctx.name || 'a manager'}. ${ctx.sc.admin ? 'They can see every store.' : 'They are an area manager and can see only these stores: the tools already limit every answer to them (' + ctx.sc.zone + '). Never say anything about other stores.'}`,
    `Stores with recent sales: ${ctx.stores.join(', ') || 'none saved yet'}.`,
    `Categories: ${CATS.join(', ')}.`,
    `Sales are saved from ${ctx.first || 'n/a'} to ${ctx.last || 'n/a'} (they come from the ERP every morning, so today is usually not in yet).`,
    `Reports this person can open (id: name): ${ctx.apps.map(a => a.id + ': ' + a.title).join('; ')}.`,
    '',
    'Rules:',
    '- Every figure must come from a tool result in this conversation. Never guess, estimate or work out a sales or stock figure from memory. If a tool returns nothing, say so plainly.',
    '- Each sales or stock tool call shows the user a visual panel with all the figures. So keep your text short: one to three sentences with the answer and the one or two things worth noticing (the best and weakest store, a big change). Do not repeat the whole table in text and do not describe the panel.',
    '- Pick the split the question needs: "in every store" -> group_by store; "each day" -> day; "best items" -> product; a single total -> none. When it helps, make two calls (for example the stores and the top products), but not more than three panels for one question.',
    '- Sales are net (without VAT) unless the user asks for gross or "with VAT". Write money as "EGP 12,345" with no decimals.',
    '- Work dates out yourself from today\'s date ("last week" = the last full Saturday to Friday week, "this month" = the 1st to today). If the year is missing, use the most recent such date. If a day is after the last saved day, say the sales for it are not in yet.',
    '- Ask a short question back only when you truly cannot tell what is wanted. Otherwise take the most likely reading and say which one you took.',
    '- Answer in the language the user writes in (English or Arabic). Plain text only: no tables, no headings, no emojis. You may use **bold** for the key figure.',
    '- You only read data. If asked to change, send, order or delete something, say you cannot and name the report where it is done.',
    '- Questions that are not about numbers (ideas, writing, advice, general knowledge): just help, fully but briefly, as a smart colleague would. For anything that needs a business figure, use a tool first. Never invent a figure.',
    '- Tools: sales (any sales question), why (why did it change), forecast (month end estimate), staff (sales people), slow_stock (Slowmoving), restock (what is running out), stock (pieces on hand), open_report (links).'
  ].join('\n');
}

// ---- the free engine: question -> lookup -> sentence ----
const egp = n => 'EGP ' + Math.round(n || 0).toLocaleString('en-US');
const nn = n => Math.round(n || 0).toLocaleString('en-US');
const dirWord = (d, ar) => (ar ? (d >= 0 ? 'ارتفاع' : 'انخفاض') : (d >= 0 ? 'up' : 'down'));
const mark = s => '**' + s + '**';
function chgText(T, cmp, ar) {
  if (T.d == null || !cmp) return '';
  return ar ? `, ${dirWord(T.d, true)} ${Math.abs(T.d)}% عن الفترة المقارنة` : `, ${dirWord(T.d)} ${Math.abs(T.d)}% vs ${cmp}`;
}

// ================== smarter, still free: why / forecast / restock & slow / briefing ==================
const baseSku = v => String(v || '').trim().toUpperCase().split('-')[0];
const stockSku = r => { const c = baseSku(r.code); if (/^\d{5,6}[A-Z0-9]*$/.test(c)) return c; const m = /^\s*([0-9]{5,6}[A-Z0-9]{0,6})/i.exec(r.design || r.name || ''); return m ? m[1].toUpperCase() : c; };
const sd = xs => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1)); };

// why did the numbers change: orders x average order, then the stores, categories and items that moved most
function whyRun(all, a, sc) {
  a = { ...a, compare: a.compare && a.compare !== 'none' ? a.compare : 'previous_period' };
  const one = (g, extra) => runSales(all, { ...a, group_by: g, then_by: undefined, sort_by: 'sales', limit: 50, ...extra }, sc);
  const T0 = one('none'); if (T0.error) return T0;
  const T = T0.panel.total;
  if (T.prev == null) return { error: 'There are no saved sales for ' + (T0.panel.cmp || 'the period before') + ', so there is nothing to compare with.' };
  const pick = (res, dim) => {
    const gs = (res.panel && res.panel.groups || []).filter(g => g.prev != null);
    const rows = gs.map(g => ({ name: g.name, sku: g.sku, diff: r0(g.sales - g.prev), d: g.d, cur: r0(g.sales), prev: r0(g.prev) })).filter(g => g.diff !== 0);
    const up = rows.filter(g => g.diff > 0).sort((x, y) => y.diff - x.diff).slice(0, 3), down = rows.filter(g => g.diff < 0).sort((x, y) => x.diff - y.diff).slice(0, 3);
    return { dim, up, down };
  };
  const movers = [pick(one('store'), 'Stores'), pick(one('category'), 'Categories'), pick(one('product'), 'Items')].filter(m => m.up.length || m.down.length);
  const drivers = [
    { name: 'Orders', cur: T.orders, prev: T.pOrders, d: chg(T.orders, T.pOrders), f: 'n' },
    { name: 'Average order', cur: T.atv, prev: T.pAtv, d: chg(T.atv, T.pAtv), f: 'egp' },
    { name: 'Pieces per order', cur: T.upt, prev: T.pUpt, d: chg(T.upt, T.pUpt), f: 'x' },
    { name: 'Pieces sold', cur: T.units, prev: T.pUnits, d: chg(T.units, T.pUnits), f: 'n' }
  ];
  const panel = { type: 'why', title: 'What moved sales', range: T0.panel.range, cmp: T0.panel.cmp, filters: T0.panel.filters, basis: T0.panel.basis, note: T0.panel.note, href: T0.panel.href,
    total: { sales: T.sales, prev: T.prev, d: T.d, diff: r0(T.sales - T.prev) }, drivers, movers };
  return { panel, forModel: { total: T, drivers, movers } };
}

// where the month is heading: what is saved so far + each remaining day at its weekday's recent average (a guide, not a promise)
function forecastRun(all, a, sc) {
  const mine = inScope(all, sc); if (!mine.length) return { error: 'No sales are saved yet.' };
  const m = /^\d{4}-\d{2}$/.test(a.month || '') ? a.month : cairoToday().slice(0, 7);
  const ms = m + '-01', me = addD(addM(ms, 1), -1), saved = mine[mine.length - 1].d, today = cairoToday();
  const through = [me, saved, addD(today, -1)].sort()[0]; // today is still open: only whole days count
  if (through < ms) return { error: 'No whole day is saved yet for ' + monthName(m) + '.' };
  const base = { stores: a.stores, categories: a.categories, search: a.search, basis: a.basis, compare: 'none', group_by: 'day' };
  const cur = runSales(all, { ...base, from: ms, to: through }, sc); if (cur.error) return cur;
  const hist = runSales(all, { ...base, from: addD(through, -55), to: through }, sc);
  const soFar = cur.panel.total.sales, days = cur.panel.groups;
  const doneDays = diffD(ms, through) + 1, left = diffD(through, me);
  const wdv = [[], [], [], [], [], [], []];
  const first = mine[0].d;
  for (const g of hist.panel.groups) if (g.key >= first) wdv[new Date(t(g.key)).getUTCDay()].push(g.sales);
  const avgAll = hist.panel.groups.length ? hist.panel.groups.reduce((x, g) => x + g.sales, 0) / hist.panel.groups.length : 0;
  const avg = wdv.map(v => (v.length >= 3 ? v.reduce((x, y) => x + y, 0) / v.length : avgAll));
  const resid = []; for (const g of hist.panel.groups) { if (g.key >= first) resid.push(g.sales - avg[new Date(t(g.key)).getUTCDay()]); }
  const daily = days.map(g => ({ d: g.key, v: r0(g.sales) })); let est = 0;
  for (let d = addD(through, 1); d <= me; d = addD(d, 1)) { const v = avg[new Date(t(d)).getUTCDay()]; est += v; daily.push({ d, v: r0(v), est: true }); }
  const spread = Math.sqrt(left) * sd(resid), proj = soFar + est;
  const pm = addM(ms, -1), pe = addD(ms, -1);
  const last = runSales(all, { ...base, group_by: 'none', from: pm, to: pe }, sc), lastTD = runSales(all, { ...base, group_by: 'none', from: pm, to: addM(through, -1) < pe ? addM(through, -1) : pe }, sc);
  const lm = !last.error && last.panel.total.sales > 0 ? last.panel.total.sales : null, ltd = !lastTD.error && lastTD.panel.total.sales > 0 ? lastTD.panel.total.sales : null;
  const done = left === 0;
  const panel = { type: 'forecast', title: (done ? '' : 'Month-end estimate · ') + monthName(m), month: monthName(m), through: fDay(through), filters: cur.panel.filters, basis: cur.panel.basis, done,
    soFar: r0(soFar), projected: r0(proj), low: r0(Math.max(soFar, proj - spread)), high: r0(proj + spread), daysDone: doneDays, daysLeft: left, lastMonth: lm ? r0(lm) : null, lastMonthSoFar: ltd ? r0(ltd) : null,
    paceVsLast: ltd ? chg(soFar, ltd) : null, vsLastMonth: lm && !done ? chg(proj, lm) : (lm && done ? chg(soFar, lm) : null), daily,
    note: done ? '' : 'An estimate: it assumes each remaining day sells like the recent average for that weekday. Promotions, holidays and stock can change it.', href: '/dashboards' };
  return { panel, forModel: { ...panel, daily: undefined } };
}

// restock (selling fast, little left) and slow items (stock that does not sell): sales joined to the saved stock balance by item code
async function coverRun(all, data, a, sc) {
  if (!data) return { error: 'No stock balance is saved yet. Open the Stock balance page once so it reads ERP.' };
  const mine = inScope(all, sc); if (!mine.length) return { error: 'No sales are saved yet.' };
  const slow = a.mode === 'slow', threshold = Math.min(365, Math.max(1, Number(a.days) || (slow ? 60 : 14))), win = slow ? threshold : 28;
  const L = mine[mine.length - 1].d, from = addD(L, -(win - 1));
  const knownSt = [...new Set(data.rows.map(r => r.wh))], knownBr = [...new Set(mine.map(r => r.br))];
  const sw = pickStores(list(a.stores), knownSt), sb = pickStores(list(a.stores), knownBr), ct = pickCats(list(a.categories));
  if (sw.bad.length) return { error: 'Unknown store: ' + sw.bad.join(', ') + '.' };
  const okSt = r => !a.stores || !a.stores.length || sw.hit.includes(r.wh);
  const stock = (sc.rx ? data.rows.filter(r => sc.rx.some(x => x.test(r.wh))) : data.rows).filter(r => okSt(r) && (!ct.hit.length || ct.hit.includes(r.cat)) && r.qty > 0);
  const q = words(a.search);
  const sold = new Map(), seen = new Set(mine.map(r => baseSku(r.sku)));
  for (const r of mine) { if (r.d < from || (sb.hit.length && !sb.hit.includes(r.br)) || (ct.hit.length && !ct.hit.includes(r.cat))) continue; const k = baseSku(r.sku); sold.set(k, (sold.get(k) || 0) + r.q); }
  const items = new Map();
  for (const r of stock) {
    const k = stockSku(r); if (!k) continue;
    if (q.length && !q.every(w => (k + ' ' + r.design + ' ' + r.name).toLowerCase().includes(w))) continue;
    let it = items.get(k); if (!it) items.set(k, it = { sku: k, name: r.name || r.design || k, cat: r.cat, qty: 0, wh: new Map() });
    it.qty += r.qty; it.wh.set(r.wh, (it.wh.get(r.wh) || 0) + r.qty);
  }
  let matched = 0; for (const k of items.keys()) if (seen.has(k)) matched++;
  if (!items.size) return { error: 'Nothing is in stock for that.' };
  if (!matched) return { error: 'I could not match the item codes in sales to the stock balance, so I cannot work out cover. Open Smart reorder or Slow moving from the menu for this.' };
  const days = Math.max(1, diffD(from > mine[0].d ? from : mine[0].d, L) + 1);
  const rows = [];
  for (const it of items.values()) {
    const s = sold.get(it.sku) || 0, perDay = s / days;
    const row = { name: String(it.name).slice(0, 80), sku: it.sku, cat: it.cat, qty: r2(it.qty), sold: r0(s), perDay: r2(perDay), days: perDay > 0 ? Math.round(it.qty / perDay) : null, where: [...it.wh.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([n, v]) => ({ name: n, units: r2(v) })) };
    if (slow ? (s === 0 && it.qty >= 3) : (s >= 2 && row.days != null && row.days <= threshold)) rows.push(row);
  }
  if (slow) rows.sort((x, y) => y.qty - x.qty); else rows.sort((x, y) => x.days - y.days || y.sold - x.sold);
  const lim = Math.min(30, Math.max(1, Number(a.limit) || 12)), more = Math.max(0, rows.length - lim);
  const asOf = data.at ? (isNaN(Date.parse(data.at)) ? data.at : 'read ' + fDay(cairoNow(Date.parse(data.at)).toISOString().slice(0, 10))) : '';
  const notes = []; if (more) notes.push(more + ' more not shown.'); if (slow && from < mine[0].d) notes.push('Sales are saved from ' + fDay(mine[0].d) + ', so older sales are not seen.');
  const filt = [sw.hit.length ? sw.hit.join(', ') : (sc.admin ? 'All stores and warehouses' : sc.zone), ct.hit.length ? ct.hit.join(', ') : 'All categories'];
  const panel = { type: 'cover', mode: slow ? 'slow' : 'restock', title: slow ? 'Slow stock · no sales in ' + threshold + ' days' : 'Restock · under ' + threshold + ' days of cover', range: 'Sales ' + fRange(from, L) + (asOf ? ' · stock ' + asOf : ''), filters: filt.join(' · '), note: notes.join(' '),
    href: '/stock', total: { items: rows.length, qty: r0(rows.reduce((x, y) => x + y.qty, 0)) }, rows: rows.slice(0, lim) };
  return { panel, forModel: { mode: panel.mode, items: rows.length, rows: panel.rows } };
}

// "worth a look": what jumped or fell the most in a by-store / by-category answer
function worthLook(p, ar) {
  if (ar || !p || p.type !== 'sales' || !['store', 'category', 'collection'].includes(p.by)) return '';
  const g = (p.groups || []).filter(x => x.prev != null && x.prev > 0 && x.d != null && Math.abs(x.sales - x.prev) >= 500);
  if (g.length < 2) return '';
  const dn = g.slice().sort((x, y) => x.d - y.d)[0], up = g.slice().sort((x, y) => y.d - x.d)[0], bits = [];
  if (dn.d <= -20) bits.push(mark(dn.name) + ' is down ' + Math.abs(dn.d) + '% (' + egp(dn.sales - dn.prev).replace('EGP -', '-EGP ') + ')');
  if (up.d >= 20 && up.name !== dn.name) bits.push(mark(up.name) + ' is up ' + up.d + '%');
  return bits.length ? 'Worth a look: ' + bits.join('; ') + '.' : '';
}
const fmtDiff = n => (n >= 0 ? '+' : '-') + egp(Math.abs(n));
function describeWhy(p) {
  const T = p.total, out = [];
  out.push(`Sales ${p.range} were ${mark(egp(T.sales))}, ${T.diff >= 0 ? 'up' : 'down'} ${mark(egp(Math.abs(T.diff)))}${T.d != null ? ' (' + (T.d >= 0 ? '+' : '') + T.d + '%)' : ''} vs ${p.cmp}.`);
  const o = p.drivers[0], v = p.drivers[1];
  if (o.d != null && v.d != null) {
    const big = Math.abs(o.d) >= Math.abs(v.d) ? o : v, small = big === o ? v : o;
    const w = x => (x.d >= 0 ? 'up ' : 'down ') + Math.abs(x.d) + '%';
    out.push(`It is mostly ${big === o ? 'the number of orders' : 'the size of each order'} (${big === o ? 'orders are' : 'the average order is'} ${w(big)}); ${small === o ? 'orders are' : 'the average order is'} ${Math.abs(small.d) < 3 ? 'about flat' : w(small)}.`);
  }
  const st = p.movers.find(m => m.dim === 'Stores'), dir = T.diff >= 0 ? 'up' : 'down', other = dir === 'up' ? 'down' : 'up';
  if (st && st[dir].length) out.push(`Biggest ${dir === 'up' ? 'gain' : 'drop'}: ${st[dir].slice(0, 2).map(x => mark(x.name) + ' ' + fmtDiff(x.diff)).join(', ')}.`);
  const ct = p.movers.find(m => m.dim === 'Categories'); if (ct && ct[dir].length) out.push(`By category: ${ct[dir].slice(0, 2).map(x => x.name + ' ' + fmtDiff(x.diff)).join(', ')}.`);
  const it = p.movers.find(m => m.dim === 'Items'); if (it && it[dir].length) out.push(`Item moving it most: ${mark(it[dir][0].name)} ${fmtDiff(it[dir][0].diff)}.`);
  if (st && st[other].length && st[other][0] && Math.abs(st[other][0].diff) >= Math.abs(T.diff) * 0.3) out.push(`Going the other way: ${st[other][0].name} ${fmtDiff(st[other][0].diff)}.`);
  return out.join('\n');
}
function describeForecast(p) {
  const out = [];
  if (p.done) out.push(`${mark(p.month)} closed at ${mark(egp(p.soFar))}${p.vsLastMonth != null ? ', ' + (p.vsLastMonth >= 0 ? 'up ' : 'down ') + Math.abs(p.vsLastMonth) + '% vs last month' : ''}.`);
  else {
    out.push(`${mark(p.month)} is heading for about ${mark(egp(p.projected))} (likely ${egp(p.low)} to ${egp(p.high)}). So far: ${egp(p.soFar)} in ${p.daysDone} days, ${p.daysLeft} to go.`);
    if (p.paceVsLast != null) out.push(`Pace vs the same days last month: ${p.paceVsLast >= 0 ? 'up ' : 'down '}${Math.abs(p.paceVsLast)}%.${p.lastMonth ? ' Last month finished at ' + egp(p.lastMonth) + '.' : ''}`);
    out.push('This is an estimate from each weekday’s recent average, not a promise.');
  }
  return out.join('\n');
}
function describeCover(p) {
  const R = p.rows;
  if (!R.length) return p.mode === 'slow' ? 'No stock with zero sales found for that. Good news.' : 'Nothing is close to running out for that.';
  if (p.mode === 'slow') return `${mark(p.total.items + ' items')} with stock but no sales in the period (${nn(p.total.qty)} pcs sitting). Most stock: ${mark(R[0].name)} (${nn(R[0].qty)} pcs${R[0].where[0] ? ', mostly ' + R[0].where[0].name : ''}).`;
  const out0 = R.filter(r => r.days <= 3);
  return `${mark(p.total.items + ' items')} may run out soon. Most urgent: ${mark(R[0].name)} – ${R[0].qty} pcs left, selling about ${R[0].perDay}/day (${R[0].days} ${R[0].days === 1 ? 'day' : 'days'}).${out0.length > 1 ? ' ' + out0.length + ' have 3 days or less.' : ''}`;
}

// ================== staff performance + the Slowmoving report ==================
const VAT = 1.14;
let staffMemo = { at: 0, cur: null };
async function staffCur() {
  if (staffMemo.cur && Date.now() - staffMemo.at < 180000) return staffMemo.cur;
  const cur = await store.getJSON('data/current.json').catch(() => null);
  staffMemo = { at: Date.now(), cur };
  return cur;
}
async function staffVocab() {
  const cur = await staffCur(), v = new Set();
  if (cur && Array.isArray(cur.people)) for (const p of cur.people) for (const w of String(p[0] || '').toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) v.add(w);
  return v;
}
// per sales person (or per store) from the Staff Performance data: [person, group, invoice, qty, amount before VAT, day, item]
async function staffRun(a, sc) {
  a = a || {};
  if (!validDay(a.from) || !validDay(a.to)) return { error: 'Give the dates as YYYY-MM-DD.' };
  const D = require('./data'), cur = await staffCur();
  if (!cur) return { error: 'No Staff Performance data is saved yet. Sync it from All Uploads first.' };
  const load = (f, e) => D.loadData(new URLSearchParams({ from: f, to: e }), cur);
  const basis = a.basis === 'gross' ? 'gross' : 'net', mul = basis === 'gross' ? VAT : 1;
  const by = a.group_by === 'store' ? 'store' : 'person';
  const words_ = words(a.person), ct = pickCats(list(a.categories));
  const wantSt = list(a.stores);
  const calc = d => {
    const exs = new Set((d.ex || []).map(g => d.groups.indexOf(g)).filter(i => i >= 0));
    const known = d.stores.filter(n => !sc.rx || sc.rx.some(x => x.test(n)));
    const st = pickStores(wantSt, known);
    const out = new Map(), tot = { inv: new Map(), sales: 0, units: 0 };
    const bad = st.bad;
    for (const r of d.rows) {
      if (exs.has(r[1])) continue;
      const p = d.people[r[0]]; if (!p) continue;
      const sn = d.stores[p[1]]; if (!known.includes(sn)) continue;
      if (st.hit.length && !st.hit.includes(sn)) continue;
      if (ct.hit.length && !ct.hit.includes(stockCat(d.groups[r[1]], ''))) continue;
      if (words_.length && !words_.every(w => String(p[0]).toLowerCase().includes(w))) continue;
      const key = by === 'store' ? sn : p[0] + '|' + sn, v = r[4] * mul;
      let g = out.get(key); if (!g) out.set(key, g = { name: by === 'store' ? sn : p[0], store: sn, sales: 0, units: 0, inv: new Map() });
      g.sales += v; g.units += r[3]; const o = g.inv.get(r[2]) || { v: 0, q: 0 }; o.v += v; o.q += r[3]; g.inv.set(r[2], o);
      tot.sales += v; tot.units += r[3]; const t = tot.inv.get(key.split('|')[0] + '#' + sn + '#' + r[2]) || { v: 0, q: 0 }; t.v += v; t.q += r[3]; tot.inv.set(key.split('|')[0] + '#' + sn + '#' + r[2], t);
    }
    const fin = g => { let n = 0, ov = 0, oq = 0; for (const o of g.inv.values()) if (o.v > 0 && o.q > 0) { n++; ov += o.v; oq += o.q; } g.orders = n; g.atv = n ? ov / n : 0; g.upt = n ? oq / n : 0; return g; };
    const groups = [...out.values()].map(fin);
    const T = fin({ inv: tot.inv, sales: tot.sales, units: tot.units });
    return { groups, T, bad, hit: st.hit, known };
  };
  const d = await load(a.from, a.to); if (!d) return { error: 'No Staff Performance data is saved for those dates.' };
  const C = calc(d);
  if (C.bad.length) return { error: 'Unknown store: ' + C.bad.join(', ') + '. The stores are: ' + C.known.join(', ') + '.' };
  // compare
  const days = diffD(a.from, a.to) + 1; let cmp = null, prev = null;
  if (a.compare === 'previous_period') cmp = { f: addD(a.from, -days), e: addD(a.from, -1), text: days === 1 ? 'the day before' : 'the ' + days + ' days before' };
  else if (a.compare === 'last_week') cmp = { f: addD(a.from, -7), e: addD(a.to, -7), text: days === 1 ? 'the same day last week' : 'a week earlier' };
  else if (a.compare === 'last_month') cmp = { f: addM(a.from, -1), e: addM(a.to, -1), text: 'the same dates last month' };
  if (cmp) { const dp = await load(cmp.f, cmp.e); if (dp) prev = calc(dp); }
  const pm = new Map(prev ? prev.groups.map(g => [by === 'store' ? g.name : g.name + '|' + g.store, g]) : []);
  const metric = ['units', 'orders', 'atv', 'upt'].includes(a.sort_by) ? a.sort_by : 'sales';
  let groups = C.groups.filter(g => g.sales !== 0 || g.units !== 0).sort((x, y) => y[metric] - x[metric] || y.sales - x.sales);
  const lim = Math.min(40, Math.max(1, Number(a.limit) || 10)), more = Math.max(0, groups.length - lim);
  groups = groups.slice(0, lim);
  const notes = [];
  if (!C.groups.length) notes.push('No staff sales match for these dates.');
  if (d.dayMax && a.to > d.dayMax) notes.push('Staff data is saved up to ' + fDay(d.dayMax) + '.');
  if (d.dayMin && a.from < d.dayMin) notes.push('Staff data is saved from ' + fDay(d.dayMin) + '.');
  if (more) notes.push(more + ' more not shown.');
  const T = C.T, TP = prev ? prev.T : null;
  const filt = [C.hit.length ? C.hit.join(', ') : (sc.admin ? 'All stores' : sc.zone), ct.hit.length ? ct.hit.join(', ') : 'All categories'];
  if (words_.length) filt.push('person: ' + String(a.person).slice(0, 30));
  const panel = { type: 'staff', by, metric, title: by === 'store' ? 'Staff sales · by store' : words_.length ? 'Sales person · ' + String(a.person).slice(0, 24) : 'Sales people · top ' + groups.length, range: fRange(a.from, a.to), filters: filt.join(' · '), basis,
    cmp: cmp && prev ? cmp.text : '', note: notes.join(' '), href: '/staff?from=' + a.from + '&to=' + a.to,
    total: { sales: r2(T.sales), units: r2(T.units), orders: T.orders, atv: r2(T.atv), upt: r2(T.upt), prev: TP ? r2(TP.sales) : null, d: TP ? chg(T.sales, TP.sales) : null, people: by === 'person' ? C.groups.filter(g => g.sales > 0).length : undefined },
    groups: groups.map(g => { const p = pm.get(by === 'store' ? g.name : g.name + '|' + g.store); return { name: g.name, store: by === 'person' ? g.store : undefined, sales: r2(g.sales), units: r2(g.units), orders: g.orders, atv: r2(g.atv), upt: r2(g.upt), share: T.sales > 0 ? Math.round(g.sales / T.sales * 1000) / 1000 : 0, ...(prev ? { prev: p ? r2(p.sales) : 0, d: p ? chg(g.sales, p.sales) : null } : {}) }; }) };
  return { panel, forModel: { period: panel.range, filters: panel.filters, total: panel.total, groups: panel.groups.slice(0, 30) } };
}
const describeStaff = (res, q) => {
  const p = res.panel, T = p.total, G = p.groups, out = [];
  if (!G.length) return 'No staff sales found for ' + p.range + (p.note ? '. ' + p.note : '.');
  const key = ['units', 'orders'].includes(p.metric) ? p.metric : 'sales';
  const fmt = g => key === 'units' ? nn(g.units) + ' pcs' : key === 'orders' ? nn(g.orders) + ' orders' : egp(g.sales);
  const one = p.by === 'person' && /^Sales person/.test(p.title);
  if (one) {
    out.push(`${mark(G[0].name)}${G[0].store ? ' (' + G[0].store + ')' : ''}, ${p.range}: ${mark(egp(G[0].sales))}${G[0].d != null && p.cmp ? ', ' + (G[0].d >= 0 ? 'up ' : 'down ') + Math.abs(G[0].d) + '% vs ' + p.cmp : ''}.`);
    out.push(`${nn(G[0].orders)} orders, ${nn(G[0].units)} pcs, average order ${egp(G[0].atv)}, ${(G[0].upt || 0).toFixed(2)} pcs per order.`);
    if (G.length > 1) out.push('Several people match that name: ' + G.slice(0, 4).map(g => g.name + (g.store ? ' (' + g.store + ')' : '')).join(', ') + '.');
  } else {
    out.push(`${p.by === 'store' ? 'Staff sales by store' : 'Top sales people'}${p.filters && p.filters.split(' · ')[0] !== 'All stores' ? ' (' + p.filters.split(' · ')[0] + ')' : ''}, ${p.range}: total ${mark(egp(T.sales))}${chgText(T, p.cmp)}.`);
    out.push(`${q.rank && q.rank.dir === 'bottom' ? 'Lowest' : 'Top'}: ${mark((q.rank && q.rank.dir === 'bottom' ? G[G.length - 1] : G[0]).name)}${p.by === 'person' && G[0].store ? ' (' + (q.rank && q.rank.dir === 'bottom' ? G[G.length - 1] : G[0]).store + ')' : ''} – ${fmt(q.rank && q.rank.dir === 'bottom' ? G[G.length - 1] : G[0])}.`);
    if (p.by === 'person' && T.people) out.push(`${T.people} people sold in this period.`);
  }
  if (q.notes.includes('nodatemonth')) out.push('You did not give a date, so I used this month so far.');
  return out.join('\n');
};

// The Slowmoving report: ERP's saved slow items per store (api/_slow.js snapshots). Pieces and ages only, never prices.
async function slowRun(a, sc) {
  a = a || {};
  const idx = await store.getJSON('slow/index.json').catch(() => null);
  const ents = idx ? Object.entries(idx) : [];
  if (!ents.length) return { empty: true };
  const known = ents.map(e => e[0]).filter(w => !sc.rx || sc.rx.some(x => x.test(w)));
  const st = pickStores(list(a.stores), known), ct = pickCats(list(a.categories));
  if (st.bad.length) return { error: 'Unknown store: ' + st.bad.join(', ') + '. The slow report covers: ' + known.join(', ') + '.' };
  const q = words(a.search), items = [];
  let at = '', months = 0;
  for (const [wh, v] of ents) {
    if (!known.includes(wh) || (st.hit.length && !st.hit.includes(wh))) continue;
    const snap = await store.getJSON('slow/w/' + v.k + '.json').catch(() => null); if (!snap || !Array.isArray(snap.rows)) continue;
    at = at && at > String(snap.at) ? at : String(snap.at || ''); months = Math.max(months, Number(snap.months) || 0);
    const cols = snap.cols || [], ci = rx => cols.findIndex(c => rx.test(String(c.fieldname || '') + ' ' + String(c.label || '')));
    let iS = ci(/(^|\s)_?sku\b/i), iN = ci(/item[_ ]?name/i), iQ = ci(/bal|qty/i), iL = ci(/last.*(sale|sold)/i), iI = ci(/idle|age/i), iC = ci(/categ|item[_ ]?group|group/i);
    if (iS < 0) iS = 0; if (iN < 0) iN = 3; if (iQ < 0) iQ = 6; if (iL < 0) iL = 7; if (iI < 0) iI = 8; if (iC < 0) iC = 5;
    for (const r of snap.rows) {
      const name = String(r[iN] || ''), cat = stockCat(r[iC], name), qty = Number(r[iQ]) || 0; if (!(qty > 0)) continue;
      if (ct.hit.length && !ct.hit.includes(cat)) continue;
      const sku = String(r[iS] || '').toUpperCase();
      if (q.length && !q.every(w => (sku + ' ' + name).toLowerCase().includes(w))) continue;
      const idle = String(r[iI] || ''), never = /never/i.test(idle) || !r[iL], months_ = never ? 99 : Number(String(idle).replace(/[^\d]/g, '')) || 0;
      items.push({ wh, sku, name, cat, qty, never, months: months_, last: String(r[iL] || '') });
    }
  }
  if (!items.length) return { panelEmpty: true, filt: [st.hit.join(', ') || 'All stores', ct.hit.join(', ') || 'All categories'] };
  const by = ['store', 'item', 'category'].includes(a.group_by) ? a.group_by : 'store';
  const m = new Map();
  for (const it of items) {
    const k = by === 'store' ? it.wh : by === 'category' ? it.cat : it.sku;
    let g = m.get(k); if (!g) m.set(k, g = { name: by === 'item' ? it.name : k, sku: by === 'item' ? it.sku : undefined, cat: by === 'item' ? it.cat : undefined, qty: 0, lines: 0, never: 0, oldest: 0, wh: new Map() });
    g.qty += it.qty; g.lines++; if (it.never) g.never++; g.oldest = Math.max(g.oldest, it.months); g.wh.set(it.wh, (g.wh.get(it.wh) || 0) + it.qty);
  }
  let groups = [...m.values()].sort((x, y) => y.qty - x.qty || String(x.name).localeCompare(String(y.name)));
  const lim = by === 'item' ? Math.min(40, Math.max(1, Number(a.limit) || 12)) : 40, more = Math.max(0, groups.length - lim);
  groups = groups.slice(0, lim);
  const tot = items.reduce((x, y) => x + y.qty, 0), never = items.filter(i => i.never).length;
  const atTxt = at && !isNaN(Date.parse(at)) ? 'saved ' + fDay(cairoNow(Date.parse(at)).toISOString().slice(0, 10)) : '';
  const filt = [st.hit.length ? st.hit.join(', ') : (sc.admin ? 'All stores' : sc.zone), ct.hit.length ? ct.hit.join(', ') : 'All categories'];
  const panel = { type: 'slow', by, title: by === 'store' ? 'Slow items · by store' : by === 'category' ? 'Slow items · by category' : 'Slowest stock · items', range: [atTxt, months ? 'no sale in ' + months + '+ months' : ''].filter(Boolean).join(' · '), filters: filt.join(' · '), note: more ? more + ' more not shown.' : '', href: '/slow2',
    total: { lines: items.length, qty: r0(tot), never, skus: new Set(items.map(i => i.sku)).size },
    groups: groups.map(g => ({ name: String(g.name).slice(0, 90), sku: g.sku, cat: g.cat, qty: r0(g.qty), lines: g.lines, never: g.never, oldest: g.oldest, share: tot > 0 ? Math.round(g.qty / tot * 1000) / 1000 : 0, sub: by === 'item' ? [...g.wh.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([n, v]) => ({ name: n, units: r0(v) })) : undefined })) };
  return { panel, forModel: { total: panel.total, groups: panel.groups.slice(0, 30) } };
}
const describeSlow = (res, q) => {
  const p = res.panel, T = p.total, G = p.groups, out = [];
  out.push(`${mark(nn(T.qty) + ' pcs')} of slow stock across ${nn(T.lines)} item lines (${nn(T.skus)} different items)${T.never ? ', ' + nn(T.never) + ' never sold' : ''}.`);
  if (p.by === 'store' && G.length > 1) out.push(`Most stuck: ${mark(G[0].name)} (${nn(G[0].qty)} pcs, ${G[0].lines} lines).`);
  else if (p.by === 'item') out.push(`Biggest pile: ${mark(G[0].name)}${G[0].sku ? ' (' + G[0].sku + ')' : ''} – ${nn(G[0].qty)} pcs${G[0].sub && G[0].sub[0] ? ', most in ' + G[0].sub[0].name : ''}.`);
  else if (G.length > 1) out.push(`Most: ${mark(G[0].name)} (${nn(G[0].qty)} pcs).`);
  out.push('Open Slowmoving 2.0 for what to do with each item.');
  return out.join('\n');
};

function describe(res, q) {
  const p = res.panel, a = q.args, ar = q.ar, T = p.total || {}, G = p.groups || [];
  const out = [];
  if (p.type === 'stock') {
    const scope = (p.filters || '').split(' · ')[0] || '';
    const cats = (a.categories || []).join(' and ');
    if (!G.length || (!T.qty && !T.items)) return ar ? 'لا يوجد مخزون مطابق.' : 'Nothing in stock matches that.';
    out.push(ar ? `${mark(nn(T.qty) + ' قطعة')} في المخزون${cats ? ' (' + cats + ')' : ''}.` : `${mark(nn(T.qty) + ' pcs')} in stock${cats ? ' (' + cats + ')' : ''} · ${scope}.`);
    if (p.by === 'item') {
      const top = G[0]; out.push(ar ? `${G.length} صنف. الأكثر: ${mark(top.name)} (${nn(top.qty)}).` : `${G.length} ${G.length === 1 ? 'item' : 'items'} found. ${mark(top.name)}${top.sku ? ' (' + top.sku + ')' : ''}: ${nn(top.qty)} pcs${top.sub && top.sub[0] ? ', most in ' + top.sub[0].name + ' (' + nn(top.sub[0].units) + ')' : ''}.`);
    } else if (G.length > 1 && G[0].qty > 0) {
      const none = G.filter(g => g.qty <= 0).map(g => g.name);
      out.push((ar ? `الأعلى: ${mark(G[0].name)} (${nn(G[0].qty)}).` : `Most: ${mark(G[0].name)} (${nn(G[0].qty)} pcs).`) + (none.length ? (ar ? ' بدون مخزون: ' : ' None in: ') + none.slice(0, 6).join(', ') + '.' : ''));
    }
    return out.join('\n');
  }
  // sales
  const metric = p.metric, key = ['units', 'orders', 'atv', 'upt'].includes(metric) ? metric : 'sales';
  const fmt = g => key === 'atv' ? egp(g.atv) + (ar ? ' للطلب' : '/order') : key === 'upt' ? (Number(g.upt) || 0).toFixed(2) + (ar ? ' قطعة للطلب' : ' pcs/order') : key === 'units' ? nn(g.units) + (ar ? ' قطعة' : ' pcs') : key === 'orders' ? nn(g.orders) + (ar ? ' طلب' : ' orders') : egp(g.sales);
  const scope0 = (p.filters || '').split(' · ')[0] || 'All stores';
  const scope = scope0 === 'All stores' ? (ar ? 'كل الفروع' : 'all stores') : scope0;
  const cats = (a.categories || []).join(' and ');
  if (!T.sales && !T.units && !T.orders) return (ar ? 'لا توجد مبيعات مطابقة ل' : 'No sales found for ') + p.range + (p.note ? '. ' + p.note : '.');
  const head = ar ? `المبيعات${cats ? ' - ' + cats : ''} (${scope}) ${p.range}:` : `${cats ? cats + ' sales' : 'Sales'} (${scope}${p.basis === 'gross' ? ', with VAT' : ''}), ${p.range}:`;
  out.push(`${head} ${mark(key === 'atv' || key === 'upt' ? fmt(T) : fmt(T))}${key === 'sales' || key === 'units' || key === 'orders' ? chgText(T, p.cmp, ar) : ''}.`);
  if (q.rank && !ar) { const lv = G.filter(g => g[key] > 0); if (lv.length >= 2 && ['store', 'category', 'day', 'month', 'weekday', 'collection', 'product'].includes(p.by)) { const pick = q.rank.dir === 'bottom' ? lv.reduce((x, y) => (y[key] < x[key] ? y : x)) : lv.reduce((x, y) => (y[key] > x[key] ? y : x)); out.unshift((q.rank.dir === 'bottom' ? 'Lowest' : 'Highest') + ' ' + (p.by === 'product' ? 'item' : p.by) + ': ' + mark(pick.name) + ' (' + fmt(pick) + ').'); } }
  const live = G.filter(g => g[key] > 0);
  if (p.by === 'store' && live.length >= 2) {
    const lo = live[live.length - 1], none = G.filter(g => !(g[key] > 0)).map(g => g.name);
    out.push((ar ? `الأعلى: ${mark(live[0].name)} (${fmt(live[0])}). الأقل: ${lo.name} (${fmt(lo)}).` : `Best: ${mark(live[0].name)} (${fmt(live[0])}, ${Math.round(live[0].share * 100)}%). Lowest: ${lo.name} (${fmt(lo)}).`) + (none.length ? (ar ? ' بدون مبيعات: ' : ' No sales: ') + none.join(', ') + '.' : ''));
  } else if (p.by === 'product' && G.length) {
    out.push(ar ? `الأعلى: ${mark(G[0].name)} (${fmt(G[0])}).` : `Top item: ${mark(G[0].name)}${G[0].sku ? ' (' + G[0].sku + ')' : ''}, ${fmt(G[0])}.`);
  } else if (['category', 'collection', 'payment'].includes(p.by) && live.length && !(p.by === 'category' && (a.categories || []).length === 1)) {
    out.push(ar ? `الأعلى: ${mark(live[0].name)} (${fmt(live[0])}).` : `Top ${p.by === 'payment' ? 'payment' : p.by}: ${mark(live[0].name)} (${fmt(live[0])}, ${Math.round(live[0].share * 100)}%).`);
  } else if (['day', 'month', 'weekday'].includes(p.by) && live.length >= 2) {
    const hi = live.reduce((x, y) => (y[key] > x[key] ? y : x)), lo = live.reduce((x, y) => (y[key] < x[key] ? y : x));
    const w = p.by === 'day' ? (ar ? 'يوم' : 'day') : p.by === 'month' ? (ar ? 'شهر' : 'month') : (ar ? 'يوم' : 'weekday');
    out.push(ar ? `الأعلى: ${mark(hi.name)} (${fmt(hi)}). الأقل: ${lo.name} (${fmt(lo)}).` : `Best ${w}: ${mark(hi.name)} (${fmt(hi)}). Lowest: ${lo.name} (${fmt(lo)}).`);
  } else if (p.by === 'none') {
    out.push(ar ? `${nn(T.orders)} طلب، متوسط الطلب ${egp(T.atv)}.` : `${nn(T.orders)} orders, average order ${egp(T.atv)}, ${(Number(T.upt) || 0).toFixed(2)} pieces per order.`);
  }
  { const w = p.metric === 'sales' ? worthLook(p, ar) : ''; if (w && !q.rank) out.push(w); }
  if (q.rank && !ar && out[0] && /^(Highest|Lowest) /.test(out[0])) { for (let i = out.length - 1; i > 1; i--) if (/^(Best|Top item|Top (payment|category|collection)|Best day|Best weekday|Best month)/.test(out[i])) out.splice(i, 1); }
  if (q.notes.includes('samedates')) out.push(ar ? 'بنفس التواريخ السابقة.' : 'Same dates as before.');
  if (q.notes.includes('nodate') && q.kind !== 'brief') out.push(ar ? 'لم تحدد تاريخا، فاستخدمت أمس.' : 'You did not give a date, so I used yesterday.');
  return out.join('\n');
}
function helpText(sc, ar) {
  if (ar) return 'أستطيع الإجابة عن **المبيعات** و**المخزون** بالأرقام الحقيقية. جرّب:\n- مبيعات التشارم في كل فرع أمس\n- أعلى 10 منتجات هذا الشهر\n- مخزون الأساور في كل فرع\nاذكر التاريخ والفرع والفئة وطريقة التقسيم (كل فرع، يوم بيوم، أعلى المنتجات).';
  return 'I answer questions about **sales**, **stock**, **staff** and **slow-moving** stock with the real figures. Try:\n- Sales of charms in every store for 15 November 2026\n- Who sold the most this month? / How is Ahmed doing?\n- Slow moving items in CFC\n- What should we restock?\n- Why did sales change yesterday?\n- Forecast this month\n- Where do I plan the shifts? (I open the right report)';
}
function followChips(q, res) {
  if (q.ar) return [];
  const p = res && res.panel, k = q.kind, st = (q.args.stores || []).length, out = [];
  if (k === 'sales' && p && p.type === 'sales') {
    if (p.cmp) out.push('Why did it change?');
    if (p.by !== 'product') out.push('Top products');
    if (p.by !== 'store' && !st) out.push('By store'); else if (p.by === 'store') out.push('By category');
    out.push('Stock for this');
  } else if (k === 'why') { out.push('Top products', 'Day by day', 'What should we restock?'); }
  else if (k === 'brief') { out.push('Why did it change?', 'Forecast this month', 'What should we restock?'); }
  else if (k === 'forecast') { out.push('Day by day this month', 'By store this month', 'Why vs last month?'); }
  else if (k === 'staff') { out.push(q.args.group_by === 'store' ? 'Top sales people' : 'By store', 'Slow moving items', 'Sales by store'); }
  else if (k === 'slow') { out.push(q.args.group_by === 'item' ? 'By store' : 'Top 10 slow items', 'What should we restock?'); }
  else if (k === 'cover') { out.push(q.args.mode === 'slow' ? 'What should we restock?' : 'Slow moving items', 'Top products this month'); }
  else if (k === 'stock') { out.push('What should we restock?', 'Slow moving items'); }
  return out.slice(0, 4);
}
async function freeAnswer(turn, ctx) {
  const P = require('./_askparse');
  const q = P.parse(turn.text, { today: cairoToday(), prev: P.readCtx(turn.prev), apps: ctx.apps, vocab: ctx.vocab, people: ctx.people });
  if (q.kind === 'help') return { text: helpText(ctx.sc, q.ar), panels: [], ctx: '', follow: q.ar ? [] : ['How are we doing?', 'Top products this month', 'What should we restock?', 'Forecast this month'] };
  if (q.kind === 'links') {
    const items = q.args.ids.map(id => ctx.apps.find(a => a.id === id)).filter(Boolean).map(a => ({ title: a.title, href: a.href }));
    return items.length ? { text: q.ar ? 'تفضل.' : 'Here you go.', panels: [{ type: 'links', items }], ctx: '' } : { text: 'You cannot open that report.', panels: [], ctx: '' };
  }
  const keep = r => JSON.stringify({ k: q.kind, a: q.args }).slice(0, 900);
  const done = (res, text, panels) => res.error ? { text: res.error, panels: [], ctx: '' } : { text: String(text).slice(0, 2000), panels: panels || [res.panel], ctx: keep(), follow: followChips(q, res) };
  if (q.kind === 'stock') { const res = runStock(await stockData(), q.args, ctx.sc); return done(res, res.error ? '' : describe(res, q)); }
  const hasApp = id => ctx.apps.some(x => x.id === id);
  if (q.kind === 'staff') {
    if (!hasApp('staff')) return { text: 'Staff Performance is not open to this account, so I cannot read it.', panels: [], ctx: '' };
    const res = await staffRun(q.rank && q.rank.dir === 'bottom' ? { ...q.args, limit: 40 } : q.args, ctx.sc); return done(res, res.error ? '' : describeStaff(res, q));
  }
  if (q.kind === 'slow') {
    if (!hasApp('slow2') && !hasApp('slow')) return { text: 'Slowmoving is not open to this account, so I cannot read it.', panels: [], ctx: '' };
    const res = await slowRun(q.args, ctx.sc);
    if (res.empty) { const r2_ = await coverRun(ctx.rows, await stockData(), { ...q.args, mode: 'slow' }, ctx.sc); return done(r2_, r2_.error ? '' : 'The Slowmoving report has not been run yet, so this is worked out from stock and sales instead.\n' + describeCover(r2_.panel)); }
    if (res.panelEmpty) return { text: 'No slow stock found for ' + res.filt.join(' · ') + '. Good news.', panels: [], ctx: keep() };
    return done(res, res.error ? '' : describeSlow(res, q));
  }
  if (q.kind === 'cover') { const res = await coverRun(ctx.rows, await stockData(), q.args, ctx.sc); return done(res, res.error ? '' : describeCover(res.panel)); }
  if (q.kind === 'forecast') { const res = forecastRun(ctx.rows, q.args, ctx.sc); return done(res, res.error ? '' : describeForecast(res.panel)); }
  if (q.kind === 'why') { const res = whyRun(ctx.rows, q.args, ctx.sc); return done(res, res.error ? '' : describeWhy(res.panel)); }
  if (q.kind === 'brief') {
    const a = q.args, by = runSales(ctx.rows, { ...a, group_by: 'store' }, ctx.sc);
    if (by.error) return done(by, '');
    const top = runSales(ctx.rows, { ...a, group_by: 'product', limit: 5, compare: 'none' }, ctx.sc);
    const panels = [by.panel]; if (!top.error && top.panel.groups.length) panels.push(top.panel);
    let text = describe(by, { ...q, args: a, rank: null }); const tp = top.error ? null : top.panel.groups[0];
    if (tp) text += '\nTop item: ' + mark(tp.name) + ' (' + egp(tp.sales) + ').';
    return done(by, text, panels);
  }
  const res = runSales(ctx.rows, q.args, ctx.sc);
  return done(res, res.error ? '' : describe(res, q));
}
// the last question, and what the answer before it used (for "and for Point 90?")
function lastTurn(msgs) {
  msgs = Array.isArray(msgs) ? msgs : [];
  let i = msgs.length - 1; while (i >= 0 && !(msgs[i] && msgs[i].role === 'user' && String(msgs[i].text == null ? '' : msgs[i].text).trim())) i--;
  if (i < 0) return null;
  let prev = ''; for (let j = i - 1; j >= 0; j--) if (msgs[j] && msgs[j].role === 'assistant') { prev = String(msgs[j].ctx || ''); break; }
  return { text: String(msgs[i].text).replace(/\u0000/g, '').trim().slice(0, 800), prev };
}

// ---- Claude ----
let modelMemo = '';
async function claude(payload) {
  const key = process.env.ANTHROPIC_API_KEY;
  const tryList = process.env.ASSISTANT_MODEL ? [process.env.ASSISTANT_MODEL.trim()] : (modelMemo ? [modelMemo] : MODELS);
  let lastErr = null;
  for (const model of tryList) {
    let r, j = null;
    try {
      r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ ...payload, model }), signal: AbortSignal.timeout(40000) });
      try { j = await r.json(); } catch (_) { j = null; }
    } catch (e) { const err = new Error('The AI service did not answer in time.'); err.kind = 'busy'; throw err; }
    if (r.ok && j && Array.isArray(j.content)) { modelMemo = process.env.ASSISTANT_MODEL ? '' : model; return j; }
    const type = (j && j.error && j.error.type) || '', msg = String((j && j.error && j.error.message) || '').slice(0, 200);
    const err = new Error(msg || 'The AI service returned an error (' + r.status + ').');
    err.kind = r.status === 401 || r.status === 403 ? 'key' : r.status === 429 || r.status === 529 || r.status >= 500 ? 'busy' : /credit balance|billing/i.test(msg) ? 'credit' : 'other';
    lastErr = err;
    if (r.status === 404 || type === 'not_found_error' || (r.status === 400 && /model/i.test(msg) && !/credit/i.test(msg))) continue; // this key has no such model: try the next one
    throw err;
  }
  throw lastErr || new Error('No AI model is available.');
}

// The conversation as Claude reads it: plain text turns; what the panels of the last answer held rides along with the next question.
function toMessages(input) {
  const out = [];
  let note = '';
  for (const m of (Array.isArray(input) ? input : []).slice(-MAX_TURNS)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = String(m.text == null ? '' : m.text).replace(/\u0000/g, '').trim().slice(0, m.role === 'user' ? 1200 : 2500);
    if (m.role === 'assistant') {
      if (!out.length) continue;
      if (out[out.length - 1].role === 'assistant') continue;
      out.push({ role: 'assistant', content: text || '(shown as panels)' });
      note = String(m.ctx || '').slice(0, 900);
    } else {
      if (!text) continue;
      const content = (note ? '<earlier_lookups>' + note.replace(/[<>]/g, ' ') + '</earlier_lookups>\n\n' : '') + text; note = '';
      if (out.length && out[out.length - 1].role === 'user') out[out.length - 1].content += '\n\n' + content; else out.push({ role: 'user', content });
    }
  }
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}

async function answer(messages, ctx) {
  const panels = [], calls = [];
  const system = systemPrompt(ctx);
  let text = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const j = await claude({ max_tokens: 1600, system, tools: TOOLS, messages });
    const uses = j.content.filter(b => b.type === 'tool_use');
    text = j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (j.stop_reason !== 'tool_use' || !uses.length) break;
    const results = [];
    for (const u of uses) {
      let out;
      try {
        if (u.name === 'sales') out = runSales(ctx.rows, u.input, ctx.sc);
        else if (u.name === 'stock') out = runStock(await stockData(), u.input, ctx.sc);
        else if (u.name === 'why') out = whyRun(ctx.rows, u.input, ctx.sc);
        else if (u.name === 'forecast') out = forecastRun(ctx.rows, u.input, ctx.sc);
        else if (u.name === 'staff') out = ctx.apps.some(a => a.id === 'staff') ? await staffRun(u.input, ctx.sc) : { error: 'Staff Performance is not open to this person.' };
        else if (u.name === 'slow_stock') {
          if (!ctx.apps.some(a => a.id === 'slow2' || a.id === 'slow')) out = { error: 'Slowmoving is not open to this person.' };
          else { out = await slowRun(u.input, ctx.sc); if (out.empty) out = await coverRun(ctx.rows, await stockData(), { ...u.input, mode: 'slow' }, ctx.sc); else if (out.panelEmpty) out = { error: 'No slow stock found for that.' }; }
        } else if (u.name === 'restock') out = await coverRun(ctx.rows, await stockData(), { ...u.input, mode: 'restock' }, ctx.sc);
        else if (u.name === 'open_report') {
          const items = list(u.input && u.input.ids).map(id => ctx.apps.find(a => a.id === id)).filter(Boolean).map(a => ({ title: a.title, href: a.href }));
          out = items.length ? { panel: { type: 'links', items }, forModel: { shown: items.map(i => i.title) } } : { error: 'None of those reports can be opened by this person.' };
        } else out = { error: 'Unknown tool.' };
      } catch (e) { out = { error: 'The lookup failed: ' + String((e && e.message) || e).slice(0, 120) }; }
      if (out.panel) { panels.push(out.panel); calls.push(u.name + ' ' + JSON.stringify(u.input || {})); }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.error ? { error: out.error } : out.forModel), ...(out.error ? { is_error: true } : {}) });
    }
    messages = messages.concat([{ role: 'assistant', content: j.content }, { role: 'user', content: results }]);
    text = '';
  }
  const shown = panels.slice(-MAX_PANELS);
  if (!text) text = shown.length ? 'Here is what I found.' : 'I could not work that out. Try asking in a different way.';
  return { text: text.slice(0, 4000), panels: shown, ctx: calls.slice(-MAX_PANELS).join(' | ').slice(0, 900) };
}

module.exports = async function handler(req, res) {
  const { sessionFacts, appsFor, greetName } = require('./_apps');
  const facts = await sessionFacts(req);
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'Please sign in again.' });
  if (!canUse(facts) || who.kind !== 'env') return send(res, 403, { ok: false, error: 'The assistant is not available for this account.' });
  const useAI = !!process.env.ANTHROPIC_API_KEY && String(process.env.ASSISTANT_MODE || '').toLowerCase() !== 'free';
  if (req.method === 'GET') return send(res, 200, { ok: true, ready: true, mode: useAI ? 'ai' : 'free' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const sc = scopeOf(who);
  if (!store.configured()) return send(res, 503, { ok: false, error: 'Storage is not connected.' });
  const b = body(req);
  const turn = lastTurn(b && b.messages);
  if (!turn) return send(res, 400, { ok: false, error: 'Type a question first.' });
  try { if (await tooMany(req, 'assistant', 150)) return send(res, 429, { ok: false, error: 'Too many questions in one hour. Try again a little later.' }); } catch (_) { /* the limit is a safety net: never block an answer because it could not be read */ }
  try {
    const rows = await salesRows(), mine = inScope(rows, sc);
    const apps = appsFor(facts).filter(a => a.id !== 'maintenance');
    const ctx = { rows, vocab: salesMemo.vocab, people: appsFor(facts).some(a => a.id === 'staff') ? await staffVocab().catch(() => null) : null, sc, name: greetName(facts), stores: liveStores(mine), first: mine.length ? mine[0].d : '', last: mine.length ? mine[mine.length - 1].d : '', apps };
    let out = null;
    if (useAI) { try { out = await answer(toMessages(b && b.messages), ctx); } catch (_) { out = null; } } // no credit, busy, bad key: the free engine answers instead
    if (!out) out = await freeAnswer(turn, ctx);
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'Something went wrong while answering. Try again.', detail: sc.admin ? String((e && e.message) || e).slice(0, 200) : undefined });
  }
};
module.exports.canUse = canUse;
// Used by api/_askclaude.js (the owner-only inbox): the same lookups, run for the super admin, with no chat around them.
module.exports.lookup = async function (text) {
  const turn = lastTurn([{ role: 'user', text: String(text || '').slice(0, 800) }]);
  if (!turn) return { text: 'Empty question.', panels: [], ctx: '' };
  const rows = await salesRows(), sc = { admin: true, rx: null, zone: '' }, mine = inScope(rows, sc);
  const apps = ['staff', 'slow2', 'slow'].map(id => ({ id }));
  const ctx = { rows, vocab: salesMemo.vocab, people: await staffVocab().catch(() => null), sc, name: 'Morris', stores: liveStores(mine), first: mine.length ? mine[0].d : '', last: mine.length ? mine[mine.length - 1].d : '', apps };
  return freeAnswer(turn, ctx);
};
module.exports._test = { runSales, runStock, toMessages, systemPrompt, recat, fRange, addM, describe, freeAnswer, lastTurn };
