const { PROJECTS, projectFrom, safeEqual, signingKey, sign, staffAccounts, normName } = require('./_projects');
const users = require('./_users');
const store = require('./_store');
const { stafferCookie } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const body = req.body || {};
  const project = projectFrom(body.project); // missing/unknown project = the original dashboard
  const cfg = PROJECTS[project];
  const secret = process.env.PANDORA_AUTH_SECRET;
  let USER = process.env[cfg.userEnv];
  let PASS = process.env[cfg.passEnv];

  if (project === 'staff') {
    // Staff Performance accepts the super admin and the area managers. Every account is checked, with no early exit.
    const accounts = staffAccounts();
    if (!accounts.length || !secret || secret.length < 32) {
      return res.status(500).json({ ok: false, error: 'Sign-in for ' + cfg.label + ' is not configured. Contact the site administrator.' });
    }
    let matched = null;
    for (const a of accounts) {
      const okUser = safeEqual(normName(body.username), normName(a.user));
      const okPass = safeEqual(String(body.password || '').trim(), a.pass);
      if (okUser && okPass && !matched) matched = a;
    }
    if (!matched) {
      // not an admin or manager: maybe a sales person with their own account
      const isEnvName = accounts.some(a => safeEqual(normName(body.username), normName(a.user)));
      const uname = users.normUsername(body.username);
      if (isEnvName || !uname || !store.configured()) { users.burn(body.password || ''); return res.status(401).json({ ok: false }); }
      const rec = await users.getUser(uname);
      if (!rec) { users.burn(body.password || ''); return res.status(401).json({ ok: false }); }
      if (rec.lockUntil && rec.lockUntil > Date.now()) {
        return res.status(429).json({ ok: false, error: 'Too many wrong attempts. Please wait 15 minutes and try again.' });
      }
      if (!users.verifyPassword(body.password || '', rec.pass)) {
        rec.fails = (rec.fails || 0) + 1;
        if (rec.fails >= 8) { rec.fails = 0; rec.lockUntil = Date.now() + 15 * 60 * 1000; }
        await users.putUser(rec);
        return res.status(401).json({ ok: false });
      }
      if (rec.status === 'pending') return res.status(403).json({ ok: false, error: 'Your account is waiting for approval. You will be able to sign in once it is approved.' });
      if (rec.status !== 'active') return res.status(403).json({ ok: false, error: 'This account is not active. Please contact your manager.' });
      if (rec.fails) { rec.fails = 0; rec.lockUntil = 0; await users.putUser(rec); }
      res.setHeader('Set-Cookie', stafferCookie(rec.username, secret));
      return res.status(200).json({ ok: true, next: '/staff' });
    }
    USER = matched.user;
  } else {
    if (!USER || !PASS || !secret || secret.length < 32) {
      return res.status(500).json({ ok: false, error: 'Sign-in for ' + cfg.label + ' is not configured. Contact the site administrator.' });
    }
    if (!safeEqual(body.username || '', USER) || !safeEqual(body.password || '', PASS)) {
      return res.status(401).json({ ok: false });
    }
  }
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = Buffer.from(`${USER}\n${exp}`).toString('base64url');
  const token = `${payload}.${sign(payload, signingKey(project, secret))}`;
  res.setHeader('Set-Cookie', `${cfg.cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 60 * 60}`);
  return res.status(200).json({ ok: true, next: project === 'staff' ? '/staff' : '/' });
};
