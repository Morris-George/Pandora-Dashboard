// What a signed-in person can open. To add a new option later, add one entry to APPS:
// `allow` decides who sees it (by role), `href` is where it opens. The home screen shows whatever this returns.
const { PROJECTS, validSession, readCookie, staffAccounts } = require('./_projects');
const { whoami } = require('./_auth');

// f = { dash: true/false, staff: { role, label, name } | null }
const APPS = [
  { id: 'dashboards', title: 'Pandora Dashboards', desc: 'Sales dashboards for the whole business.', href: '/dashboards', allow: f => f.dash },
  { id: 'staff', title: 'Staff Performance', desc: 'How each store and each sales person is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role !== 'staff' },
  { id: 'mysales', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'staff' }
];

function appsFor(f) {
  return APPS.filter(a => a.allow(f)).map(a => ({ id: a.id, title: a.title, desc: a.desc, href: a.href }));
}

// Read the cookies of this request: which logins are valid?
async function sessionFacts(req) {
  const secret = process.env.PANDORA_AUTH_SECRET;
  // only the super admin has a dashboards session (the old separate dashboards login was removed)
  const tok = readCookie(req, PROJECTS.dashboards.cookie);
  const adminUser = (staffAccounts().find(a => a.role === 'admin') || {}).user;
  const dash = validSession('dashboards', tok, adminUser, secret);
  const who = await whoami(req);
  const staff = who ? { role: who.info.role, label: who.info.label, name: who.kind === 'staff' ? who.user.name : '', who } : null;
  return { dash, staff };
}

module.exports = { APPS, appsFor, sessionFacts };
