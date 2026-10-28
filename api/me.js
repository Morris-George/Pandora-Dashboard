// Who am I and what can I open? Used by the home screen.
const { appsFor, sessionFacts, greetName } = require('./_apps');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const f = await sessionFacts(req);
  if (!f.dash && !f.staff && !f.vm && !f.sc && !f.hr) return res.status(401).json({ ok: false, error: 'sign-in-required' });
  const label = f.vm || f.sc || f.hr ? f.vmName : f.staff ? (f.staff.role === 'staff' || f.staff.role === 'store' ? f.staff.name : f.staff.label) : 'Pandora Dashboards';
  return res.status(200).json({ ok: true, label, greet: greetName(f), apps: appsFor(f) });
};
