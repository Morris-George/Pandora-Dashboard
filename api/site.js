
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

const LOGOUT_SNIPPET = '<script>(function(){' +
  "var b=document.createElement('button');" +
  "b.type='button';b.id='logoutBtn';b.className='secondary';b.textContent='Log out';" +
  "b.addEventListener('click',function(){" +
  "b.disabled=true;b.textContent='Logging out\\u2026';" +
  "fetch('/api/logout',{method:'POST',credentials:'same-origin'}).then(function(r){" +
  "if(r.ok){location.replace('/login.html');}else{throw new Error('logout failed');}" +
  "}).catch(function(){b.disabled=false;b.textContent='Log out';});" +
  '});' +
  "var bar=document.querySelector('.top-actions');" +
  'if(bar){bar.appendChild(b);}' +
  "else{b.style.cssText='position:fixed;top:12px;right:12px;z-index:9999';document.body.appendChild(b);}" +
  '})();</script>';

function addLogoutButton(buf) {
  const html = buf.toString('utf8');
  const i = html.lastIndexOf('</body>');
  if (i === -1) return buf;
  return Buffer.from(html.slice(0, i) + LOGOUT_SNIPPET + html.slice(i), 'utf8');
}

function sendFile(res, filename, contentType, transform) {
  try {
    let content = fs.readFileSync(
      path.join(PRIVATE_DIR, filename)
    );
    if (transform) content = transform(content);

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
    return sendFile(res, 'index.html', 'text/html; charset=utf-8', addLogoutButton);
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).end();
};
