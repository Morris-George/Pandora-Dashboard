const { PROJECTS, projectFrom, safeEqual, signingKey, sign, staffAccounts } = require('./_projects');

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
      const okUser = safeEqual(body.username || '', a.user);
      const okPass = safeEqual(body.password || '', a.pass);
      if (okUser && okPass && !matched) matched = a;
    }
    if (!matched) return res.status(401).json({ ok: false });
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
