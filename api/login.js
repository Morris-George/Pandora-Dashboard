const { PROJECTS, safeEqual, signingKey, sign, staffAccounts, normName } = require('./_projects');
const users = require('./_users');
const store = require('./_store');
const { stafferCookie } = require('./_auth');
const activity = require('./_activity');

// every sign-in, wrong password and blocked account goes into the Activity log (api/_activity.js); the log can never stop a sign-in
const note = (req, id, ev) => activity.recordFor(req, id, ev).catch(() => {});

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const body = req.body || {};
  const secret = process.env.PANDORA_AUTH_SECRET;
  const accounts = staffAccounts();
  if (!secret || secret.length < 32 || !accounts.length) {
    return res.status(500).json({ ok: false, error: 'Sign-in is not configured. Contact the site administrator.' });
  }
  const typedUser = normName(body.username), typedPass = String(body.password || '').trim();

  // One login for everyone. Every credential set is checked (no early exit), then the account decides what the person can open.
  let matched = null;
  for (const a of accounts) {
    const okUser = safeEqual(typedUser, normName(a.user));
    // an area manager whose password was changed by the super admin signs in with the new one; the Vercel password no longer works
    const custom = okUser && a.role !== 'admin' && store.configured() ? await users.getEnvPw(a.user) : null;
    const okPass = custom ? users.verifyPassword(typedPass, custom.pass) : safeEqual(typedPass, a.pass);
    if (okUser && okPass && !matched) matched = a;
  }

  const cookie = (project, user) => {
    const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
    const payload = Buffer.from(`${user}\n${exp}`).toString('base64url');
    const token = `${payload}.${sign(payload, signingKey(project, secret))}`;
    return `${PROJECTS[project].cookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 60 * 60}`;
  };
  const finish = (cookies, facts) => {
    res.setHeader('Set-Cookie', cookies);
    return res.status(200).json({ ok: true, next: '/' });
  };

  if (matched) {
    if (matched.role !== 'admin' && store.configured() && await users.envOff(matched.user)) {
      await note(req, activity.identFromAccount(matched), { ty: 'fail', a: 'Sign-in blocked', d: 'the account is switched off', co: 600000 });
      return res.status(403).json({ ok: false, error: 'This account is not active. Please contact your manager.' });
    }
    const cookies = [];
    const facts = { dash: false, staff: null };
    cookies.push(cookie('staff', matched.user)); facts.staff = { role: matched.role };
    // area managers can also open Pandora Dashboards, but only see the stores of their zone (enforced in api/uploads.js)
    if (matched.role !== 'admin') facts.dash = true;
    // the super admin can open everything, so the super admin also gets the dashboards session
    if (matched.role === 'admin') { cookies.push(cookie('dashboards', matched.user)); facts.dash = true; }
    await note(req, activity.identFromAccount(matched), { ty: 'login', a: 'Signed in', d: activity.device(req) });
    return finish(cookies, facts);
  }

  // not an admin, a manager or the dashboards user: maybe a sales person with their own account
  const envAcc = accounts.find(a => safeEqual(typedUser, normName(a.user)));
  const isEnvName = !!envAcc;
  const uname = users.normUsername(body.username);
  if (isEnvName || !uname || !store.configured()) {
    users.burn(body.password || '');
    if (envAcc) await note(req, activity.identFromAccount(envAcc), { ty: 'fail', a: 'Wrong password', d: 'wrong password typed', co: 600000 });
    else if (store.configured() && typedUser) await activity.recordAnon(req, { ty: 'fail', a: 'Sign-in with an unknown username', d: activity.mask(body.username), throttle: true });
    return res.status(401).json({ ok: false });
  }
  const rec = await users.getUser(uname);
  if (!rec) { users.burn(body.password || ''); await activity.recordAnon(req, { ty: 'fail', a: 'Sign-in with an unknown username', d: activity.mask(body.username), throttle: true }); return res.status(401).json({ ok: false }); }
  if (rec.lockUntil && rec.lockUntil > Date.now()) {
    await note(req, activity.identFromRec(rec), { ty: 'fail', a: 'Sign-in blocked', d: 'locked after too many wrong passwords', co: 600000 });
    return res.status(429).json({ ok: false, error: 'Too many wrong attempts. Please wait 15 minutes and try again.' });
  }
  if (!users.verifyPassword(body.password || '', rec.pass)) {
    rec.fails = (rec.fails || 0) + 1;
    if (rec.fails >= 8) { rec.fails = 0; rec.lockUntil = Date.now() + 15 * 60 * 1000; }
    await users.putUser(rec);
    await note(req, activity.identFromRec(rec), { ty: 'fail', a: 'Wrong password', d: 'wrong password typed', co: 600000 });
    return res.status(401).json({ ok: false });
  }
  if (rec.status === 'pending') { await note(req, activity.identFromRec(rec), { ty: 'fail', a: 'Sign-in blocked', d: 'the account is waiting for approval', co: 600000 }); return res.status(403).json({ ok: false, error: 'Your account is waiting for approval. You will be able to sign in once it is approved.' }); }
  if (rec.status !== 'active') { await note(req, activity.identFromRec(rec), { ty: 'fail', a: 'Sign-in blocked', d: 'the account is switched off', co: 600000 }); return res.status(403).json({ ok: false, error: 'This account is not active. Please contact your manager.' }); }
  if (rec.fails) { rec.fails = 0; rec.lockUntil = 0; await users.putUser(rec); }
  await note(req, activity.identFromRec(rec), { ty: 'login', a: 'Signed in', d: activity.device(req) });
  if (rec.role === 'overseer') return finish([stafferCookie(rec.username, secret)], { dash: true, staff: { role: 'admin', overseer: true } });
  if (rec.role === 'stockcount') return finish([stafferCookie(rec.username, secret)], { dash: false, staff: null, vm: false, sc: true });
  if (rec.role === 'hr') return finish([stafferCookie(rec.username, secret)], { dash: false, staff: null, vm: false, sc: false, hr: true });
  if (rec.role === 'vm') return finish([stafferCookie(rec.username, secret)], { dash: false, staff: null, vm: true });
  return finish([stafferCookie(rec.username, secret)], { dash: false, staff: { role: 'staff' } });
};
