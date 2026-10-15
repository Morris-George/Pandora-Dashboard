// Sales person accounts: the super admin approves, disables or removes them.
const store = require('./_store');
const users = require('./_users');
const { whoami } = require('./_auth');

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'env' && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Only the super admin can manage accounts.' });

  if (req.method === 'GET') {
    const list = (await users.listUsers()).map(u => ({
      username: u.username, phone: u.phone, store: u.store, name: u.name, status: u.status, createdAt: u.createdAt
    }));
    list.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return send(res, 200, { ok: true, accounts: list });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    const username = users.normUsername(b.username);
    const rec = username ? await users.getUser(username) : null;
    if (!rec) return send(res, 404, { ok: false, error: 'Account not found.' });
    if (b.action === 'approve' || b.action === 'enable') { rec.status = 'active'; rec.fails = 0; rec.lockUntil = 0; await users.putUser(rec); }
    else if (b.action === 'disable') { rec.status = 'disabled'; await users.putUser(rec); }
    else if (b.action === 'remove') { await users.removeUser(rec); }
    else return send(res, 400, { ok: false, error: 'Unknown action.' });
    return send(res, 200, { ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
