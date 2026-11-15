// Who may open Smart Reorder (/reorder): the super admins, the overseers, and the people named here (read only).
// A name matches the account's username or full name, ignoring dots, dashes and capitals (ayman.nassif = Ayman Nassif).
const NAMES = ['ayman nassif', 'baher arafa'];
const norm = s => String(s || '').toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
function smartOk(who) {
  if (!who) return false;
  if (who.kind === 'env' && who.info && who.info.role === 'admin') return true; // super admins and overseers
  const u = who.user || {};
  return [u.username, u.name].some(x => NAMES.includes(norm(x)));
}
module.exports = { smartOk, NAMES };
