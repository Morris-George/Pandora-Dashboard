// The Maintenance tile on the home page: a super admin who is already signed in here opens Maintenance without a second sign-in.
const { whoami } = require('./_auth');
const { ADMIN_NAME } = require('./_projects');
const maint = require('./_maintenance');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const go = (loc, cookie) => { if (cookie) res.setHeader('Set-Cookie', cookie); res.setHeader('Location', loc); return res.status(302).end(); };
  const who = await whoami(req).catch(() => null);
  if (!who) return go('/login.html');
  const isAdmin = who.info && who.info.role === 'admin' && !who.info.overseer;
  if (!isAdmin || !maint.configured()) return go('/maintenance');
  const name = who.user && who.user.name ? who.user.name : ADMIN_NAME;
  const r = await maint.session(name);
  if (r.status === 200 && r.json && r.json.ok) return go('/maintenance/sso', maint.ticketCookie(r.json));
  // no Maintenance Super Admin with this name: fall back to Maintenance's own handling
  return go('/maintenance');
};
