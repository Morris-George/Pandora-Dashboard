const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIVATE_DIR = path.join(process.cwd(), 'private');
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function validSession(token, expectedUser, secret) {
  try {
    if (!token || !expectedUser || !secret) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    const decoded = Buffer.from(payload, 'base64url').toString('utf8').split('\n');
    return decoded.length === 2 && safeEqual(decoded[0], expectedUser) && Number(decoded[1]) > Math.floor(Date.now() / 1000);
  } catch (_) { return false; }
}
function sendFile(res, filename, contentType) {
  try {
    const content = fs.readFileSync(path.join(PRIVATE_DIR, filename));
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    return res.status(200).send(content);
  } catch (_) { return res.status(500).send('Site file unavailable.'); }
}
module.exports = function handler(req, res) {
const pathname = url.searchParams.has('path')
  ? '/' + (url.searchParams.get('path') || '').replace(/^\/+/, '')
  : url.pathname;
  // Only these two resources are intentionally available before login.
  if (pathname === '/login.html') return sendFile(res, 'login.html', 'text/html; charset=utf-8');
  if (pathname === '/pandora-logo.png') return sendFile(res, 'pandora-logo.png', 'image/png');
  if (pathname === '/favicon.ico') return res.status(404).end();

  const { PANDORA_USERNAME, PANDORA_AUTH_SECRET } = process.env;
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('pandora_auth='))?.slice('pandora_auth='.length);
  if (!validSession(token, PANDORA_USERNAME, PANDORA_AUTH_SECRET)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/login.html');
    return res.status(302).end();
  }
  // The dashboard is kept outside the public root and only emitted after validation.
  if (pathname === '/' || pathname === '/index.html') return sendFile(res, 'index.html', 'text/html; charset=utf-8');
  return res.status(404).setHeader('Cache-Control', 'no-store').end();
};
