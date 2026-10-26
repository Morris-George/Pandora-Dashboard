// Slow Moving: ERP's "Pandora Slow Moving" report, run store by store (its filters: warehouse, months), kept as snapshots
// and joined with what each SKU sold in every store, so the page can say: slow in store Y, sells in store X, move it.
//   GET  /api/slow                    the saved snapshots (one per warehouse) + per SKU: sold per store, stock, refill order
//   GET  /api/slow?warehouses=1       the ERP warehouses that are stores (the samples and main warehouse are left out)
//   POST /api/slow?op=sync            Refill Order "manage": {warehouse, months} runs the report for one warehouse
//   POST /api/slow?op=clear           Refill Order "manage": forget every snapshot
// Who: anyone with Refill Order access (view and up). /api/slow is rewritten to /api/erp?slow=1 (vercel.json).
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');

const INDEX = 'slow/index.json';
const REPORT = process.env.ERP_SLOW_REPORT || 'Pandora Slow Moving by SKU';
// the same report without the warehouse filter: one row per item and store (a Warehouse column), one run for every store
const REPORT_ALL = process.env.ERP_SLOW_REPORT_ALL || 'Pandora Slow Moving by SKU-No Warehouse Filter';
const NOT_A_STORE = /sample|main|transit|damage|defect|reject|return|water\s*way/i;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readJSON(req) {
  let b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (!b) { const chunks = []; for await (const c of req) chunks.push(c); b = Buffer.concat(chunks); }
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : b); } catch (_) { return null; }
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const skuOf = v => str(v, 40).toUpperCase().replace(/\.0$/, '');
const cairo = () => new Date(Date.now() + 3 * 3600 * 1000);
const keyOfWh = w => crypto.createHash('sha1').update(w).digest('hex').slice(0, 12);
const erpBase = () => String(process.env.ERP_URL || '').replace(/\/+$/, '');
const erpAuth = () => ({ Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: 'application/json' });

