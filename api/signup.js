// Sales person sign-up. Always open. There is no SMS code: the super admin approves every account
// and links it to the right sales person, so nobody sees any sales before that.
const store = require('./_store');
const users = require('./_users');
const { tooMany } = require('./_ratelimit');
const { safeEqual, staffAccounts, normName } = require('./_projects');
const activity = require('./_activity');

const LIMIT_PER_HOUR = 6;   // sign-up attempts per visitor per hour
const MAX_ACCOUNTS = 500;   // protects the storage from being filled with fake accounts

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!store.configured()) return send(res, 503, { ok: false, error: 'Sign-up is temporarily unavailable. Please try again later.' });
  const b = req.body || {};
  if (b.website) return send(res, 200, { ok: true }); // hidden field that only robots fill in
  if (await tooMany(req, 'signup', LIMIT_PER_HOUR)) return send(res, 429, { ok: false, error: 'Too many tries. Please wait a while and try again.' });

  const name = clean(b.name, 60), shop = clean(b.store, 60);
  if (name.length < 2) return send(res, 400, { ok: false, error: 'Please type your full name.' });
  if (shop.length < 2) return send(res, 400, { ok: false, error: 'Please type your store name.' });
  const phone = users.normalizePhone(b.phone);
  if (!phone) return send(res, 400, { ok: false, error: 'Please enter a valid mobile number, for example 01012345678.' });
  const username = users.normUsername(b.username);
  if (!username) return send(res, 400, { ok: false, error: 'Username: 3 to 30 letters or numbers (you can use . _ -), no spaces.' });
  const pw = String(b.password || '');
  if (pw.length < 8 || pw.length > 100) return send(res, 400, { ok: false, error: 'Password must be at least 8 characters.' });

  if (staffAccounts().some(a => safeEqual(username, normName(a.user))) || await users.getUser(username)) {
    return send(res, 409, { ok: false, error: 'That username is taken. Choose another.' });
  }
  if (await users.phoneTaken(phone)) return send(res, 409, { ok: false, error: 'This number already has an account. Go back and sign in.' });
  if ((await store.list('users/u/')).length >= MAX_ACCOUNTS) return send(res, 503, { ok: false, error: 'Sign-up is full right now. Please ask your manager.' });

  await users.createUser({ username, password: pw, phone, store: shop, name });
  await activity.recordAnon(req, { ty: 'signup', a: 'Created an account (waiting for approval)', d: name + ' · ' + shop + ' · ' + username });
  return send(res, 200, { ok: true });
};
