// VM reports. The super admin feeds them; the VM account only views them.
// Money never reaches storage: every upload is cleaned on the server, and only item/category/store/date/quantity columns are kept.
//   GET  /api/vm            list of reports (super admin and VM account)
//   GET  /api/vm?id=<id>    one report
//   POST /api/vm            super admin: upload {file, sheets:[{name, columns, rows}]} (gzip or plain JSON)
//   POST /api/vm?op=delete  super admin: {id}
const zlib = require('zlib');
const store = require('./_store');
const { whoami } = require('./_auth');
const ex = require('./_exclude');

const INDEX = 'vm/index.json';
const MAX_CELLS = 400000;
const MAX_REPORTS = 60;

// Keep a column only if it is clearly about where / what / when / how many, and never if it is about money.
const ALLOW = /(^|[^a-z])(store|branch|location|shop|year|month|date|day|week|category|group|class|brand|collection|item|product|sku|code|description|name|material|colou?r|size|qty|quantity|units|pieces|pcs)([^a-z]|$)/i;
const DENY = /(amount|value|revenue|price|vat|tax|cost|margin|profit|gross|net|discount|atv|trx|transaction|invoice|egp|incl|excl|sales\s*(?:amt|amount|value)|turnover|payment)/i;
const keepColumn = name => ALLOW.test(String(name)) && !DENY.test(String(name));

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';

// "Sales_QTY_and_Volume_by_category-Jewelry_2026-10-01_2026-10-15_Pandora.xlsx" -> title + period
function describe(file) {
  let n = String(file || 'VM report').replace(/\.[^.]+$/, '');
  let period = '';
  const m = n.match(/(\d{4})-(\d{2})-(\d{2})[_\s-]+(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const mo = i => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+i - 1] || m[i];
    period = (m[2] === m[5] && m[1] === m[4]) ? `${+m[3]}–${+m[6]} ${mo(m[2])} ${m[1]}` : `${+m[3]} ${mo(m[2])} ${m[1]} – ${+m[6]} ${mo(m[5])} ${m[4]}`;
    n = n.replace(m[0], ' ');
  }
  n = n.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' – ').replace(/\s+/g, ' ').replace(/(\s*[–-]\s*)+$/, '').trim();
  return { title: n.slice(0, 80) || 'VM report', period };
}

function cleanSheet(sh) {
  const keep = [];
  sh.columns.forEach((c, i) => { if (keepColumn(c)) keep.push(i); });
  const dropped = sh.columns.filter((c, i) => !keep.includes(i)).map(String);
  const columns = keep.map(i => String(sh.columns[i] == null ? '' : sh.columns[i]).slice(0, 80));
  const rows = [];
  for (const r of sh.rows) {
    const first = r.find(v => typeof v === 'string' && v.trim());
    if (first && /^(grand\s*)?total/i.test(first.trim())) continue; // total rows are not data
    const out = keep.map(i => { const v = r[i]; return v === undefined ? null : (typeof v === 'string' ? v.slice(0, 120) : v); });
    if (out.some(v => v !== null && v !== '')) rows.push(out);
  }
  const clean = ex.filterTable(rows); rows.length = 0; rows.push(...clean);
  const find = re => columns.findIndex(c => re.test(c));
  const kind = find(/categor|group|class/i) >= 0 && find(/qty|quantity|units|pieces|pcs/i) >= 0 && find(/store|branch|location|shop/i) >= 0 ? 'qty-by-category' : 'table';
  return { columns, rows, dropped, kind };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const isAdmin = who.kind === 'env' && who.info.role === 'admin';
  if (!isAdmin && who.kind !== 'vm') return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      if (!/^[a-z0-9-]{1,60}$/.test(id)) return send(res, 400, { ok: false, error: 'Bad id.' });
      const d = await store.getJSON('vm/r/' + id + '.json');
      if (d && Array.isArray(d.rows)) d.rows = ex.filterTable(d.rows); // Laderach is left out
      return d ? send(res, 200, d) : send(res, 404, { ok: false, error: 'no-data' });
    }
    return send(res, 200, { ok: true, reports: (await store.getJSON(INDEX)) || [] });
  }

  if (req.method === 'POST') {
    if (!isAdmin) return send(res, 403, { ok: false, error: 'Only the super admin can change the reports.' });
    let idx = (await store.getJSON(INDEX)) || [];

    if (url.searchParams.get('op') === 'delete') {
      let b = req.body; if (Buffer.isBuffer(b)) { try { b = JSON.parse(b.toString('utf8')); } catch (_) { b = null; } }
      const id = b && String(b.id || '');
      if (!id || !/^[a-z0-9-]{1,60}$/.test(id)) return send(res, 400, { ok: false, error: 'Bad id.' });
      await store.del('vm/r/' + id + '.json');
      await store.putJSON(INDEX, idx.filter(r => r.id !== id));
      return send(res, 200, { ok: true });
    }

    let d;
    try {
      let buf = await readBody(req);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 60 * 1024 * 1024 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (_) { return send(res, 400, { ok: false, error: 'Could not read the uploaded data.' }); }
    if (!d || !Array.isArray(d.sheets) || !d.sheets.length) return send(res, 400, { ok: false, error: 'The file has no sheets.' });
    let cells = 0;
    for (const sh of d.sheets) {
      if (!sh || typeof sh.name !== 'string' || !Array.isArray(sh.columns) || !Array.isArray(sh.rows) || sh.rows.some(r => !Array.isArray(r))) return send(res, 400, { ok: false, error: 'A sheet is not valid.' });
      cells += sh.rows.reduce((n, r) => n + r.length, 0);
    }
    if (cells > MAX_CELLS) return send(res, 400, { ok: false, error: 'The file is too large.' });

    const meta = describe(d.file), saved = [], droppedAll = new Set();
    for (const sh of d.sheets) {
      const c = cleanSheet(sh);
      if (!c.columns.length || !c.rows.length) continue;
      c.dropped.forEach(x => droppedAll.add(x));
      const multi = d.sheets.length > 1;
      const title = multi ? meta.title + ' · ' + String(sh.name).slice(0, 40) : meta.title;
      const id = slug(multi ? meta.title + '-' + sh.name : meta.title);
      const rec = { id, title, period: meta.period, kind: c.kind, columns: c.columns, rows: c.rows, uploadedAt: new Date().toISOString() };
      await store.putJSON('vm/r/' + id + '.json', rec);
      idx = idx.filter(r => r.id !== id);
      idx.push({ id, title, period: meta.period, kind: c.kind, rows: c.rows.length, uploadedAt: rec.uploadedAt });
      saved.push(id);
    }
    if (!saved.length) return send(res, 400, { ok: false, error: 'Nothing to show was found in that file (no item, category or quantity columns).' });
    if (idx.length > MAX_REPORTS) return send(res, 400, { ok: false, error: 'Too many reports. Remove an old one first.' });
    idx.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    await store.putJSON(INDEX, idx);
    return send(res, 200, { ok: true, reports: saved.length, removed: [...droppedAll] });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
