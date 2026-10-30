// Report access (super admin only): for every person, which pages and reports they are allowed to open.
// It uses the same rules as the home screen (APPS in api/_apps.js), so what is shown here is exactly what that person sees.
// Reached at /api/access, which is rewritten to /api/vm?access=1 (the Hobby plan allows only 12 functions).
const store = require('./_store');
const users = require('./_users');
const { whoami, whoFromRec } = require('./_auth');
const { staffAccounts, roleInfo } = require('./_projects');
const { APPS, factsFromWho, OVERRIDES } = require('./_apps');

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}

const LEVEL_TEXT = { view: 'view only', input: 'can add and change', manage: 'full control', warehouse: 'warehouse scanning' };

// the little note shown next to a report: how much of it this person gets
function noteFor(app, f, who) {
  if (app.id === 'refill') return LEVEL_TEXT[f.refill] || '';
  if (app.id === 'slow') return LEVEL_TEXT[f.refill] || '';
  if (app.id === 'dist') return LEVEL_TEXT[f.dist] || '';
  if (app.id === 'recv') return ({ accounts: 'scans for Accounts', warehouse: 'scans for the Warehouse', view: 'report only', manage: 'full control' })[f.recv] || '';
  const role = f.staff && f.staff.role;
  if (['dashboards', 'staff', 'stock'].includes(app.id) && who && who.info && who.info.zone && role !== 'store' && role !== 'staff') return who.info.zone + ' only';
  if (app.id === 'stock' && f.vm) return 'pieces only';
  if (app.id === 'vm' && f.vm) return 'view only';
  if (app.id === 'schedule' && f.hr) return 'all stores, view only';
  if (app.id === 'daily' || app.id === 'schedule') {
    if (role === 'staff') return app.id === 'schedule' ? 'own store, view only' : 'own store';
    if (role === 'store') return 'own store';
    if (role && role !== 'admin') return who.info.zone ? who.info.zone + ' only' : '';
  }
  if (app.id === 'zonestock' && role === 'store') return 'own store';
  return '';
}

function scopeOf(who) {
  if (!who) return '';
  const i = who.info || {};
  if (i.overseer) return 'Sees everything the super admin sees, except accounts and passwords';
  if (i.role === 'admin') return 'Sees everything';
  if (i.role === 'vm') return 'Visual Merchandiser: pieces only, never sales amounts';
  if (i.role === 'stockcount') return 'Stock Count account only';
  if (i.role === 'hr') return 'HR: Weekly Schedule only, view only';
  if (i.role === 'store') return 'Store manager of ' + i.zone;
  if (i.role === 'staff') return 'Sees only their own sales' + (i.self && i.self.store ? ' at ' + i.self.store : '');
  if (i.zone) return 'Area manager: ' + i.zone + ' only';
  return '';
}

const ADDABLE = { refill: 'refill', slow: 'refill', dist: 'dist', recv: 'recv' }; // reports that carry their own access level, so they can be given to anyone
const isSuperWho = who => !!who && who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer;

async function overrides() { return (await store.getJSON(OVERRIDES)) || {}; }
// Departments the super admin makes (Finance, Warehouse ...) with the people in each: { list: [names], of: { <key>: name } }
const DEPTS = 'access/depts.json';
async function depts() { const d = (await store.getJSON(DEPTS)) || {}; return { list: Array.isArray(d.list) ? d.list : [], of: d.of || {} }; }
async function deptOp(b, res) {
  const d = await depts(), name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (b.op === 'newdept') { if (!name) return send(res, 400, { ok: false, error: 'Type a department name.' }); if (!d.list.some(x => x.toLowerCase() === name.toLowerCase())) d.list.push(name); }
  else if (b.op === 'deldept') { d.list = d.list.filter(x => x !== name); for (const k of Object.keys(d.of)) if (d.of[k] === name) delete d.of[k]; }
  else if (b.op === 'setdept') { const k = String(b.key || ''); if (!k) return send(res, 400, { ok: false, error: 'Pick a person.' }); if (name && d.list.includes(name)) d.of[k] = name; else delete d.of[k]; }
  else return send(res, 400, { ok: false, error: 'Unknown action.' });
  await store.putJSON(DEPTS, d);
  return send(res, 200, { ok: true });
}

async function describe(who, key, ovr) {
  const f = await factsFromWho(who, isSuperWho(who)); // what their role gives them, before any switch-off
  const removed = (ovr[key] && ovr[key].remove) || [];
  const locked = isSuperWho(who);
  const list = [];
  for (const a of APPS) {
    if (a.id === 'mysales2') continue; // the twin of "My sales"
    let allowed = !!a.allow(f);
    if (a.id === 'mysales') allowed = allowed || !!APPS.find(x => x.id === 'mysales2').allow(f);
    const off = removed.includes(a.id);
    const canAdd = !allowed && !!ADDABLE[a.id];
    list.push({
      id: a.id, title: a.title, desc: a.desc, href: a.href,
      on: allowed && !off,
      note: allowed && !off ? noteFor(a, f, who) : '',
      locked: locked || (!allowed && !canAdd),
      why: locked ? 'The super admin always keeps everything.' : (!allowed && !canAdd) ? 'Not part of this person\'s role.' : ''
    });
  }
  return { scope: scopeOf(who), apps: list };
}

