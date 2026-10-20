// The monthly sales data, kept on the server.
//   GET  /api/data                  what the signed-in person is allowed to see (everything / their zone / their own page)
//   POST /api/data                  super admin only: publish a new month (gzip or plain JSON body)
//   POST /api/data?op=settings      super admin only: which item groups are left out of the numbers
const zlib = require('zlib');
const store = require('./_store');
const { whoami } = require('./_auth');
const { staffView } = require('./_stats');
const ex = require('./_exclude');

const FILE = 'data/current.json';
const MAX_ROWS = 600000;

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

function scopeByStores(d, allowRegexes) {
  const rx = allowRegexes.map(s => new RegExp(s, 'i'));
  const ok = n => rx.some(r => r.test(n));
  const sMap = new Map(), stores = [];
  d.stores.forEach((s, i) => { if (ok(s)) { sMap.set(i, stores.length); stores.push(s); } });
  const pMap = new Map(), people = [];
  d.people.forEach((p, i) => { if (sMap.has(p[1])) { pMap.set(i, people.length); people.push([p[0], sMap.get(p[1])]); } });
  const rows = [];
  for (const r of d.rows) { const np = pMap.get(r[0]); if (np !== undefined) { const c = r.slice(); c[0] = np; rows.push(c); } }
  return { ...d, stores, people, rows };
}

// Date range: rows carry the day number (days since 1970-01-01) in column 5. ?from=YYYY-MM-DD&to=YYYY-MM-DD keeps only those days,
// for everyone (super admin, area managers, store managers, sales people). dayMin/dayMax always describe the whole file.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoToDay = s => ISO.test(String(s || '')) ? Math.round(Date.parse(s + 'T00:00:00Z') / 86400000) : null;
const dayToIso = n => new Date(n * 86400000).toISOString().slice(0, 10);
const fmtDay = (n, year) => new Date(n * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...(year ? { year: 'numeric' } : {}) });
function byDate(d, from, to) {
  let mn = null, mx = null;
  for (const r of d.rows) if (r[5] != null) { if (mn === null || r[5] < mn) mn = r[5]; if (mx === null || r[5] > mx) mx = r[5]; }
  const meta = { dayMin: mn === null ? null : dayToIso(mn), dayMax: mx === null ? null : dayToIso(mx) };
  let f = isoToDay(from), t = isoToDay(to);
  if (f === null && t === null) return { ...d, ...meta };
  if (f !== null && t !== null && f > t) { const x = f; f = t; t = x; }
  const rows = d.rows.filter(r => r[5] != null && (f === null || r[5] >= f) && (t === null || r[5] <= t));
  const a = f !== null ? f : mn, b = t !== null ? t : mx;
  const period = a !== null && b !== null ? fmtDay(a) + ' – ' + fmtDay(b, true) : d.period;
  return { ...d, rows, period, ...meta, from: f === null ? null : dayToIso(f), to: t === null ? null : dayToIso(t) };
}

function validate(d) {
  if (!d || typeof d !== 'object') return 'The file is not valid.';
  for (const k of ['stores', 'people', 'groups', 'rows']) if (!Array.isArray(d[k])) return 'The file is missing ' + k + '.';
  if (!d.rows.length) return 'The file has no sales rows.';
  if (d.rows.length > MAX_ROWS) return 'The file is too large.';
  const ns = d.stores.length, np = d.people.length, ng = d.groups.length;
  for (const p of d.people) if (!Array.isArray(p) || typeof p[0] !== 'string' || !(p[1] >= 0 && p[1] < ns)) return 'The people list is not valid.';
  for (const r of d.rows) {
    if (!Array.isArray(r) || r.length < 5) return 'A sales row is not valid.';
    if (!(r[0] >= 0 && r[0] < np) || !(r[1] >= 0 && r[1] < ng) || !isFinite(r[3]) || !isFinite(r[4])) return 'A sales row is not valid.';
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (who.kind === 'vm' || who.kind === 'sc') return send(res, 403, { ok: false, error: 'No access.' });

  if (req.method === 'GET') {
    const q = new URL(req.url, 'https://x.invalid').searchParams;
    const d0 = ex.filterStaff(await store.getJSON(FILE));
    if (!d0) return send(res, 404, { ok: false, error: 'no-data' });
    const d = byDate(d0, q.get('from'), q.get('to'));
    const wantMe = q.get('me');
    if (who.kind === 'staff' && (wantMe || !who.info.storeManager)) return send(res, 200, staffView(d, who.user.store, who.user.name)); // own page only
    if (who.info.allow) return send(res, 200, scopeByStores(d, who.info.allow)); // area managers: their zone; store managers: their own store
    return send(res, 200, d);
  }

  if (req.method === 'POST') {
    if (!(who.kind === 'env' && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Only the super admin can change the data.' });
    const url = new URL(req.url, 'https://x.invalid');

    if (url.searchParams.get('op') === 'settings') {
      let b = req.body;
      if (Buffer.isBuffer(b)) { try { b = JSON.parse(b.toString('utf8')); } catch (_) { b = null; } }
      if (!b || !Array.isArray(b.ex)) return send(res, 400, { ok: false, error: 'Bad settings.' });
      const d = await store.getJSON(FILE);
      if (!d) return send(res, 404, { ok: false, error: 'no-data' });
      d.ex = b.ex.filter(x => typeof x === 'string').slice(0, 500);
      await store.putJSON(FILE, d);
      return send(res, 200, { ok: true });
    }

    let d;
    try {
      let buf = await readBody(req);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 120 * 1024 * 1024 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (_) { return send(res, 400, { ok: false, error: 'Could not read the uploaded data.' }); }
    const problem = validate(d);
    if (problem) return send(res, 400, { ok: false, error: problem });
    const prev = await store.getJSON(FILE);
    const clean0 = {
      file: String(d.file || '').slice(0, 70), period: String(d.period || '').slice(0, 60),
      stores: d.stores.map(String), people: d.people.map(p => [String(p[0]), p[1]]), groups: d.groups.map(String),
      items: Array.isArray(d.items) ? d.items.map(i => Array.isArray(i) ? [String(i[0] || ''), String(i[1] || '')] : [String(i || ''), '']) : [],
      ex: Array.isArray(d.ex) ? d.ex.filter(x => typeof x === 'string') : (prev && prev.ex) || undefined,
      rows: d.rows, uploadedAt: new Date().toISOString()
    };
    const clean = ex.filterStaff(clean0);
    await store.putJSON(FILE, clean);
    return send(res, 200, { ok: true, rows: clean.rows.length });
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
