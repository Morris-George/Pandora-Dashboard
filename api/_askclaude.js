// Ask Claude inbox: owner only (the super admin account named by ASK_CLAUDE_OWNER, default "morris").
// The owner saves a request from the chat; a scheduled Claude task, holding ASK_CLAUDE_KEY, reads the waiting ones, looks the figures up
// with the same lookups the free assistant uses, and saves the answer back. Anyone else gets a plain 404, the same as a page that is not there.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');
const { normName } = require('./_projects');

const PRE = 'askclaude/r/';
const MAX_WAITING = 5, KEEP = 40;

const owner = () => normName(process.env.ASK_CLAUDE_OWNER || 'morris');
// The env-secret super admin login only: a stored user record that happens to be called "morris" does not count.
function isOwner(who) {
  return !!(who && who.kind === 'env' && !who.user && !who.viewAs && who.account && who.account.role === 'admin' && !who.account.overseer && normName(who.account.user) === owner());
}
function keyOk(req) {
  const k = process.env.ASK_CLAUDE_KEY || '', h = String(req.headers['x-claude-key'] || '');
  if (k.length < 24 || !h) return false;
  const a = crypto.createHash('sha256').update(k).digest(), b = crypto.createHash('sha256').update(h).digest();
  return crypto.timingSafeEqual(a, b);
}
const none = res => { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); };
const out = (res, code, obj) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); return res.status(code).json(obj); };
function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  return b && typeof b === 'object' ? b : null;
}
async function all() {
  const names = await store.list(PRE);
  const rs = await Promise.all(names.map(n => store.getJSON(n).catch(() => null)));
  return rs.filter(r => r && r.id).sort((a, b) => b.at - a.at);
}
const clean = (t, n) => String(t == null ? '' : t).replace(/\u0000/g, '').trim().slice(0, n);
// an answer is plain text plus, optionally, a few bars and a small table. Nothing else is stored, so the page can never be handed markup.
function cleanAnswer(a) {
  a = a && typeof a === 'object' ? a : {};
  const bars = (Array.isArray(a.bars) ? a.bars : []).slice(0, 12).map(b => ({ label: clean(b && b.label, 60), value: Number(b && b.value) || 0, show: clean(b && b.show, 30) })).filter(b => b.label);
  const table = a.table && Array.isArray(a.table.rows) ? { head: (Array.isArray(a.table.head) ? a.table.head : []).slice(0, 6).map(x => clean(x, 40)), rows: a.table.rows.slice(0, 30).map(r => (Array.isArray(r) ? r : []).slice(0, 6).map(x => clean(x, 60))) } : null;
  return { text: clean(a.text, 6000), bars, table, title: clean(a.title, 90) };
}

module.exports = async function handler(req, res) {
  const q = new URL(req.url, 'https://x.invalid').searchParams;
  if (!store.configured()) return none(res);
  const m = String(req.method || 'GET').toUpperCase();

  // ---- the scheduled Claude task (a secret key, no login) ----
  const act = q.get('claude');
  if (act) {
    if (!keyOk(req)) return none(res);
    try {
      if (act === 'pending' && m === 'GET') {
        const rs = (await all()).filter(r => r.status === 'waiting').reverse();
        return out(res, 200, { ok: true, requests: rs.map(r => ({ id: r.id, question: r.q, asked: new Date(r.at).toISOString() })) });
      }
      if (act === 'lookup' && m === 'POST') {
        const b = body(req), text = clean(b && b.q, 800);
        if (!text) return out(res, 400, { ok: false, error: 'q is empty' });
        const r = await require('./_assistant').lookup(text);
        return out(res, 200, { ok: true, text: r.text, panels: (r.panels || []).slice(0, 4) });
      }
      if (act === 'answer' && m === 'POST') {
        const b = body(req), id = clean(b && b.id, 40);
        if (!/^[a-z0-9]+$/.test(id)) return out(res, 400, { ok: false, error: 'bad id' });
        const rec = await store.getJSON(PRE + id + '.json').catch(() => null);
        if (!rec) return out(res, 404, { ok: false, error: 'no such request' });
        rec.ans = cleanAnswer(b.answer); rec.ans.at = Date.now();
        if (!rec.ans.text) return out(res, 400, { ok: false, error: 'the answer has no text' });
        rec.status = 'done'; rec.seen = false;
        await store.putJSON(PRE + id + '.json', rec);
        return out(res, 200, { ok: true });
      }
    } catch (e) { return out(res, 500, { ok: false, error: String((e && e.message) || e).slice(0, 160) }); }
    return none(res);
  }

  // ---- the owner, from the chat ----
  const who = await whoami(req);
  if (!isOwner(who)) return none(res);
  try {
    if (m === 'GET') {
      const rs = await all();
      if (q.get('seen')) { // the chat has shown these answers
        for (const r of rs) if (r.status === 'done' && !r.seen) { r.seen = true; await store.putJSON(PRE + r.id + '.json', r); }
        return out(res, 200, { ok: true });
      }
      return out(res, 200, { ok: true, items: rs.slice(0, KEEP).map(r => ({ id: r.id, q: r.q, at: r.at, status: r.status, seen: !!r.seen, ans: r.ans || null })) });
    }
    if (m === 'POST') {
      const b = body(req), text = clean(b && b.q, 800);
      if (!text) return out(res, 400, { ok: false, error: 'Type your request first.' });
      const rs = await all();
      if (rs.filter(r => r.status === 'waiting').length >= MAX_WAITING) return out(res, 429, { ok: false, error: 'You already have ' + MAX_WAITING + ' waiting. Let Claude answer some first.' });
      const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      await store.putJSON(PRE + id + '.json', { id, q: text, at: Date.now(), status: 'waiting', seen: false });
      for (const r of rs.slice(KEEP - 1)) await store.del(PRE + r.id + '.json'); // old ones go
      return out(res, 200, { ok: true, id });
    }
  } catch (e) { return out(res, 500, { ok: false, error: 'Could not save. Try again.' }); }
  return none(res);
};
module.exports.isOwner = isOwner;
