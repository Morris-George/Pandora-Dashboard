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

// ---- Staff Performance roles ----
// super admin sees everything; each area manager sees only the stores of their zone.
// Store names are matched loosely (case-insensitive regular expressions) against the store names in the Query Report.
// A store that matches no zone is visible to the super admin only.
const ZONES = {
  cairo:   { label: 'Cairo zone',                 stores: ['almaza', 'city\\s*stars', 'cfc', 'festival', 'point\\s*90'] },
  octalex: { label: 'October & Alexandria zone',  stores: ['mall\\s*of\\s*egypt', 'mall\\s*of\\s*arabia', 'arabia', 'alex'] }
};
const STAFF_ACCOUNTS = [
  { role: 'admin',   label: 'Super admin',                  userEnv: 'STAFF_USERNAME',          passEnv: 'STAFF_PASSWORD' },
  { role: 'cairo',   label: 'Cairo zone manager',           userEnv: 'MANAGER_CAIRO_USERNAME',  passEnv: 'MANAGER_CAIRO_PASSWORD' },
  { role: 'octalex', label: 'October & Alexandria manager', userEnv: 'MANAGER_OCT_USERNAME',    passEnv: 'MANAGER_OCT_PASSWORD' }
];
// Only accounts that have both a username and a password set. A manager whose username equals another account's is ignored,
// so one login can never be read as a different role.
// usernames of admin/managers ignore capital letters and extra spaces (phones auto-capitalise and add spaces)
const normName = u => String(u || '').replace(/\s+/g, ' ').trim().toLowerCase();
function staffAccounts() {
  const list = STAFF_ACCOUNTS
    .map(a => ({ ...a, user: (process.env[a.userEnv] || '').trim(), pass: (process.env[a.passEnv] || '').trim() }))
    .filter(a => a.user && a.pass);
  return list.filter(a => list.filter(b => normName(b.user) === normName(a.user)).length === 1);
}
function staffSession(token, secret) {
  for (const a of staffAccounts()) {
    if (validSession('staff', token, a.user, secret)) return a;
  }
  return null;
}
function roleInfo(account) {
  const zone = ZONES[account.role];
  return {
    role: account.role,
    label: account.label,
    zone: zone ? zone.label : null,
    allow: zone ? zone.stores : null,
    zones: account.role === 'admin' ? Object.values(ZONES).map(z => ({ label: z.label, allow: z.stores })) : null
  };
}

module.exports = { normName, PROJECTS, projectFrom, safeEqual, signingKey, sign, validSession, readCookie, ZONES, staffAccounts, staffSession, roleInfo };
