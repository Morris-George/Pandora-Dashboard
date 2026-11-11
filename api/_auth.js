// Who is calling? Three kinds of people can use Staff Performance:
//  - super admin and area managers: usernames/passwords in Vercel settings (cookie staff_auth)
//  - sales people who signed up themselves and were approved (cookie staffer_auth, its own signing key)
const crypto = require('crypto');
const { PROJECTS, readCookie, staffSession, roleInfo, normName } = require('./_projects');
const users = require('./_users');
const store = require('./_store');

const STAFFER_COOKIE = 'staffer_auth';
const VIEW_COOKIE = 'viewas_auth'; // "View as": only ever honoured together with the super admin's own valid sign-in
const VIEW_AGE = 2 * 60 * 60;
const MAX_AGE = 8 * 60 * 60;
const key = secret => secret + '|staffer';
const hmac = (payload, secret) => crypto.createHmac('sha256', key(secret)).update(payload).digest();

function stafferCookie(username, secret) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = Buffer.from(`${username}\n${exp}`).toString('base64url');
  const token = `${payload}.${hmac(payload, secret).toString('base64url')}`;
  return `${STAFFER_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
function stafferUsername(token, secret) {
  try {
    if (!token || !secret) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = hmac(payload, secret), actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const [u, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    return Number(exp) > Math.floor(Date.now() / 1000) ? u : null;
  } catch (_) { return null; }
}

// The kind of person a saved account is (also used by the Report access page, api/_access.js, to see what each account can open).
// The caller decides whether the account is active; this only reads its role.
function whoFromRec(rec) {
  if (rec.role === 'vm') {
    return { kind: 'vm', user: rec, info: { role: 'vm', label: 'Visual Merchandiser', zone: null, allow: null, zones: null } };
  }
  if (rec.role === 'overseer') {
    // an Overseer (for example Ibrahim Nassif): sees and does everything the super admin does, except managing accounts and passwords
    const account = { role: 'admin', label: 'Overseer', user: rec.username, overseer: true };
    return { kind: 'env', account, user: rec, info: { ...roleInfo(account), overseer: true } };
  }
  if (rec.role === 'superadmin') {
    // a second super admin (for example Maurice Fakhry): the same rights as the super admin kept in Vercel settings
    const account = { role: 'admin', label: 'Super admin', user: rec.username, superRec: true };
    return { kind: 'env', account, user: rec, info: { ...roleInfo(account), superRec: true } };
  }
  if (rec.role === 'hr') {
    // an HR account (for example Sandra): can look at the Weekly Schedule of every store, view only, and nothing else
    return { kind: 'hr', user: rec, info: { role: 'hr', label: 'HR', zone: null, allow: null, zones: null } };
  }
  if (rec.role === 'stockcount') {
    // a Stock Count only account: opens the Stock Count page and its data, nothing else
    return { kind: 'sc', user: rec, info: { role: 'stockcount', label: 'Stock Count', zone: null, allow: null, zones: null } };
  }
  if (rec.storeManager && rec.linked && rec.store) {
    // a store manager: still a sales person (own page at /staff/me), and also sees the team of their own store, nothing else
    const rx = '^' + String(rec.store).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
    return { kind: 'staff', user: rec, info: { role: 'store', label: 'Store manager', zone: rec.store, allow: [rx], zones: null, self: { store: rec.store, name: rec.name }, storeManager: true } };
  }
  return { kind: 'staff', user: rec, info: { role: 'staff', label: 'Sales person', zone: null, allow: null, zones: null, self: { store: rec.store, name: rec.name } } };
}

// -> {kind:'env', account, info} | {kind:'staff', user, info} | {kind:'vm'|'sc'|'hr', user, info} | null
// The answer is kept for the length of one request, so the activity log can ask "who is this?" without reading storage again.
const memo = new WeakMap();
function whoami(req) {
  if (req && typeof req === 'object') {
    if (!memo.has(req)) memo.set(req, whoamiNow(req));
    return memo.get(req);
  }
  return whoamiNow(req);
}
// Which report a request belongs to: the page itself, or (for its data calls) the page it came from
const REPORT_PATHS = { '/dashboards': 'dashboards', '/index.html': 'dashboards', '/staff': 'staff', '/staff.html': 'staff', '/staff/index.html': 'staff', '/staff/person': 'staff',
  '/uploads': 'uploads', '/uploads.html': 'uploads', '/activity': 'activity', '/activity.html': 'activity', '/daily': 'daily', '/daily.html': 'daily', '/schedule': 'schedule', '/schedule.html': 'schedule',
  '/vm/zones': 'vmzones', '/vmzones.html': 'vmzones', '/vm/stock': 'zonestock', '/zonestock.html': 'zonestock', '/stock': 'stock', '/stock.html': 'stock', '/stockcount': 'stockcount', '/stockcount.html': 'stockcount',
  '/stockchecker': 'stockchecker', '/stockchecker.html': 'stockchecker', '/vm': 'vm', '/vm.html': 'vm' };
function reportOf(req) {
  const one = u => { try { return REPORT_PATHS[new URL(u, 'https://x.invalid').pathname.replace(/\/+$/, '') || '/'] || ''; } catch (_) { return ''; } };
  const path = String(req.url || '');
  // the page itself, or a data call (/api/...) made from that page
  return one(path) || (path.startsWith('/api/') ? one((req.headers && req.headers.referer) || '') : '');
}
// Reports the super admin gave this person beyond their role (User Access Privileges): on those pages, and their data calls,
// the person is treated as an Overseer (every store, never accounts or passwords). Everywhere else they keep their own role.
async function lift(req, who, key, user) {
  if (!who || !store.configured()) return who;
  const id = reportOf(req); if (!id) return who;
  const o = ((await store.getJSONCached('access/overrides.json')) || {})[key];
  if (!o || !Array.isArray(o.add) || !o.add.includes(id)) return who;
  const account = { role: 'admin', label: 'Overseer', user, overseer: true };
  return { kind: 'env', account, user: who.user, lifted: id, info: { ...roleInfo(account), overseer: true } };
}

// A sign-in lasts 8 hours, so when it began = its expiry minus 8 hours. "Log out from all devices" kills every sign-in that began at or before the moment it was pressed.
const cookieStart = token => { try { return Number(Buffer.from(String(token).split('.')[0], 'base64url').toString('utf8').split('\n')[1]) - MAX_AGE; } catch (_) { return 0; } };
const signedOut = async (key, token) => { try { const at = await users.signedOutAt(key); return !!at && at >= cookieStart(token); } catch (_) { return false; } };

const viewKey = secret => secret + '|viewas';
function viewCookie(adminUser, targetKey, secret) {
  const exp = Math.floor(Date.now() / 1000) + VIEW_AGE;
  const payload = Buffer.from(`${targetKey}\n${exp}\n${normName(adminUser)}`).toString('base64url');
  const sig = crypto.createHmac('sha256', viewKey(secret)).update(payload).digest('base64url');
  return `${VIEW_COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VIEW_AGE}`;
}
// The person the super admin is looking at the site as, or undefined when not viewing (no cookie, a bad or expired one, or the person is no longer active).
async function viewWho(req, admin, secret) {
  try {
    const tok = readCookie(req, VIEW_COOKIE); if (!tok || !secret) return undefined;
    const [payload, sig] = tok.split('.');
    if (!payload || !sig) return undefined;
    const expected = crypto.createHmac('sha256', viewKey(secret)).update(payload).digest(), actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return undefined;
    const [key, exp, adm] = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    if (!(Number(exp) > Math.floor(Date.now() / 1000)) || adm !== normName(admin.user)) return undefined;
    let who = null, name = '';
    if (key.startsWith('env:')) {
      const acc = require('./_projects').staffAccounts().find(a => a.role !== 'admin' && normName(a.user) === key.slice(4));
      if (acc && !(await users.envOff(acc.user))) { who = await lift(req, { kind: 'env', account: acc, info: roleInfo(acc) }, 'env:' + String(acc.user).toLowerCase(), acc.user); name = acc.user; }
    } else if (key.startsWith('u:')) {
      const rec = await users.getUser(key.slice(2));
      if (rec && rec.status === 'active') { who = rec.role === 'overseer' || rec.role === 'superadmin' ? whoFromRec(rec) : await lift(req, whoFromRec(rec), 'u:' + rec.username, rec.username); name = rec.name || rec.username; }
    }
    return who ? Object.assign({}, who, { viewAs: { name, admin: admin.user } }) : undefined;
  } catch (_) { return undefined; }
}

async function whoamiNow(req) {
  const secret = process.env.PANDORA_AUTH_SECRET;
  const account = staffSession(readCookie(req, PROJECTS.staff.cookie), secret);
  if (account) {
    if (store.configured() && await signedOut('env:' + normName(account.user), readCookie(req, PROJECTS.staff.cookie))) return null;
    if (account.role === 'admin' && store.configured()) {
      // the super admin is looking at the site as someone else: they see that person's site, and nothing can be changed while doing so
      const v = await viewWho(req, account, secret);
      if (v) return ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase()) ? v : null;
    }
    // a switched-off area manager is signed out at once (the super admin can never be switched off)
    if (account.role !== 'admin' && store.configured() && await users.envOff(account.user)) return null;
    const who = { kind: 'env', account, info: roleInfo(account) };
    return account.role === 'admin' ? who : lift(req, who, 'env:' + String(account.user).toLowerCase(), account.user);
  }
  const u = stafferUsername(readCookie(req, STAFFER_COOKIE), secret);
  if (u && store.configured()) {
    const rec = await users.getUser(u);
    if (rec && rec.status === 'active' && await signedOut('u:' + rec.username, readCookie(req, STAFFER_COOKIE))) return null;
    if (rec && rec.status === 'active') return rec.role === 'overseer' || rec.role === 'superadmin' ? whoFromRec(rec) : lift(req, whoFromRec(rec), 'u:' + rec.username, rec.username);
  }
  return null;
}

module.exports = { VIEW_COOKIE, viewCookie, STAFFER_COOKIE, stafferCookie, whoami, whoFromRec };
