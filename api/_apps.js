// What a signed-in person can open. To add a new option later, add one entry to APPS:
// `allow` decides who sees it (by role), `href` is where it opens. The home screen shows whatever this returns.
const { PROJECTS, validSession, readCookie, staffAccounts } = require('./_projects');
const { whoami } = require('./_auth');

// f = { dash: true/false, staff: { role, label, name } | null, vm: true/false, sc: true/false (Stock Count only account) }
const APPS = [
  { id: 'dashboards', title: 'Pandora Dashboards', desc: 'Sales dashboards for the whole business.', href: '/dashboards', allow: f => f.dash },
  { id: 'staff', title: 'Staff Performance', desc: 'How each store and each sales person is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role !== 'staff' && f.staff.role !== 'store' },
  { id: 'uploads', title: 'All Uploads', desc: 'Add, see and remove every document, grouped by where it is used.', href: '/uploads', allow: f => !!f.staff && f.staff.role === 'admin' },
  { id: 'approvals', title: 'Staff approvals', desc: 'Approve new sales people, reset passwords and manage accounts.', href: '/staff/accounts', allow: f => !!f.staff && f.staff.role === 'admin' && !f.staff.overseer },
  { id: 'mysales', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'staff' },
  { id: 'storeteam', title: 'My store team', desc: 'How each sales person in your store is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'store' },
  { id: 'mysales2', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff/me', allow: f => !!f.staff && f.staff.role === 'store' },
  { id: 'daily', title: 'Daily Store Report', desc: 'Add the daily sheet and see sales against target, visitors, conversion and more.', href: '/daily', allow: f => !!f.staff },
  { id: 'vmzones', title: 'VM Zones', desc: 'Which collection is in which zone of each store, and its effect on sales.', href: '/vm/zones', allow: f => !!f.vm || (!!f.staff && f.staff.role === 'admin') },
  { id: 'zonestock', title: 'Zone Stock', desc: 'What is in each zone of the store: counts, goods received, moves, and sales taken off automatically.', href: '/vm/stock', allow: f => !!f.vm || (!!f.staff && (f.staff.role === 'admin' || f.staff.role === 'store')) },
  { id: 'stock', title: 'Stock balance', desc: 'How many pieces are in stock in each category, store by store, for the dates you pick.', href: '/stock', allow: f => !!f.vm || (!!f.staff && f.staff.role !== 'staff' && f.staff.role !== 'store') },
  { id: 'stockcount', title: 'Stock Count', desc: 'Count a store with scanners or phones and see what matches the ERP stock balance and what differs.', href: '/stockcount', allow: f => !!f.sc || (!!f.staff && f.staff.role === 'admin') },
  { id: 'vm', title: 'VM Report', desc: 'The Visual Merchandiser report.', href: '/vm', allow: f => !!f.vm || (!!f.staff && f.staff.role === 'admin') }
];

function appsFor(f) {
  // area managers open the same Dashboards as the super admin, but the server only sends them the stores of their zone
  const zoneManager = !!f.staff && f.staff.role !== 'admin' && f.staff.role !== 'staff' && f.staff.role !== 'store';
  return APPS.filter(a => a.allow(f)).map(a => ({ id: a.id, title: a.title, desc: a.id === 'dashboards' && zoneManager ? 'Sales dashboards for the stores in your zone.' : a.desc, href: a.href }));
}

// Read the cookies of this request: which logins are valid?
async function sessionFacts(req) {
  const secret = process.env.PANDORA_AUTH_SECRET;
  // the super admin has a dashboards session (the old separate dashboards login was removed);
  // area managers open Dashboards with their staff login, limited to their zone by the server (api/uploads.js)
  const tok = readCookie(req, PROJECTS.dashboards.cookie);
  const adminUser = (staffAccounts().find(a => a.role === 'admin') || {}).user;
  const who = await whoami(req);
  const dash = validSession('dashboards', tok, adminUser, secret) || (!!who && who.kind === 'env' && (!!who.info.allow || !!who.info.overseer));
  const vm = !!who && who.kind === 'vm';
  const sc = !!who && who.kind === 'sc';
  const staff = who && !vm && !sc ? { role: who.info.role, label: who.info.label, name: who.kind === 'staff' ? who.user.name : '', overseer: !!who.info.overseer, who } : null;
  return { dash, staff, vm, sc, vmName: vm || sc ? who.user.name : '' };
}

// Area managers are greeted by first name ("Hello Joseph"). Everyone else keeps their usual label.
function greetName(f) {
  const acc = f.staff && f.staff.who && f.staff.who.kind === 'env' ? f.staff.who.account : null;
  if (!acc || acc.role === 'admin') return '';
  const first = String(acc.user || '').trim().split(/[\s._-]+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

module.exports = { APPS, appsFor, sessionFacts, greetName };
