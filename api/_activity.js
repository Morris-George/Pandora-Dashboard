// Activity tracking: who signed in, which pages they opened, and every change they made. Super admin only (see canView).
//
// How it records (nothing here can be switched off by a user, and no password or sales figure is ever written):
//  - sign-ins, failed sign-ins and sign-outs: written by api/login.js and api/logout.js
//  - changes (uploads, approvals, passwords, daily sheets, stock counts ...): wrap() around every API function. It looks at
//    each POST, works out a plain-words label, and writes it after the request is done (the answer to the browser waits for it).
//  - pages opened and time spent: a tiny script that api/site.js adds to every page after sign-in sends "open" and "leave" to /api/activity
//  - sign-up requests and "forgot password" requests (nobody is signed in yet): kept in act/anon.json
//
// Storage (the private store, api/_store.js):
//   act/u/<person>.json   {profile, lastSeen, lastLogin, logins, fails, device, days:{YYYY-MM-DD:{l,v,a,s,f,dn,pg,ps,ac}}, events:[newest first, 300 kept]}
//   act/anon.json         {events:[...]} visitors who are not signed in (sign-ups, forgot password, wrong usernames)
//   act/settings.json     {overseer:true|false}  whether the Overseer (Ibrahim) may open the Activity page
// Reached at /api/activity, which is rewritten to /api/vm?activity=1 (the Hobby plan allows only 12 functions).
// Set ACTIVITY_OFF=1 in Vercel to stop recording.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');
const users = require('./_users');
const { staffAccounts, normName } = require('./_projects');

const KEEP_EVENTS = 300;   // events kept per person (the daily counters below are kept longer)
const KEEP_DAYS = 150;     // days of counters kept per person
const KEEP_ANON = 150;
const HOLD_MS = 2500;      // the most a request waits for its log line to be saved
const SETTINGS = 'act/settings.json';

