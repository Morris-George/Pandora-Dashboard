// TEMPORARY diagnostics: walks the whole Maintenance hand-over server side (no tokens or secrets returned)
const maint = require('./_maintenance');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const out = { configured: maint.configured() };
  if (q.e && q.p) {
    const r = await maint.login(String(q.e).trim().toLowerCase(), String(q.p));
    out.login = { status: r.status, ok: !!(r.json && r.json.ok) };
    if (r.json && r.json.ok) {
      const ck = maint.ticketCookie(r.json).split(';')[0];
      const base = 'https://pandora-maintenance.vercel.app';
      const s = await fetch(base + '/maintenance/sso', { redirect: 'manual', headers: { cookie: ck } });
      const setc = (s.headers.getSetCookie ? s.headers.getSetCookie() : []).map(c => c.split('=')[0] + ' [' + c.length + ']');
      out.sso = { status: s.status, location: s.headers.get('location'), setCookies: setc };
      const jar = (s.headers.getSetCookie ? s.headers.getSetCookie() : []).map(c => c.split(';')[0]).filter(c => !c.startsWith('mnt_sso=')).join('; ');
      const loc = s.headers.get('location') || '/maintenance';
      const a = await fetch(loc.startsWith('http') ? loc : base + loc, { redirect: 'manual', headers: { cookie: jar } });
      out.app = { status: a.status, location: a.headers.get('location'), matched: a.headers.get('x-matched-path') };
    }
  }
  res.status(200).json(out);
};
