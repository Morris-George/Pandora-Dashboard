// Who is calling? Three kinds of people can use Staff Performance:
//  - super admin and area managers: usernames/passwords in Vercel settings (cookie staff_auth)
//  - sales people who signed up themselves and were approved (cookie staffer_auth, its own signing key)
const crypto = require('crypto');
const { PROJECTS, readCookie, staffSession, roleInfo } = require('./_projects');
const users = require('./_users');
const store = require('./_store');

const STAFFER_COOKIE = 'staffer_auth';
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

// -> {kind:'env', account, info} | {kind:'staff', user, info} | {kind:'vm', user, info} | null
// The answer is kept for the length of one request, so the activity log can ask "who is this?" without reading storage again.
const memo = new WeakMap();
function whoami(req) {
  if (req && typeof req === 'object') {
    if (!memo.has(req)) memo.set(req, whoamiNow(req));
    return memo.get(req);
  }
  return whoamiNow(req);
}
async function whoamiNow(req) {
  const secret = process.env.PANDORA_AUTH_SECRET;
  const account = staffSession(readCookie(req, PROJECTS.staff.cookie), secret);
  if (account) {
    // a switched-off area manager is signed out at once (the super admin can never be switched off)
    if (account.role !== 'admin' && store.configured() && await users.envOff(account.user)) return null;
    return { kind: 'env', account, info: roleInfo(account) };
  }
  const u = stafferUsername(readCookie(req, STAFFER_COOKIE), secret);
  if (u && store.configured()) {
    const rec = await users.getUser(u);
    if (rec && rec.status === 'active' && rec.role === 'vm') {
      return { kind: 'vm', user: rec, info: { role: 'vm', label: 'Visual Merchandiser', zone: null, allow: null, zones: null } };
    }
    if (rec && rec.status === 'active' && rec.role === 'overseer') {
      // an Overseer (for example Ibrahim Nassif): sees and does everything the super admin does, except managing accounts and passwords
      const account = { role: 'admin', label: 'Overseer', user: rec.username, overseer: true };
      return { kind: 'env', account, user: rec, info: { ...roleInfo(account), overseer: true } };
    }
    if (rec && rec.status === 'active' && rec.role === 'stockcount') {
      // a Stock Count only account: opens the Stock Count page and its data, nothing else
      return { kind: 'sc', user: rec, info: { role: 'stockcount', label: 'Stock Count', zone: null, allow: null, zones: null } };
    }
    if (rec && rec.status === 'active' && rec.storeManager && rec.linked && rec.store) {
      // a store manager: still a sales person (own page at /staff/me), and also sees the team of their own store, nothing else
      const rx = '^' + String(rec.store).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      return { kind: 'staff', user: rec, info: { role: 'store', label: 'Store manager', zone: rec.store, allow: [rx], zones: null, self: { store: rec.store, name: rec.name }, storeManager: true } };
    }
    if (rec && rec.status === 'active') {
      return { kind: 'staff', user: rec, info: { role: 'staff', label: 'Sales person', zone: null, allow: null, zones: null, self: { store: rec.store, name: rec.name } } };
    }
  }
  return null;
}

module.exports = { STAFFER_COOKIE, stafferCookie, whoami };
