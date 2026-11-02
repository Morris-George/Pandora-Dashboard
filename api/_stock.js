// Stock balance (reached at /api/stock, rewritten to api/erp.js: the Hobby plan allows 12 functions, so this is a helper).
//   GET  /api/stock?from=YYYY-MM-DD&to=YYYY-MM-DD   super admin, area managers (their zone's warehouses) and the VM (pieces only, never any value)
//        With ERP connected it asks ERPNext's "Stock Balance" report for those dates (cached 30 minutes, or a day for past dates),
//        so the dates can be changed freely. Without ERP (or if ERP cannot be reached) it shows the last uploaded Excel file, which is
//        one fixed snapshot: its dates cannot be changed.
//   POST /api/stock?op=upload   super admin: {file, rows:[[code, name, group, warehouse, opening, in, out, balance, value]]} (gzip or plain)
//   POST /api/stock?op=delete   super admin: remove the uploaded Excel snapshot
// Row: [item code, item name, item group, warehouse, opening qty, in qty, out qty, balance qty, balance value, description (search only)]
const zlib = require('zlib');
const store = require('./_store');
const { whoami, whoFromRec } = require('./_auth');
const ex = require('./_exclude');

const CURRENT = 'stock/current.json';
const CACHE_INDEX = 'stock/index.json';
const STATUS = 'stock/status.json'; // last ERP sync, shown on All Uploads
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
  if (/l['\u2019`]?aderach|frisch|chocolate/i.test(r[2] + ' ' + r[3])) return false; // Laderach (also spelled L'Aderach) and its chocolate lines
  return !!(r[4] || r[5] || r[6] || r[7] || r[8]);
}
const toRow = a => [str(a[0], 40), str(a[1], 120), str(a[2], 80), cleanWarehouse(a[3]), num(a[4]), num(a[5]), num(a[6]), num(a[7]), num(a[8]), str(String(a[9] == null ? '' : a[9]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), 200)];

