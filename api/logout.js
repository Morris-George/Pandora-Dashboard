const { PROJECTS } = require('./_projects');
const { whoami } = require('./_auth');
const activity = require('./_activity');

// One log out for everything: clears every session cookie.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try { const who = await whoami(req); if (who) await activity.record(req, who, { ty: 'logout', a: 'Signed out' }); } catch (_) {} // before the cookies are cleared, so we still know who it is
  const gone = name => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  res.setHeader('Set-Cookie', [PROJECTS.dashboards.cookie, PROJECTS.staff.cookie, 'staffer_auth', 'stockpair_auth'].map(gone));
  return res.status(200).json({ ok: true });
};
