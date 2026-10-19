// Staff accounts (sales people who sign up themselves). Stored as JSON files in the private store.
//   users/u/<username>.json   the account
//   users/p/<phone digits>.json   {username}   one account per phone number
//   users/n/<sha1(store|name)>.json   {username}   one account per sales person (written when the admin links it)
const crypto = require('crypto');
const store = require('./_store');

const USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;

function normUsername(u) {
  // spaces become dots, so "Raef Wengat" and "raef.wengat" are the same username
  const s = String(u || '').trim().toLowerCase().replace(/\s+/g, '.');
  return USERNAME_RE.test(s) ? s : '';
}

// Egyptian numbers can be typed as 01XXXXXXXXX; anything else must be full international format.
function normalizePhone(input) {
  let s = String(input || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^01\d{9}$/.test(s)) s = '+20' + s.slice(1);
  else if (/^201\d{9}$/.test(s)) s = '+' + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : '';
}
const phoneKey = phone => phone.replace(/\D/g, '');
const nameKey = (store_, name) => crypto.createHash('sha1').update(String(store_) + '|' + String(name)).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}
function verifyPassword(pw, stored) {
  try {
    const [kind, saltB64, hashB64] = String(stored).split('$');
    if (kind !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
// run when the username does not exist, so a wrong username and a wrong password take the same time
const DUMMY = hashPassword('dummy-password-for-timing');
const burn = pw => { verifyPassword(pw, DUMMY); };

const getUser = u => store.getJSON('users/u/' + u + '.json');
const putUser = rec => store.putJSON('users/u/' + rec.username + '.json', rec);

async function listUsers() {
  const paths = await store.list('users/u/');
  const out = [];
  for (const p of paths) { const r = await store.getJSON(p); if (r) out.push(r); }
  return out;
}

// A new account starts unlinked and pending. The super admin links it to the right sales person when approving.
async function createUser({ username, password, phone, store: st, name }) {
  const rec = {
    username, phone, store: st, name, linked: false,
    pass: hashPassword(password),
    status: 'pending',
    fails: 0, lockUntil: 0,
    createdAt: new Date().toISOString()
  };
  await putUser(rec);
  await store.putJSON('users/p/' + phoneKey(phone) + '.json', { username });
  return rec;
}

// An account made by the super admin for one special person (for example the Visual Merchandiser). No phone, no sales person link.
async function createSpecial({ username, password, name, role }) {
  const rec = { username, phone: '', store: '', name, role, linked: true, pass: hashPassword(password), status: 'active', fails: 0, lockUntil: 0, createdAt: new Date().toISOString() };
  await putUser(rec);
  return rec;
}

async function removeUser(rec) {
  await store.del('users/u/' + rec.username + '.json');
  if (rec.phone) await store.del('users/p/' + phoneKey(rec.phone) + '.json');
  await store.del('resets/' + rec.username + '.json');
  if (rec.linked && !rec.role) await store.del('users/n/' + nameKey(rec.store, rec.name) + '.json');
}

// point the account at a sales person from the published file (one account per sales person)
async function linkUser(rec, st, name) {
  if (rec.linked && !rec.role) await store.del('users/n/' + nameKey(rec.store, rec.name) + '.json');
  rec.store = st; rec.name = name; rec.linked = true;
  await putUser(rec);
  await store.putJSON('users/n/' + nameKey(st, name) + '.json', { username: rec.username });
}

const getJSONByPhone = async phone => { const c = await store.getJSON('users/p/' + phoneKey(phone) + '.json'); return c ? c.username : null; };
const phoneTaken = async phone => !!(await store.getJSON('users/p/' + phoneKey(phone) + '.json'));
const claimOwner = async (st, name) => { const c = await store.getJSON('users/n/' + nameKey(st, name) + '.json'); return c ? c.username : null; };

// Area managers sign in with usernames/passwords kept in Vercel settings, so they have no account file of their own.
// Switching one off writes a small marker here; login and every request check it.
const offKey = user => 'users/off/' + nameKey('env', String(user || '').replace(/\s+/g, ' ').trim().toLowerCase()) + '.json';
const envOff = async user => !!(await store.getJSON(offKey(user)));
const setEnvOff = async (user, off) => off ? store.putJSON(offKey(user), { username: String(user), at: new Date().toISOString() }) : store.del(offKey(user));

// A password the super admin set here for an area manager. When one exists it replaces the password kept in Vercel settings
// (the old Vercel password stops working). Stored as a one-way hash, like every other account.
const envPwKey = user => 'users/envpw/' + nameKey('envpw', String(user || '').replace(/\s+/g, ' ').trim().toLowerCase()) + '.json';
const getEnvPw = async user => { const r = await store.getJSON(envPwKey(user)); return r && r.pass ? r : null; };
const setEnvPw = async (user, password) => store.putJSON(envPwKey(user), { username: String(user), pass: hashPassword(password), at: new Date().toISOString() });

module.exports = { getEnvPw, setEnvPw, envOff, setEnvOff, normUsername, normalizePhone, hashPassword, verifyPassword, burn, getUser, putUser, listUsers, createUser, createSpecial, removeUser, linkUser, phoneTaken, getJSONByPhone, claimOwner, nameKey };
