// Daily Store Report: each store's daily sheet (visitors, transactions, pieces, cash, visa, morning, night + the month's target).
// Sales people, store managers, area managers and the super admin add the sheet; the page turns it into dashboards.
//   GET  /api/daily                      what this person may open: stores, months per store, role
//   GET  /api/daily?month=YYYY-MM        the saved sheets of every store this person may see, for that month
//   POST /api/daily?op=save   {store, month, target, weights:{"1":0.03,...}, file, rows:[{d,v,t,q,c,x,m,n}]}
//   POST /api/daily?op=delete {store, month}                 (not sales people)
// Who: super admin = every store; area managers = the stores of their zone; store managers and sales people = their own store.
// Saving a sheet again is safe: days that have numbers replace the saved day, empty days never wipe anything.
// Stored at daily/<store>/<YYYY-MM>.json, reached through api/vm.js (Hobby plan: 12 functions max).
const store = require('./_store');
const { whoami } = require('./_auth');

// the stores of the business, with the loose name match the rest of the site uses
const CANON = [
  { name: 'CC Almaza', rx: /almaza/i, zone: 'cairo' },
  { name: 'City Stars', rx: /city\s*stars/i, zone: 'cairo' },
  { name: 'CFC', rx: /\bcfc\b|festival/i, zone: 'cairo' },
  { name: 'Point 90', rx: /point\s*90/i, zone: 'cairo' },
  { name: 'Mall of Egypt', rx: /mall\s*of\s*egypt/i, zone: 'octalex' },
  { name: 'Mall of Arabia', rx: /arabia/i, zone: 'octalex' },
  { name: 'Alexandria', rx: /alex/i, zone: 'octalex' }
];
const canon = s => { const t = String(s || '').trim(); const c = CANON.find(c => c.rx.test(t)); return c ? c.name : t.replace(/\s+/g, ' ').slice(0, 60); };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let buf;
  if (Buffer.isBuffer(req.body)) buf = req.body;
  else if (typeof req.body === 'string') buf = Buffer.from(req.body);
  else { const ch = []; for await (const c of req) ch.push(c); buf = Buffer.concat(ch); }
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { return null; }
}

// -> {role:'admin'|'area'|'store'|'staff', by, own?, allow?:[regex]} | {code}
async function access(req) {
  const who = await whoami(req);
  if (!who) return { code: 401 };
  if (who.kind === 'env') {
    const by = who.account.label || 'Manager';
    return who.info.role === 'admin' ? { role: 'admin', by } : { role: 'area', by, allow: (who.info.allow || []).map(a => new RegExp(a, 'i')) };
  }
  if (who.kind === 'staff' && who.info.self && who.info.self.store) {
    return { role: who.info.role === 'store' ? 'store' : 'staff', by: who.user.name || 'Staff', own: canon(who.info.self.store) };
  }
  return { code: 403 }; // VM and Stock Count accounts do not use this page
}
const mayStore = (a, name) => {
  const n = canon(name);
  if (!n) return false;
  if (a.role === 'admin') return true;
  if (a.role === 'area') return a.allow.some(rx => rx.test(n));
  return n === a.own;
};

// slug -> {name, months:[]} from the file names
async function overview() {
  const paths = await store.list('daily/');
  const by = new Map();
  for (const p of paths) {
    const m = /^daily\/([a-z0-9-]+)\/(\d{4}-\d{2})\.json$/.exec(p);
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], []);
    by.get(m[1]).push(m[2]);
  }
  const out = [];
  for (const [sl, months] of by) {
    months.sort();
    let name = (CANON.find(c => slug(c.name) === sl) || {}).name;
    if (!name) { const r = await store.getJSON('daily/' + sl + '/' + months[months.length - 1] + '.json'); name = r && r.store; }
    if (name) out.push({ name, months });
  }
  return out;
}

