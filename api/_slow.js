// Slow Moving: ERP's "Pandora Slow Moving" report, kept as a snapshot and joined with sales, stock and the refill order.
//   GET  /api/slow             the last snapshot + per SKU: sold in the last 6 months (all stores and per store), stock, in the refill order
//   POST /api/slow?op=sync     Refill Order "manage": run the report now (its filters are read from the report itself)
// Who: anyone with Refill Order access (view and up). /api/slow is rewritten to /api/erp?slow=1 (vercel.json).
const store = require('./_store');
const { whoami } = require('./_auth');

const SNAP = 'slow/latest.json';
const REPORT = process.env.ERP_SLOW_REPORT || 'Pandora Slow Moving';

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const skuOf = v => str(v, 40).toUpperCase().replace(/\.0$/, '');
const cairo = () => new Date(Date.now() + 3 * 3600 * 1000);
const day = d => d.toISOString().slice(0, 10);

// the report's filters, from its own script: company, dates and anything with a default
async function filtersFor() {
  const base = String(process.env.ERP_URL || '').replace(/\/+$/, '');
  const r = await fetch(base + '/api/method/frappe.desk.query_report.get_script?report_name=' + encodeURIComponent(REPORT), {
    headers: { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { filters: {}, found: [] };
  const m = (await r.json()).message || {};
  const js = String(m.script || '') + '\n' + JSON.stringify(m.filters || '');
  const f = {}, found = [];
  const re = /fieldname["']?\s*:\s*["']([\w-]+)["'][^{}]*?fieldtype["']?\s*:\s*["'](\w+)["']|fieldtype["']?\s*:\s*["'](\w+)["'][^{}]*?fieldname["']?\s*:\s*["']([\w-]+)["']/g;
  let x; const now = cairo();
  while ((x = re.exec(js))) {
    const name = x[1] || x[4], type = x[2] || x[3]; found.push(name + ':' + type);
    if (/company/i.test(name)) f[name] = process.env.ERP_COMPANY || 'All-Niche';
    else if (type === 'Date') f[name] = /from|start/i.test(name) ? day(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))) : day(now);
  }
  // Report Builder / Query reports keep their filters on the report itself
  if (Array.isArray(m.filters)) for (const q of m.filters) if (q && q.fieldname && q.default != null && f[q.fieldname] == null) f[q.fieldname] = q.default;
  return { filters: f, found };
}

async function sync() {
  const { runReportRaw } = require('./erp');
  let ff; try { ff = await filtersFor(); } catch (_) { ff = { filters: {}, found: [] }; } // no filters found: the report runs with its own
  const { filters, found } = ff;
  let out, used = filters;
  try { out = await runReportRaw(REPORT, filters); }
  catch (e) { used = {}; try { out = await runReportRaw(REPORT, {}); } catch (_) { throw new Error(String(e.message || e) + (found.length ? ' · report filters: ' + found.join(', ') : '')); } }
  const cols = (out.columns || []).map(c => typeof c === 'string' ? { label: c.split(':')[0], fieldname: c.split(':')[0].toLowerCase().replace(/\W+/g, '_'), fieldtype: c.split(':')[1] || 'Data' } : { label: str(c.label || c.fieldname, 60), fieldname: str(c.fieldname || c.label, 60), fieldtype: str(c.fieldtype || 'Data', 20) });
  const rows = [];
  for (const r of out.rows || []) {
    if (Array.isArray(r)) { if (r.length === cols.length && !/total/i.test(String(r[0] || ''))) rows.push(r.map(v => typeof v === 'number' ? v : str(v, 140))); continue; }
    if (r && typeof r === 'object') rows.push(cols.map(c => { const v = r[c.fieldname]; return typeof v === 'number' ? v : str(v, 140); }));
    if (rows.length >= 40000) break;
  }
  const snap = { at: new Date().toISOString(), report: REPORT, filters: used, found, cols, rows };
  await store.putJSON(SNAP, snap);
  return { rows: rows.length, cols: cols.length };
}

// per SKU: sold in the last 6 full months (all stores, and per store from the nightly ERP sales), stock, refill order
async function enrich(skus) {
  const want = new Set(skus), info = {};
  const erp = (await store.getJSON('rf/erp.json')) || {};
  const months = Object.keys(erp.sold || {}).sort(), cur = day(cairo()).slice(0, 7), last6 = months.filter(m => m < cur).slice(-6);
  for (const s of want) {
    const sold = last6.reduce((a, m) => a + ((erp.sold[m] || {})[s] || 0), 0), byMonth = last6.map(m => Math.round((erp.sold[m] || {})[s] || 0));
    info[s] = { sold: Math.round(sold), byMonth, soh: Math.round((erp.soh || {})[s] || 0), wh: (erp.wh || {})[s] || {}, grp: (erp.grp || {})[s] || '', stores: {}, order: 0 };
  }
  // per store sales (dash/f/erp-YYYY-MM.json rows: [date, invoice, qty, net, gross, sku, name, branch, ...])
  for (const m of last6) {
    const f = await store.getJSON('dash/f/erp-' + m + '.json'); if (!f || !Array.isArray(f.rows)) continue;
    for (const r of f.rows) { const s = skuOf(r[5]); if (!want.has(s)) continue; const b = String(r[7] || '?'); info[s].stores[b] = (info[s].stores[b] || 0) + (Number(r[2]) || 0); }
  }
  // the newest refill order: what it orders of these SKUs
  const idx = (await store.getJSON('rf/orders/index.json')) || [];
  const last = idx.length ? await store.getJSON('rf/orders/' + idx[idx.length - 1].id + '.json') : null;
  if (last) {
    const lines = last.approved ? last.approved.lines.map(l => [l[0], l[2]]) : Object.entries(last.fb || {});
    for (const [s, q] of lines) if (info[s]) info[s].order = Number(q) || 0;
  }
  return { info, months: last6, order: last ? { name: last.name, status: last.status, approved: !!last.approved } : null };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await require('./_refill').levelFor(who);
  if (lvl === 'none') return send(res, 403, { ok: false, error: 'No access to Slow Moving. Ask the super admin (Refill Order access).' });
  const url = new URL(req.url, 'https://x.invalid');
  if (req.method === 'GET') {
    const snap = await store.getJSON(SNAP);
    if (!snap) return send(res, 200, { ok: true, level: lvl, snap: null });
    const skuCol = snap.cols.findIndex(c => /^(sku|item_code|item|sku_item|sku-item)$/i.test(c.fieldname) || /^sku|item code/i.test(c.label));
    const skus = skuCol < 0 ? [] : [...new Set(snap.rows.map(r => skuOf(r[skuCol])).filter(Boolean))];
    return send(res, 200, { ok: true, level: lvl, snap, skuCol, ...(await enrich(skus)) });
  }
  if (req.method !== 'POST' || url.searchParams.get('op') !== 'sync') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (lvl !== 'manage') return send(res, 403, { ok: false, error: 'Only Refill Order "Manage" can refresh the report.' });
  if (!process.env.ERP_URL || !process.env.ERP_API_KEY || !process.env.ERP_API_SECRET) return send(res, 503, { ok: false, error: 'ERP is not connected.' });
  try { return send(res, 200, { ok: true, ...(await sync()) }); }
  catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 400) }); }
};
