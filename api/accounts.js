// Sales person accounts: the super admin approves (and links to the right sales person), switches off or removes them.
const crypto = require('crypto');
const store = require('./_store');
const users = require('./_users');
const { whoami } = require('./_auth');
const { staffAccounts, normName } = require('./_projects');

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (!(who.kind === 'env' && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Only the super admin can manage accounts.' });

  const data = await store.getJSON('data/current.json');
  const people = data ? data.people.map(p => ({ store: data.stores[p[1]], name: p[0] })) : [];

  if (req.method === 'GET') {
    const all = await users.listUsers();
    const taken = new Map(all.filter(u => u.linked && !u.role).map(u => [u.store + '|' + u.name, u.username]));
    const list = all.map(u => ({
      username: u.username, role: u.role || '', storeManager: !!u.storeManager, phone: u.phone, store: u.store, name: u.name, linked: !!u.linked, status: u.status, createdAt: u.createdAt,
      // suggested match from the sales file: same name (and store when it matches)
      suggest: (() => {
        const same = people.filter(p => norm(p.name) === norm(u.name));
        const best = same.find(p => norm(p.store) === norm(u.store)) || (same.length === 1 ? same[0] : null);
        return best ? best.store + '|' + best.name : '';
      })()
    }));
    // people who pressed "forgot my password"
    const resets = [];
    for (const path of await store.list('resets/')) {
      const r = await store.getJSON(path); const u = r && all.find(x => x.username === r.username);
      if (u) resets.push({ username: u.username, name: u.name, store: u.store, phone: u.phone, requestedAt: r.requestedAt });
    }
    resets.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
    list.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const admins = [];
    for (const a of staffAccounts()) admins.push({ username: a.user, role: a.role, label: a.label, off: a.role !== 'admin' && await users.envOff(a.user) });
    return send(res, 200, {
      ok: true, accounts: list, admins, resets, hasData: !!data,
      people: people.map(p => ({ ...p, takenBy: taken.get(p.store + '|' + p.name) || '' })).sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name))
    });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.action === 'createspecial') {
      const name = String(b.name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const uname = users.normUsername(b.username), pw = String(b.password || '').trim();
      if (name.length < 2) return send(res, 400, { ok: false, error: 'Type the person\'s full name.' });
      if (!uname) return send(res, 400, { ok: false, error: 'Username: 3 to 30 letters or numbers (you can use . _ -), no spaces.' });
      if (pw.length < 8 || pw.length > 100) return send(res, 400, { ok: false, error: 'Password must be at least 8 characters.' });
      if (b.role !== 'vm') return send(res, 400, { ok: false, error: 'Unknown account type.' });
      if (staffAccounts().some(a => normName(a.user) === uname) || await users.getUser(uname)) return send(res, 409, { ok: false, error: 'That username is taken. Choose another.' });
      await users.createSpecial({ username: uname, password: pw, name, role: 'vm' });
      return send(res, 200, { ok: true, username: uname });
    }
    if (b.action === 'envdisable' || b.action === 'envenable') {
      // area managers (accounts kept in Vercel settings): switch off / on, same as anyone else. The super admin cannot be switched off.
      const mgr = staffAccounts().find(a => a.role !== 'admin' && normName(a.user) === normName(b.username));
      if (!mgr) return send(res, 404, { ok: false, error: 'Account not found.' });
      await users.setEnvOff(mgr.user, b.action === 'envdisable');
      return send(res, 200, { ok: true });
    }
    if (b.action === 'envsetpassword') {
      // area managers (Joseph, Hassan): the new password is saved here and replaces the one in Vercel settings. The super admin's own password is not changed here.
      const mgr = staffAccounts().find(a => a.role !== 'admin' && normName(a.user) === normName(b.username));
      if (!mgr) return send(res, 404, { ok: false, error: 'Account not found.' });
      let pw = String(b.password || '').trim();
      if (!pw) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; pw = Array.from({ length: 10 }, () => A[crypto.randomInt(A.length)]).join(''); }
      if (pw.length < 8 || pw.length > 100) return send(res, 400, { ok: false, error: 'Password must be at least 8 characters.' });
      await users.setEnvPw(mgr.user, pw);
      return send(res, 200, { ok: true, password: pw });
    }
    const username = users.normUsername(b.username);
    const rec = username ? await users.getUser(username) : null;
    if (!rec) return send(res, 404, { ok: false, error: 'Account not found.' });

    // link to a sales person in the published file
    const doLink = async (st, name) => {
      const p = people.find(x => x.store === st && x.name === name);
      if (!p) return 'Choose a sales person from the list.';
      const owner = await users.claimOwner(st, name);
      if (owner && owner !== rec.username) return 'That sales person already has an account (' + owner + ').';
      await users.linkUser(rec, st, name);
      return '';
    };

    if (b.action === 'link') {
      const err = await doLink(b.store, b.name);
      if (err) return send(res, 400, { ok: false, error: err });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'approve') {
      if (b.store && b.name) { const err = await doLink(b.store, b.name); if (err) return send(res, 400, { ok: false, error: err }); }
      else if (!rec.linked && data) return send(res, 400, { ok: false, error: 'Choose the sales person for this account first.' });
      if (b.storeManager === true && !rec.role) {
        if (!rec.linked) return send(res, 400, { ok: false, error: 'Choose the sales person for this account first, so we know which store they manage.' });
        rec.storeManager = true;
      }
      rec.status = 'active'; rec.fails = 0; rec.lockUntil = 0; await users.putUser(rec);
      return send(res, 200, { ok: true, linked: !!rec.linked });
    }
    if (b.action === 'setmanager') {
      if (rec.role) return send(res, 400, { ok: false, error: 'That account type cannot be a store manager.' });
      if (b.on === true && !rec.linked) return send(res, 400, { ok: false, error: 'Link this account to a sales person first, so we know which store they manage.' });
      if (b.on === true) rec.storeManager = true; else delete rec.storeManager;
      await users.putUser(rec);
      return send(res, 200, { ok: true });
    }
    if (b.action === 'setpassword') {
      // Passwords are stored as one-way hashes, so nobody can look one up. The admin sets a new one (typed, or made here) and gives it to the person.
      let pw = String(b.password || '').trim();
      if (!pw) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; pw = Array.from({ length: 10 }, () => A[crypto.randomInt(A.length)]).join(''); }
      if (pw.length < 8 || pw.length > 100) return send(res, 400, { ok: false, error: 'Password must be at least 8 characters.' });
      rec.pass = users.hashPassword(pw); rec.fails = 0; rec.lockUntil = 0; await users.putUser(rec); await store.del('resets/' + rec.username + '.json');
      return send(res, 200, { ok: true, password: pw });
    }
    if (b.action === 'dismissreset') { await store.del('resets/' + rec.username + '.json'); return send(res, 200, { ok: true }); }
    if (b.action === 'enable') { rec.status = 'active'; rec.fails = 0; rec.lockUntil = 0; await users.putUser(rec); return send(res, 200, { ok: true }); }
    if (b.action === 'disable') { rec.status = 'disabled'; await users.putUser(rec); return send(res, 200, { ok: true }); }
    if (b.action === 'remove') { await users.removeUser(rec); return send(res, 200, { ok: true }); }
    return send(res, 400, { ok: false, error: 'Unknown action.' });
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