const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= (max || 1e9) ? Math.round(n * 1000) / 1000 : null; };

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const a = await access(req);
  if (a.code === 401) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (a.code) return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');

  if (req.method === 'GET') {
    const ov = (await overview()).filter(s => mayStore(a, s.name));
    const names = new Map();
    if (a.role === 'admin') CANON.forEach(c => names.set(c.name, []));
    else if (a.role === 'area') CANON.filter(c => mayStore(a, c.name)).forEach(c => names.set(c.name, []));
    else names.set(a.own, []);
    ov.forEach(s => names.set(s.name, s.months));
    const stores = [...names.entries()].map(([name, months]) => ({ name, months }));

    const month = url.searchParams.get('month');
    if (!month) return send(res, 200, { ok: true, role: a.role, stores, canDelete: a.role !== 'staff' });
    if (!MONTH.test(month)) return send(res, 400, { ok: false, error: 'Bad month.' });
    const records = [];
    await Promise.all(stores.filter(s => s.months.includes(month)).map(async s => {
      const r = await store.getJSON('daily/' + slug(s.name) + '/' + month + '.json');
      if (r) records.push(r);
    }));
    return send(res, 200, { ok: true, role: a.role, month, records });
  }

  if (req.method === 'POST') {
    const op = url.searchParams.get('op');
    const b = await readBody(req);
    if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'Could not read the data.' });
    const name = canon(b.store), month = String(b.month || '');
    if (!MONTH.test(month)) return send(res, 400, { ok: false, error: 'The month could not be read.' });
    if (!name || !mayStore(a, name) || (a.role === 'admin' && !CANON.some(c => c.name === name) && !(await overview()).some(s => s.name === name))) {
      return send(res, 403, { ok: false, error: 'You can only add sheets for your own store.' });
    }
    const key = 'daily/' + slug(name) + '/' + month + '.json';

    if (op === 'delete') {
      if (a.role === 'staff') return send(res, 403, { ok: false, error: 'Only managers can remove a month.' });
      await store.del(key);
      return send(res, 200, { ok: true });
    }
    if (op !== 'save') return send(res, 400, { ok: false, error: 'Unknown action.' });

    const rowsIn = Array.isArray(b.rows) ? b.rows : null;
    if (!rowsIn || !rowsIn.length || rowsIn.length > 31) return send(res, 400, { ok: false, error: 'The sheet has no days to save.' });
    const old = (await store.getJSON(key)) || { store: name, month, target: 0, weights: null, rows: {} };
    const rows = old.rows || {};
    let saved = 0;
    for (const r of rowsIn) {
      if (!r || !DAY.test(String(r.d || '')) || String(r.d).slice(0, 7) !== month) return send(res, 400, { ok: false, error: 'A day in the sheet is not in ' + month + '.' });
      const v = [r.v, r.t, r.q, r.c, r.x, r.m, r.n].map(x => num(x));
      if (v.some(x => x === null)) return send(res, 400, { ok: false, error: 'A number in the sheet is not valid (' + r.d + ').' });
      const filled = v[1] > 0 || v[3] + v[4] > 0 || v[0] > 0;
      if (!filled) continue; // an empty day never wipes a saved day
      rows[r.d] = v; // [visitors, transactions, pieces, cash, visa, morning, night]
      saved++;
    }
    if (!saved) return send(res, 400, { ok: false, error: 'No day with numbers was found in the sheet.' });
    const target = num(b.target);
    let weights = old.weights;
    if (b.weights && typeof b.weights === 'object') {
      const w = {};
      for (const k of Object.keys(b.weights)) { const n = num(b.weights[k], 1); if (/^\d{1,2}$/.test(k) && +k >= 1 && +k <= 31 && n !== null) w[k] = n; }
      if (Object.keys(w).length) weights = w;
    }
    const at = new Date().toISOString();
    const log = [{ at, by: a.by, file: String(b.file || '').slice(0, 80), days: saved }, ...(old.log || [])].slice(0, 15);
    const rec = { store: name, month, target: target || old.target || 0, weights, rows, updated: { at, by: a.by }, log };
    await store.putJSON(key, rec);
    return send(res, 200, { ok: true, saved, store: name, month });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
module.exports.CANON = CANON;
module.exports.canon = canon;
