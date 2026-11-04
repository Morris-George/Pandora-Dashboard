// Transfer: pick ANY items (not only slow ones) to move between stores. Reached at /api/transfer (rewritten to api/erp.js).
//   GET /api/transfer   today's stock per SKU and store (ERP "Branches Stock Balance") + what each SKU sold in each store
//                       over the last 3 months (the nightly ERP sales files), so the page can say where an item sells.
// Who: anyone with Refill Order access (view and up), the same people as Slow Moving. Read only: nothing is saved except a 10 minute cache.
const store = require('./_store');
const { whoami } = require('./_auth');

const CACHE = 'transfer/cache.json';
const TTL = 10 * 60 * 1000;
const MONTHS = 3;
const NOT_A_STORE = /sample|main|transit|damage|defect|reject|return|water\s*way/i;
const NOT_STOCK = /packaging|services|maintenance/i;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const skuOf = v => str(v, 40).toUpperCase().replace(/\.0$/, '');
const eanFromName = v => { const m = /-(\d{8,14})\b/.exec(String(v || '')); return m ? m[1] : ''; };
const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };

async function build() {
  const { runReport } = require('./erp'), { storeOf, settings } = require('./_dist'), st = await settings();
  const d = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  let list;
  try { list = await runReport('Branches Stock Balance', { company: process.env.ERP_COMPANY || 'All-Niche', from_date: d, to_date: d, item_group: 'Pandora', valuation_field_type: 'Currency' }); }
  catch (_) { list = await runReport('Branches Stock Balance', { from_date: d, to_date: d }); }
  const agg = {};
  for (const x of list) {
    const sk = skuOf(x.sku || x['sku-item'] || x.item_code), w = str(x.warehouse, 140), c = storeOf(w, st.stores), q = num(x.bal_qty != null ? x.bal_qty : x.balance_qty);
    const grp = str(x.item_group || x.full_group || x.category || '', 80);
    if (!sk || !c || NOT_A_STORE.test(w) || NOT_STOCK.test(grp) || !(q > 0)) continue;
    const k = sk + '|' + c, a = agg[k] || (agg[k] = { sk, c, q: 0, name: str(x.item_name || x.item || '', 140), grp });
    a.q += q;
  }
  // what each SKU sold per store in the last MONTHS months, and the last sale date (dash/f/erp-YYYY-MM.json rows: [date, invoice, qty, net, gross, sku, name, branch, ...])
  const now = new Date(Date.now() + 3 * 3600 * 1000), keys = [];
  for (let k = 0; k <= MONTHS; k++) keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS, now.getUTCDate())).toISOString().slice(0, 10);
  const have = new Set(Object.values(agg).map(a => a.sk)), sold = {}, meta = {};
  for (const m of keys) {
    const f = await store.getJSON('dash/f/erp-' + m + '.json'); if (!f || !Array.isArray(f.rows)) continue;
    for (const r of f.rows) {
      const sk = skuOf(r[5]); if (!have.has(sk)) continue;
      const c = storeOf(r[7], st.stores) || String(r[7] || ''); if (!c) continue;
      const q = Number(r[2]) || 0; if (!(q > 0)) continue;
      const dt = String(r[0] || '').slice(0, 10), isRecent = dt >= from;
      const o = sold[sk + '|' + c] || (sold[sk + '|' + c] = { q: 0, last: '' });
      if (isRecent) o.q += q;
      if (dt > o.last) o.last = dt;
      if (!meta[sk]) meta[sk] = str(r[6], 140);
    }
  }
  const items = Object.values(agg).map(a => [a.sk, eanFromName(a.name || meta[a.sk]), a.name || meta[a.sk] || a.sk, a.grp, a.c, Math.round(a.q * 10) / 10]);
  const sales = Object.entries(sold).filter(([, o]) => o.q > 0 || o.last).map(([k, o]) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1), Math.round(o.q), o.last]; });
  return { at: new Date().toISOString(), months: MONTHS, items, sales };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await require('./_refill').levelFor(who);
  if (lvl === 'none') return send(res, 403, { ok: false, error: 'No access to Transfer. Ask the super admin (Refill Order access).' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!(process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET)) return send(res, 503, { ok: false, error: 'ERP is not connected.' });
  const fresh = new URL(req.url, 'https://x.invalid').searchParams.get('fresh');
  try {
    let c = fresh ? null : await store.getJSON(CACHE);
    if (!c || Date.now() - Date.parse(c.at) > TTL) { c = await build(); await store.putJSON(CACHE, c); }
    return send(res, 200, { ok: true, level: lvl, ...c });
  } catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 400) }); }
};
