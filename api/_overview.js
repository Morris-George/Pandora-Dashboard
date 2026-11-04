// Store Overview (super admin and brand manager / overseer only). Reached at /api/overview, rewritten to api/erp.js
// (the Hobby plan allows 12 functions, so it is a helper). A simple set of numbers for the whole chain, month to date and year to date:
// total sales, average sales per store, average ticket (ATV), orders, units per ticket, average price per piece,
// average per store per day and the top store. Same figures as Pandora Dashboards: net of VAT, Laderach / Waterway left out
// (api/_sales.js), an order = an invoice with sales and pieces above zero (like Sales Intelligence). The Online shop is not a store.
const store = require('./_store');
const { whoami } = require('./_auth');
const { dashRows } = require('./_sales');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_MIN = 10;
const ONLINE = /online|e-?commerce|website/i;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const r1 = n => Math.round((n || 0) * 10) / 10;
const r0 = n => Math.round(n || 0);
const dayN = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const pretty = v => String(v || '').replace(/^\s*pandora\s+/i, '').replace(/\s+-\s+[A-Z]{1,4}$/, '').trim() || String(v || '');
const pad = n => String(n).padStart(2, '0');
// same day in another year / month, kept inside that month (29 Feb -> 28 Feb, 31 Mar -> 28 Feb)
function shifted(iso, dy, dm) {
  let y = +iso.slice(0, 4) + dy, m = +iso.slice(5, 7) - 1 + dm, d = +iso.slice(8, 10);
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return y + '-' + pad(m + 1) + '-' + pad(Math.min(d, last));
}

