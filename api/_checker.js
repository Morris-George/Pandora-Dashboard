// Stock Checker: scans saved on the server by store, by day and by person (reached at /api/checker, rewritten to api/vm.js: the Hobby plan allows 12 functions).
//   GET  /api/checker                                what this person may open: { role, by, own, stores, manager }
//   GET  /api/checker?store=NAME&day=YYYY-MM-DD      one store, one day (default today). Managers get everyone; sales people and QR phones get only their own scans.
//                                                    Managers also get `days`: the last 30 days of that store with totals.
//   GET  /api/checker?overview=1&day=YYYY-MM-DD      managers: every store they may see, that day: people, scans, SKUs, last scan
//   POST /api/checker?op=scan    {store, code, t?, by?}      add one scan (always on its own day: today, or the day the phone scanned it offline)
//   POST /api/checker?op=verdict {store, day, t, v:'ok'|'swapped'|''}   mark one of YOUR scans
//   POST /api/checker?op=undo    {store}                     remove YOUR last scan of today
//   POST /api/checker?op=reset   {store, day, person}        erase YOUR scans of that day (person omitted); another person ('name') or '*' (the whole store that day) = managers only
// Who: super admin = every store; area managers = the stores of their zone; store managers = their own store; all three are "managers" and see every person.
//      Sales people = their own store, their own scans only. A phone opened from a store's QR code (no login) = that one store, its own scans only.
//      Nobody ever sees another store's scans.
// Stored per day and person at chk/<store slug>/<YYYY-MM-DD>/<person slug>.json = { store, name, day, ev:[{t, c, v}] } so two phones never overwrite each other.
const store = require('./_store');
const { whoami } = require('./_auth');
const pair = require('./_pair');
const { CANON, canon } = require('./_daily');

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EV = 5000;
const COOLDOWN_MS = 900; // the page keeps 2 seconds; the server only stops obvious double posts
const cairoDay = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); // YYYY-MM-DD in Cairo time

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
const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const cleanCode = v => { const c = String(v || '').trim(); return /^[A-Za-z0-9._\-\/ ]{1,40}$/.test(c) ? c : ''; };
const firstName = u => { const f = String(u || '').trim().split(/[\s._-]+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ''; };

// -> { role:'admin'|'area'|'store'|'staff'|'phone', by, own?, allow? } | { code }
async function access(req) {
  const who = await whoami(req);
  if (who) {
    if (who.kind === 'env') {
      if (who.info.overseer) return { code: 403 }; // the brand manager does not use Stock Checker
      if (who.info.role === 'admin') return { role: 'admin', by: 'Super admin' };
      return { role: 'area', by: firstName(who.account.user) || who.account.label || 'Area manager', allow: (who.info.allow || []).map(a => new RegExp(a, 'i')) };
    }
    if (who.kind === 'staff' && who.info.self && who.info.self.store) {
      if (/online|e-?commerce|website/i.test(who.info.self.store)) return { code: 403 };
      return { role: who.info.role === 'store' ? 'store' : 'staff', by: cleanName(who.user.name) || 'Staff', own: canon(who.info.self.store) };
    }
    return { code: 403 };
  }
  const ps = pair.storeOf(req, 'checker'); // a phone that opened a store's QR code
  if (ps) return { role: 'phone', by: '', own: canon(ps) };
  return { code: 401 };
}
const mayStore = (a, name) => {
  const n = canon(name);
  if (!n) return false;
  if (a.role === 'admin') return true;
  if (a.role === 'area') return a.allow.some(rx => rx.test(n));
  return n === a.own;
};
const storesFor = a => a.role === 'admin' ? CANON.map(c => c.name) : a.role === 'area' ? CANON.map(c => c.name).filter(n => a.allow.some(rx => rx.test(n))) : [a.own];
const manager = a => a.role === 'admin' || a.role === 'area' || a.role === 'store';

const dirOf = (st, day) => 'chk/' + slug(st) + '/' + day + '/';
const pathOf = (st, day, person) => dirOf(st, day) + (slug(person) || 'x') + '.json';

async function readDay(st, day) {
  const paths = (await store.list(dirOf(st, day))).filter(p => /\.json$/.test(p)).slice(0, 80);
  const files = await Promise.all(paths.map(p => store.getJSON(p).catch(() => null)));
  return files.filter(f => f && Array.isArray(f.ev) && f.ev.length);
}

function summarize(files) {
  const skus = new Set(); let scans = 0, last = 0;
  for (const f of files) for (const e of f.ev) { scans++; skus.add(e.c); if (e.t > last) last = e.t; }
  return { people: files.length, scans, skus: skus.size, last };
}

function build(st, day, files, me, mgr) {
  const shown = mgr ? files : files.filter(f => String(f.name).toLowerCase() === String(me).toLowerCase()); // sales people and phones only ever get their own scans
  const people = [], items = new Map(), recent = [];
  let total = 0;
  for (const f of shown) {
    const skus = new Set();
    let last = 0;
    for (const e of f.ev) {
      total++; skus.add(e.c); if (e.t > last) last = e.t;
      let o = items.get(e.c); if (!o) items.set(e.c, o = { c: e.c, n: 0, sw: 0, last: 0, by: {} });
      o.n++; if (e.v === 'swapped') o.sw++; if (e.t > o.last) o.last = e.t;
      o.by[f.name] = (o.by[f.name] || 0) + 1;
      recent.push({ name: f.name, c: e.c, t: e.t, v: e.v || '' });
    }
    people.push({ name: f.name, scans: f.ev.length, skus: skus.size, last });
  }
  people.sort((a, b) => b.last - a.last);
  recent.sort((a, b) => b.t - a.t);
  return { store: st, day, total, skus: items.size, people, items: [...items.values()].sort((a, b) => b.last - a.last).slice(0, 400), recent: recent.slice(0, 40), me: me || '' };
}

const lastDays = (day, n) => { const out = [], base = Date.parse(day + 'T12:00:00Z'); for (let i = 0; i < n; i++) out.push(new Date(base - i * 86400000).toISOString().slice(0, 10)); return out; };

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const a = await access(req);
  if (a.code) return send(res, a.code, { ok: false, error: a.code === 401 ? 'Please sign in again.' : 'You do not have access to Stock Checker.' });
  const url = new URL(req.url, 'https://x.invalid'), q = url.searchParams;
  const today = cairoDay(Date.now());
  const dayQ = DAY.test(q.get('day') || '') ? q.get('day') : today;

  if (req.method === 'GET') {
    if (q.get('overview')) {
      if (!manager(a)) return send(res, 403, { ok: false, error: 'Only managers can see the overview.' });
      const rows = await Promise.all(storesFor(a).map(async st => ({ name: st, ...summarize(await readDay(st, dayQ)) })));
      return send(res, 200, { ok: true, day: dayQ, today, stores: rows });
    }
    const st = q.get('store');
    if (!st) return send(res, 200, { ok: true, role: a.role, by: a.by, own: a.own || '', stores: storesFor(a), manager: manager(a), today });
    if (!mayStore(a, st)) return send(res, 403, { ok: false, error: 'That is not your store.' });
    const me = a.role === 'phone' ? cleanName(q.get('by')) : a.by;
    const out = build(canon(st), dayQ, await readDay(canon(st), dayQ), me, manager(a));
    if (manager(a) && q.get('days')) { // the last 30 days of this store, for the monitor (asked for now and then, not on every refresh)
      out.days = await Promise.all(lastDays(today, 30).map(async d => ({ day: d, ...summarize(await readDay(canon(st), d)) })));
    }
    return send(res, 200, { ok: true, today, ...out });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }

  const b = await readBody(req);
  if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'Bad request.' });
  const op = q.get('op');
  const st = canon(b.store);
  if (!mayStore(a, st)) return send(res, 403, { ok: false, error: 'That is not your store.' });
  // the person: the signed-in name for logged in people, the typed name for a phone opened from a QR code
  const by = a.role === 'phone' ? cleanName(b.by) : a.by;
  if (!by) return send(res, 400, { ok: false, error: 'Type your name first.' });
  const day = DAY.test(b.day || '') ? b.day : today;

  if (op === 'scan') {
    const c = cleanCode(b.code);
    if (!c) return send(res, 400, { ok: false, error: 'That code could not be read.' });
    const now = Date.now();
    // a phone that was offline sends the time it scanned; it is only trusted when it is recent
    let t = Number(b.t) || now; if (!(t <= now && t > now - 36 * 3600 * 1000)) t = now;
    const d = cairoDay(t);
    const file = pathOf(st, d, by);
    const cur = (await store.getJSON(file).catch(() => null)) || { store: st, name: by, day: d, ev: [] };
    const last = cur.ev[cur.ev.length - 1];
    if (last && now - last.t < COOLDOWN_MS && t >= now - COOLDOWN_MS) return send(res, 429, { ok: false, error: 'cooldown' });
    if (last && t <= last.t) t = last.t + 1;
    cur.store = st; cur.name = by; cur.day = d;
    cur.ev.push({ t, c, v: '' });
    if (cur.ev.length > MAX_EV) cur.ev.splice(0, cur.ev.length - MAX_EV);
    await store.putJSON(file, cur);
    return send(res, 200, { ok: true, t, day: d, mine: cur.ev.filter(e => e.c === c).length });
  }
  if (op === 'verdict') {
    const file = pathOf(st, day, by);
    const cur = await store.getJSON(file).catch(() => null);
    const e = cur && cur.ev.find(x => x.t === Number(b.t));
    if (!e) return send(res, 404, { ok: false, error: 'That scan was not found.' });
    e.v = b.v === 'ok' || b.v === 'swapped' ? b.v : '';
    await store.putJSON(file, cur);
    return send(res, 200, { ok: true });
  }
  if (op === 'undo') {
    const file = pathOf(st, today, by);
    const cur = await store.getJSON(file).catch(() => null);
    const e = cur && cur.ev.pop();
    if (e) { if (cur.ev.length) await store.putJSON(file, cur); else await store.del(file); }
    return send(res, 200, { ok: true, removed: e ? e.c : '' });
  }
  if (op === 'reset') {
    const person = cleanName(b.person) || by;
    if (b.person === '*' || person.toLowerCase() !== by.toLowerCase()) {
      if (!manager(a)) return send(res, 403, { ok: false, error: 'You can only erase your own scans.' });
      if (b.person === '*') {
        const paths = (await store.list(dirOf(st, day))).filter(p => /\.json$/.test(p));
        for (const p of paths) await store.del(p);
        return send(res, 200, { ok: true, cleared: paths.length });
      }
    }
    await store.del(pathOf(st, day, person));
    return send(res, 200, { ok: true, cleared: 1 });
  }
  return send(res, 400, { ok: false, error: 'Unknown action.' });
};
module.exports.access = access;
