// Stock balance (reached at /api/stock, rewritten to api/erp.js: the Hobby plan allows 12 functions, so this is a helper).
//   GET  /api/stock?from=YYYY-MM-DD&to=YYYY-MM-DD   super admin, area managers (their zone's warehouses) and the VM (pieces only, never any value)
//        With ERP connected it asks ERPNext's "Stock Balance" report for those dates (cached 30 minutes, or a day for past dates),
//        so the dates can be changed freely. Without ERP (or if ERP cannot be reached) it shows the last uploaded Excel file, which is
//        one fixed snapshot: its dates cannot be changed.
//   POST /api/stock?op=upload   super admin: {file, rows:[[code, name, group, warehouse, opening, in, out, balance, value]]} (gzip or plain)
//   POST /api/stock?op=delete   super admin: remove the uploaded Excel snapshot
// Row: [item code, item name, item group, warehouse, opening qty, in qty, out qty, balance qty, balance value]
const zlib = require('zlib');
const store = require('./_store');
const { whoami } = require('./_auth');
const ex = require('./_exclude');

const CURRENT = 'stock/current.json';
const CACHE_INDEX = 'stock/index.json';
const MAX_CACHE = 20;
const MAX_ROWS = 200000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; };
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const cairoToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

// "Pandora Almaza - AN" -> "Almaza" (same cleaning idea as the sales branches)
function cleanWarehouse(w) {
  const s = str(w, 80).replace(/\s-\s[A-Za-z]{1,5}$/, '').replace(/^Pandora\s+/i, '').replace(/ Of /g, ' of ').trim();
  return s || 'Unspecified';
}
// Packaging and services are not stock to count; Laderach is left out everywhere; all-zero lines carry nothing.
function keep(r) {
  if (/packaging|services|maintenance/i.test(r[2])) return false;
  if (ex.anyHit(r[0], r[1], r[2], r[3])) return false;
  return !!(r[4] || r[5] || r[6] || r[7] || r[8]);
}
const toRow = a => [str(a[0], 40), str(a[1], 120), str(a[2], 80), cleanWarehouse(a[3]), num(a[4]), num(a[5]), num(a[6]), num(a[7]), num(a[8])];

function fromErp(list) {
  return list.filter(x => x && !Array.isArray(x) && x.item_code)
    .map(x => toRow([x.item_code, x.item_name, x.item_group, x.warehouse, x.opening_qty, x.in_qty, x.out_qty, x.bal_qty, x.bal_val]))
    .filter(keep);
}

// area managers: only the warehouses of their zone; the VM: pieces only
function scope(rows, who) {
  let out = rows;
  if (who.kind === 'env' && who.info.allow) {
    const rx = who.info.allow.map(s => new RegExp(s, 'i'));
    out = out.filter(r => rx.some(x => x.test(r[3])));
  }
  if (who.kind === 'vm') out = out.map(r => { const c = r.slice(); c[8] = 0; return c; });
  return out;
}

async function erpStock(from, to, fresh) {
  const key = 'stock/r/' + from + '_' + to + '.json';
  const ttl = to < cairoToday() ? 24 * 3600 * 1000 : 30 * 60 * 1000; // a past date does not change
  if (!fresh) {
    const c = await store.getJSON(key);
    if (c && Date.now() - Date.parse(c.at) < ttl) return c;
  }
  const status = await store.getJSON('erp/status.json');
  const company = process.env.ERP_COMPANY || (status && status.company) || '';
  if (!company) throw new Error('The ERP company is not known yet. Press Sync from ERP once on the All Uploads page.');
  const { runReport } = require('./erp');
  const list = await runReport('Stock Balance', { company, from_date: from, to_date: to });
  const rec = { at: new Date().toISOString(), from, to, rows: fromErp(list) };
  await store.putJSON(key, rec);
  let idx = ((await store.getJSON(CACHE_INDEX)) || []).filter(k => k !== key);
  idx.push(key);
  while (idx.length > MAX_CACHE) await store.del(idx.shift());
  await store.putJSON(CACHE_INDEX, idx);
  return rec;
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'vm' || who.kind === 'env')) return send(res, 403, { ok: false, error: 'No access.' }); // sales people and store managers never
  const isAdmin = who.kind === 'env' && who.info.role === 'admin';
  const url = new URL(req.url, 'https://x.invalid');

  if (req.method === 'POST') {
    if (!isAdmin) return send(res, 403, { ok: false, error: 'Only the super admin can change stock files.' });
    const op = url.searchParams.get('op');
    if (op === 'delete') { await store.del(CURRENT); return send(res, 200, { ok: true }); }
    if (op !== 'upload') return send(res, 400, { ok: false, error: 'Unknown action.' });
    let d;
    try {
      let buf = await readBody(req);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 120 * 1024 * 1024 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (_) { return send(res, 400, { ok: false, error: 'Could not read the uploaded data.' }); }
    if (!d || !Array.isArray(d.rows) || !d.rows.length) return send(res, 400, { ok: false, error: 'No stock lines were found in that file.' });
    if (d.rows.length > MAX_ROWS) return send(res, 400, { ok: false, error: 'The file is too large.' });
    const rows = d.rows.filter(Array.isArray).map(toRow).filter(keep);
    if (!rows.length) return send(res, 400, { ok: false, error: 'No stock lines were found in that file.' });
    await store.putJSON(CURRENT, { file: str(d.file, 100) || 'Stock balance', asOf: cairoToday(), uploadedAt: new Date().toISOString(), rows });
    return send(res, 200, { ok: true, rows: rows.length });
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }

  const today = cairoToday();
  let from = ISO.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : today.slice(0, 8) + '01';
  let to = ISO.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : today;
  if (from > to) { const x = from; from = to; to = x; }
  const base = { ok: true, canSeeValue: who.kind !== 'vm', isAdmin, today };
  const snap = await store.getJSON(CURRENT);
  const erpOn = !!(process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET);
  let note = '';

  if (erpOn) {
    try {
      const d = await erpStock(from, to, isAdmin && url.searchParams.get('fresh') === '1');
      return send(res, 200, { ...base, source: 'erp', from, to, fetchedAt: d.at, canChangeDates: true, hasExcel: !!snap, rows: scope(d.rows, who) });
    } catch (e) {
      if (!snap) return send(res, 502, { ok: false, error: 'ERP could not give the stock balance: ' + String(e && e.message || e).slice(0, 240) });
      note = 'ERP could not be reached, so this is the last Excel file that was added.';
    }
  }
  if (!snap) return send(res, 404, { ok: false, error: 'no-stock' });
  return send(res, 200, { ...base, source: 'excel', file: snap.file, asOf: snap.asOf, uploadedAt: snap.uploadedAt, canChangeDates: false, note, rows: scope(snap.rows, who) });
};
