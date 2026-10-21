// Refill Order: suggests the next order to Pandora from the Available to Order list, the master data, the pipeline,
// the slow moving list and ERP (stock on hand, sell out, purchases). Reached at /api/refill (rewritten to api/erp.js:
// the Hobby plan allows 12 functions).
//   GET  /api/refill                       who I am, my level, the files, the ERP sync state, the orders
//   GET  /api/refill?order=<id>            one order + every Available to Order SKU joined with master / pipeline / slow / ERP
//   POST /api/refill?op=file   manage      {kind: avail|master|pipe|slow, name, rows, part, parts}  (rows already read in the browser)
//   POST /api/refill?op=sync   manage      {what: soh} | {what: sales|buy, month: YYYY-MM}
//   POST /api/refill?op=new    manage      {name}
//   POST /api/refill?op=settings manage    {id, settings, stop}
//   POST /api/refill?op=fb     input       {id, lines: [[sku, qty|null, note]]}
//   POST /api/refill?op=status input/manage {id, status, lines?}  Submitted (input), Approved / Draft (manage); Approved keeps a copy of the lines
//   POST /api/refill?op=delete manage      {id}
// Access levels (set by the super admin on Staff approvals): none, view, input, manage. The super admin is always manage.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');

const ACCESS = 'rf/access.json';
const ERP = 'rf/erp.json';
const ORDERS = 'rf/orders/index.json';
const KINDS = { avail: 'Available to Order', master: 'Master Data', pipe: 'Pipeline', slow: 'Slow Moving' };
const LEVELS = ['none', 'view', 'input', 'manage'];
const SKU = /^[A-Z0-9][A-Z0-9\-_./]{0,39}$/;

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
const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const skuOf = v => str(v, 40).toUpperCase().replace(/\.0$/, '');
const cairoToday = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

// the key a person is known by in the access list
function keyOf(who) {
  if (!who) return '';
  if (who.kind === 'env' && who.user) return 'u:' + who.user.username;          // Overseer
  if (who.kind === 'env') return 'env:' + String(who.account.user || '').toLowerCase();
  return who.user ? 'u:' + who.user.username : '';
}
const isAdmin = who => !!who && who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer;
async function levelFor(who) {
  if (!who) return 'none';
  if (isAdmin(who)) return 'manage';
  const acc = (await store.getJSON(ACCESS)) || {};
  return LEVELS.includes(acc[keyOf(who)]) ? acc[keyOf(who)] : 'none';
}
const atLeast = (lvl, need) => LEVELS.indexOf(lvl) >= LEVELS.indexOf(need);
const nameOf = who => who.user ? (who.user.name || who.user.username) : (who.account && who.account.user) || 'Super admin';

/* ---------- ERP ---------- */
const company = () => process.env.ERP_COMPANY || 'All-Niche';
const monthRange = m => { const [y, mo] = m.split('-').map(Number); const last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return [m + '-01', m + '-' + String(last).padStart(2, '0')]; };
const pick = (x, ...ks) => { for (const k of ks) if (x[k] != null && x[k] !== '') return x[k]; return null; };

async function syncPart(b) {
  const { runReport } = require('./erp');
  const erp = (await store.getJSON(ERP)) || { soh: {}, sold: {}, buy: {}, at: {} };
  if (b.what === 'soh') {
    // every store and warehouse, nothing left out
    const d = cairoToday();
    let list;
    try { list = await runReport('Branches Stock Balance', { company: company(), from_date: d, to_date: d, item_group: 'Pandora', valuation_field_type: 'Currency' }); }
    catch (_) { list = await runReport('Branches Stock Balance', { from_date: d, to_date: d }); }
    const soh = {};
    for (const x of list) { const s = skuOf(pick(x, 'item_code', 'sku', 'item')); if (s) soh[s] = (soh[s] || 0) + num(pick(x, 'bal_qty', 'balance_qty', 'balance')); }
    erp.soh = soh; erp.at.soh = new Date().toISOString(); erp.sohDate = d;
    await store.putJSON(ERP, erp);
    return { skus: Object.keys(soh).length, pcs: Math.round(Object.values(soh).reduce((a, q) => a + q, 0)) };
  }
  if (!/^\d{4}-\d{2}$/.test(b.month || '')) throw new Error('Pick a month.');
  const [from, to] = monthRange(b.month);
  const out = {};
  if (b.what === 'sales') {
    const list = await runReport('Sales Report by Item & SKU', { company: company(), from_date: from, to_date: to, brand: 'Pandora' });
    for (const x of list) { const s = skuOf(pick(x, 'sku-item', 'sku', 'item_code')); if (s) out[s] = (out[s] || 0) + num(pick(x, 'stock_qty', 'qty')); }
    erp.sold[b.month] = out;
  } else if (b.what === 'buy') {
    // Stock Ledger, purchases only (Purchase Receipt, or a Purchase Invoice that moved stock)
    let list;
    try { list = await runReport('Stock Ledger', { company: company(), from_date: from, to_date: to, item_group: 'Pandora', valuation_field_type: 'Currency' }); }
    catch (_) { list = await runReport('Stock Ledger', { company: company(), from_date: from, to_date: to, valuation_field_type: 'Currency' }); }
    for (const x of list) {
      if (!/^Purchase (Receipt|Invoice)$/.test(String(x.voucher_type || ''))) continue;
      const s = skuOf(pick(x, 'item_code', 'sku')), q = num(pick(x, 'in_qty', 'actual_qty', 'qty'));
      if (s && q > 0) out[s] = (out[s] || 0) + q;
    }
    erp.buy[b.month] = out;
  } else throw new Error('Unknown sync.');
  erp.at[b.what + ':' + b.month] = new Date().toISOString();
  await store.putJSON(ERP, erp);
  return { month: b.month, skus: Object.keys(out).length, pcs: Math.round(Object.values(out).reduce((a, q) => a + q, 0)) };
}

