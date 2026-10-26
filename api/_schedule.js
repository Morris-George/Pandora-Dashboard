// Weekly Schedule: a manager plans who works each day in the Morning, Between and Night shifts, with a From and To time for every person.
//   GET  /api/schedule                           what this person may open: stores + their usual shift times and known names
//   GET  /api/schedule?store=<name>&week=YYYY-MM-DD   the saved schedule of that store for that week (the week starts on WEEK_START below)
//   POST /api/schedule?op=day      {store, week, date, shifts:{m:[{n,f,t}], b:[...], n:[...]}}   replace ONE day (empty lists clear it)
//   POST /api/schedule?op=times    {store, times:{m:['10:00','18:00'], b:[..], n:[..]}}          the usual From/To that new people start with
//   POST /api/schedule?op=copy     {store, week, from, replace?:bool}                            copy another week into this one (shifted by whole weeks)
//   POST /api/schedule?op=clear    {store, week}                                                  empty the whole week
// Who: super admin = every store; area managers = the stores of their zone; store managers = their own store (all three can edit).
// Sales people can only LOOK at their own store's schedule (GET); every change answers 403.
// o = people on vacation that day: [{n, r}] with r = annual | weekly | holiday (sent inside shifts of op=day, same as m/b/n).
// m = Morning, b = Between, n = Night. Times are 24-hour "HH:MM"; a To that is earlier than the From means the shift ends after midnight.
// Stored at sched/<store>/<week start>.json and sched/<store>/settings.json, reached through api/vm.js (Hobby plan: 12 functions max).
const store = require('./_store');
const { whoami } = require('./_auth');
const { CANON, canon } = require('./_daily');
const users = require('./_users');

const WEEK_START = 6; // 0 = Sunday ... 6 = Saturday (the Egyptian working week starts on Saturday). Change this one number to start the week on another day.
const SHIFTS = ['m', 'b', 'n'];
const DEFAULT_TIMES = { m: ['10:00', '18:00'], b: ['13:00', '21:00'], n: ['16:00', '00:00'] };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PER_SHIFT = 3, MAX_NAMES = 80;
// People who are NOT on a shift that day because they are away. Saved on the day as o:[{n, r}] where r is one of LEAVE_REASONS.
const LEAVE_REASONS = ['annual', 'weekly', 'holiday']; // annual vacation, weekly vacation (day off), official holiday
const MAX_LEAVE = 12;

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

// -> {role:'admin'|'area'|'store', by, own?, allow?:[regex]} | {code}
async function access(req) {
  const who = await whoami(req);
  if (!who) return { code: 401 };
  if (who.kind === 'env') {
    const by = who.account.label || 'Manager';
    return who.info.role === 'admin' ? { role: 'admin', by } : { role: 'area', by, allow: (who.info.allow || []).map(a => new RegExp(a, 'i')) };
  }
  if (who.kind === 'staff' && who.info.role === 'store' && who.info.self && who.info.self.store) {
    if (/online|e-?commerce|website/i.test(who.info.self.store)) return { code: 403 }; // the Online store has no shop floor shifts
    return { role: 'store', by: who.user.name || 'Store manager', own: canon(who.info.self.store) };
  }
  if (who.kind === 'staff' && who.info.role === 'staff' && who.info.self && who.info.self.store) {
    if (/online|e-?commerce|website/i.test(who.info.self.store)) return { code: 403 };
    return { role: 'staff', by: who.user.name || 'Staff', own: canon(who.info.self.store), readonly: true }; // sales people may look at their own store's schedule, never change it
  }
  return { code: 403 }; // VM and Stock Count accounts do not use the schedule
}
const mayStore = (a, name) => {
  const n = canon(name);
  if (!n) return false;
  if (a.role === 'admin') return true;
  if (a.role === 'area') return a.allow.some(rx => rx.test(n));
  return n === a.own;
};

const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const validDate = d => DAY.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const validWeek = w => validDate(w) && dow(w) === WEEK_START;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekDates = w => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(w, i));
const cleanName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

