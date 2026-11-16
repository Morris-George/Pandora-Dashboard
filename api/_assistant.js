// Pandora Assistant: the chat helper shown on every page (reached at /api/assistant, rewritten to api/vm.js: the plan limits the number of functions).
//   GET  /api/assistant   -> { ok, ready }  (ready = the AI key is set in Vercel)
//   POST /api/assistant   { messages: [{ role: 'user' | 'assistant', text, ctx? }] }  -> { ok, text, panels, ctx }
//
// How it works: the question goes to Claude (Anthropic API, key in ANTHROPIC_API_KEY) together with a few tools. Claude never sees the raw
// sales lines and never works figures out by itself: it only chooses WHAT to look up (dates, stores, categories, grouping). The lookups
// below run here, on the same saved sales lines as Pandora Dashboards and the same stock as Stock balance, and every figure in the visual
// panels comes straight from them. So a number on a panel is always a real number; the text beside it is Claude's short reading of it.
//
// Who: the people who can open Pandora Dashboards (super admins, overseers, area managers). Area managers only ever get the stores of
// their zone, enforced here, whatever is asked. Nobody else gets the assistant, and it never changes anything (read only).
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
      salesMemo = { at: Date.now(), rows: out, pr: null };
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
  const metric = ['units', 'orders'].includes(a.sort_by) ? a.sort_by : 'sales';
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

  const auto = [ct.hit.length === 1 ? ct.hit[0] : ct.hit.length ? ct.hit.length + ' categories' : 'Sales', DIM_LABEL[by]].filter(Boolean).join(' · ');
  const hash = new URLSearchParams(); hash.set('from', from); hash.set('to', to); if (ct.hit.length === 1) hash.set('cat', ct.hit[0]); if (basis === 'gross') hash.set('basis', 'gross');
  const panel = {
    type: 'sales', by, then, metric, title: String(a.title || auto).slice(0, 70), range: fRange(from, to), filters: filt.join(' · '), basis,
    cmp: cmp && !cmp.empty ? cmp.text : '', note: notes.join(' '), href: '/dashboards#' + hash.toString(),
    total: { sales: r2(total.sales), units: r2(total.units), orders: total.orders, atv: r2(total.atv), upt: r2(total.upt), prev: totalP ? r2(totalP.sales) : null, d: totalP ? chg(total.sales, totalP.sales) : null },
    groups: groups.map(g => ({ name: String(g.name).slice(0, 90), key: by === 'day' ? g.key : undefined, sku: g.sku || undefined, cat: g.cat || undefined, sales: r2(g.sales), units: r2(g.units), orders: g.orders, atv: r2(g.atv), share: Math.round(g.share * 1000) / 1000, d: g.d === undefined ? undefined : g.d, prev: g.prev === undefined ? undefined : r2(g.prev), sub: g.sub ? g.sub.map(s => ({ name: String(s.name).slice(0, 70), sku: s.sku, sales: r2(s.sales), units: r2(s.units) })) : undefined }))
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
        compare: { type: 'string', enum: ['none', 'previous_period', 'last_week', 'last_month', 'last_year'], description: 'Adds the change against another period. For one day, last_week (the same weekday) is the fair comparison.' },
        basis: { type: 'string', enum: ['net', 'gross'], description: 'net = without VAT (the default everywhere on the site). gross = with VAT.' },
        sort_by: { type: 'string', enum: ['sales', 'units', 'orders'], description: 'What ranks the groups and is shown biggest. Default sales.' },
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
    name: 'open_report',
    description: 'Show the user buttons that open pages of this site. Use it when another report answers the question better, or the user asks where to find something.',
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Report ids from the list in the instructions.' } }, required: ['ids'] }
  }
];

function systemPrompt(ctx) {
  const now = cairoNow(), today = now.toISOString().slice(0, 10);
  return [
    'You are the Pandora Assistant, built into the internal website of Pandora Egypt (jewellery stores). You answer questions from the management team about sales and stock, quickly and exactly.',
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
    '- Questions that are not about this business: answer in one helpful sentence and steer back.'
  ].join('\n');
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
    const j = await claude({ max_tokens: 1200, system, tools: TOOLS, messages });
    const uses = j.content.filter(b => b.type === 'tool_use');
    text = j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (j.stop_reason !== 'tool_use' || !uses.length) break;
    const results = [];
    for (const u of uses) {
      let out;
      try {
        if (u.name === 'sales') out = runSales(ctx.rows, u.input, ctx.sc);
        else if (u.name === 'stock') out = runStock(await stockData(), u.input, ctx.sc);
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
  const ready = !!process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') return send(res, 200, { ok: true, ready });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const sc = scopeOf(who);
  if (!ready) return send(res, 503, { ok: false, error: sc.admin ? 'The assistant is not switched on yet. Add ANTHROPIC_API_KEY in Vercel (Settings, Environment Variables) and redeploy.' : 'The assistant is not switched on yet.' });
  if (!store.configured()) return send(res, 503, { ok: false, error: 'Storage is not connected.' });
  const b = body(req);
  const messages = toMessages(b && b.messages);
  if (!messages.length) return send(res, 400, { ok: false, error: 'Type a question first.' });
  try { if (await tooMany(req, 'assistant', 150)) return send(res, 429, { ok: false, error: 'Too many questions in one hour. Try again a little later.' }); } catch (_) { /* the limit is a safety net: never block an answer because it could not be read */ }
  try {
    const rows = await salesRows(), mine = inScope(rows, sc);
    const apps = appsFor(facts).filter(a => a.id !== 'maintenance');
    const out = await answer(messages, { rows, sc, name: greetName(facts), stores: liveStores(mine), first: mine.length ? mine[0].d : '', last: mine.length ? mine[mine.length - 1].d : '', apps });
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    const kind = e && e.kind;
    const msg = kind === 'key' ? (sc.admin ? 'The AI key was not accepted. Check ANTHROPIC_API_KEY in Vercel.' : 'The assistant is not available right now.')
      : kind === 'credit' ? (sc.admin ? 'The AI account has no credit left. Add credit at console.anthropic.com (Billing).' : 'The assistant is not available right now.')
      : kind === 'busy' ? 'The assistant is busy right now. Try again in a moment.'
      : 'Something went wrong while answering. Try again.';
    return send(res, kind === 'busy' ? 503 : 500, { ok: false, error: msg, detail: sc.admin ? String((e && e.message) || e).slice(0, 200) : undefined });
  }
};
module.exports.canUse = canUse;
module.exports._test = { runSales, runStock, toMessages, systemPrompt, recat, fRange, addM };
