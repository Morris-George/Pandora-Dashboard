const { PROJECTS, projectFrom } = require('./_projects');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const url = new URL(req.url, 'https://vercel.invalid');
  const cfg = PROJECTS[projectFrom(url.searchParams.get('project'))];
  const gone = name => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  const cookies = [gone(cfg.cookie)];
  if (cfg === PROJECTS.staff) cookies.push(gone('staffer_auth'));
  res.setHeader('Set-Cookie', cookies);
  return res.status(200).json({ ok: true });
};