// one shift's people -> clean list, or an error text
function cleanShift(list) {
  if (!Array.isArray(list)) return { err: 'The shift list could not be read.' };
  if (list.length > MAX_PER_SHIFT) return { err: 'Up to ' + MAX_PER_SHIFT + ' people per shift.' };
  const out = [];
  for (const e of list) {
    const n = cleanName(e && e.n);
    if (!n) return { err: 'Every person needs a name.' };
    if (!TIME.test(String(e.f || '')) || !TIME.test(String(e.t || ''))) return { err: 'Choose a From and a To time for ' + n + '.' };
    if (e.f === e.t) return { err: 'From and To are the same time for ' + n + '.' };
    out.push({ n, f: e.f, t: e.t });
  }
  return { list: out };
}
// the "on vacation" list of one day -> clean list, or an error text
function cleanLeave(list) {
  if (!Array.isArray(list)) return { err: 'The vacation list could not be read.' };
  if (list.length > MAX_LEAVE) return { err: 'Up to ' + MAX_LEAVE + ' people can be marked on vacation in one day.' };
  const out = [], seen = new Set();
  for (const e of list) {
    const n = cleanName(e && e.n);
    if (!n) return { err: 'Every person needs a name.' };
    if (!LEAVE_REASONS.includes(e.r)) return { err: 'Choose the reason ' + n + ' is on vacation.' };
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push({ n, r: e.r });
  }
  return { list: out };
}
const cleanTimes = t => {
  const out = {};
  for (const s of SHIFTS) {
    const p = t && t[s];
    if (!Array.isArray(p) || !TIME.test(String(p[0] || '')) || !TIME.test(String(p[1] || '')) || p[0] === p[1]) return null;
    out[s] = [p[0], p[1]];
  }
  return out;
};

