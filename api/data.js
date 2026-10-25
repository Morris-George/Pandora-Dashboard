// The monthly sales data, kept on the server.
//   GET  /api/data                  what the signed-in person is allowed to see (everything / their zone / their own page)
//   POST /api/data                  super admin only: publish a new month (gzip or plain JSON body)
//   POST /api/data?op=settings      super admin only: which item groups are left out of the numbers
const zlib = require('zlib');
const activity = require('./_activity');
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

// Several months in one: stores, people, groups and items are matched by name, invoice numbers are shifted so two months never share one.
function mergeMonths(list) {
  const stores = [], people = [], groups = [], items = [], sI = new Map(), pI = new Map(), gI = new Map(), tI = new Map(), rows = [];
  const idx = (m, arr, k) => { if (!m.has(k)) { m.set(k, arr.length); arr.push(k); } return m.get(k); };
  let invOff = 0;
  for (const d of list) {
    const sm = d.stores.map(s => idx(sI, stores, s));
    const pm = d.people.map(p => { const k = sm[p[1]] + '|' + p[0]; if (!pI.has(k)) { pI.set(k, people.length); people.push([p[0], sm[p[1]]]); } return pI.get(k); });
    const gm = d.groups.map(g => idx(gI, groups, g));
    const tm = (Array.isArray(d.items) ? d.items : []).map(i => { const k = JSON.stringify(i); if (!tI.has(k)) { tI.set(k, items.length); items.push(i); } return tI.get(k); });
    let mx = -1;
    for (const r of d.rows) {
      const c = r.slice(); c[0] = pm[r[0]]; c[1] = gm[r[1]];
      if (typeof c[2] === 'number') { if (c[2] > mx) mx = c[2]; c[2] += invOff; }
      if (c.length > 6 && c[6] != null) c[6] = tm[c[6]];
      rows.push(c);
    }
    invOff += mx + 1;
  }
  const last = list[list.length - 1] || {};
  return { file: last.file, period: last.period, stores, people, groups, items, rows, ex: last.ex, uploadedAt: last.uploadedAt };
}
const monthsBetween = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(y + '-' + String(m).padStart(2, '0')); if (++m > 12) { m = 1; y++; } } return out; };

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

module.exports = activity.wrap('data', async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (who.kind === 'vm' || who.kind === 'sc') return send(res, 403, { ok: false, error: 'No access.' });

  if (req.method === 'GET') {
    const q = new URL(req.url, 'https://x.invalid').searchParams;
    const cur = await store.getJSON(FILE);
    if (q.get('months')) { // which months can be opened (one saved file per month, plus the current one)
      const keys = (await store.list('data/m/')).map(p => (/^data\/m\/(\d{4}-\d{2})\.json$/.exec(p) || [])[1]).filter(Boolean);
      const ck = ex.monthKey(cur);
      if (ck && !keys.includes(ck)) keys.push(ck);
      keys.sort().reverse();
      return send(res, 200, { ok: true, months: keys, current: ck || null });
    }
    let raw = cur;
    const mk = q.get('month'), ck = ex.monthKey(cur);
    const loadMonth = async k => {
      if (k === ck) return cur;
      const m = await store.getJSON('data/m/' + k + '.json');
      return m && cur && cur.ex ? { ...m, ex: cur.ex } : m; // the hidden item groups are the same for every month
    };
    if (/^\d{4}-\d{2}$/.test(mk || '')) {
      if (ck !== mk) raw = await loadMonth(mk);
    } else if (ISO.test(q.get('from') || '') || ISO.test(q.get('to') || '')) {
      // free dates: pick any start and end day, even in different months
      const saved = (await store.list('data/m/')).map(p => (/^data\/m\/(\d{4}-\d{2})\.json$/.exec(p) || [])[1]).filter(Boolean);
      if (ck && !saved.includes(ck)) saved.push(ck);
      saved.sort();
      const fk = ISO.test(q.get('from') || '') ? q.get('from').slice(0, 7) : saved[0], tk = ISO.test(q.get('to') || '') ? q.get('to').slice(0, 7) : saved[saved.length - 1];
      if (saved.length && fk && tk && (fk !== ck || tk !== ck)) {
        const lo = fk < tk ? fk : tk, hi = fk < tk ? tk : fk;
        const want = monthsBetween(lo, hi).filter(k => saved.includes(k));
        const parts = [];
        for (const k of want) { const m = await loadMonth(k); if (m) parts.push(ex.filterStaff(m)); }
        if (parts.length === 1) raw = parts[0]; else if (parts.length > 1) raw = mergeMonths(parts);
      }
    }
    const d0 = ex.filterStaff(raw);
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
    const mkey = ex.monthKey(clean);
    if (mkey) await store.putJSON('data/m/' + mkey + '.json', clean); // keep every month so older months can be opened later
    return send(res, 200, { ok: true, rows: clean.rows.length });
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
});
