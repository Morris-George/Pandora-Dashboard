// Orders Distribution: upload a shipment invoice, split it to the stores by stock on hand, sell out and store priority,
// then the main warehouse scans each piece and sees how many go to each store.
//   GET  /api/dist                       stores, settings, shipments
//   GET  /api/dist?id=<id>               one shipment (the warehouse does not get costs)
//   POST /api/dist?op=settings  manage   {stores:[{code,name,match,on}], months, target, maxPer}
//   POST /api/dist?op=new       manage   {name, invoice, lines:[[ean, sku, qty, desc, cost, rp, cat, hint]], manual?}
//   POST /api/dist?op=allocate  manage   {id}   stock from ERP now, sell out from the nightly ERP sales, then split
//   POST /api/dist?op=set       manage   {id, sku, alloc:{code:qty}|null}   hand-set split for one SKU (null = back to the suggestion)
//   POST /api/dist?op=status    manage   {id, status: Draft|Final}
//   POST /api/dist?op=scan      warehouse {id, code (EAN or SKU), n: 1|-1}
//   POST /api/dist?op=delete    manage   {id}
// /api/dist is rewritten to /api/erp?dist=1 (vercel.json): the Hobby plan allows 12 functions.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');

const ACCESS = 'ds/access.json';
const SETTINGS = 'ds/settings.json';
const INDEX = 'ds/shipments.json';
const LEVELS = ['none', 'warehouse', 'manage'];
// the stores of the distribution sheet; "match" finds them in ERP warehouse and sales branch names
const DEFAULT_STORES = [
  { code: 'Online', name: 'Online', match: 'online|e-?commerce|website', on: true },
  { code: 'CFC', name: 'Cairo Festival City Mall', match: 'festival|cfc', on: true },
  { code: 'Point', name: 'Point 90', match: 'point', on: true },
  { code: 'MOE', name: 'Mall of Egypt', match: 'mall of egypt|moe', on: true },
  { code: 'MOA', name: 'Mall of Arabia', match: 'mall of arabia|moa', on: true },
  { code: 'Alex', name: 'City Centre Alexandria', match: 'alex', on: true },
  { code: 'Almaza', name: 'City Centre Almaza', match: 'almaza', on: true },
  { code: 'City', name: 'City Stars', match: 'city stars|citystars', on: true }
];
const DEFAULTS = { stores: DEFAULT_STORES, months: 3, target: 2, maxPer: 0 };

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readJSON(req) {
  let b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (!b) { const chunks = []; for await (const c of req) chunks.push(c); b = Buffer.concat(chunks); }
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : b); } catch (_) { return null; }
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
const skuOf = v => str(v, 40).toUpperCase().replace(/\.0$/, '');
const eanOf = v => str(v, 20).replace(/\.0$/, '').replace(/\D/g, '');
const cairoToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
const norm = s => String(s || '').toLowerCase().replace(/\s+-\s+[a-z]{1,5}$/, '').replace(/^pandora\s+/, '').replace(/\s+/g, ' ').trim();

const { keyOf } = require('./_refill');
const isAdmin = who => !!who && who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer;
async function levelFor(who) {
  if (!who) return 'none';
  if (isAdmin(who)) return 'manage';
  const acc = (await store.getJSON(ACCESS)) || {};
  return LEVELS.includes(acc[keyOf(who)]) ? acc[keyOf(who)] : 'none';
}
const nameOf = who => who.kind === 'env' ? String((who.user && who.user.name) || who.account.user || 'Admin') : String((who.user && (who.user.name || who.user.username)) || '');
async function settings() { const s = (await store.getJSON(SETTINGS)) || {}; return { ...DEFAULTS, ...s, stores: Array.isArray(s.stores) && s.stores.length ? s.stores : DEFAULT_STORES }; }
// which store a warehouse or branch name belongs to (first match in the list)
function storeOf(name, stores) {
  const n = norm(name); if (!n) return '';
  if (/sample|main\s*warehouse|transit|damage|defect/.test(n)) return '';
  for (const s of stores) { try { if (new RegExp(s.match || s.code, 'i').test(n)) return s.code; } catch (_) { if (n.includes(String(s.code).toLowerCase())) return s.code; } }
  return '';
}