const weekKey = (name, week) => 'sched/' + slug(name) + '/' + week + '.json';
const settingsKey = name => 'sched/' + slug(name) + '/settings.json';
const emptyWeek = (name, week) => ({ store: name, week, days: {} });
const hasPeople = rec => !!rec && Object.keys(rec.days || {}).some(d => SHIFTS.concat('o').some(s => (rec.days[d][s] || []).length));

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const a = await access(req);
  if (a.code === 401) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (a.code) return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');
  const stores = CANON.filter(c => mayStore(a, c.name)).map(c => c.name);
  if (a.role === 'store' && !stores.includes(a.own)) stores.push(a.own);

  if (req.method === 'GET') {
    const name = url.searchParams.get('store') ? canon(url.searchParams.get('store')) : '';
    if (!name) return send(res, 200, { ok: true, role: a.role, canEdit: !a.readonly, stores, weekStart: WEEK_START });
    if (!mayStore(a, name)) return send(res, 403, { ok: false, error: 'You can only open your own stores.' });
    const settings = (await store.getJSON(settingsKey(name))) || {};
    // the approved people of this store (sales people and store managers who have an account), for the name picker
    let people = [];
    if (!a.readonly) try {
      people = (await users.listUsers()).filter(r => r && r.status === 'active' && !r.role && r.store && canon(r.store) === name && cleanName(r.name))
        .map(r => cleanName(r.name)).filter((n, i, arr) => arr.findIndex(x => x.toLowerCase() === n.toLowerCase()) === i).sort((x, y) => x.localeCompare(y));
    } catch (_) { people = []; }
    const out = { ok: true, role: a.role, store: name, times: settings.times || DEFAULT_TIMES, names: a.readonly ? [] : (settings.names || []), people, canEdit: !a.readonly, weekStart: WEEK_START };
    const week = url.searchParams.get('week');
    if (week) {
      if (!validWeek(week)) return send(res, 400, { ok: false, error: 'The week could not be read.' });
      out.week = week;
      out.record = (await store.getJSON(weekKey(name, week))) || emptyWeek(name, week);
    }
    return send(res, 200, out);
  }

  if (req.method === 'POST') {
    if (a.readonly) return send(res, 403, { ok: false, error: 'You can look at the schedule, but only managers can change it.' });
    const op = url.searchParams.get('op');
    const b = await readBody(req);
    if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'Could not read the data.' });
    const name = canon(b.store);
    if (!name || !mayStore(a, name)) return send(res, 403, { ok: false, error: 'You can only plan the schedule of your own stores.' });
    if (op !== 'day' && op !== 'times' && op !== 'copy' && op !== 'clear') return send(res, 400, { ok: false, error: 'Unknown action.' });
    const at = new Date().toISOString();

    if (op === 'times') {
      const times = cleanTimes(b.times);
      if (!times) return send(res, 400, { ok: false, error: 'Each usual shift needs a From and a To time.' });
      const s = (await store.getJSON(settingsKey(name))) || {};
      s.times = times;
      await store.putJSON(settingsKey(name), s);
      return send(res, 200, { ok: true, times });
    }

    const week = String(b.week || '');
    if (!validWeek(week)) return send(res, 400, { ok: false, error: 'The week could not be read.' });
    const key = weekKey(name, week);

    if (op === 'day') {
      const date = String(b.date || '');
      if (!weekDates(week).includes(date)) return send(res, 400, { ok: false, error: 'That day is not in this week.' });
      const shifts = b.shifts || {}, day = {};
      for (const s of SHIFTS) {
        const c = cleanShift(shifts[s] || []);
        if (c.err) return send(res, 400, { ok: false, error: c.err });
        if (c.list.length) day[s] = c.list;
      }
      const lv = cleanLeave(shifts.o || []);
      if (lv.err) return send(res, 400, { ok: false, error: lv.err });
      if (lv.list.length) day.o = lv.list;
      const rec = (await store.getJSON(key)) || emptyWeek(name, week);
      rec.days = rec.days || {};
      if (Object.keys(day).length) rec.days[date] = day; else delete rec.days[date];
      rec.updated = { at, by: a.by };
      rec.log = [{ at, by: a.by, date, action: 'changed' }, ...(rec.log || [])].slice(0, 40);
      await store.putJSON(key, rec);
      // remember the names so the next week can pick them from a list
      const added = [].concat(...SHIFTS.concat('o').map(s => day[s] || [])).map(e => e.n);
      if (added.length) {
        const st = (await store.getJSON(settingsKey(name))) || {};
        const seen = new Set(), names = [];
        for (const n of added.concat(st.names || [])) { const k = n.toLowerCase(); if (!seen.has(k)) { seen.add(k); names.push(n); } }
        st.names = names.slice(0, MAX_NAMES);
        await store.putJSON(settingsKey(name), st);
      }
      return send(res, 200, { ok: true, record: rec });
    }

    if (op === 'clear') {
      await store.del(key);
      return send(res, 200, { ok: true, record: emptyWeek(name, week) });
    }

    if (op === 'copy') {
      const from = String(b.from || '');
      if (!validWeek(from) || from === week) return send(res, 400, { ok: false, error: 'Choose another week to copy from.' });
      const src = await store.getJSON(weekKey(name, from));
      if (!hasPeople(src)) return send(res, 404, { ok: false, error: 'That week has nobody planned.' });
      const cur = await store.getJSON(key);
      if (hasPeople(cur) && !b.replace) return send(res, 409, { ok: false, error: 'This week already has people planned.', needsReplace: true });
      const shift = Math.round((Date.parse(week) - Date.parse(from)) / 86400000);
      const rec = emptyWeek(name, week);
      for (const d of Object.keys(src.days || {})) rec.days[addDays(d, shift)] = src.days[d];
      rec.updated = { at, by: a.by };
      rec.log = [{ at, by: a.by, action: 'copied from ' + from }, ...((cur && cur.log) || [])].slice(0, 40);
      await store.putJSON(key, rec);
      return send(res, 200, { ok: true, record: rec });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
module.exports.WEEK_START = WEEK_START;
