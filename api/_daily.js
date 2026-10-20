// Daily Store Report: each store's daily sheet (visitors, transactions, pieces, cash, visa, morning, night + the month's target).
// Sales people, store managers, area managers and the super admin add the sheet; the page turns it into dashboards.
//   GET  /api/daily                      what this person may open: stores, months per store, role
//   GET  /api/daily?month=YYYY-MM        the saved sheets of every store this person may see, for that month
//   POST /api/daily?op=shift  {store, month, date, shift:'m'|'n', data:{v,t,q,c,x} | null}   one shift typed in on the site (null clears it)
//   POST /api/daily?op=target {store, month, target, weights:{"1":0.03,...}}                  month target + each day's share (super admin, area managers)
//   POST /api/daily?op=save   {store, month, target, weights:{"1":0.03,...}, file, rows:[{d,v,t,q,c,x,m,n}]}   a whole Excel sheet (older way)
//   POST /api/daily?op=delete {store, month}                 (not sales people)
// A day is typed in twice: the morning shift and the night shift. Each shift holds visitors, transactions, pieces, cash and visa of THAT shift.
// rows[date] = [visitors, transactions, pieces, cash, visa, morning sales, night sales] is always worked out from the shifts, so the page reads one shape.
// shifts[date] = {m:{v,t,q,c,x,by,at}, n:{...}}; a day with only one shift is "in progress". Days that came from an Excel sheet have rows but no shifts.
// Who: super admin = every store; area managers = the stores of their zone; store managers and sales people = their own store.
// Saving a sheet again is safe: days that have numbers replace the saved day, empty days never wipe anything.
// Stored at daily/<store>/<YYYY-MM>.json, reached through api/vm.js (Hobby plan: 12 functions max).
const store = require('./_store');
const { whoami } = require('./_auth');

// the stores of the business, with the loose name match the rest of the site uses
const CANON = [
  { name: 'CC Almaza', rx: /almaza/i, zone: 'cairo' },
  { name: 'City Stars', rx: /city\s*stars/i, zone: 'cairo' },
  { name: 'CFC', rx: /\bcfc\b|festival/i, zone: 'cairo' },
  { name: 'Point 90', rx: /point\s*90/i, zone: 'cairo' },
  { name: 'Mall of Egypt', rx: /mall\s*of\s*egypt/i, zone: 'octalex' },
  { name: 'Mall of Arabia', rx: /arabia/i, zone: 'octalex' },
  { name: 'Alexandria', rx: /alex/i, zone: 'octalex' }
];
const canon = s => { const t = String(s || '').trim(); const c = CANON.find(c => c.rx.test(t)); return c ? c.name : t.replace(/\s+/g, ' ').slice(0, 60); };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const cairoToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let buf;
  if (Buffer.isBuffer(req.body)) buf = req.body;
  else if (typeof req.body === 'string') buf = Buffer.from(req.body);
  else { const ch = []; for await (const c of req) ch.push(c); buf = Buffer.concat(ch); }
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { return null; }
}

// -> {role:'admin'|'area'|'store'|'staff', by, own?, allow?:[regex]} | {code}
async function access(req) {
  const who = await whoami(req);
  if (!who) return { code: 401 };
  if (who.kind === 'env') {
    const by = who.account.label || 'Manager';
    return who.info.role === 'admin' ? { role: 'admin', by } : { role: 'area', by, allow: (who.info.allow || []).map(a => new RegExp(a, 'i')) };
  }
  if (who.kind === 'staff' && who.info.self && who.info.self.store) {
    return { role: who.info.role === 'store' ? 'store' : 'staff', by: who.user.name || 'Staff', own: canon(who.info.self.store) };
  }
  return { code: 403 }; // VM and Stock Count accounts do not use this page
}
const mayStore = (a, name) => {
  const n = canon(name);
  if (!n) return false;
  if (a.role === 'admin') return true;
  if (a.role === 'area') return a.allow.some(rx => rx.test(n));
  return n === a.own;
};

// slug -> {name, months:[]} from the file names
async function overview() {
  const paths = await store.list('daily/');
  const by = new Map();
  for (const p of paths) {
    const m = /^daily\/([a-z0-9-]+)\/(\d{4}-\d{2})\.json$/.exec(p);
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], []);
    by.get(m[1]).push(m[2]);
  }
  const out = [];
  for (const [sl, months] of by) {
    months.sort();
    let name = (CANON.find(c => slug(c.name) === sl) || {}).name;
    if (!name) { const r = await store.getJSON('daily/' + sl + '/' + months[months.length - 1] + '.json'); name = r && r.store; }
    if (name) out.push({ name, months });
  }
  return out;
}


