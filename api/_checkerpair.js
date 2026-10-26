// Stock Checker phone link (POST /api/checkerpair, rewritten to /api/vm?checkerpair=1).
// Anyone who can open Stock Checker (super admin, area managers, store managers, Stock Count accounts) gets a signed
// 12-hour token for the QR code. The token opens only /stockchecker on the phone (see api/_pair.js).
const { whoami } = require('./_auth');
const pair = require('./_pair');

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}

module.exports = async function handler(req, res) {
  const who = await whoami(req);
  if (!who) return send(res, 401, { error: 'Please sign in again.' });
  const ok = who.kind === 'sc' || (who.kind !== 'vm' && !!who.info && who.info.role !== 'staff');
  if (!ok) return send(res, 403, { error: 'You do not have access to Stock Checker.' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const secret = process.env.PANDORA_AUTH_SECRET;
  if (!secret || secret.length < 32) return send(res, 503, { error: 'not configured' });
  return send(res, 200, { token: pair.makeToken(secret, 'checker') });
};
