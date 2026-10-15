// Sales person sign-up. Always open. There is no SMS code: the super admin approves every account
// and links it to the right sales person, so nobody sees any sales before that.
const crypto = require('crypto');
const store = require('./_store');
const users = require('./_users');
const { safeEqual, staffAccounts } = require('./_projects');

const LIMIT_PER_HOUR = 6;   // sign-up attempts per visitor per hour
const MAX_ACCOUNTS = 500;   // protects the storage from being filled with fake accounts

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

async function tooMany(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
  const key = 'rl/' + crypto.createHash('sha1').update(ip).digest('hex').slice(0, 20) + '-' + Math.floor(Date.now() / 3600000) + '.json';
  const cur = (await store.getJSON(key)) || { n: 0 };
  if (cur.n >= LIMIT_PER_HOUR) return true;
  await store.putJSON(key, { n: cur.n + 1 });
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!store.configured()) return send(res, 503, { ok: false, error: 'Sign-up is temporarily unavailable. Please try again later.' });
  const b = req.body || {};
  if (b.website) return send(res, 200, { ok: true }); // hidden field that only robots fill in
  if (await tooMany(req)) return send(res, 429, { ok: false, error: 'Too many tries. Please wait a while and try again.' });

  const name = clean(b.name, 60), shop = clean(b.store, 60);
  if (name.length < 2) return send(res, 400, { ok: false, error: 'Please type your full name.' });
  if (shop.length < 2) return send(res, 400, { ok: false, error: 'Please type your store name.' });
  const phone = users.normalizePhone(b.phone);
  if (!phone) return send(res, 400, { ok: false, error: 'Please enter a valid mobile number, for example 01012345678.' });
  const username = users.normUsername(b.username);
  if (!username) return send(res, 400, { ok: false, error: 'Username: 3 to 30 letters or numbers (you can use . _ -), no spaces.' });
  const pw = String(b.password || '');
  if (pw.length < 8 || pw.length > 100) return send(res, 400, { ok: false, error: 'Password must be at least 8 characters.' });

  if (staffAccounts().some(a => safeEqual(username, a.user.toLowerCase())) || await users.getUser(username)) {
    return send(res, 409, { ok: false, error: 'That username is taken. Choose another.' });
  }
  if (await users.phoneTaken(phone)) return send(res, 409, { ok: false, error: 'This number already has an account. Go back and sign in.' });
  if ((await store.list('users/u/')).length >= MAX_ACCOUNTS) return send(res, 503, { ok: false, error: 'Sign-up is full right now. Please ask your manager.' });

  await users.createUser({ username, password: pw, phone, store: shop, name });
  return send(res, 200, { ok: true });
};