// A new month starts empty, but not blank: it carries last month's target and each weekday's share of it,
// so the first entry of the month already gets insights. The area manager / super admin can change it (op=target).
const prevMonth = mo => { const [y, m] = mo.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); };
function weekdayShares(rec) {
  if (!rec || !rec.weights) return null;
  const [y, m] = rec.month.split('-').map(Number), sum = Array(7).fill(0), cnt = Array(7).fill(0);
  for (const k of Object.keys(rec.weights)) { const wd = new Date(Date.UTC(y, m - 1, +k)).getUTCDay(); sum[wd] += rec.weights[k]; cnt[wd]++; }
  return sum.map((v, i) => cnt[i] ? v / cnt[i] : null);
}
function carryOver(prev, month) {
  const rec = { store: prev.store, month, target: prev.target || 0, weights: null, rows: {}, shifts: {}, carried: !!prev.target };
  const sh = weekdayShares(prev);
  if (sh) {
    const [y, m] = month.split('-').map(Number), dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), raw = {};
    let tot = 0;
    const fill = sh.filter(v => v != null); const avg = fill.reduce((a, b) => a + b, 0) / (fill.length || 1);
    for (let d = 1; d <= dim; d++) { const w = sh[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; raw[d] = w != null ? w : avg; tot += raw[d]; }
    rec.weights = {}; for (let d = 1; d <= dim; d++) rec.weights[d] = Math.round(raw[d] / tot * 1e5) / 1e5;
  }
  return rec;
}
const startRecord = async (name, month) => {
  const prev = await store.getJSON('daily/' + slug(name) + '/' + prevMonth(month) + '.json');
  return prev && (prev.target || prev.weights) ? carryOver(prev, month) : { store: name, month, target: 0, weights: null, rows: {}, shifts: {} };
};

