// What a signed-in person can open. To add a new option later, add one entry to APPS:
// `allow` decides who sees it (by role), `href` is where it opens. The home screen shows whatever this returns.
const { PROJECTS, validSession, readCookie, staffAccounts } = require('./_projects');
const { whoami } = require('./_auth');

// f = { dash: true/false, staff: { role, label, name } | null, vm: true/false }
const APPS = [
  { id: 'dashboards', title: 'Pandora Dashboards', desc: 'Sales dashboards for the whole business.', href: '/dashboards', allow: f => f.dash },
  { id: 'staff', title: 'Staff Performance', desc: 'How each store and each sales person is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role !== 'staff' && f.staff.role !== 'store' },
  { id: 'uploads', title: 'All Uploads', desc: 'Add, see and remove every document, grouped by where it is used.', href: '/uploads', allow: f => !!f.staff && f.staff.role === 'admin' },
  { id: 'approvals', title: 'Staff approvals', desc: 'Approve new sales people, reset passwords and manage accounts.', href: '/staff/accounts', allow: f => !!f.staff && f.staff.role === 'admin' },
  { id: 'mysales', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'staff' },
  { id: 'storeteam', title: 'My store team', desc: 'How each sales person in your store is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'store' },
  { id: 'mysales2', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff/me', allow: f => !!f.staff && f.staff.role === 'store' },
  { id: 'vmzones', title: 'VM Zones', desc: 'Which collection is in which zone of each store, and its effect on sales.', href: '/vm/zones', allow: f => !!f.vm || (!!f.staff && f.staff.role === 'admin') },
  { id: 'vm', title: 'VM Report', desc: 'The Visual Merchandiser report.', href: '/vm', allow: f => !!f.vm || (!!f.staff && f.staff.role === 'admin') }
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
  const vm = !!who && who.kind === 'vm';
  const staff = who && !vm ? { role: who.info.role, label: who.info.label, name: who.kind === 'staff' ? who.user.name : '', who } : null;
  return { dash, staff, vm, vmName: vm ? who.user.name : '' };
}

module.exports = { APPS, appsFor, sessionFacts };
