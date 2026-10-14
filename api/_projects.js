// Shared settings for the two protected projects.
// Each project has its own username/password (Vercel env vars) and its own session cookie.
const crypto = require('crypto');

const PROJECTS = {
  dashboards: {
    label: 'Pandora Dashboards',
    userEnv: 'PANDORA_USERNAME',
    passEnv: 'PANDORA_PASSWORD',
    cookie: 'pandora_auth',
    keySuffix: '' // unchanged, so existing sessions keep working
  },
  staff: {
    label: 'Staff Performance',
    userEnv: 'STAFF_USERNAME',
    passEnv: 'STAFF_PASSWORD',
    cookie: 'staff_auth',
    keySuffix: '|staff' // a different signing key, so one login can never open the other project
  }
};

function projectFrom(value) {
  return PROJECTS[value] ? value : 'dashboards';
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function signingKey(project, secret) {
  return secret + PROJECTS[project].keySuffix;
}
function sign(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}
function validSession(project, token, expectedUser, secret) {
  try {
    if (!token || !expectedUser || !secret) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    const expected = crypto.createHmac('sha256', signingKey(project, secret)).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    const decoded = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    return decoded.length === 2 && safeEqual(decoded[0], expectedUser) && Number(decoded[1]) > Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}
function readCookie(req, name) {
  const c = (req.headers.cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith(name + '='));
  return c ? c.slice(name.length + 1) : '';
}

module.exports = { PROJECTS, projectFrom, safeEqual, signingKey, sign, validSession, readCookie };