const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= (max || 1e9) ? Math.round(n * 1000) / 1000 : null; };

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const a = await access(req);
  if (a.code === 401) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (a.code) return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');

  if (req.method === 'GET') {
    const ov = (await overview()).filter(s => mayStore(a, s.name));
    const names = new Map();
    if (a.role === 'admin') CANON.forEach(c => names.set(c.name, []));
    else if (a.role === 'area') CANON.filter(c => mayStore(a, c.name)).forEach(c => names.set(c.name, []));
    else names.set(a.own, []);
    ov.forEach(s => names.set(s.name, s.months));
    const stores = [...names.entries()].map(([name, months]) => ({ name, months }));

    const month = url.searchParams.get('month');
    if (!month) return send(res, 200, { ok: true, role: a.role, stores, canDelete: a.role !== 'staff' });
    if (!MONTH.test(month)) return send(res, 400, { ok: false, error: 'Bad month.' });
    const records = [];
    await Promise.all(stores.filter(s => s.months.includes(month)).map(async s => {
      const r = await store.getJSON('daily/' + slug(s.name) + '/' + month + '.json');
      if (r) records.push(r);
    }));
    return send(res, 200, { ok: true, role: a.role, month, records });
  }

  if (req.method === 'POST') {
    const op = url.searchParams.get('op');
    const b = await readBody(req);
    if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'Could not read the data.' });
    const name = canon(b.store), month = String(b.month || '');
    if (!MONTH.test(month)) return send(res, 400, { ok: false, error: 'The month could not be read.' });
    if (!name || !mayStore(a, name) || (a.role === 'admin' && !CANON.some(c => c.name === name) && !(await overview()).some(s => s.name === name))) {
      return send(res, 403, { ok: false, error: 'You can only add sheets for your own store.' });
    }
    const key = 'daily/' + slug(name) + '/' + month + '.json';

    if (op === 'delete') {
      if (a.role === 'staff') return send(res, 403, { ok: false, error: 'Only managers can remove a month.' });
      await store.del(key);
      return send(res, 200, { ok: true });
    }
    if (op !== 'save' && op !== 'shift' && op !== 'target') return send(res, 400, { ok: false, error: 'Unknown action.' });

    if (op === 'shift') {
      const date = String(b.date || ''), sh = b.shift;
      if (!DAY.test(date) || date.slice(0, 7) !== month) return send(res, 400, { ok: false, error: 'The date is not in ' + month + '.' });
      if (date > new Date(Date.parse(cairoToday()) + 86400000).toISOString().slice(0, 10)) return send(res, 400, { ok: false, error: 'This date is in the future.' });
      if (sh !== 'm' && sh !== 'n') return send(res, 400, { ok: false, error: 'Choose morning or night.' });
      const rec = (await store.getJSON(key)) || (await startRecord(name, month));
      rec.rows = rec.rows || {}; rec.shifts = rec.shifts || {};
      const at = new Date().toISOString();
      let data = null;
      if (b.data) {
        const v = ['v', 't', 'q', 'c', 'x'].map(k => num(b.data[k]));
        if (v.some(x => x === null)) return send(res, 400, { ok: false, error: 'A number is not valid. Use numbers only, no negatives.' });
        if (v.every(x => x === 0)) return send(res, 400, { ok: false, error: 'All numbers are zero. Fill the shift, or use Clear.' });
        data = { v: v[0], t: v[1], q: v[2], c: v[3], x: v[4], by: a.by, at };
      }
      const day = rec.shifts[date] || {};
      if (data) day[sh] = data; else delete day[sh];
      if (day.m || day.n) rec.shifts[date] = day; else delete rec.shifts[date];
      const part = a2 => a2 ? [a2.v, a2.t, a2.q, a2.c, a2.x] : [0, 0, 0, 0, 0];
      if (day.m || day.n) {
        const m = part(day.m), n = part(day.n);
        rec.rows[date] = [m[0] + n[0], m[1] + n[1], m[2] + n[2], m[3] + n[3], m[4] + n[4], m[3] + m[4], n[3] + n[4]];
      } else delete rec.rows[date];
      rec.updated = { at, by: a.by };
      rec.log = [{ at, by: a.by, date, shift: sh, action: data ? 'saved' : 'cleared' }, ...(rec.log || [])].slice(0, 40);
      await store.putJSON(key, rec);
      return send(res, 200, { ok: true, store: name, month, date, shift: sh });
    }

    if (op === 'target') {
      if (a.role !== 'admin' && a.role !== 'area') return send(res, 403, { ok: false, error: 'Only area managers and the super admin can set the target.' });
      const target = num(b.target);
      if (target === null) return send(res, 400, { ok: false, error: 'The target is not a valid number.' });
      const rec = (await store.getJSON(key)) || (await startRecord(name, month));
      rec.target = target; delete rec.carried;
      if (b.weights && typeof b.weights === 'object') {
        const w = {};
        for (const k of Object.keys(b.weights)) { const n = num(b.weights[k], 1); if (/^\d{1,2}$/.test(k) && +k >= 1 && +k <= 31 && n !== null) w[k] = n; }
        if (Object.keys(w).length) rec.weights = w;
      }
      const at = new Date().toISOString();
      rec.updated = { at, by: a.by };
      rec.log = [{ at, by: a.by, action: 'target', target }, ...(rec.log || [])].slice(0, 40);
      await store.putJSON(key, rec);
      return send(res, 200, { ok: true });
    }

    const rowsIn = Array.isArray(b.rows) ? b.rows : null;
    if (!rowsIn || !rowsIn.length || rowsIn.length > 31) return send(res, 400, { ok: false, error: 'The sheet has no days to save.' });
    const old = (await store.getJSON(key)) || { store: name, month, target: 0, weights: null, rows: {} };
    const rows = old.rows || {};
    let saved = 0;
    for (const r of rowsIn) {
      if (!r || !DAY.test(String(r.d || '')) || String(r.d).slice(0, 7) !== month) return send(res, 400, { ok: false, error: 'A day in the sheet is not in ' + month + '.' });
      const v = [r.v, r.t, r.q, r.c, r.x, r.m, r.n].map(x => num(x));
      if (v.some(x => x === null)) return send(res, 400, { ok: false, error: 'A number in the sheet is not valid (' + r.d + ').' });
      const filled = v[1] > 0 || v[3] + v[4] > 0 || v[0] > 0;
      if (!filled) continue; // an empty day never wipes a saved day
      rows[r.d] = v; // [visitors, transactions, pieces, cash, visa, morning, night]
      if (old.shifts) delete old.shifts[r.d];
      saved++;
    }
    if (!saved) return send(res, 400, { ok: false, error: 'No day with numbers was found in the sheet.' });
    const target = num(b.target);
    let weights = old.weights;
    if (b.weights && typeof b.weights === 'object') {
      const w = {};
      for (const k of Object.keys(b.weights)) { const n = num(b.weights[k], 1); if (/^\d{1,2}$/.test(k) && +k >= 1 && +k <= 31 && n !== null) w[k] = n; }
      if (Object.keys(w).length) weights = w;
    }
    const at = new Date().toISOString();
    const log = [{ at, by: a.by, file: String(b.file || '').slice(0, 80), days: saved }, ...(old.log || [])].slice(0, 15);
    const rec = { store: name, month, target: target || old.target || 0, weights, rows, shifts: old.shifts || {}, updated: { at, by: a.by }, log };
    await store.putJSON(key, rec);
    return send(res, 200, { ok: true, saved, store: name, month });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
module.exports.CANON = CANON;
module.exports.canon = canon;