/* ---------- files (read in the browser, cleaned again here) ---------- */
function cleanRows(kind, rows) {
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const s = skuOf(r[0]); if (!s || !SKU.test(s)) continue;
    if (kind === 'avail') out.push([s, r[1] === 0 || r[1] === '0' ? 0 : 1]);
    else if (kind === 'slow') out.push([s]);
    else if (kind === 'pipe') out.push([s, Math.max(0, Math.round(num(r[1])))]);
    else out.push([s, skuOf(r[1]), str(r[2], 140), str(r[3], 40), str(r[4], 40), /^\d{4}-\d{2}-\d{2}$/.test(r[5] || '') ? r[5] : '', num(r[6]), num(r[7]), str(r[8], 30)]);
    // master: [sku, dv, name, category, sub category, launch, FOB $, RRP EGP, status]
  }
  return out;
}
async function fileList() {
  const o = {};
  for (const k of Object.keys(KINDS)) { const f = await store.getJSON('rf/files/' + k + '.json'); o[k] = f ? { name: f.name, by: f.by, at: f.at, rows: f.rows.length } : null; }
  return o;
}

/* ---------- the join the page works on ---------- */
// bags, boxes and other packaging are left out of the whole analysis. By category first; by name only for clear packaging words
// ("box chain" is a bracelet, so the word box alone is not enough)
const NOT_JEWEL_CAT = /accessor|packag|bag|box|pouch|consumable|marketing|display|service/i;
const NOT_JEWEL_NAME = /\b(gift|paper|shopping|carrier|tote)\s*bags?\b|\bbags?\b.*\b(small|medium|large|xl)\b|\bjewel(le)?ry\s*box|\bgift\s*box|\bpouch|\bpackaging|\bwrapping|\bribbon\b|\bcleaning\s*(kit|cloth)/i;
const notJewel = (cat, name) => NOT_JEWEL_CAT.test(cat || '') || NOT_JEWEL_NAME.test(name || '');
async function joined() {
  const [av, md, pp, sl, erp] = await Promise.all(['avail', 'master', 'pipe', 'slow'].map(k => store.getJSON('rf/files/' + k + '.json')).concat([store.getJSON(ERP)]));
  if (!av) return { items: [], months: [] };
  const M = new Map((md ? md.rows : []).map(r => [r[0], r]));
  const P = new Map(); (pp ? pp.rows : []).forEach(r => P.set(r[0], (P.get(r[0]) || 0) + r[1]));
  const S = new Set((sl ? sl.rows : []).map(r => r[0]));
  const e = erp || { soh: {}, sold: {}, buy: {} };
  const months = Object.keys(e.sold).sort();
  // item: [sku, available, dv, name, cat, sub, launch, fob, rrp, status, inMaster, soh, pipe, slow, [sold per month], [bought per month]]
  const items = av.rows.filter(([s]) => { const m = M.get(s); return !m || !notJewel(m[3], m[2]); }).map(([s, a]) => {
    const m = M.get(s);
    return [s, a, m ? m[1] : s.split('-')[0], m ? m[2] : '', m ? m[3] : '', m ? m[4] : '', m ? m[5] : '', m ? m[6] : 0, m ? m[7] : 0, m ? m[8] : '', m ? 1 : 0,
      Math.round(e.soh[s] || 0), P.get(s) || 0, S.has(s) ? 1 : 0,
      months.map(k => Math.round((e.sold[k] || {})[s] || 0)), months.map(k => Math.round((e.buy[k] || {})[s] || 0))];
  });
  // selling, but not on the Available to Order list (for information only)
  const avs = new Set(av.rows.map(r => r[0])), off = new Map();
  for (const k of months) for (const [s, q] of Object.entries(e.sold[k] || {})) {
    if (avs.has(s) || q <= 0) continue;
    const m = M.get(s); if (m && notJewel(m[3], m[2])) continue;
    off.set(s, (off.get(s) || 0) + q);
  }
  const notListed = [...off.entries()].filter(([s]) => M.has(s) || !/BAG|BOX|POUCH/i.test(s)).sort((a, b) => b[1] - a[1]).slice(0, 150).map(([s, q]) => [s, (M.get(s) || [])[2] || '', q, Math.round(e.soh[s] || 0)]);
  return { items, months, notListed, sohDate: e.sohDate || '', boughtMonths: Object.keys(e.buy || {}).sort() };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await levelFor(who);
  if (lvl === 'none') return send(res, 403, { ok: false, error: 'No access to Refill Order. Ask the super admin.' });
  const url = new URL(req.url, 'https://x.invalid');
  const by = nameOf(who);

  if (req.method === 'GET') {
    const id = url.searchParams.get('order');
    if (id) {
      if (!/^[a-f0-9]{12}$/.test(id)) return send(res, 404, { ok: false, error: 'Not found.' });
      const o = await store.getJSON('rf/orders/' + id + '.json');
      if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
      return send(res, 200, { ok: true, level: lvl, today: cairoToday(), order: o, ...(await joined()) });
    }
    const erp = (await store.getJSON(ERP)) || { at: {}, sold: {}, buy: {} };
    return send(res, 200, {
      ok: true, level: lvl, me: by, today: cairoToday(), files: await fileList(),
      erp: { at: erp.at || {}, sold: Object.keys(erp.sold || {}).sort(), buy: Object.keys(erp.buy || {}).sort(), sohDate: erp.sohDate || '' },
      erpOn: !!(process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET),
      orders: ((await store.getJSON(ORDERS)) || []).slice().reverse()
    });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const op = url.searchParams.get('op');
  const b = await readJSON(req) || {};
  const need = { file: 'manage', sync: 'manage', new: 'manage', settings: 'manage', delete: 'manage', fb: 'input', status: 'input' }[op];
  if (!need) return send(res, 400, { ok: false, error: 'Unknown action.' });
  if (!atLeast(lvl, need)) return send(res, 403, { ok: false, error: 'Your access does not allow this.' });

  if (op === 'file') {
    if (!KINDS[b.kind]) return send(res, 400, { ok: false, error: 'Unknown file.' });
    const rows = cleanRows(b.kind, b.rows);
    if (!rows) return send(res, 400, { ok: false, error: 'Nothing readable in this file.' });
    const part = Number(b.part) || 0, parts = Number(b.parts) || 1;
    if (!(parts >= 1 && parts <= 20 && part >= 0 && part < parts)) return send(res, 400, { ok: false, error: 'Bad piece.' });
    // big files (the master) come in pieces; they are put together after the last one
    const tmp = 'rf/tmp/' + b.kind + '.json';
    const cur = part === 0 ? { rows: [] } : ((await store.getJSON(tmp)) || { rows: [] });
    cur.rows.push(...rows);
    if (part < parts - 1) { await store.putJSON(tmp, cur); return send(res, 200, { ok: true, more: true }); }
    if (!cur.rows.length) return send(res, 400, { ok: false, error: 'No SKUs found. Check the first column is the SKU.' });
    await store.putJSON('rf/files/' + b.kind + '.json', { name: str(b.name, 120), by, at: new Date().toISOString(), rows: cur.rows });
    if (parts > 1) await store.del(tmp);
    return send(res, 200, { ok: true, rows: cur.rows.length });
  }
  if (op === 'sync') {
    if (!process.env.ERP_URL || !process.env.ERP_API_KEY || !process.env.ERP_API_SECRET) return send(res, 503, { ok: false, error: 'ERP is not connected.' });
    try { return send(res, 200, { ok: true, ...(await syncPart(b)) }); }
    catch (e) { return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 300) }); }
  }

  const idx = (await store.getJSON(ORDERS)) || [];
  if (op === 'new') {
    const name = str(b.name, 60);
    if (name.length < 2) return send(res, 400, { ok: false, error: 'Name the order, for example Nov.26.' });
    const prev = idx.length ? await store.getJSON('rf/orders/' + idx[idx.length - 1].id + '.json') : null;
    const o = {
      id: crypto.randomBytes(6).toString('hex'), name, status: 'Draft', createdAt: new Date().toISOString(), by,
      settings: prev ? prev.settings : { pm: 6, lt: 2, cv: 3, mq: 1, nm: 9, budget: 150000 }, stop: prev ? prev.stop : [],
      fb: {}, notes: {}, log: [{ at: new Date().toISOString(), by, what: 'Created' }]
    };
    await store.putJSON('rf/orders/' + o.id + '.json', o);
    idx.push({ id: o.id, name, status: o.status, at: o.createdAt });
    await store.putJSON(ORDERS, idx);
    return send(res, 200, { ok: true, id: o.id });
  }
  if (!/^[a-f0-9]{12}$/.test(b.id || '')) return send(res, 400, { ok: false, error: 'Pick an order.' });
  const key = 'rf/orders/' + b.id + '.json';
  const o = await store.getJSON(key);
  if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
  const log = what => { o.log.push({ at: new Date().toISOString(), by, what }); if (o.log.length > 500) o.log = o.log.slice(-500); };

  if (op === 'delete') {
    await store.del(key);
    await store.putJSON(ORDERS, idx.filter(x => x.id !== b.id));
    return send(res, 200, { ok: true });
  }
  if (o.status === 'Approved' && !(op === 'status' && b.status === 'Draft')) return send(res, 400, { ok: false, error: 'This order is approved. Reopen it first.' });
  if (op === 'settings') {
    const s = b.settings || {}, cl = (v, lo, hi, d) => { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    o.settings = { pm: cl(s.pm, 1, 24, 6), lt: cl(s.lt, 0, 12, 2), cv: cl(s.cv, 0, 24, 3), mq: Math.round(cl(s.mq, 1, 1000, 1)), nm: cl(s.nm, 0, 36, 9), budget: Math.round(cl(s.budget, 0, 1e8, 0)) };
    o.stop = Array.isArray(b.stop) ? b.stop.map(c => str(c, 40)).filter(Boolean).slice(0, 30) : o.stop;
    log('Settings changed');
  } else if (op === 'fb') {
    if (!Array.isArray(b.lines) || b.lines.length > 5000) return send(res, 400, { ok: false, error: 'Bad lines.' });
    let n = 0;
    for (const l of b.lines) {
      const s = skuOf(l[0]); if (!SKU.test(s)) continue;
      if (l[1] === null || l[1] === '' || l[1] === undefined) delete o.fb[s]; else o.fb[s] = Math.max(0, Math.min(100000, Math.round(Number(l[1]) || 0)));
      if (l[2] !== undefined) { const t = str(l[2], 200); if (t) o.notes[s] = t; else delete o.notes[s]; }
      n++;
    }
    log(n === 1 ? 'Team feedback: ' + skuOf(b.lines[0][0]) : 'Team feedback: ' + n + ' lines');
  } else if (op === 'status') {
    const to = b.status;
    if (to === 'Submitted' && o.status === 'Draft') { /* input or manage */ }
    else if ((to === 'Approved' || to === 'Draft') && atLeast(lvl, 'manage')) { /* manage */ }
    else return send(res, 403, { ok: false, error: 'Your access does not allow this.' });
    if (to === 'Approved') {
      // keep what was approved: [sku, proposed, final, FOB]
      if (!Array.isArray(b.lines) || b.lines.length > 20000) return send(res, 400, { ok: false, error: 'Bad lines.' });
      o.approved = { at: new Date().toISOString(), by, lines: b.lines.filter(l => Array.isArray(l) && SKU.test(skuOf(l[0]))).map(l => [skuOf(l[0]), Math.round(num(l[1])), Math.round(num(l[2])), num(l[3])]) };
    }
    o.status = to; log(to === 'Draft' ? 'Reopened' : to);
    const i = idx.find(x => x.id === o.id); if (i) { i.status = to; await store.putJSON(ORDERS, idx); }
  }
  await store.putJSON(key, o);
  return send(res, 200, { ok: true });
};
module.exports.levelFor = levelFor;
module.exports.keyOf = keyOf;
module.exports.LEVELS = LEVELS;
module.exports.ACCESS = ACCESS;
