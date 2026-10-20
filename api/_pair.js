// Phone pairing for Stock Count. The super admin's screen makes a pairing link (a signed token, good for 12 hours);
// opening it on a phone sets a small cookie that opens ONLY the Stock Count page and its data, nothing else on the site.
// It is not a login: it is not read by whoami(), so it can never open any other page, report or account screen.
const crypto = require('crypto');
const { readCookie } = require('./_projects');

const COOKIE = 'stockpair_auth';
const MAX_AGE = 12 * 60 * 60;
const hmac = (payload, secret) => crypto.createHmac('sha256', secret + '|stockpair').update(payload).digest();

function makeToken(secret) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = Buffer.from('stockcount-pair\n' + exp).toString('base64url');
  return payload + '.' + hmac(payload, secret).toString('base64url');
}
function validToken(token, secret) {
  try {
    if (!token || !secret) return false;
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig) return false;
    const expected = hmac(payload, secret), actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    const [what, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    return what === 'stockcount-pair' && Number(exp) > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
const cookieHeader = token => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
const hasPair = req => validToken(readCookie(req, COOKIE), process.env.PANDORA_AUTH_SECRET);

module.exports = { COOKIE, makeToken, validToken, cookieHeader, hasPair };
