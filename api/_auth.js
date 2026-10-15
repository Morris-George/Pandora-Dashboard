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

// -> {kind:'env', account, info} | {kind:'staff', user, info} | null
async function whoami(req) {
  const secret = process.env.PANDORA_AUTH_SECRET;
  const account = staffSession(readCookie(req, PROJECTS.staff.cookie), secret);
  if (account) return { kind: 'env', account, info: roleInfo(account) };
  const u = stafferUsername(readCookie(req, STAFFER_COOKIE), secret);
  if (u && store.configured()) {
    const rec = await users.getUser(u);
    if (rec && rec.status === 'active') {
      return { kind: 'staff', user: rec, info: { role: 'staff', label: 'Sales person', zone: null, allow: null, zones: null, self: { store: rec.store, name: rec.name } } };
    }
  }
  return null;
}

module.exports = { STAFFER_COOKIE, stafferCookie, whoami };