function fromErp(list) {
  const pick = (x, ...ks) => { for (const k of ks) if (x[k] != null && x[k] !== '') return x[k]; return null; };
  return list.filter(x => x && !Array.isArray(x) && pick(x, 'item_code', 'sku', 'item'))
    .map(x => toRow([
      pick(x, 'item_code', 'sku', 'item'), pick(x, 'item_name', 'name', 'item'),
      pick(x, 'item_group', 'full_group', 'category', 'item_category') || '', x.warehouse,
      pick(x, 'opening_qty') || 0, pick(x, 'in_qty') || 0, pick(x, 'out_qty') || 0,
      pick(x, 'bal_qty', 'balance_qty', 'balance') || 0, pick(x, 'bal_val', 'balance_value') || 0, pick(x, 'description', 'item_description') || '']))
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

// The stock report only knows the design code as the item name. Real product names come from ERPNext's Item list (its description),
// read once per fresh stock read; lines ERP has no description for borrow the name from the saved sales lines.
const cleanName = v => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[|]/g, ' ').replace(/---/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
async function erpItemNames() {
  const base = String(process.env.ERP_URL || '').replace(/\/+$/, '');
  const auth = { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: 'application/json' };
  const names = new Map();
  for (let start = 0; start < 60000; start += 5000) {
    const q = 'fields=' + encodeURIComponent('["name","item_name","description"]') + '&limit_page_length=5000&limit_start=' + start;
    const r = await fetch(base + '/api/resource/Item?' + q, { headers: auth, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('ERP Item list answered ' + r.status);
    const list = ((await r.json()).data) || [];
    for (const x of list) { const n = cleanName(x.description); if (n && x.name) names.set(String(x.name).trim().toUpperCase(), n); }
    if (list.length < 5000) break;
  }
  return names;
}
async function addNames(rows) {
  addNames.err = '';
  if (!rows.some(r => !r[9])) return;
  let err = '';
  try {
    const names = await erpItemNames();
    for (const r of rows) if (!r[9]) { const n = names.get(String(r[0]).trim().toUpperCase()) || names.get(String(r[1]).trim().toUpperCase()); if (n) r[9] = n; }
  } catch (e) { err = String(e && e.message || e).slice(0, 160); }
  try {
    if (!rows.some(r => !r[9])) return;
    const { dashRows } = require('./_sales');
    const names = new Map();
    for (const r of await dashRows()) {
      const b = String(r[5] || '').toUpperCase().split('-')[0].trim();
      if (b && r[6] && !names.has(b)) names.set(b, String(r[6]).slice(0, 120));
    }
    for (const r of rows) {
      if (r[9]) continue;
      const n = names.get(String(r[1]).toUpperCase().split('-')[0].trim()) || names.get(String(r[0]).toUpperCase().split('-')[0].trim());
      if (n) r[9] = n;
    }
  } catch (_) { /* names are a bonus: the stock itself is still shown */ }
  const left = rows.filter(r => !r[9]).length;
  addNames.err = left ? left + ' of ' + rows.length + ' stock lines have no name' + (err ? ' (ERP Item list: ' + err + ')' : ' (ERP Item list read, no description for them)') : '';
}

async function erpStock(from, to, fresh) {
  const key = 'stock/r/' + from + '_' + to + '.json';
  const ttl = to < cairoToday() ? 24 * 3600 * 1000 : 30 * 60 * 1000; // a past date does not change
  {
    const c = await store.getJSON(key);
    // a Sync press is honoured unless the same dates were read less than a minute ago; an empty answer is never trusted from the cache
    if (c && c.rows && c.rows.length && Date.now() - Date.parse(c.at) < (fresh ? 60 * 1000 : ttl)) {
      // a copy saved before names existed: add them once and save it again
      if ((!c.named || fresh) && c.rows.some(r => !r[9])) { await addNames(c.rows); c.named = true; c.diag = { ...(c.diag || {}), names: addNames.err || undefined }; await store.putJSON(key, c).catch(() => {}); }
      return c;
    }
  }
  const { runReport } = require('./erp');
  // "Branches Stock Balance" is a Custom Report with saved filters; runReport asks ERPNext for our dates instead.
  const list = await runReport(process.env.ERP_STOCK_REPORT || 'Branches Stock Balance', { from_date: from, to_date: to });
  const rec = { at: new Date().toISOString(), from, to, rows: fromErp(list) };
  await addNames(rec.rows); rec.named = true;
  rec.diag = { names: addNames.err || undefined, company: 'Branches Stock Balance', raw: list.length, keys: list[0] ? Object.keys(list[0]).slice(0, 25) : [], kept: rec.rows.length };
  await store.putJSON(STATUS, { ok: true, at: rec.at, from, to, lines: rec.rows.length, raw: list.length });
  if (!rec.rows.length) return rec; // nothing to cache: show what ERP said instead
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

// ---- One item's quantity in each store (the "Stock per store" button in the Pandora Dashboards item popup) ----
//   GET /api/stock?op=item&code=<SKU>     -> { ok, code, stores:[{store, qty}], total, scope, asOf }
// Who sees which stores is decided HERE, on the server, never in the page:
//   super admin / overseer / VM  -> every store and warehouse
//   area managers (Joseph, Hassan) -> only the stores of their own zone
//   store managers and sales people -> only their own store
// Anyone else (HR, Stock Count only) gets nothing. A person who was only lifted onto this report by Report access
// keeps their own limits when they are a store manager or a sales person.
const nrmStore = s => String(s || '').toLowerCase().replace(/^pandora\s+/, '').replace(/[^a-z0-9]+/g, '');
const sameStore = (a, b) => { const x = nrmStore(a), y = nrmStore(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)))); };
function itemScope(who) {
  let w = who;
  if (w && w.lifted && w.user) { const own = whoFromRec(w.user); if (own && own.kind === 'staff') w = own; }
  if (w.kind === 'vm') return { all: true };
  if (w.kind === 'env') return w.info && w.info.allow ? { rx: w.info.allow.map(s => new RegExp(s, 'i')), zone: w.info.zone } : { all: true };
  if (w.kind === 'staff' && w.info && w.info.self && w.info.self.store) return { store: w.info.self.store };
  return null;
}
async function itemStock(req, res, who) {
  const sc = itemScope(who);
  if (!sc) return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');
  const code = str(url.searchParams.get('code'), 60).toUpperCase();
  if (!code || code === '—') return send(res, 400, { ok: false, error: 'This item has no code.' });
  const today = cairoToday(), from = today.slice(0, 8) + '01';
  const snap = await store.getJSON(CURRENT);
  let rows = null, at = '';
  if (process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET) {
    try { const d = await erpStock(from, today, false); rows = d.rows; at = d.at; }
    catch (_) {
      // ERP did not answer: use whatever was saved for this month, then the Excel file
      const c = await store.getJSON('stock/r/' + from + '_' + today + '.json');
      if (c && c.rows && c.rows.length) { rows = c.rows; at = c.at; }
    }
  }
  if (!rows && snap) { rows = snap.rows; at = snap.uploadedAt || snap.asOf || ''; }
  if (!rows) return send(res, 404, { ok: false, error: 'No stock balance is available yet.' });
  const up = v => String(v == null ? '' : v).trim().toUpperCase();
  let hit = rows.filter(r => up(r[0]) === code || up(r[1]) === code);
  if (!hit.length) hit = rows.filter(r => up(r[0]).startsWith(code + '-') || up(r[1]).startsWith(code + '-')); // the design without a size
  const by = new Map();
  for (const r of hit) {
    const w = r[3];
    if (sc.rx && !sc.rx.some(x => x.test(w))) continue;
    if (sc.store && !sameStore(w, sc.store)) continue;
    by.set(w, (by.get(w) || 0) + (Number(r[7]) || 0));
  }
  const stores = [...by.entries()].map(([s, q]) => ({ store: s, qty: Math.round(q * 1000) / 1000 })).sort((a, b) => b.qty - a.qty || a.store.localeCompare(b.store));
  return send(res, 200, { ok: true, code, stores, total: stores.reduce((t, x) => t + x.qty, 0), scope: sc.all ? 'all' : sc.rx ? 'zone' : 'store', zone: sc.zone || undefined, asOf: at, source: at && snap && rows === snap.rows ? 'excel' : 'erp' });
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (req.method === 'GET' && new URL(req.url, 'https://x.invalid').searchParams.get('op') === 'item') return itemStock(req, res, who); // per-store quantity of one item, limited to the caller's own stores
  if (!(who.kind === 'vm' || who.kind === 'env')) return send(res, 403, { ok: false, error: 'No access.' }); // sales people and store managers never
  const isAdmin = who.kind === 'env' && who.info.role === 'admin';
  const url = new URL(req.url, 'https://x.invalid');

  if (req.method === 'POST') {
    if (!isAdmin) return send(res, 403, { ok: false, error: 'Only the super admin can change stock files.' });
    const op = url.searchParams.get('op');
    if (op === 'delete') { await store.del(CURRENT); return send(res, 200, { ok: true }); }
    if (op === 'sync') {
      const t = cairoToday();
      try { await erpStock(t.slice(0, 8) + '01', t, true); }
      catch (e) { const st = { ok: false, at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 200) }; await store.putJSON(STATUS, st).catch(() => {}); return send(res, 502, { ok: false, error: st.error, status: st }); }
      return send(res, 200, { ok: true, status: await store.getJSON(STATUS) });
    }
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

  if (url.searchParams.get('op') === 'status') {
    if (!isAdmin) return send(res, 403, { ok: false, error: 'Only the super admin can see the sync status.' });
    return send(res, 200, { ok: true, status: await store.getJSON(STATUS) });
  }
  const today = cairoToday();
  let from = ISO.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : today.slice(0, 8) + '01';
  let to = ISO.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : today;
  if (from > to) { const x = from; from = to; to = x; }
  const base = { ok: true, canSeeValue: who.kind !== 'vm', isAdmin, today };
  const snap = await store.getJSON(CURRENT);
  const erpOn = !!(process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET); // live from ERPNext; the Excel file on All Uploads is the fallback
  let note = '';

  // cached=1: answer at once with whatever was saved for these dates (any age), so the page opens instantly while the live read happens in a second call
  if (url.searchParams.get('cached') === '1') {
    const c = await store.getJSON('stock/r/' + from + '_' + to + '.json');
    if (c && c.rows && c.rows.length) return send(res, 200, { ...base, source: 'erp', from, to, fetchedAt: c.at, canChangeDates: true, hasExcel: !!snap, stale: true, rows: scope(c.rows, who) });
    return send(res, 200, { ok: true, miss: true });
  }

  if (erpOn) {
    try {
      const d = await erpStock(from, to, url.searchParams.get('fresh') === '1');
      return send(res, 200, { ...base, source: 'erp', from, to, fetchedAt: d.at, diag: d.rows.length ? undefined : d.diag, namesNote: who.kind === 'env' && who.info.role === 'admin' && d.diag && d.diag.names ? d.diag.names : undefined, canChangeDates: true, hasExcel: !!snap, rows: scope(d.rows, who) });
    } catch (e) {
      if (!snap) await store.putJSON(STATUS, { ok: false, at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 200) }).catch(() => {});
      if (!snap) return send(res, 502, { ok: false, error: 'ERP could not give the stock balance: ' + String(e && e.message || e).slice(0, 240) });
      note = 'ERP could not be reached, so this is the last Excel file that was added.';
      await store.putJSON(STATUS, { ok: false, at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 200) }).catch(() => {});
    }
  }
  if (!snap) return send(res, 404, { ok: false, error: 'no-stock' });
  return send(res, 200, { ...base, source: 'excel', file: snap.file, asOf: snap.asOf, uploadedAt: snap.uploadedAt, canChangeDates: false, note, rows: scope(snap.rows, who) });
};
