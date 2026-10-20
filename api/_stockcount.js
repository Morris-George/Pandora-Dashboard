// Stock Count: the shared database behind the Stock Count page (/stockcount). Super admin only.
// Reached at /api/stockcount (rewritten to /api/vm?stockcount=1 in vercel.json, so it is not one more function: Hobby allows 12).
// Same small document API the standalone Stock Count site used (ops: ping, get, set, update, list, sync), kept in the
// private store (api/_store.js) instead of Redis, so nothing extra has to be set up.
//
// Storage layout (private store):
//   sc/d/<path>.<t>.json   one document, t = milliseconds when it was written (older versions are removed after a write)
//   sc/ver.json            {v}  changes on every write; devices poll this one small file and only read more when it changed
const store = require('./_store');
const { whoami } = require('./_auth');
const pair = require('./_pair');

const OVERLAP = 8000; // a collection read goes back this far, so a slow write that lands late is still seen

const okPath = p => typeof p === 'string' && p.length < 200 && /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(p);
const docKey = (p, t) => 'sc/d/' + p + '.' + t + '.json';
const NAME = /^sc\/d\/(.+)\.(\d{10,})\.json$/;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(code).json(obj);
}

// every stored version of documents whose path starts with `prefix`  ->  [{path, t, key}]
async function versions(prefix) {
  const keys = await store.list('sc/d/' + prefix);
  const out = [];
  for (const k of keys) {
    const m = NAME.exec(k);
    if (m) out.push({ path: m[1], t: Number(m[2]), key: k });
  }
  return out;
}

async function readDoc(path) {
  const vs = (await versions(path + '.')).filter(v => v.path === path).sort((a, b) => b.t - a.t);
  for (const v of vs) {
    const o = await store.getJSON(v.key);
    if (o) return { t: v.t, d: o.d };
  }
  return null;
}

async function readColl(path, since) {
  const parent = path + '/';
  const latest = new Map();
  for (const v of await versions(parent)) {
    const id = v.path.slice(parent.length);
    if (!id || id.includes('/') || v.t < since) continue;
    if (!latest.has(id) || latest.get(id).t < v.t) latest.set(id, v);
  }
  const out = await Promise.all([...latest.entries()].map(async ([id, v]) => {
    const o = await store.getJSON(v.key);
    return o ? { id, t: v.t, d: o.d } : null;
  }));
  return out.filter(Boolean).sort((a, b) => a.t - b.t);
}

async function bump() {
  await store.putJSON('sc/ver.json', { v: Date.now() + '-' + Math.random().toString(36).slice(2, 6) });
}
async function currentVer() {
  const o = await store.getJSON('sc/ver.json');
  return o ? o.v : 0;
}

async function writeDoc(path, data) {
  const t = Date.now();
  await store.putJSON(docKey(path, t), { d: data });
  // drop the older versions of this document (best effort: a leftover is harmless, readers take the newest)
  try {
    for (const v of await versions(path + '.')) if (v.path === path && v.t < t) await store.del(v.key);
  } catch (_) {}
  await bump();
  return t;
}

module.exports = async function handler(req, res) {
  const who = await whoami(req);
  const isAdmin = !!who && who.kind === 'env' && who.info.role === 'admin';
  // a phone paired from the super admin's screen may use the count too (see api/_pair.js), but never make pairing links
  const paired = !isAdmin && pair.hasPair(req);
  const counter = !!who && who.kind === 'sc'; // a Stock Count only account
  if (!isAdmin && !paired && !counter) {
    if (!who) return send(res, 401, { error: 'Please sign in again.' });
    return send(res, 403, { error: 'You do not have access to Stock Count.' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!store.configured()) return send(res, 503, { error: 'storage not configured' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  b = b || {};
  try {
    switch (b.op) {
      case 'ping':
        return send(res, 200, { ok: true });
      case 'pair': {
        if (!isAdmin) return send(res, 403, { error: 'Only the super admin can pair a phone.' });
        const secret = process.env.PANDORA_AUTH_SECRET;
        if (!secret || secret.length < 32) return send(res, 503, { error: 'not configured' });
        return send(res, 200, { token: pair.makeToken(secret) });
      }
      case 'get': {
        if (!okPath(b.path)) return send(res, 400, { error: 'bad path' });
        const o = await readDoc(b.path);
        return send(res, 200, { exists: !!o, d: o ? o.d : null, t: o ? o.t : 0 });
      }
      case 'set': {
        if (!okPath(b.path)) return send(res, 400, { error: 'bad path' });
        if (JSON.stringify(b.data || {}).length > 900000) return send(res, 413, { error: 'too large' });
        return send(res, 200, { t: await writeDoc(b.path, b.data || {}) });
      }
      case 'update': {
        if (!okPath(b.path)) return send(res, 400, { error: 'bad path' });
        const cur = ((await readDoc(b.path)) || {}).d || {};
        return send(res, 200, { t: await writeDoc(b.path, Object.assign({}, cur, b.data || {})) });
      }
      case 'list': {
        if (!okPath(b.path)) return send(res, 400, { error: 'bad path' });
        return send(res, 200, { docs: await readColl(b.path, 0) });
      }
      case 'sync': {
        const subs = Array.isArray(b.subs) ? b.subs.slice(0, 12) : [];
        const ver = await currentVer();
        if (String(ver) === String(b.ver)) return send(res, 200, { same: true, ver });
        const out = [];
        for (const s of subs) {
          if (!s || !okPath(s.path)) { out.push({}); continue; }
          if (s.k === 'd') {
            const o = await readDoc(s.path);
            out.push({ doc: o ? { t: o.t, d: o.d } : null });
          } else {
            const since = Math.max(0, (Number(s.since) || 0) - OVERLAP);
            out.push({ docs: await readColl(s.path, since) });
          }
        }
        return send(res, 200, { ver, res: out });
      }
      default:
        return send(res, 400, { error: 'unknown op' });
    }
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
};
