
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIVATE_DIR = path.join(process.cwd(), 'private');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length &&
    crypto.timingSafeEqual(aa, bb);
}

function validSession(token, expectedUser, secret) {
  try {
    if (!token || !expectedUser || !secret) return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [payload, signature] = parts;
    const expected = crypto.createHmac('sha256', secret)
      .update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');

    if (actual.length !== expected.length ||
        !crypto.timingSafeEqual(actual, expected)) return false;

    const decoded = Buffer.from(payload, 'base64url')
      .toString('utf8').split('\n');

    return decoded.length === 2 &&
      safeEqual(decoded[0], expectedUser) &&
      Number(decoded[1]) > Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}

function sendFile(res, filename, contentType) {
  try {
    const content = fs.readFileSync(
      path.join(PRIVATE_DIR, filename)
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    return res.status(200).send(content);
  } catch (_) {
    return res.status(500).send('Site file unavailable.');
  }
}

module.exports = function handler(req, res) {
  const url = new URL(req.url, 'https://vercel.invalid');

  const requestedPath = url.searchParams.has('path')
    ? '/' + (url.searchParams.get('path') || '').replace(/^\/+/, '')
    : url.pathname;

  if (requestedPath === '/login.html') {
    return sendFile(res, 'login.html', 'text/html; charset=utf-8');
  }

  if (requestedPath === '/pandora-logo.png') {
    return sendFile(res, 'pandora-logo.png', 'image/png');
  }

  if (requestedPath === '/favicon.ico') {
    return res.status(404).end();
  }

  const { PANDORA_USERNAME, PANDORA_AUTH_SECRET } = process.env;

  const cookie = (req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('pandora_auth='));

  const token = cookie
    ? cookie.slice('pandora_auth='.length)
    : '';

  if (!validSession(token, PANDORA_USERNAME, PANDORA_AUTH_SECRET)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/login.html');
    return res.status(302).end();
  }

  if (requestedPath === '/' || requestedPath === '/index.html') {
    return sendFile(res, 'index.html', 'text/html; charset=utf-8');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).end();
};