async function build() {
  const out = [], ovr = await overrides();
  // accounts kept in Vercel settings: the super admin and the two area managers
  for (const a of staffAccounts()) {
    const who = { kind: 'env', account: a, info: roleInfo(a) };
    const off = a.role !== 'admin' && await users.envOff(a.user);
    const d = await describe(who, 'env:' + a.user.toLowerCase(), ovr);
    out.push({
      key: 'env:' + a.user.toLowerCase(), username: a.user, name: a.role === 'admin' ? 'Super admin' : a.user,
      group: a.role === 'admin' ? 'Super admin' : 'Area managers', label: a.label,
      status: off ? 'disabled' : 'active', ...d
    });
  }
  // every saved account (sales people, store managers, VM, Stock Count, Overseer ...)
  for (const rec of await users.listUsers()) {
    const who = whoFromRec(rec);
    const d = await describe(who, 'u:' + rec.username, ovr);
    let group = 'Sales people';
    if (rec.role === 'overseer') group = 'Brand manager and Overseer';
    else if (rec.role === 'vm') group = 'Visual Merchandiser';
    else if (rec.role === 'hr') group = 'HR';
    else if (rec.role === 'stockcount') group = rec.title === 'Finance' ? 'Finance' : 'Stock Count accounts';
    else if (rec.storeManager) group = 'Store managers';
    out.push({
      key: 'u:' + rec.username, username: rec.username, name: rec.name || rec.username, group,
      label: (who.info && who.info.label) + (rec.title ? ' · ' + rec.title : ''), store: rec.store || '',
      status: rec.status || 'pending', ...d
    });
  }
  return out;
}


// switch one report on or off for one person; returns an error text, or '' when done
async function setOne(key, app, on) {
  let who = null;
  const m = /^env:(.+)$/.exec(key), u = /^u:(.+)$/.exec(key);
  if (m) { const a = staffAccounts().find(x => x.user.toLowerCase() === m[1]); if (a) who = { kind: 'env', account: a, info: roleInfo(a) }; }
  else if (u) { const rec = await users.getUser(u[1]); if (rec) who = whoFromRec(rec); }
  if (!who) return 'Person not found.';
  if (isSuperWho(who)) return 'The super admin always keeps everything.';
  const f = await factsFromWho(who, false);
  let allowed = !!app.allow(f);
  if (app.id === 'mysales') allowed = allowed || !!APPS.find(x => x.id === 'mysales2').allow(f);
  const ovr = await overrides(), cur = ovr[key] || { remove: [] }, rm = new Set(cur.remove || []);
  const level = async (kind, val) => {
    const { ACCESS } = require(kind === 'dist' ? './_dist' : kind === 'recv' ? './_recv' : './_refill');
    const acc = (await store.getJSON(ACCESS)) || {};
    if (val === 'none') delete acc[key]; else acc[key] = val;
    await store.putJSON(ACCESS, acc);
  };
  if (on) {
    rm.delete(app.id);
    if (!allowed) {
      if (ADDABLE[app.id] === 'refill') await level('refill', 'view');
      else if (ADDABLE[app.id] === 'dist') await level('dist', 'warehouse');
      else if (ADDABLE[app.id] === 'recv') await level('recv', 'view');
      else return "This report is not part of this person's role, so it cannot be added here.";
    }
  } else {
    if (app.id === 'refill') await level('refill', 'none');       // Slow Moving follows Refill Order access
    else if (app.id === 'dist') await level('dist', 'none');
    else if (app.id === 'recv') await level('recv', 'none');
    else rm.add(app.id);
  }
  if (rm.size) ovr[key] = { remove: [...rm] }; else delete ovr[key];
  await store.putJSON(OVERRIDES, ovr);
  return '';
}

async function change(req, res) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  b = b || {};
  const app = APPS.find(a => a.id === b.app), on = b.on === true;
  if (b.op === 'deptapp') {
    // one report on or off for everyone in a department, one after the other (the files are shared)
    if (!app || app.id === 'mysales2') return send(res, 400, { ok: false, error: 'Unknown report.' });
    const d = await depts(), keys = Object.keys(d.of).filter(k => d.of[k] === b.name);
    if (!keys.length) return send(res, 400, { ok: false, error: 'Nobody is in this department yet.' });
    const skipped = [];
    for (const k of keys) { const e = await setOne(k, app, on); if (e) skipped.push(k.replace(/^(u|env):/, '')); }
    return send(res, 200, { ok: true, done: keys.length - skipped.length, skipped });
  }
  if (b.op) return deptOp(b, res);
  if (!app || app.id === 'mysales2') return send(res, 400, { ok: false, error: 'Unknown report.' });
  const e = await setOne(String(b.key || ''), app, on);
  return e ? send(res, e === 'Person not found.' ? 404 : 400, { ok: false, error: e }) : send(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer)) return send(res, 403, { ok: false, error: 'Only the super admin can see report access.' });
  if (req.method === 'POST') return change(req, res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  try { const d = await depts(), people = await build(); for (const p of people) p.dept = d.of[p.key] || ''; return send(res, 200, { ok: true, people, depts: d.list }); }
  catch (e) { return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
};
