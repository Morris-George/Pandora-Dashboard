// Staff accounts (sales people who sign up themselves). Stored as JSON files in the private store.
//   users/u/<username>.json   the account
//   users/p/<phone digits>.json   {username}   one account per phone number
//   users/n/<sha1(store|name)>.json   {username}   one account per sales person
const crypto = require('crypto');
const store = require('./_store');

const USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;

function normUsername(u) {
  const s = String(u || '').trim().toLowerCase();
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

async function createUser({ username, password, phone, store: st, name }) {
  const rec = {
    username, phone, store: st, name,
    pass: hashPassword(password),
    status: 'pending', // an admin approves each new account
    fails: 0, lockUntil: 0,
    createdAt: new Date().toISOString()
  };
  await putUser(rec);
  await store.putJSON('users/p/' + phoneKey(phone) + '.json', { username });
  await store.putJSON('users/n/' + nameKey(st, name) + '.json', { username });
  return rec;
}

async function removeUser(rec) {
  await store.del('users/u/' + rec.username + '.json');
  await store.del('users/p/' + phoneKey(rec.phone) + '.json');
  await store.del('users/n/' + nameKey(rec.store, rec.name) + '.json');
}

const phoneTaken = async phone => !!(await store.getJSON('users/p/' + phoneKey(phone) + '.json'));
const nameTaken = async (st, name) => !!(await store.getJSON('users/n/' + nameKey(st, name) + '.json'));

module.exports = { normUsername, normalizePhone, hashPassword, verifyPassword, burn, getUser, putUser, listUsers, createUser, removeUser, phoneTaken, nameTaken, nameKey };