function figures(lines, from, to) {
  const inv = new Map(), byStore = new Map();
  let rev = 0, units = 0;
  for (const r of lines) {
    if (r[0] < from || r[0] > to) continue;
    const q = +r[2] || 0, net = +r[3] || 0, br = r[7] || 'Unspecified';
    rev += net; units += q;
    const k = br + '|' + r[1];
    const o = inv.get(k) || { rev: 0, q: 0 }; o.rev += net; o.q += q; inv.set(k, o);
    byStore.set(br, (byStore.get(br) || 0) + net);
  }
  let orders = 0, pieces = 0, ordersRev = 0;
  const ps = new Map(); // per store: orders, pieces, revenue of those orders
  for (const [k, o] of inv) if (o.rev > 0 && o.q > 0) {
    orders++; pieces += o.q; ordersRev += o.rev;
    const br = k.slice(0, k.lastIndexOf('|')), x = ps.get(br) || { orders: 0, pieces: 0, rev: 0 };
    x.orders++; x.pieces += o.q; x.rev += o.rev; ps.set(br, x);
  }
  const stores = [...byStore.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const days = dayN(to) - dayN(from) + 1;
  const n = stores.length;
  return {
    sales: r0(rev), stores: n, avgPerStore: n ? r0(rev / n) : 0, avgPerStorePerDay: n && days > 0 ? r0(rev / n / days) : 0,
    orders, atv: orders ? r0(ordersRev / orders) : 0, upt: orders ? r1(pieces / orders) : 0, units: r0(units), asp: units > 0 ? r0(rev / units) : 0,
    perStore: stores.map(([name, v]) => { const x = ps.get(name) || { orders: 0, pieces: 0, rev: 0 }; return { name: pretty(name), sales: r0(v), share: rev > 0 ? r1(v / rev * 100) : 0, orders: x.orders, atv: x.orders ? r0(x.rev / x.orders) : 0, upt: x.orders ? r1(x.pieces / x.orders) : 0 }; }),
    top: stores.length ? { name: pretty(stores[0][0]), sales: r0(stores[0][1]) } : null,
    days
  };
}

// Average month of the year so far: full months only (the month still running is left out, unless the data reaches its last day).
function monthlyAvg(rows, yearStart, to) {
  const last = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate();
  const lastKey = +to.slice(8) >= last ? to.slice(0, 7) : null;
  const byM = new Map(); // month -> Map(store -> sales)
  for (const r of rows) {
    if (r[0] < yearStart || r[0] > to) continue;
    const k = r[0].slice(0, 7);
    if (k === to.slice(0, 7) && k !== lastKey) continue;
    const m = byM.get(k) || new Map(), br = pretty(r[7] || 'Unspecified');
    m.set(br, (m.get(br) || 0) + (+r[3] || 0)); byM.set(k, m);
  }
  let chain = 0, perStoreAvg = 0, months = 0;
  const acc = new Map(); // store -> [sum, months with sales]
  for (const m of byM.values()) {
    let tot = 0, n = 0;
    for (const [br, v] of m) if (v > 0) { tot += v; n++; const a = acc.get(br) || [0, 0]; a[0] += v; a[1]++; acc.set(br, a); }
    if (!n) continue;
    months++; chain += tot; perStoreAvg += tot / n;
  }
  const byStore = {};
  for (const [br, a] of acc) byStore[br] = r0(a[0] / a[1]);
  return { months, from: [...byM.keys()].sort()[0] || '', to: [...byM.keys()].sort().pop() || '', chain: months ? r0(chain / months) : 0, perStoreAvg: months ? r0(perStoreAvg / months) : 0, byStore };
}

// Sales of every store in every month of the year so far (the month still running is flagged as partial).
function monthTable(rows, yearStart, to) {
  const byS = new Map(), months = new Set();
  for (const r of rows) {
    if (r[0] < yearStart || r[0] > to) continue;
    const k = r[0].slice(0, 7), br = pretty(r[7] || 'Unspecified'), net = +r[3] || 0;
    months.add(k);
    const o = byS.get(br) || {}; o[k] = (o[k] || 0) + net; byS.set(br, o);
  }
  const list = [...months].sort();
  const last = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate();
  const stores = [...byS.entries()].map(([name, o]) => {
    const by = {}; let total = 0;
    for (const k of list) { by[k] = r0(o[k]); total += o[k] || 0; }
    return { name, byMonth: by, total: r0(total) };
  }).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  const totals = {};
  for (const k of list) totals[k] = stores.reduce((a, x) => a + x.byMonth[k], 0);
  return { months: list, partial: +to.slice(8) >= last ? null : to.slice(0, 7), stores, totals, total: stores.reduce((a, x) => a + x.total, 0) };
}

async function build() {
  const rows = (await dashRows()).filter(r => r && r[0] && ISO.test(r[0]) && !ONLINE.test(String(r[7] || '')));
  if (!rows.length) return { ok: true, empty: true };
  let minD = '9999', maxD = '';
  for (const r of rows) { if (r[0] < minD) minD = r[0]; if (r[0] > maxD) maxD = r[0]; }
  const monthStart = maxD.slice(0, 8) + '01', yearStart = maxD.slice(0, 5) + '01-01';
  const out = { ok: true, upTo: maxD, generatedAt: new Date().toISOString(), month: maxD.slice(0, 7), year: maxD.slice(0, 4) };
  const mk = (from, prevFrom, prevTo) => {
    const cur = figures(rows, from, maxD);
    // the earlier period is only compared when the saved data really reaches back to its first day
    const prev = minD <= prevFrom ? figures(rows, prevFrom, prevTo) : null;
    const pc = (a, b) => (b ? Math.round((a / b - 1) * 1000) / 10 : null);
    return { from, to: maxD, ...cur, vs: prev && prev.sales > 0 ? { from: prevFrom, to: prevTo, sales: pc(cur.sales, prev.sales), avgPerStore: pc(cur.avgPerStore, prev.avgPerStore), atv: pc(cur.atv, prev.atv), upt: pc(cur.upt, prev.upt) } : null };
  };
  out.mtd = mk(monthStart, shifted(monthStart, 0, -1), shifted(maxD, 0, -1));
  // the full month before (complete figures, only when the saved data reaches its first day)
  const lmFrom = shifted(monthStart, 0, -1);
  const lmEnd = new Date(Date.UTC(+monthStart.slice(0, 4), +monthStart.slice(5, 7) - 1, 0)).toISOString().slice(0, 10);
  out.lm = minD <= lmFrom ? { from: lmFrom, to: lmEnd, month: lmFrom.slice(0, 7), ...figures(rows, lmFrom, lmEnd), vs: null } : null;
  out.ytd = mk(yearStart, shifted(yearStart, -1, 0), shifted(maxD, -1, 0));
  const ma = monthlyAvg(rows, yearStart, maxD);
  Object.assign(out.ytd, { months: ma.months, monthsFrom: ma.from, monthsTo: ma.to, avgMonth: ma.chain, avgMonthPerStore: ma.perStoreAvg });
  out.ytd.perStore.forEach(x => { x.avgMonth = ma.byStore[x.name] || 0; });
  out.monthly = monthTable(rows, yearStart, maxD);
  return out;
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'env' && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Only the super admin and the brand manager can open this report.' }); // area managers, VM and staff never
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const fresh = new URL(req.url, 'https://x.invalid').searchParams.get('fresh') === '1';
  const ck = 'overview/c5.json';
  if (!fresh) {
    const c = await store.getJSON(ck).catch(() => null);
    if (c && c.ok && Date.now() - Date.parse(c.generatedAt) < CACHE_MIN * 60000) return send(res, 200, c);
  }
  try {
    const d = await build();
    if (d.ok && !d.empty) await store.putJSON(ck, d).catch(() => {});
    return send(res, 200, d);
  } catch (e) {
    console.error('OVERVIEW_ERROR', e && e.stack || e);
    return send(res, 500, { ok: false, error: 'Could not build the report: ' + String(e && e.message || e).slice(0, 200) });
  }
};
module.exports.build = build;
