// The Visual Merchandiser (VM) report. The super admin feeds it, the VM account only views it.
//   GET  /api/vm   super admin and VM account
//   POST /api/vm   super admin only: publish {title, period, sheets:[{name, columns:[...], rows:[[...]]}]} (gzip or plain JSON)
const zlib = require('zlib');
const store = require('./_store');
const { whoami } = require('./_auth');

const FILE = 'vm/current.json';
const MAX_CELLS = 400000;

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
function validate(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.sheets) || !d.sheets.length) return 'The file has no sheets.';
  let cells = 0;
  for (const sh of d.sheets) {
    if (!sh || typeof sh.name !== 'string' || !Array.isArray(sh.columns) || !Array.isArray(sh.rows)) return 'A sheet is not valid.';
    for (const r of sh.rows) { if (!Array.isArray(r)) return 'A sheet row is not valid.'; cells += r.length; }
    if (cells > MAX_CELLS) return 'The file is too large.';
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const isAdmin = who.kind === 'env' && who.info.role === 'admin';
  if (!isAdmin && who.kind !== 'vm') return send(res, 403, { ok: false, error: 'No access.' });

  if (req.method === 'GET') {
    const d = await store.getJSON(FILE);
    if (!d) return send(res, 404, { ok: false, error: 'no-data' });
    return send(res, 200, d);
  }
  if (req.method === 'POST') {
    if (!isAdmin) return send(res, 403, { ok: false, error: 'Only the super admin can change this report.' });
    let d;
    try {
      let buf = await readBody(req);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 60 * 1024 * 1024 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (_) { return send(res, 400, { ok: false, error: 'Could not read the uploaded data.' }); }
    const problem = validate(d);
    if (problem) return send(res, 400, { ok: false, error: problem });
    const clean = {
      title: String(d.title || 'VM Report').slice(0, 80), period: String(d.period || '').slice(0, 60), file: String(d.file || '').slice(0, 70),
      sheets: d.sheets.map(sh => ({ name: String(sh.name).slice(0, 60), columns: sh.columns.map(c => String(c == null ? '' : c).slice(0, 80)), rows: sh.rows })),
      uploadedAt: new Date().toISOString()
    };
    await store.putJSON(FILE, clean);
    return send(res, 200, { ok: true, sheets: clean.sheets.length });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
