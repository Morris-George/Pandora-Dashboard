const crypto = require('crypto');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { PANDORA_USERNAME, PANDORA_PASSWORD, PANDORA_AUTH_SECRET } = process.env;
  if (!PANDORA_USERNAME || !PANDORA_PASSWORD || !PANDORA_AUTH_SECRET || PANDORA_AUTH_SECRET.length < 32) {
    return res.status(500).json({ ok: false, error: 'Authentication is not configured. Contact the site administrator.' });
  }
  const body = req.body || {};
  if (!safeEqual(body.username || '', PANDORA_USERNAME) || !safeEqual(body.password || '', PANDORA_PASSWORD)) {
    return res.status(401).json({ ok: false });
  }
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = Buffer.from(`${PANDORA_USERNAME}\n${exp}`).toString('base64url');
  const token = `${payload}.${sign(payload, PANDORA_AUTH_SECRET)}`;
  res.setHeader('Set-Cookie', `pandora_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 60 * 60}`);
  return res.status(200).json({ ok: true });
};