/* ---------- the split ---------- */
// For one SKU: first a piece to every store with none (store priority first, then the best seller), then piece by piece
// to the store that needs it most (monthly sales × target months − what it has), store priority breaking ties.
function split(qty, stores, soh, sold, months, target, maxPer, hint) {
  const on = stores.filter(s => s.on !== false), out = {};
  on.forEach(s => { out[s.code] = 0; });
  if (!qty || !on.length) return out;
  const h = hint && on.find(s => s.code.toLowerCase() === String(hint).toLowerCase() || norm(s.name) === norm(hint));
  if (h) { out[h.code] = qty; return out; }
  const rank = new Map(on.map((s, i) => [s.code, i]));
  const has = c => Math.max(0, soh[c] || 0) + out[c], mon = c => (sold[c] || 0) / Math.max(1, months), full = c => maxPer > 0 && out[c] >= maxPer;
  let left = qty;
  for (const s of [...on].sort((a, b) => rank.get(a.code) - rank.get(b.code) || (sold[b.code] || 0) - (sold[a.code] || 0))) {
    if (!left) break;
    if (has(s.code) <= 0 && !full(s.code)) { out[s.code]++; left--; }
  }
  while (left > 0) {
    const open = on.filter(s => !full(s.code)); if (!open.length) break;
    open.sort((a, b) => {
      const na = mon(a.code) * target - has(a.code), nb = mon(b.code) * target - has(b.code);
      if (Math.abs(nb - na) > 1e-9) return nb - na;
      if (has(a.code) !== has(b.code)) return has(a.code) - has(b.code);
      return rank.get(a.code) - rank.get(b.code);
    });
    out[open[0].code]++; left--;
  }
  return out;
}
function allocAll(o, st) {
  const alloc = {};
  for (const l of o.lines) {
    const sku = l[1], snap = (o.snap && o.snap[sku]) || { soh: {}, sold: {} };
    alloc[sku] = split(l[2], st.stores, snap.soh, snap.sold, st.months, st.target, st.maxPer, l[7]);
  }
  return alloc;
}

