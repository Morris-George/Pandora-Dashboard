// TEMPORARY diagnostics: does this site's sign-in reach the Maintenance app? (no tokens or secrets returned)
const maint = require('./_maintenance');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const out = { configured: maint.configured() };
  if (q.e && q.p) {
    const r = await maint.login(String(q.e).trim().toLowerCase(), String(q.p));
    out.login = { status: r.status, ok: !!(r.json && r.json.ok), keys: Object.keys(r.json || {}), cookieLen: r.json && r.json.ok ? maint.ticketCookie(r.json).length : 0 };
  }
  res.status(200).json(out);
};
