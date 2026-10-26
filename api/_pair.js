// Phone pairing. A signed link (good for 12 hours) opens a phone on ONE page of the site, with no sign-in:
//   'count'   -> Stock Count   (made on the super admin's Stock Count screen)
//   'checker' -> Stock Checker (made on the Stock Checker screen by anyone who can open it)
// Opening the link sets a small cookie that opens ONLY that page. It is not a login: it is not read by whoami(),
// so it can never open any other page, report or account screen. Each kind has its own token text, salt and cookie,
// so a link made for one page does not work on the other.
const crypto = require('crypto');
const { readCookie } = require('./_projects');

const KINDS = {
  count: { what: 'stockcount-pair', cookie: 'stockpair_auth', salt: '|stockpair' },
  checker: { what: 'stockchecker-pair', cookie: 'checkerpair_auth', salt: '|checkerpair' }
};
const COOKIE = KINDS.count.cookie;
const MAX_AGE = 12 * 60 * 60;
const kindOf = k => KINDS[k] || KINDS.count;
const hmac = (payload, secret, k) => crypto.createHmac('sha256', secret + kindOf(k).salt).update(payload).digest();

function makeToken(secret, k) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = Buffer.from(kindOf(k).what + '\n' + exp).toString('base64url');
  return payload + '.' + hmac(payload, secret, k).toString('base64url');
}
function validToken(token, secret, k) {
  try {
    if (!token || !secret) return false;
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig) return false;
    const expected = hmac(payload, secret, k), actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    const [what, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    return what === kindOf(k).what && Number(exp) > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
const cookieHeader = (token, k) => `${kindOf(k).cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
const hasPair = (req, k) => validToken(readCookie(req, kindOf(k).cookie), process.env.PANDORA_AUTH_SECRET, k);

module.exports = { COOKIE, makeToken, validToken, cookieHeader, hasPair };
