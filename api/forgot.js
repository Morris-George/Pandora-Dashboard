// "I forgot my password": the sales person types the phone number of their account.
// Nothing is sent to the phone. The super admin sees the request on the approvals page, checks it is really them (calls the number), and sets a new password.
const store = require('./_store');
const users = require('./_users');
const { tooMany } = require('./_ratelimit');
const activity = require('./_activity');

const LIMIT_PER_HOUR = 6;
function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!store.configured()) return send(res, 503, { ok: false, error: 'This is temporarily unavailable. Please try again later.' });
  const b = req.body || {};
  if (b.website) return send(res, 200, { ok: true }); // hidden field that only robots fill in
  if (await tooMany(req, 'forgot', LIMIT_PER_HOUR)) return send(res, 429, { ok: false, error: 'Too many tries. Please wait a while and try again.' });
  const phone = users.normalizePhone(b.phone);
  if (!phone) return send(res, 400, { ok: false, error: 'Please enter a valid mobile number, for example 01012345678.' });
  const owner = await users.getJSONByPhone(phone);
  const rec = owner ? await users.getUser(owner) : null;
  if (!rec) return send(res, 404, { ok: false, error: 'We could not find an account with this number. Check the number, or create an account.' });
  await store.putJSON('resets/' + rec.username + '.json', { username: rec.username, requestedAt: new Date().toISOString() });
  await activity.recordAnon(req, { ty: 'forgot', a: 'Asked for a new password', d: rec.username + (rec.name ? ' (' + rec.name + ')' : '') });
  return send(res, 200, { ok: true });
};
