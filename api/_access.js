// Report access (super admin only): for every person, which pages and reports they are allowed to open.
// It uses the same rules as the home screen (APPS in api/_apps.js), so what is shown here is exactly what that person sees.
// Reached at /api/access, which is rewritten to /api/vm?access=1 (the Hobby plan allows only 12 functions).
const store = require('./_store');
const users = require('./_users');
const { whoami, whoFromRec } = require('./_auth');
const { staffAccounts, roleInfo } = require('./_projects');
const { appsFor, factsFromWho } = require('./_apps');

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
  const role = f.staff && f.staff.role;
  if (['dashboards', 'staff', 'stock'].includes(app.id) && who && who.info && who.info.zone && role !== 'store' && role !== 'staff') return who.info.zone + ' only';
  if (app.id === 'stock' && f.vm) return 'pieces only';
  if (app.id === 'vm' && f.vm) return 'view only';
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
  if (i.role === 'store') return 'Store manager of ' + i.zone;
  if (i.role === 'staff') return 'Sees only their own sales' + (i.self && i.self.store ? ' at ' + i.self.store : '');
  if (i.zone) return 'Area manager: ' + i.zone + ' only';
  return '';
}

async function describe(who, dashOk) {
  const f = await factsFromWho(who, dashOk);
  const open = appsFor(f);
  const { APPS } = require('./_apps');
  const byId = new Map(APPS.map(a => [a.id, a]));
  return {
    scope: scopeOf(who),
    apps: open.map(a => ({ id: a.id, title: a.title, desc: a.desc, href: a.href, note: noteFor(byId.get(a.id), f, who) }))
  };
}

async function build() {
  const out = [];
  // accounts kept in Vercel settings: the super admin and the two area managers
  for (const a of staffAccounts()) {
    const who = { kind: 'env', account: a, info: roleInfo(a) };
    const off = a.role !== 'admin' && await users.envOff(a.user);
    const d = await describe(who, a.role === 'admin');
    out.push({
      key: 'env:' + a.user.toLowerCase(), username: a.user, name: a.role === 'admin' ? 'Super admin' : a.user,
      group: a.role === 'admin' ? 'Super admin' : 'Area managers', label: a.label,
      status: off ? 'disabled' : 'active', ...d
    });
  }
  // every saved account (sales people, store managers, VM, Stock Count, Overseer ...)
  for (const rec of await users.listUsers()) {
    const who = whoFromRec(rec);
    const d = await describe(who, false);
    let group = 'Sales people';
    if (rec.role === 'overseer') group = 'Brand manager and Overseer';
    else if (rec.role === 'vm') group = 'Visual Merchandiser';
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

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer)) return send(res, 403, { ok: false, error: 'Only the super admin can see report access.' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  try { return send(res, 200, { ok: true, people: await build() }); }
  catch (e) { return send(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
};
