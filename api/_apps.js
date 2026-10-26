// What a signed-in person can open. To add a new option later, add one entry to APPS:
// `allow` decides who sees it (by role), `href` is where it opens. The home screen shows whatever this returns.
const { PROJECTS, validSession, readCookie, staffAccounts } = require('./_projects');
const { whoami } = require('./_auth');

// f = { dash: true/false, staff: { role, label, name } | null, vm: true/false, sc: true/false (Stock Count only account) }
const APPS = [
  { id: 'dashboards', title: 'Pandora Dashboards', desc: 'Sales dashboards for the whole business.', href: '/dashboards', allow: f => f.dash },
  { id: 'staff', title: 'Staff Performance', desc: 'How each store and each sales person is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role !== 'staff' && f.staff.role !== 'store' },
  { id: 'uploads', title: 'All Uploads', desc: 'Add, see and remove every document, grouped by where it is used.', href: '/uploads', allow: f => !!f.staff && f.staff.role === 'admin' },
  { id: 'activity', title: 'Activity', desc: 'Who signed in, which pages they opened and what they changed: staff, area managers and the VM.', href: '/activity', allow: f => !!f.activity },
  { id: 'film', title: 'Launch Film', desc: 'A 15-second motion film of the dashboards, to play in a meeting.', href: '/film', allow: f => !!f.staff && f.staff.role === 'admin' },
  { id: 'approvals', title: 'Staff approvals', desc: 'Approve new sales people, reset passwords and manage accounts.', href: '/staff/accounts', allow: f => !!f.staff && f.staff.role === 'admin' && !f.staff.overseer },
  { id: 'access', title: 'Report access', desc: 'Pick a person and see which reports they are allowed to open.', href: '/access', allow: f => !!f.staff && f.staff.role === 'admin' && !f.staff.overseer },
  { id: 'mysales', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'staff' },
  { id: 'storeteam', title: 'My store team', desc: 'How each sales person in your store is doing.', href: '/staff', allow: f => !!f.staff && f.staff.role === 'store' },
  { id: 'mysales2', title: 'My sales', desc: 'What you sold, what sells best for you, and tips to improve.', href: '/staff/me', allow: f => !!f.staff && f.staff.role === 'store' },
  { id: 'daily', title: 'Daily Store Report', desc: 'Add the daily sheet and see sales against target, visitors, conversion and more.', href: '/daily', allow: f => !!f.staff && !(f.staff.who && f.staff.who.info && f.staff.who.info.self && /online|e-?commerce|website/i.test(f.staff.who.info.self.store || '')) },
  { id: 'schedule', title: 'Weekly Schedule', desc: 'Plan who works the Morning, Between and Night shifts each day, with their from and to times.', href: '/schedule', allow: f => !!f.staff && !(f.staff.who && f.staff.who.info && f.staff.who.info.self && /online|e-?commerce|website/i.test(f.staff.who.info.self.store || '')) },
  { id: 'vmzones', title: 'VM Zones', desc: 'Which collection is in which zone of each store, and its effect on sales.', href: '/vm/zones', allow: f => !!f.vm || (!!f.staff && f.staff.role === 'admin') },
  { id: 'zonestock', title: 'Zone Stock', desc: 'What is in each zone of the store: counts, goods received, moves, and sales taken off automatically.', href: '/vm/stock', allow: f => !!f.vm || (!!f.staff && (f.staff.role === 'admin' || f.staff.role === 'store')) },
  { id: 'stock', title: 'Stock balance', desc: 'How many pieces are in stock in each category, store by store, for the dates you pick.', href: '/stock', allow: f => !!f.vm || (!!f.staff && f.staff.role !== 'staff' && f.staff.role !== 'store') },
  { id: 'stockcount', title: 'Stock Count', desc: 'Count a store with scanners or phones and see what matches the ERP stock balance and what differs.', href: '/stockcount', allow: f => !!f.sc || (!!f.staff && f.staff.role === 'admin') },
  { id: 'refill', title: 'Refill Order', desc: 'The suggested refill order to Pandora: stock, pipeline, sell out and budget, with the team feedback.', href: '/refill', allow: f => !!f.refill && f.refill !== 'none' },
  { id: 'slow', title: 'Slow Moving', desc: 'Slow moving items from ERP: where they sit, what they are worth, and what to do with them.', href: '/slow', allow: f => !!f.refill && f.refill !== 'none' },
  { id: 'dist', title: 'Orders Distribution', desc: 'Split a new shipment to the stores by stock, sell out and store priority, and scan it in the warehouse.', href: '/distribution', allow: f => !!f.dist && f.dist !== 'none' },
  { id: 'vm', title: 'VM Report', desc: 'The Visual Merchandiser report.', href: '/vm', allow: f => !!f.vm || (!!f.staff && f.staff.role === 'admin') }
];

function appsFor(f) {
  // area managers open the same Dashboards as the super admin, but the server only sends them the stores of their zone
  const zoneManager = !!f.staff && f.staff.role !== 'admin' && f.staff.role !== 'staff' && f.staff.role !== 'store';
  const hidden = f.hidden || [];
  return APPS.filter(a => a.allow(f) && !hidden.includes(a.id)).map(a => ({ id: a.id, title: a.title, desc: a.id === 'dashboards' && zoneManager ? 'Sales dashboards for the stores in your zone.' : a.id === 'schedule' && f.staff && f.staff.role === 'staff' ? 'See who works the Morning, Between and Night shifts at your store this week.' : a.desc, href: a.href }));
}

// Reports the super admin switched off for one person (Report access page): access/overrides.json = { "<key>": { remove: ["stock", ...] } }.
// The super admin is never affected, so nobody can lock themselves out. Hiding "mysales" also hides its twin "mysales2".
const OVERRIDES = 'access/overrides.json';
async function hiddenFor(who) {
  try {
    if (!who || (who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer)) return [];
    const store = require('./_store');
    if (!store.configured()) return [];
    const all = (await store.getJSON(OVERRIDES)) || {};
    const o = all[require('./_refill').keyOf(who)];
    const ids = o && Array.isArray(o.remove) ? o.remove.slice() : [];
    if (ids.includes('mysales')) ids.push('mysales2');
    return ids;
  } catch (_) { return []; }
}

// What one person (a "who" from api/_auth.js) can open. dashOk = they hold the separate Dashboards session (super admin).
async function factsFromWho(who, dashOk, withOverrides) {
  // area managers open Dashboards with their staff login, limited to their zone by the server (api/uploads.js)
  const dash = !!dashOk || (!!who && who.kind === 'env' && (!!who.info.allow || !!who.info.overseer));
  const vm = !!who && who.kind === 'vm';
  const sc = !!who && who.kind === 'sc';
  const staff = who && !vm && !sc ? { role: who.info.role, label: who.info.label, name: who.kind === 'staff' ? who.user.name : '', overseer: !!who.info.overseer, who } : null;
  const refill = who ? await require('./_refill').levelFor(who) : 'none'; // Refill Order access level, set on Staff approvals
  const dist = who ? await require('./_dist').levelFor(who) : 'none'; // Orders Distribution access level, set on Staff approvals
  const activity = who ? await require('./_activity').canView(who) : false; // the Activity page: super admin, or the Overseer once it is switched on
  const hidden = withOverrides ? await hiddenFor(who) : [];
  return { dash, staff, vm, sc, refill, dist, activity, hidden, vmName: vm || sc ? who.user.name : '' };
}

// Read the cookies of this request: which logins are valid?
async function sessionFacts(req) {
  const secret = process.env.PANDORA_AUTH_SECRET;
  // the super admin has a dashboards session (the old separate dashboards login was removed)
  const tok = readCookie(req, PROJECTS.dashboards.cookie);
  const adminUser = (staffAccounts().find(a => a.role === 'admin') || {}).user;
  const who = await whoami(req);
  return factsFromWho(who, validSession('dashboards', tok, adminUser, secret), true);
}

// Area managers are greeted by first name ("Hello Joseph"). Everyone else keeps their usual label.
function greetName(f) {
  const acc = f.staff && f.staff.who && f.staff.who.kind === 'env' ? f.staff.who.account : null;
  if (acc && acc.overseer) { const n = String((f.staff.who.user || {}).name || '').trim().split(/\s+/)[0]; return n ? 'Mr. ' + n : ''; } // Overseers are greeted "Hello Mr. Ibrahim"
  if (!acc || acc.role === 'admin') return '';
  const first = String(acc.user || '').trim().split(/[\s._-]+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

module.exports = { APPS, appsFor, sessionFacts, factsFromWho, greetName, OVERRIDES };
