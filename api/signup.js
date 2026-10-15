// Sales person sign-up: phone number -> SMS code (Twilio Verify) -> pick own name -> username and password.
// The new account stays "pending" until the super admin approves it.
const crypto = require('crypto');
const store = require('./_store');
const users = require('./_users');
const { safeEqual, staffAccounts } = require('./_projects');

const TWILIO = () => ({
  sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, svc: process.env.TWILIO_VERIFY_SERVICE_SID
});
const twilioReady = () => { const t = TWILIO(); return !!(t.sid && t.token && t.svc); };

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}

async function twilio(path, params) {
  const t = TWILIO();
  const r = await fetch('https://verify.twilio.com/v2/Services/' + encodeURIComponent(t.svc) + '/' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(t.sid + ':' + t.token).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params).toString()
  });
  let j = {}; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

// short-lived proof that this phone number was verified
const sigKey = secret => secret + '|signup';
function makeToken(phone, secret) {
  const payload = Buffer.from(`${phone}\n${Math.floor(Date.now() / 1000) + 15 * 60}`).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', sigKey(secret)).update(payload).digest('base64url');
}
function readToken(token, secret) {
  try {
    const [payload, sig] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', sigKey(secret)).update(payload).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const [phone, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    return Number(exp) > Math.floor(Date.now() / 1000) ? phone : null;
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const secret = process.env.PANDORA_AUTH_SECRET;
  if (!store.configured() || !twilioReady() || !secret || secret.length < 32) {
    return send(res, 503, { ok: false, error: 'Sign-up is not open yet. Please ask your manager.' });
  }
  const b = req.body || {};
  const action = b.action;

  if (action === 'send') {
    const phone = users.normalizePhone(b.phone);
    if (!phone) return send(res, 400, { ok: false, error: 'Please enter a valid mobile number, for example 01012345678.' });
    if (await users.phoneTaken(phone)) return send(res, 409, { ok: false, error: 'This number already has an account. Go back and sign in.' });
    const r = await twilio('Verifications', { To: phone, Channel: 'sms' });
    if (r.status === 429) return send(res, 429, { ok: false, error: 'Too many codes were requested. Please wait a few minutes and try again.' });
    if (r.status >= 400) return send(res, 502, { ok: false, error: 'We could not send the code. Check the number and try again.' });
    return send(res, 200, { ok: true, phone });
  }

  if (action === 'verify') {
    const phone = users.normalizePhone(b.phone);
    const code = String(b.code || '').replace(/\s/g, '');
    if (!phone || !/^\d{4,10}$/.test(code)) return send(res, 400, { ok: false, error: 'Enter the code from the text message.' });
    const r = await twilio('VerificationCheck', { To: phone, Code: code });
    if (r.status >= 400 || !r.body || r.body.status !== 'approved') return send(res, 400, { ok: false, error: 'That code is not right or has expired.' });
    const d = await store.getJSON('data/current.json');
    if (!d) return send(res, 503, { ok: false, error: 'Sign-up opens after this month’s sales are published. Please ask your manager.' });
    const names = [];
    for (const p of d.people) {
      const st = d.stores[p[1]];
      if (!(await users.nameTaken(st, p[0]))) names.push({ store: st, name: p[0] });
    }
    names.sort((x, y) => x.store.localeCompare(y.store) || x.name.localeCompare(y.name));
    return send(res, 200, { ok: true, token: makeToken(phone, secret), names });
  }

  if (action === 'create') {
    const phone = readToken(b.token, secret);
    if (!phone) return send(res, 401, { ok: false, error: 'Your verification expired. Please start again.' });
    const username = users.normUsername(b.username);
    if (!username) return send(res, 400, { ok: false, error: 'Username: 3 to 30 letters or numbers (you can use . _ -), no spaces.' });
    if (staffAccounts().some(a => safeEqual(username, a.user.toLowerCase()))) return send(res, 409, { ok: false, error: 'That username is taken. Choose another.' });
    const pw = String(b.password || '');
    if (pw.length < 8 || pw.length > 100) return send(res, 400, { ok: false, error: 'Password must be at least 8 characters.' });
    if (await users.getUser(username)) return send(res, 409, { ok: false, error: 'That username is taken. Choose another.' });
    if (await users.phoneTaken(phone)) return send(res, 409, { ok: false, error: 'This number already has an account.' });
    const d = await store.getJSON('data/current.json');
    const person = d && d.people.find(p => p[0] === b.name && d.stores[p[1]] === b.store);
    if (!person) return send(res, 400, { ok: false, error: 'Please choose your name from the list.' });
    if (await users.nameTaken(b.store, b.name)) return send(res, 409, { ok: false, error: 'This name already has an account. Please ask your manager.' });
    await users.createUser({ username, password: pw, phone, store: b.store, name: b.name });
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { ok: false, error: 'Unknown request.' });
};