/* ---------- stock and sell out per store ---------- */
async function snapshot(skus, st) {
  const { runReport } = require('./erp');
  const want = new Set(skus), snap = {};
  skus.forEach(s => { snap[s] = { soh: {}, sold: {} }; });
  const d = cairoToday();
  let list;
  try { list = await runReport('Branches Stock Balance', { company: process.env.ERP_COMPANY || 'All-Niche', from_date: d, to_date: d, item_group: 'Pandora', valuation_field_type: 'Currency' }); }
  catch (_) { list = await runReport('Branches Stock Balance', { from_date: d, to_date: d }); }
  const unknownWh = {};
  for (const x of list) {
    const s = skuOf(x.sku || x['sku-item'] || x.item_code); if (!want.has(s)) continue;
    const c = storeOf(x.warehouse, st.stores), q = num(x.bal_qty != null ? x.bal_qty : x.balance_qty);
    if (!c) { const w = str(x.warehouse, 60); if (q) unknownWh[w] = (unknownWh[w] || 0) + q; continue; }
    snap[s].soh[c] = (snap[s].soh[c] || 0) + q;
  }
  // sell out: the nightly ERP sales files (dash/f/erp-YYYY-MM.json), last full months plus this one
  const months = Math.max(1, st.months), keys = [];
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  for (let k = 0; k <= months; k++) { const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); keys.push('erp-' + t.toISOString().slice(0, 7)); }
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate())).toISOString().slice(0, 10);
  const unknownBr = {};
  for (const id of keys) {
    const f = await store.getJSON('dash/f/' + id + '.json'); if (!f || !Array.isArray(f.rows)) continue;
    for (const r of f.rows) {
      if (r[0] < from) continue;
      const s = skuOf(r[5]); if (!want.has(s)) continue;
      const c = storeOf(r[7], st.stores);
      if (!c) { unknownBr[r[7]] = (unknownBr[r[7]] || 0) + num(r[2]); continue; }
      snap[s].sold[c] = (snap[s].sold[c] || 0) + num(r[2]);
    }
  }
  return { snap, at: new Date().toISOString(), from, unknownWh, unknownBr };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await levelFor(who);
  if (lvl === 'none') return send(res, 403, { ok: false, error: 'No access to Orders Distribution. Ask the super admin.' });
  const url = new URL(req.url, 'https://x.invalid'), by = nameOf(who), mg = lvl === 'manage';

  if (req.method === 'GET') {
    const st = await settings(), idx = (await store.getJSON(INDEX)) || [];
    const id = url.searchParams.get('id');
    if (!id) return send(res, 200, { ok: true, level: lvl, settings: st, shipments: idx.slice().reverse() });
    if (!/^[a-f0-9]{12}$/.test(id)) return send(res, 404, { ok: false, error: 'Not found.' });
    const o = await store.getJSON('ds/s/' + id + '.json');
    if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
    const alloc = allocAll(o, st);
    for (const [k, v] of Object.entries(o.manual || {})) alloc[k] = v;
    const out = { ...o, alloc };
    if (!mg) { out.lines = o.lines.map(l => [l[0], l[1], l[2], l[3], 0, l[5], l[6], l[7]]); delete out.snap; delete out.diag; }
    return send(res, 200, { ok: true, level: lvl, settings: st, shipment: out });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const op = url.searchParams.get('op'), b = await readJSON(req);
  if (!b) return send(res, 400, { ok: false, error: 'Bad request.' });
  if (op !== 'scan' && !mg) return send(res, 403, { ok: false, error: 'Your access does not allow this.' });

  if (op === 'settings') {
    const cl = (v, lo, hi, d) => { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const stores = (Array.isArray(b.stores) ? b.stores : []).slice(0, 30).map(s => ({ code: str(s.code, 20), name: str(s.name, 60), match: str(s.match, 120), on: s.on !== false })).filter(s => s.code);
    if (!stores.length) return send(res, 400, { ok: false, error: 'Keep at least one store.' });
    for (const s of stores) { try { new RegExp(s.match || s.code, 'i'); } catch (_) { return send(res, 400, { ok: false, error: 'The match text of ' + s.code + ' is not valid.' }); } }
    await store.putJSON(SETTINGS, { stores, months: Math.round(cl(b.months, 1, 12, 3)), target: cl(b.target, 0.5, 12, 2), maxPer: Math.round(cl(b.maxPer, 0, 999, 0)) });
    return send(res, 200, { ok: true });
  }
  const idx = (await store.getJSON(INDEX)) || [];
  if (op === 'new') {
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 5000).map(l => [eanOf(l[0]), skuOf(l[1]), Math.max(0, Math.round(num(l[2]))), str(l[3], 140), num(l[4]), num(l[5]), str(l[6], 40), str(l[7], 40)]).filter(l => l[1] && l[2] > 0);
    if (!lines.length) return send(res, 400, { ok: false, error: 'No lines with a SKU and a quantity.' });
    // the same SKU twice on one invoice: added together
    const m = new Map(); for (const l of lines) { const p = m.get(l[1]); if (p) { p[2] += l[2]; if (!p[0]) p[0] = l[0]; } else m.set(l[1], l); }
    const o = { id: crypto.randomBytes(6).toString('hex'), name: str(b.name, 80) || 'Shipment', invoice: str(b.invoice, 60), status: 'Draft', at: new Date().toISOString(), by,
      lines: [...m.values()], manual: {}, scans: {}, snap: {}, log: [{ at: new Date().toISOString(), by, what: 'Uploaded ' + m.size + ' SKUs' }] };
    if (b.manual && typeof b.manual === 'object') for (const [k, v] of Object.entries(b.manual)) { const s = skuOf(k); if (m.has(s) && v && typeof v === 'object') { const a = {}; for (const [c, q] of Object.entries(v)) a[str(c, 20)] = Math.max(0, Math.round(num(q))); o.manual[s] = a; } }
    await store.putJSON('ds/s/' + o.id + '.json', o);
    idx.push({ id: o.id, name: o.name, invoice: o.invoice, status: o.status, at: o.at, skus: o.lines.length, pcs: o.lines.reduce((a, l) => a + l[2], 0) });
    await store.putJSON(INDEX, idx);
    return send(res, 200, { ok: true, id: o.id });
  }
  if (!/^[a-f0-9]{12}$/.test(b.id || '')) return send(res, 400, { ok: false, error: 'Pick a shipment.' });
  const key = 'ds/s/' + b.id + '.json', o = await store.getJSON(key);
  if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
  const log = what => { o.log.push({ at: new Date().toISOString(), by, what }); if (o.log.length > 1000) o.log = o.log.slice(-1000); };
  const saveIdx = async () => { const i = idx.find(x => x.id === o.id); if (i) { i.status = o.status; i.name = o.name; } await store.putJSON(INDEX, idx); };

  if (op === 'delete') { await store.del(key); await store.putJSON(INDEX, idx.filter(x => x.id !== b.id)); return send(res, 200, { ok: true }); }
  if (op === 'scan') {
    // the warehouse scans a piece: count it against the invoice (EAN or SKU)
    const c = str(b.code, 40), e = eanOf(c), s = skuOf(c);
    const l = o.lines.find(x => (e && x[0] === e) || x[1] === s);
    if (!l) return send(res, 404, { ok: false, error: 'Not on this shipment: ' + c });
    const n = b.n === -1 ? -1 : b.n === 0 ? 0 : 1;
    o.scans = o.scans || {};
    o.scans[l[1]] = Math.max(0, (o.scans[l[1]] || 0) + n);
    if (n) log((n > 0 ? 'Scanned ' : 'Unscanned ') + l[1]);
    await store.putJSON(key, o);
    return send(res, 200, { ok: true, sku: l[1], scanned: o.scans[l[1]] });
  }
  if (o.status === 'Final' && !(op === 'status' && b.status === 'Draft')) return send(res, 400, { ok: false, error: 'This shipment is final. Reopen it first.' });
  if (op === 'allocate') {
    const st = await settings();
    try { const r = await snapshot(o.lines.map(l => l[1]), st); o.snap = r.snap; o.diag = { at: r.at, from: r.from, months: st.months, unknownWh: r.unknownWh, unknownBr: r.unknownBr }; }
    catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 300) }); }
    log('Stock and sell out refreshed from ERP');
    await store.putJSON(key, o);
    return send(res, 200, { ok: true });
  }
  if (op === 'set') {
    const s = skuOf(b.sku); if (!o.lines.some(l => l[1] === s)) return send(res, 404, { ok: false, error: 'Not on this shipment.' });
    if (b.alloc == null) delete o.manual[s];
    else { const a = {}; for (const [c, q] of Object.entries(b.alloc)) a[str(c, 20)] = Math.max(0, Math.round(num(q))); o.manual[s] = a; }
    log('Split changed by hand: ' + s);
    await store.putJSON(key, o);
    return send(res, 200, { ok: true });
  }
  if (op === 'status') {
    if (!['Draft', 'Final'].includes(b.status)) return send(res, 400, { ok: false, error: 'Unknown status.' });
    o.status = b.status; log(b.status === 'Final' ? 'Made final' : 'Reopened');
    await store.putJSON(key, o); await saveIdx();
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { ok: false, error: 'Unknown action.' });
};
module.exports.levelFor = levelFor;
module.exports.LEVELS = LEVELS;
module.exports.ACCESS = ACCESS;
module.exports.split = split;
module.exports.storeOf = storeOf;
module.exports.settings = settings;