// the warehouses of the company that hold stock (not groups, not disabled); the store code from Orders Distribution's store list
async function warehouses() {
  const q = 'fields=' + encodeURIComponent(JSON.stringify(['name', 'warehouse_name', 'is_group', 'disabled'])) + '&limit_page_length=500';
  const r = await fetch(erpBase() + '/api/resource/Warehouse?' + q, { headers: erpAuth(), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('ERP answered ' + r.status + ' for the warehouse list');
  const d = await r.json(), { storeOf, settings } = require('./_dist'), st = await settings();
  return (d.data || []).filter(w => !w.is_group && !w.disabled && !/water\s*way/i.test(w.name)).map(w => ({ name: w.name, store: storeOf(w.name, st.stores) || '' }))
    .sort((a, b) => (!!b.store - !!a.store) || a.name.localeCompare(b.name));
}

// "Pandora Slow Moving" is a prepared report: ERP builds it in the background ("Generate New Report").
// Ask for it directly first; if ERP insists on preparing it, start the build and wait for it (or say it is still running).
async function erpCall(method, body) {
  const r = await fetch(erpBase() + '/api/method/' + method, { method: 'POST', headers: { ...erpAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
  const txt = await r.text();
  if (!r.ok) { let why = ''; try { const e = JSON.parse(txt); why = e._server_messages ? JSON.parse(e._server_messages).map(x => { try { return JSON.parse(x).message; } catch (_) { return x; } }).join(' ') : (e.exception || ''); } catch (_) {} throw new Error('ERP answered ' + r.status + (why ? ': ' + String(why).replace(/<[^>]+>/g, ' ').slice(0, 200) : '')); }
  return (JSON.parse(txt).message) || {};
}
async function fetchReport(filters, pr, report = REPORT) {
  const REPORT = report;
  const hasRows = m => Array.isArray(m.result) && m.result.length;
  if (!pr) {
    // the all-stores report is too big to run while we wait: always let ERP prepare it
    const m = report === REPORT_ALL ? {} : await erpCall('frappe.desk.query_report.run', { report_name: REPORT, filters, ignore_prepared_report: true, are_default_filters: false });
    if (report !== REPORT_ALL && (hasRows(m) || !m.prepared_report)) return { columns: m.columns || [], rows: m.result || [] };
    if (m.doc && m.doc.status === 'Completed' && m.doc.name) pr = m.doc.name;
    else { // "Generate New Report": make_prepared_report on current Frappe, background_enqueue_run on older ones
      let q; try { q = await erpCall('frappe.core.doctype.prepared_report.prepared_report.make_prepared_report', { report_name: REPORT, filters: JSON.stringify(filters) }); }
      catch (e) { if (!/failed to get method|has no attribute|417/i.test(e.message)) throw e; q = await erpCall('frappe.desk.query_report.background_enqueue_run', { report_name: REPORT, filters: JSON.stringify(filters) }); } pr = q.name || (q.doc && q.doc.name) || q; }
  }
  // wait for the build (up to ~40 seconds here; the page asks again if it takes longer)
  for (let t = 0; t < 20; t++) {
    const r = await fetch(erpBase() + '/api/resource/Prepared%20Report/' + encodeURIComponent(pr), { headers: erpAuth(), signal: AbortSignal.timeout(10000) });
    const st = r.ok ? ((await r.json()).data || {}).status : '';
    if (st === 'Completed') break;
    if (st === 'Error' || st === 'Failed') throw new Error('ERP could not build the report.');
    if (t === 19) return { pending: pr };
    await new Promise(z => setTimeout(z, 2000));
  }
  // ERP's run() has no prepared_report_name: with the same filters it returns the latest finished build
  const m = await erpCall('frappe.desk.query_report.run', { report_name: REPORT, filters, are_default_filters: false });
  if (!Array.isArray(m.result) && m.prepared_report && !(m.doc && m.doc.status === 'Completed')) return { pending: pr };
  return { columns: m.columns || [], rows: m.result || [] };
}
// the SKU is the start of the item name: "583050C00-18-5700303xxxxxx …" -> 583050C00-18 (the item code is ERP's own number)
const skuFromName = v => { const m = /^\s*([0-9]{5,6}[A-Z0-9]{0,6}(?:-[A-Z0-9]{1,4})?)(?=-\d{8,14}\b|\s|$)/i.exec(String(v || '')); return m ? m[1].toUpperCase() : ''; };
const eanFromName = v => { const m = /-(\d{8,14})\b/.exec(String(v || '')); return m ? m[1] : ''; };

function parse(out) {
  const cols0 = (out.columns || []).map(c => typeof c === 'string' ? { label: c.split(':')[0], fieldname: c.split(':')[0].toLowerCase().replace(/\W+/g, '_'), fieldtype: c.split(':')[1] || 'Data' } : { label: str(c.label || c.fieldname, 60), fieldname: str(c.fieldname || c.label, 60), fieldtype: str(c.fieldtype || 'Data', 20) });
  const rows0 = [];
  for (const r of out.rows || []) {
    if (Array.isArray(r)) { if (r.length === cols0.length && !/total/i.test(String(r[0] || ''))) rows0.push(r.map(v => typeof v === 'number' ? v : str(v, 140))); }
    else if (r && typeof r === 'object') rows0.push(cols0.map(c => { const v = r[c.fieldname]; return typeof v === 'number' ? v : str(v, 140); }));
    if (rows0.length >= 20000) break;
  }
  // two columns in front: the SKU and the EAN, read from the item name (or the item code when it already is a SKU)
  const ni = cols0.findIndex(c => /item[_ ]?name/i.test(c.fieldname + ' ' + c.label)), si = cols0.findIndex(c => /^sku$/i.test(c.fieldname) || /^sku$/i.test(String(c.label || '').trim())), ci = cols0.findIndex(c => /item[_ ]?code|^item$/i.test(c.fieldname + ' ' + c.label));
  const cols = [{ label: 'SKU', fieldname: '_sku', fieldtype: 'Data' }, { label: 'EAN', fieldname: '_ean', fieldtype: 'Data' }, ...cols0];
  const rows = rows0.map(r => { const nm = ni >= 0 ? r[ni] : '', code = ci >= 0 ? String(r[ci]) : ''; return [(si >= 0 && String(r[si] || '').trim().toUpperCase()) || skuFromName(nm) || (/^\d{5,6}[A-Z]/i.test(code) ? code.toUpperCase() : ''), eanFromName(nm), ...r]; });
  return { cols, rows };
}
async function save(warehouse, months, cols, rows, idx) {
  const at = new Date().toISOString(), k = keyOfWh(warehouse);
  await store.putJSON('slow/w/' + k + '.json', { at, warehouse, months, cols, rows });
  idx[warehouse] = { k, at, months, rows: rows.length };
}
async function runOne(warehouse, months, pr) {
  const out = await fetchReport({ warehouse, months }, pr);
  if (out.pending) return { warehouse, pending: out.pending };
  const { cols, rows } = parse(out);
  const at = new Date().toISOString(), k = keyOfWh(warehouse);
  await store.putJSON('slow/w/' + k + '.json', { at, warehouse, months, cols, rows });
  const idx = (await store.getJSON(INDEX)) || {};
  idx[warehouse] = { k, at, months, rows: rows.length };
  await store.putJSON(INDEX, idx);
  return { warehouse, rows: rows.length };
}
// built here, the same logic as the ERP query, without waiting for ERP to prepare a report:
// stock per store today (Branches Stock Balance) and the last sale of each SKU in that store (the nightly sales files).
// Slow = pieces on hand in a store where the SKU did not sell in the last `months` months (or never, in the sales on file).
async function buildFromData(months) {
  const { runReport } = require('./erp'), { storeOf, settings } = require('./_dist'), st = await settings();
  const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const d = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  let list;
  try { list = await runReport('Branches Stock Balance', { company: process.env.ERP_COMPANY || 'All-Niche', from_date: d, to_date: d, item_group: 'Pandora', valuation_field_type: 'Currency' }); }
  catch (_) { list = await runReport('Branches Stock Balance', { from_date: d, to_date: d }); }
  // last sale per SKU and store, from every month on file
  const files = (await store.list('dash/f/erp-')).filter(x => /erp-\d{4}-\d{2}\.json$/.test(x)).sort();
  const last = {}, meta = {}; let first = '';
  for (const f of files) {
    const j = await store.getJSON(f); if (!j || !Array.isArray(j.rows)) continue;
    for (const x of j.rows) {
      const sk = skuOf(x[5]), c = storeOf(x[7], st.stores) || String(x[7] || ''); if (!sk || !c || !(Number(x[2]) > 0)) continue;
      const k = sk + '|' + c, dt = String(x[0] || '').slice(0, 10);
      if (!first || dt < first) first = dt;
      if (!last[k] || dt > last[k]) last[k] = dt;
      if (!meta[sk]) meta[sk] = { name: str(x[6], 140), cat: str(x[8], 60) };
    }
  }
  const cut = new Date(Date.now() + 3 * 3600 * 1000); cut.setUTCMonth(cut.getUTCMonth() - months); const cutS = cut.toISOString().slice(0, 10);
  const today = new Date(d + 'T00:00:00Z');
  const cols = [{ label: 'SKU', fieldname: '_sku', fieldtype: 'Data' }, { label: 'EAN', fieldname: '_ean', fieldtype: 'Data' }, { label: 'Item Code', fieldname: 'item_code', fieldtype: 'Data' }, { label: 'Item Name', fieldname: 'item_name', fieldtype: 'Data' }, { label: 'Warehouse', fieldname: 'warehouse', fieldtype: 'Data' }, { label: 'Category', fieldname: 'category', fieldtype: 'Data' }, { label: 'Qty On Hand', fieldname: 'qty_on_hand', fieldtype: 'Float' }, { label: 'Last Sale Date', fieldname: 'last_sale_date', fieldtype: 'Date' }, { label: 'Idle Since', fieldname: 'idle_since', fieldtype: 'Data' }, { label: 'Item Group', fieldname: 'item_group', fieldtype: 'Data' }];
  const agg = {};
  for (const x of list) {
    const sk = skuOf(x.sku || x['sku-item'] || x.item_code), w = str(x.warehouse, 140), c = storeOf(w, st.stores), q = num(x.bal_qty != null ? x.bal_qty : x.balance_qty);
    if (!sk || !c || NOT_A_STORE.test(w)) continue;
    const k = sk + '|' + w, a = agg[k] || (agg[k] = { sk, w, c, q: 0, code: str(x.item_code, 40), name: str(x.item_name || x.item || '', 140), cat: str(x.item_group || '', 60), grp: str(x.item_group || x.full_group || x.category || '', 80) });
    a.q += q;
  }
  const by = {};
  for (const a of Object.values(agg)) {
    if (!(a.q > 0)) continue;
    const ls = last[a.sk + '|' + a.c] || '';
    if (ls && ls >= cutS) continue;
    const m = meta[a.sk] || {}, nm = a.name || m.name || a.sk;
    const idle = ls ? Math.max(0, Math.floor((today - new Date(ls + 'T00:00:00Z')) / 2629800000)) + ' m' : 'Never Sold';
    (by[a.w] = by[a.w] || []).push([a.sk, eanFromName(nm), a.code, nm, a.w, m.cat || a.cat, Math.round(a.q * 10) / 10, ls, idle, a.grp || m.cat || 'No group']);
  }
  for (const l of Object.values(by)) l.sort((x, y) => (x[7] || '0').localeCompare(y[7] || '0') || y[6] - x[6]);
  const old = (await store.getJSON(INDEX)) || {};
  for (const v of Object.values(old)) await store.del('slow/w/' + v.k + '.json').catch(() => {});
  const idx = {};
  for (const [w, l] of Object.entries(by)) await save(w, months, cols, l, idx);
  await store.putJSON(INDEX, idx);
  return { stores: Object.keys(by).length, rows: Object.values(by).reduce((t, l) => t + l.length, 0), salesFrom: first };
}
// one run for every store: split the rows by the Warehouse column; keep the ticked stores (or every store when none is given)
async function runAll(months, only, pr) {
  const out = await fetchReport({ months }, pr, REPORT_ALL);
  if (out.pending) return { pending: out.pending };
  const { cols, rows } = parse(out);
  const wi = cols.findIndex(c => /warehouse/i.test(c.fieldname + ' ' + c.label));
  if (wi < 0) throw new Error('The report has no Warehouse column.');
  const keep = new Set(only || []), by = {};
  for (const r of rows) { const w = String(r[wi] || '').trim(); if (!w || (keep.size ? !keep.has(w) : NOT_A_STORE.test(w))) continue; (by[w] = by[w] || []).push(r); }
  const old = (await store.getJSON(INDEX)) || {};
  for (const v of Object.values(old)) await store.del('slow/w/' + v.k + '.json').catch(() => {});
  const idx = {};
  for (const [w, l] of Object.entries(by)) await save(w, months, cols, l, idx);
  await store.putJSON(INDEX, idx);
  return { stores: Object.keys(by).length, rows: Object.values(by).reduce((a, l) => a + l.length, 0) };
}

// per SKU: sold in each store over the last `months` (nightly ERP sales), all-store totals per month, stock, refill order
async function enrich(skus, months) {
  const want = new Set(skus), info = {}, { storeOf, settings } = require('./_dist'), st = await settings();
  const erp = (await store.getJSON('rf/erp.json')) || {};
  const all = Object.keys(erp.sold || {}).sort(), cur = cairo().toISOString().slice(0, 7), lastN = all.filter(m => m < cur).slice(-Math.max(1, months));
  for (const s of want) info[s] = { sold: Math.round(lastN.reduce((a, m) => a + ((erp.sold[m] || {})[s] || 0), 0)), byMonth: lastN.map(m => Math.round((erp.sold[m] || {})[s] || 0)), soh: Math.round((erp.soh || {})[s] || 0), grp: (erp.grp || {})[s] || '', stores: {}, order: 0 };
  // per store, by store code (dash/f/erp-YYYY-MM.json rows: [date, invoice, qty, net, gross, sku, name, branch, ...])
  const now = cairo(), keys = [];
  for (let k = 0; k <= months; k++) keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate())).toISOString().slice(0, 10);
  for (const m of keys) {
    const f = await store.getJSON('dash/f/erp-' + m + '.json'); if (!f || !Array.isArray(f.rows)) continue;
    for (const r of f.rows) { if (r[0] < from) continue; const s = skuOf(r[5]); if (!want.has(s)) continue; const c = storeOf(r[7], st.stores) || String(r[7] || '?'); info[s].stores[c] = (info[s].stores[c] || 0) + (Number(r[2]) || 0); }
  }
  const idx = (await store.getJSON('rf/orders/index.json')) || [];
  const last = idx.length ? await store.getJSON('rf/orders/' + idx[idx.length - 1].id + '.json') : null;
  if (last) for (const [s, q] of (last.approved ? last.approved.lines.map(l => [l[0], l[2]]) : Object.entries(last.fb || {}))) if (info[s]) info[s].order = Number(q) || 0;
  return { info, from, salesMonths: lastN, order: last ? { name: last.name, status: last.status } : null, stores: st.stores.map(s => ({ code: s.code, name: s.name })) };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await require('./_refill').levelFor(who);
  if (lvl === 'none') return send(res, 403, { ok: false, error: 'No access to Slow Moving. Ask the super admin (Refill Order access).' });
  const url = new URL(req.url, 'https://x.invalid');
  const erpOn = !!(process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET);
  if (req.method === 'GET') {
    if (url.searchParams.get('warehouses')) {
      if (!erpOn) return send(res, 503, { ok: false, error: 'ERP is not connected.' });
      try { return send(res, 200, { ok: true, warehouses: await warehouses() }); } catch (e) { return send(res, 502, { ok: false, error: String(e.message || e).slice(0, 300) }); }
    }
    const idx = (await store.getJSON(INDEX)) || {}, { storeOf, settings } = require('./_dist'), st = await settings();
    const snaps = [];
    for (const [w, v] of Object.entries(idx)) { if (/water\s*way/i.test(w)) continue; const s = await store.getJSON('slow/w/' + v.k + '.json'); if (s) snaps.push({ ...s, store: storeOf(w, st.stores) || w }); }
    if (!snaps.length) return send(res, 200, { ok: true, level: lvl, snaps: [] });
    // the SKU column, by name
    const c0 = snaps.find(s => s.cols.length).cols, skuCol = c0 ? c0.findIndex(c => c.fieldname === '_sku') : -1;
    const skus = skuCol < 0 ? [] : [...new Set(snaps.flatMap(s => s.rows.map(r => skuOf(r[skuCol]))).filter(Boolean))];
    const months = Math.max(...snaps.map(s => Number(s.months) || 6));
    return send(res, 200, { ok: true, level: lvl, snaps, skuCol, months, ...(await enrich(skus, months)) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (lvl !== 'manage') return send(res, 403, { ok: false, error: 'Only Refill Order "Manage" can run the report.' });
  const op = url.searchParams.get('op'), b = (await readJSON(req)) || {};
  if (op === 'clear') {
    const idx = (await store.getJSON(INDEX)) || {};
    for (const v of Object.values(idx)) await store.del('slow/w/' + v.k + '.json').catch(() => {});
    await store.putJSON(INDEX, {});
    return send(res, 200, { ok: true });
  }
  if (op === 'syncall') {
    if (!erpOn) return send(res, 503, { ok: false, error: 'ERP is not connected.' });
    const months = Math.max(1, Math.min(36, Math.round(Number(b.months) || 6))), only = Array.isArray(b.warehouses) ? b.warehouses.map(w => str(w, 140)).filter(Boolean) : [];
    try { return send(res, 200, { ok: true, ...(await buildFromData(months)) }); }
    catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 400) }); }
  }
  if (op !== 'sync') return send(res, 400, { ok: false, error: 'Unknown action.' });
  if (!erpOn) return send(res, 503, { ok: false, error: 'ERP is not connected.' });
  const wh = str(b.warehouse, 140), months = Math.max(1, Math.min(36, Math.round(Number(b.months) || 6)));
  if (!wh) return send(res, 400, { ok: false, error: 'Pick a store.' });
  try { return send(res, 200, { ok: true, ...(await runOne(wh, months, str(b.pr, 140))) }); }
  catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 400) }); }
};
module.exports.buildFromData = buildFromData;
