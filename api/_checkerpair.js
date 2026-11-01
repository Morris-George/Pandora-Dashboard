// Stock Checker phone link (POST /api/checkerpair, rewritten to /api/vm?checkerpair=1).
// Anyone who may open Stock Checker gets a signed 12-hour token for ONE store they may see (their own store, or any store of their zone
// for an area manager, or any store for the super admin). The token opens only /stockchecker on the phone, bound to that store (see api/_pair.js).
const pair = require('./_pair');
const { access } = require('./_checker');
const { canon } = require('./_daily');

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let buf;
  if (Buffer.isBuffer(req.body)) buf = req.body;
  else if (typeof req.body === 'string') buf = Buffer.from(req.body);
  else { const ch = []; for await (const c of req) ch.push(c); buf = Buffer.concat(ch); }
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  const a = await access(req);
  if (a.code === 401) return send(res, 401, { error: 'Please sign in again.' });
  if (a.code || a.role === 'phone') return send(res, 403, { error: 'You do not have access to Stock Checker.' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const secret = process.env.PANDORA_AUTH_SECRET;
  if (!secret || secret.length < 32) return send(res, 503, { error: 'not configured' });
  const b = await body(req);
  const st = canon(b && b.store);
  const ok = st && (a.role === 'admin' || (a.role === 'area' && a.allow.some(rx => rx.test(st))) || st === a.own);
  if (!ok) return send(res, 403, { error: 'Pick one of your stores.' });
  return send(res, 200, { token: pair.makeToken(secret, 'checker', st), store: st });
};