const off = () => process.env.ACTIVITY_OFF === '1' || !store.configured();
const iso = ms => new Date(ms).toISOString();
const cairoDay = ms => new Date((ms === undefined ? Date.now() : ms) + 3 * 3600 * 1000).toISOString().slice(0, 10); // same clock as the rest of the site
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const S = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 80);
const prettyName = u => String(u || '').split(/[\s._-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

// ---- who and where ----
function device(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  if (!ua) return '';
  const kind = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'Phone' : 'Computer';
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [kind, os, br].filter(Boolean).join(' · ');
}
// a short tag for "the same visitor", never the address itself
function visitor(req) {
  const ip = String((req && req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '').split(',')[0].trim();
  return ip ? crypto.createHash('sha1').update(ip + '|' + (process.env.PANDORA_AUTH_SECRET || '')).digest('hex').slice(0, 6) : '';
}

function identFromAccount(a, info) {
  return { key: 'env-' + slug(normName(a.user)), username: a.user, name: a.role === 'admin' ? 'Super admin' : prettyName(a.user), role: a.role === 'admin' ? 'admin' : 'area', label: a.label, store: '', zone: (info && info.zone) || (a.role === 'cairo' ? 'Cairo zone' : a.role === 'octalex' ? 'October & Alexandria zone' : '') };
}
function identFromRec(r) {
  const role = r.role === 'vm' ? 'vm' : r.role === 'overseer' ? 'overseer' : r.role === 'stockcount' ? 'stockcount' : r.storeManager && r.linked ? 'store' : 'staff';
  const label = { vm: 'Visual Merchandiser', overseer: 'Overseer', stockcount: 'Stock Count', store: 'Store manager', staff: 'Sales person' }[role];
  return { key: 'u-' + slug(r.username), username: r.username, name: r.name || prettyName(r.username), role, label: r.title ? label + ' · ' + r.title : label, store: r.store || '', zone: '' };
}
function ident(who) {
  if (!who) return null;
  if (who.kind === 'env' && !who.user) return identFromAccount(who.account, who.info);
  if (who.user) return identFromRec(who.user);
  return null;
}
const SYSTEM = { key: 'system', username: 'system', name: 'Scheduled tasks', role: 'system', label: 'Automatic', store: '', zone: '' };

// ---- writing ----
function blank(id, now) { return { key: id.key, first: iso(now), logins: 0, fails: 0, days: {}, events: [] }; }
const recent = new Map(); // per running copy of the function: repeated scanning is not written more than once every 15 s

function apply(rec, ev, now) {
  const day = cairoDay(now);
  const d = rec.days[day] || (rec.days[day] = { l: 0, v: 0, a: 0, s: 0, f: 0, dn: 0, pg: {}, ps: {}, ac: {} });
  const label = S(ev.a, 80);
  const e = { t: iso(now), ty: ev.ty, a: label };
  if (ev.d) e.d = S(ev.d, 160);
  if (ev.p) e.p = S(ev.p, 60);
  if (ev.id) e.id = S(ev.id, 16);
  if (ev.st) e.st = ev.st;
  if (ev.s) e.s = ev.s;

  if (ev.ty === 'login') { rec.logins++; rec.lastLogin = e.t; d.l++; }
  else if (ev.ty === 'fail') { rec.fails++; d.f++; }
  else if (ev.ty === 'denied') d.dn++;
  else if (ev.ty === 'action' || ev.ty === 'error') { d.a++; d.ac[label] = (d.ac[label] || 0) + 1; }
  else if (ev.ty === 'view') { d.v++; if (ev.p) d.pg[ev.p] = (d.pg[ev.p] || 0) + 1; }

  if (ev.ty === 'leave') { // time spent: added to the page-open line it belongs to (or kept alone if that line has already aged out)
    const secs = Math.max(0, Math.min(1800, Number(ev.s) || 0));
    d.s += secs; if (ev.p) d.ps[ev.p] = (d.ps[ev.p] || 0) + secs;
    const hit = ev.id && rec.events.find(x => x.id === ev.id && x.ty === 'view');
    if (hit) { hit.s = (hit.s || 0) + secs; hit.t2 = e.t; return; }
    e.ty = 'view'; e.s = secs; d.v++; if (ev.p) d.pg[ev.p] = (d.pg[ev.p] || 0) + 1;
  }
  // the same thing again straight away (typing, scanning): one line with a count
  const top = rec.events[0];
  if (ev.co && top && top.ty === e.ty && top.a === e.a && (top.d || '') === (e.d || '') && now - Date.parse(top.t2 || top.t) < ev.co) {
    top.n = (top.n || 1) + 1; top.t2 = e.t; return;
  }
  rec.events.unshift(e);
  if (rec.events.length > KEEP_EVENTS) rec.events.length = KEEP_EVENTS;
  const old = Object.keys(rec.days).sort();
  while (old.length > KEEP_DAYS) delete rec.days[old.shift()];
}

async function recordFor(req, id, ev) {
  if (off() || !id) return;
  const now = Date.now();
  if (ev.co) { const k = id.key + '|' + ev.a + '|' + (ev.d || ''); if (now - (recent.get(k) || 0) < 15000) return; recent.set(k, now); if (recent.size > 500) recent.clear(); }
  const path = 'act/u/' + id.key + '.json';
  const rec = (await store.getJSON(path)) || blank(id, now);
  rec.username = id.username; rec.name = id.name; rec.role = id.role; rec.label = id.label; rec.store = id.store; rec.zone = id.zone;
  rec.lastSeen = iso(now);
  const dev = device(req); if (dev) rec.device = dev;
  apply(rec, ev, now);
  await store.putJSON(path, rec);
}
// who is a result of whoami(); errors in the log never break the page that is being used
const record = (req, who, ev) => recordFor(req, ident(who), ev).catch(() => {});

async function recordAnon(req, ev) {
  if (off()) return;
  try {
    const now = Date.now(), dv = device(req), vt = visitor(req);
    // wrong usernames can come in fast: one visitor writes at most once every 10 s, so a stranger cannot push real lines out of the log
    if (ev.throttle) { const k = 'anon|' + vt; if (now - (recent.get(k) || 0) < 10000) return; recent.set(k, now); }
    const rec = (await store.getJSON('act/anon.json')) || { events: [] };
    const e = { t: iso(now), ty: ev.ty, a: S(ev.a, 80) };
    if (ev.d) e.d = S(ev.d, 160);
    if (dv) e.dev = dv; if (vt) e.v = vt;
    const top = rec.events[0];
    if (top && top.ty === e.ty && top.a === e.a && (top.d || '') === (e.d || '') && (top.v || '') === (e.v || '') && now - Date.parse(top.t2 || top.t) < 600000) { top.n = (top.n || 1) + 1; top.t2 = e.t; }
    else { rec.events.unshift(e); if (rec.events.length > KEEP_ANON) rec.events.length = KEEP_ANON; }
    await store.putJSON('act/anon.json', rec);
  } catch (_) {}
}
// a typed username that is not an account: show only enough to spot a typo, never all of it (it may be a password typed in the wrong box)
const mask = s => { const t = String(s || '').trim(); return t.length <= 2 ? '**' : t.slice(0, 2) + '***' + ' (' + t.length + ' letters)'; };

// ---- what each change is called, in plain words ----
const ACCOUNT_ACTIONS = {
  createspecial: ['Created a special account', b => S(b.username) + ' (' + S(b.role) + ')'],
  refillaccess: ['Changed Refill Order access', b => S(b.key) + ' → ' + S(b.level)],
  distaccess: ['Changed Orders Distribution access', b => S(b.key) + ' → ' + S(b.level)],
  envdisable: ['Switched off an area manager', b => S(b.username)],
  envenable: ['Switched an area manager on', b => S(b.username)],
  envsetpassword: ['Changed an area manager password', b => S(b.username)],
  link: ['Linked an account to a sales person', b => S(b.username) + ' → ' + S(b.name) + (b.store ? ' (' + S(b.store) + ')' : '')],
  approve: ['Approved an account', b => S(b.username) + (b.name ? ' as ' + S(b.name) + (b.store ? ' (' + S(b.store) + ')' : '') : '') + (b.storeManager ? ' · store manager' : '')],
  setmanager: ['Changed store manager status', b => S(b.username) + ' → ' + (b.on ? 'store manager' : 'not a store manager')],
  setstore: ['Moved a sales person to another store', b => S(b.username) + ' → ' + S(b.store)],
  setpassword: ['Changed a staff password', b => S(b.username)],
  dismissreset: ['Dismissed a forgot-password request', b => S(b.username)],
  enable: ['Switched an account on', b => S(b.username)],
  disable: ['Switched an account off', b => S(b.username)],
  settitle: ['Changed a job title', b => S(b.username) + ' → ' + (S(b.title) || 'none')],
  remove: ['Removed an account', b => S(b.username)]
};
const flag = (u, n) => !!u.searchParams.get(n) || u.pathname === '/api/' + n;
const none = () => '';

// -> {a: label, d(responseBody, status): detail, co?: ms, system?: true} | null when the request is not worth a line
function describe(name, req) {
  const m = req.method, u = new URL(req.url, 'https://x.invalid'), q = u.searchParams, op = q.get('op') || '';
  const raw = req.body, b = raw && typeof raw === 'object' && !Buffer.isBuffer(raw) ? raw : {};
  if (flag(u, 'activity')) return null; // the log never logs itself

  if (name === 'accounts') {
    if (m !== 'POST') return null;
    const x = ACCOUNT_ACTIONS[b.action];
    return x ? { a: x[0], d: () => x[1](b) } : { a: 'Account action', d: () => S(b.action) };
  }
  if (name === 'data') {
    if (m !== 'POST') return null;
    return op === 'settings' ? { a: 'Changed the hidden item groups (Staff Performance)', d: none } : { a: 'Published Staff Performance data', d: r => (r && r.rows ? r.rows.toLocaleString('en-US') + ' rows' : '') };
  }
  if (name === 'uploads') {
    if (m !== 'POST') return null;
    if (op === 'delete') return { a: 'Removed a document', d: () => S(b.area) + ' · ' + S(b.id) };
    return { a: 'Added a sales file (Pandora Dashboards)', d: r => (r && r.rows ? r.rows.toLocaleString('en-US') + ' lines' : S(b.file)), co: 60000 };
  }
  if (name === 'erp') {
    if (flag(u, 'stock')) {
      if (m !== 'POST') return null;
      return { sync: { a: 'Synced Stock balance from ERP', d: none }, delete: { a: 'Removed the Stock balance Excel file', d: none }, upload: { a: 'Uploaded the Stock balance Excel file', d: none, co: 60000 } }[op] || null;
    }
    if (flag(u, 'refill')) {
      if (m !== 'POST') return null;
      return {
        groups: { a: 'Changed Refill Order item groups', d: none }, file: { a: 'Uploaded a Refill Order file', d: () => S(b.kind) + (b.name ? ' · ' + S(b.name) : ''), co: 300000 },
        sync: { a: 'Synced Refill Order from ERP', d: none }, new: { a: 'Started a new refill order', d: () => S(b.name) }, delete: { a: 'Deleted a refill order', d: none },
        settings: { a: 'Changed refill order settings', d: none, co: 300000 }, fb: { a: 'Typed refill team feedback', d: none, co: 600000 }, status: { a: 'Changed a refill order status', d: () => '→ ' + S(b.status) }
      }[op] || null;
    }
    if (flag(u, 'dist')) {
      if (m !== 'POST') return null;
      return {
        settings: { a: 'Changed Orders Distribution settings', d: none }, new: { a: 'Added a new shipment', d: () => S(b.name) + (b.invoice ? ' · ' + S(b.invoice) : '') }, delete: { a: 'Deleted a shipment', d: none },
        scan: { a: 'Scanned shipment pieces', d: none, co: 600000 }, allocate: { a: 'Refreshed a shipment split from ERP', d: none }, set: { a: 'Changed a shipment split by hand', d: none, co: 300000 }, status: { a: 'Changed a shipment status', d: () => '→ ' + S(b.status) }
      }[op] || null;
    }
    if (flag(u, 'slow')) {
      if (m !== 'POST') return null;
      return { clear: { a: 'Cleared the Slow Moving report', d: none }, syncall: { a: 'Ran Slow Moving for all stores from ERP', d: none }, sync: { a: 'Ran Slow Moving for one store from ERP', d: () => S(b.warehouse) } }[op] || null;
    }
    const cron = !!process.env.CRON_SECRET && req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET;
    if (cron) return { a: 'Daily ERP sync (automatic)', d: r => (r && r.ok ? 'sales ' + (r.sales || 0) + ' · staff ' + (r.staff || 0) : 'failed'), system: true };
    return m === 'POST' ? { a: 'Synced from ERP', d: r => S(q.get('month')) + (r && r.sales !== undefined ? ' · sales ' + r.sales + ' · staff ' + r.staff : '') } : null;
  }
  if (name === 'vm') {
    if (m !== 'POST') return null;
    if (flag(u, 'daily')) {
      if (op === 'shift') return { a: b.data ? 'Saved a daily store shift' : 'Cleared a daily store shift', d: () => S(b.store) + ' · ' + S(b.date) + ' · ' + (b.shift === 'm' ? 'morning' : 'night') + (b.data ? ' · visitors ' + S(b.data.v, 9) + ', transactions ' + S(b.data.t, 9) + ', pieces ' + S(b.data.q, 9) : '') };
      if (op === 'target') return { a: 'Set a monthly store target', d: () => S(b.store) + ' · ' + S(b.month) + ' · EGP ' + S(b.target, 14) };
      if (op === 'save') return { a: 'Uploaded a daily store Excel sheet', d: () => S(b.store) + ' · ' + S(b.month) + ' · ' + (Array.isArray(b.rows) ? b.rows.length : 0) + ' days' };
      if (op === 'delete') return { a: 'Removed a daily store month', d: () => S(b.store) + ' · ' + S(b.month) };
      if (op === 'clearimport') return { a: 'Removed daily days that came from Excel', d: none };
      return null;
    }
    if (flag(u, 'stockcount')) {
      if (b.op === 'set' || b.op === 'update') return { a: 'Stock Count: saved scans', d: none, co: 600000 };
      if (b.op === 'pair') return { a: 'Stock Count: paired a phone', d: none };
      return null; // reading and the 4-second sync are not changes
    }
    if (flag(u, 'zonestock')) {
      const x = { count: 'Zone stock: counted zones', in: 'Zone stock: received goods', move: 'Zone stock: moved pieces', undo: 'Zone stock: undid a movement' }[op];
      return x ? { a: x, d: () => S(b.store) } : null;
    }
    if (flag(u, 'vmzones')) {
      const x = { settings: 'Changed what the VM account can see', layout: 'Edited the zones of a store', place: 'Placed a collection in a zone', unplace: 'Removed a collection placement', file: 'Uploaded a floor plan or photo', delfile: 'Removed a floor plan or photo', plan: 'Changed the floor plan of a store' }[op];
      return x ? { a: x, d: () => S(b.store) + (op === 'place' ? ' · ' + S(b.col || (b.list && b.list.name)) + ' · from ' + S(b.start) : ''), co: op === 'file' ? 300000 : 0 } : null;
    }
    if (op === 'delete') return { a: 'Removed a VM report', d: () => S(b.id) };
    return { a: 'Added a VM report (Excel)', d: r => (r && r.reports ? r.reports + ' report(s)' : '') };
  }
  return null;
}

// Wrap an API function: after the request, write one line for it. The answer to the browser is held until the line is saved
// (serverless functions can stop the moment the answer leaves), but never longer than HOLD_MS.
function wrap(name, handler) {
  return function activityWrapped(req, res) {
    let info = null;
    try { if (!off()) info = describe(name, req); } catch (_) { info = null; }
    if (!info) return handler(req, res);
    let body = null, done = false;
    const origJson = res.json, origEnd = res.end;
    if (typeof origJson === 'function') res.json = function (o) { body = o; return origJson.apply(this, arguments); };
    res.end = function () {
      if (done) return origEnd.apply(this, arguments);
      done = true;
      const self = this, args = arguments, st = res.statusCode || 200;
      const finish = () => origEnd.apply(self, args);
      withTimeout(logRequest(req, info, st, body), HOLD_MS).then(finish, finish);
      return this;
    };
    return handler(req, res);
  };
}
async function logRequest(req, info, st, body) {
  try {
    const detail = (() => { try { return info.d(body, st) || ''; } catch (_) { return ''; } })();
    if (info.system) return recordFor(req, SYSTEM, { ty: st >= 400 ? 'error' : 'action', a: info.a, d: detail || (body && body.error) || '', st: st >= 400 ? st : 0 });
    const who = await whoami(req);
    if (!who) return; // nobody signed in: not recorded (it would let strangers fill the log)
    if (st === 401 || st === 403) return record(req, who, { ty: 'denied', a: info.a, d: detail, st });
    if (st >= 500) return record(req, who, { ty: 'error', a: info.a, d: (body && body.error) || detail, st });
    if (st >= 400) return; // a form that was not filled in correctly
    return record(req, who, { ty: 'action', a: info.a, d: detail, co: info.co || 0 });
  } catch (_) {}
}

// ---- who may open the Activity page ----
async function settings() { return (await store.getJSON(SETTINGS).catch(() => null)) || { overseer: false }; }
const isSuper = who => !!who && who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer;
// the super admin always; the Overseer (Ibrahim) only after the super admin switches it on
async function canView(who) {
  if (isSuper(who)) return true;
  if (who && who.kind === 'env' && who.info.overseer && store.configured()) return !!(await settings()).overseer;
  return false;
}

// ---- reading ----
const PAGES = {
  '/': 'Home', '/dashboards': 'Pandora Dashboards', '/staff': 'Staff Performance', '/staff/person': 'A sales person page', '/staff/me': 'My sales', '/staff/accounts': 'Staff approvals',
  '/uploads': 'All Uploads', '/film': 'Launch Film', '/daily': 'Daily Store Report', '/vm': 'VM Report', '/vm/zones': 'VM Zones', '/vm/stock': 'Zone Stock', '/stock': 'Stock balance',
  '/stockcount': 'Stock Count', '/refill': 'Refill Order', '/slow': 'Slow Moving', '/distribution': 'Orders Distribution', '/activity': 'Activity'
};
const pageLabel = p => PAGES[String(p || '').replace(/\/+$/, '') || '/'] || S(p, 40);

async function inChunks(list, n, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(...await Promise.all(list.slice(i, i + n).map(fn)));
  return out;
}
function dayList(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(cairoDay(Date.now() - i * 86400000)); return out; }

async function overview(rangeDays) {
  const days = dayList(rangeDays), first = days[0];
  const files = await store.list('act/u/');
  const recs = (await inChunks(files, 12, p => store.getJSON(p))).filter(Boolean);
  const byKey = new Map(recs.map(r => [r.key, r]));

  // everyone who has an account, so people who never signed in show up too
  const accts = [];
  for (const a of staffAccounts()) accts.push({ key: identFromAccount(a).key, name: a.role === 'admin' ? 'Super admin' : prettyName(a.user), username: a.user, role: a.role === 'admin' ? 'admin' : 'area', label: a.label, store: '', status: a.role !== 'admin' && await users.envOff(a.user) ? 'off' : 'active', createdAt: '' });
  for (const r of await users.listUsers()) { const i = identFromRec(r); accts.push({ key: i.key, name: i.name, username: r.username, role: i.role, label: i.label, store: r.store || '', status: r.status === 'active' ? 'active' : r.status === 'pending' ? 'pending' : 'off', createdAt: r.createdAt || '' }); }
  const seen = new Set(), people = [];
  const add = (a, r) => {
    seen.add(a.key);
    const p = { key: a.key, name: (r && r.name) || a.name, username: a.username || (r && r.username) || '', role: a.role, label: a.label, store: a.store || (r && r.store) || '', zone: (r && r.zone) || '', status: a.status, createdAt: a.createdAt || '', firstSeen: r ? r.first : '', lastSeen: r ? r.lastSeen || '' : '', lastLogin: r ? r.lastLogin || '' : '', device: r ? r.device || '' : '', fails: r ? r.fails || 0 : 0, logins: 0, views: 0, actions: 0, secs: 0, denied: 0, failed: 0, activeDays: 0, days: {} };
    if (r) for (const day of days) {
      const d = r.days && r.days[day]; if (!d) continue;
      p.logins += d.l; p.views += d.v; p.actions += d.a; p.secs += d.s; p.denied += d.dn || 0; p.failed += d.f || 0;
      if (d.l || d.v || d.a) p.activeDays++;
      p.days[day] = d; // the page adds these up itself, so every filter (dates, store, page) works without asking again
    }
    people.push(p);
  };
  accts.forEach(a => add(a, byKey.get(a.key)));
  recs.filter(r => !seen.has(r.key) && r.key !== 'system').forEach(r => add({ key: r.key, name: r.name, username: r.username, role: r.role, label: r.label, store: r.store, status: 'removed' }, r));

  // totals per day, pages and actions
  const series = days.map(day => ({ day, logins: 0, users: 0, views: 0, actions: 0, secs: 0 }));
  const pageAgg = new Map(), actAgg = new Map();
  for (const r of recs) {
    if (r.key === 'system') continue;
    series.forEach(s => {
      const d = r.days && r.days[s.day]; if (!d) return;
      s.logins += d.l; s.views += d.v; s.actions += d.a; s.secs += d.s; if (d.l || d.v || d.a) s.users++;
      for (const k of Object.keys(d.pg || {})) { const o = pageAgg.get(k) || { p: k, label: pageLabel(k), views: 0, secs: 0, users: new Set() }; o.views += d.pg[k]; o.users.add(r.key); pageAgg.set(k, o); }
      for (const k of Object.keys(d.ps || {})) { const o = pageAgg.get(k) || { p: k, label: pageLabel(k), views: 0, secs: 0, users: new Set() }; o.secs += d.ps[k]; pageAgg.set(k, o); }
      for (const k of Object.keys(d.ac || {})) actAgg.set(k, (actAgg.get(k) || 0) + d.ac[k]);
    });
  }

  // the feed: every event in the range, newest first, with the person
  const feed = [];
  for (const r of recs) for (const e of r.events || []) {
    if (cairoDay(Date.parse(e.t)) < first) continue;
    feed.push({ ...e, w: r.key, who: r.name, role: r.role, label: r.label, store: r.store || '', pl: e.p ? pageLabel(e.p) : '' });
  }
  const anon = ((await store.getJSON('act/anon.json').catch(() => null)) || { events: [] }).events.filter(e => cairoDay(Date.parse(e.t)) >= first);
  anon.forEach(e => feed.push({ ...e, w: 'anon', who: 'Not signed in', role: 'visitor', label: 'Visitor', store: '' }));
  feed.sort((a, b) => String(b.t2 || b.t).localeCompare(String(a.t2 || a.t)));

  const real = people.filter(p => p.status !== 'pending');
  return {
    ok: true, now: iso(Date.now()), range: rangeDays, from: first, to: days[days.length - 1],
    today: days[days.length - 1], people, series, feed: feed.slice(0, 1500), feedTotal: feed.length,
    pages: [...pageAgg.values()].map(o => ({ p: o.p, label: o.label, views: o.views, secs: o.secs, users: o.users.size })).sort((a, b) => b.views - a.views).slice(0, 30),
    acts: [...actAgg.entries()].map(([a, n]) => ({ a, n })).sort((x, y) => y.n - x.n).slice(0, 30),
    totals: {
      accounts: real.length, pending: people.filter(p => p.status === 'pending').length, neverSignedIn: real.filter(p => !p.lastLogin && p.status === 'active').length,
      activeUsers: real.filter(p => p.activeDays > 0).length, logins: series.reduce((n, s) => n + s.logins, 0), views: series.reduce((n, s) => n + s.views, 0),
      actions: series.reduce((n, s) => n + s.actions, 0), secs: series.reduce((n, s) => n + s.secs, 0), failed: people.reduce((n, p) => n + p.failed, 0) + anon.filter(e => e.ty === 'fail').length
    }
  };
}

// Who filled the daily store sheet: for every store and day of the last N days, was the morning and the night shift typed in, and by whom
async function dailyView(n) {
  const { CANON } = require('./_daily');
  const days = dayList(n), months = [...new Set(days.map(d => d.slice(0, 7)))];
  const out = [];
  for (const c of CANON) {
    const recs = (await Promise.all(months.map(m => store.getJSON('daily/' + slug(c.name) + '/' + m + '.json').catch(() => null)))).filter(Boolean);
    const cells = days.map(d => {
      const rec = recs.find(r => r.month === d.slice(0, 7)) || {};
      const sh = (rec.shifts || {})[d] || {};
      const hasRow = !!(rec.rows || {})[d];
      return { d, m: sh.m ? { by: sh.m.by, at: sh.m.at } : null, n: sh.n ? { by: sh.n.by, at: sh.n.at } : null, excel: hasRow && !sh.m && !sh.n };
    });
    let last = null; recs.forEach(r => (r.log || []).forEach(l => { if (!last || String(l.at) > String(last.at)) last = { by: l.by, at: l.at }; }));
    out.push({ name: c.name, zone: c.zone, cells, last });
  }
  return { ok: true, today: cairoDay(), days, stores: out };
}

async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let buf = Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? Buffer.from(req.body) : null;
  if (!buf) { const ch = []; for await (const c of req) ch.push(c); buf = Buffer.concat(ch); }
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { return {}; }
}
function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return obj === undefined ? res.status(code).end() : res.status(code).json(obj);
}

// /api/activity
async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, req.method === 'POST' ? 204 : 401, req.method === 'POST' ? undefined : { ok: false, error: 'sign-in-required' });
  const u = new URL(req.url, 'https://x.invalid'), q = u.searchParams;

  if (req.method === 'POST') {
    const b = await body(req);
    if (b && (b.t === 'open' || b.t === 'leave')) { // the page beacon: any signed-in person
      const p = String(b.p || '');
      if (!/^\/[a-z0-9\/._-]{0,60}$/i.test(p) || p.replace(/\/+$/, '') === '/activity' || !/^[a-z0-9]{6,16}$/i.test(String(b.id || ''))) return send(res, 204);
      const x = S(b.x, 80), label = pageLabel(p);
      if (b.t === 'open') await record(req, who, { ty: 'view', a: label, p, d: x, id: b.id });
      else await record(req, who, { ty: 'leave', a: label, p, d: x, id: b.id, s: Number(b.secs) || 0 });
      return send(res, 204);
    }
    if (q.get('op') === 'share') { // the super admin lets the Overseer (Ibrahim) open this page, or takes it back
      if (!isSuper(who)) return send(res, 403, { ok: false, error: 'Only the super admin can change this.' });
      const on = !!(b && b.on);
      await store.putJSON(SETTINGS, { overseer: on, at: iso(Date.now()) });
      await record(req, who, { ty: 'action', a: on ? 'Let the Overseer open Activity' : 'Stopped the Overseer opening Activity', d: '' });
      return send(res, 200, { ok: true, overseer: on });
    }
    return send(res, 400, { ok: false, error: 'Unknown action.' });
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!(await canView(who))) return send(res, 403, { ok: false, error: 'Only the super admin can open Activity.' });
  try {
    if (q.get('view') === 'daily') return send(res, 200, await dailyView(Math.max(3, Math.min(31, parseInt(q.get('days'), 10) || 14))));
    const range = Math.max(1, Math.min(KEEP_DAYS, parseInt(q.get('range'), 10) || 7));
    const o = await overview(range);
    o.shared = !!(await settings()).overseer; o.canShare = isSuper(who);
    return send(res, 200, o);
  } catch (e) { return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
}

module.exports = { wrap, record, recordFor, recordAnon, ident, identFromAccount, identFromRec, canView, handler, mask, device, S };
