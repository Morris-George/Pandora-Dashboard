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
const GROUPS = 'rf/groups.json'; // ERP item groups left out of the whole analysis (chosen on the page)
const DEFAULT_OUT = ['Pandora Services', 'Pandora Maintenance', 'Miscellaneous accessories', 'Jewellery Boxes - Customer utility', 'Pandora Packaging'];
const groupsOut = async () => { const g = await store.getJSON(GROUPS); return new Set(g && Array.isArray(g.exclude) ? g.exclude : DEFAULT_OUT); };
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
// Pandora only; services, boxes, bags and other packaging are left out of stock, sales and purchases
const groupOf = x => String(pick(x, 'item_group', 'full_group', 'category', 'item_category') || '');
function keepRow(x) {
  const brand = String(x.brand || ''), grp = groupOf(x), name = String(pick(x, 'item_name', 'description') || '');
  if (brand && !/pandora/i.test(brand)) return false;
  return !notJewel(grp, name);
}
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
    // the SKU is in "sku"; "item_code" is ERP's own code (kept to read the Stock Ledger, which only has item_code)
    const soh = {}, code2sku = {}, wh = {}; erp.grp = erp.grp || {};
    let kept = 0;
    for (const x of list) {
      const s = skuOf(pick(x, 'sku', 'sku-item', 'item_code', 'item')); if (!s) continue;
      if (x.item_code) code2sku[skuOf(x.item_code)] = s;
      if (groupOf(x)) erp.grp[s] = groupOf(x).slice(0, 80);
      if (!keepRow(x)) continue;
      const q = num(pick(x, 'bal_qty', 'balance_qty', 'balance'));
      soh[s] = (soh[s] || 0) + q; kept++;
      // where the pieces are: "City Stars - AN" -> "City Stars"
      const w = str(x.warehouse, 60).replace(/\s-\s[A-Za-z]{1,5}$/, '').replace(/^Pandora\s+/i, '') || '?';
      if (q) { const m = wh[s] || (wh[s] = {}); m[w] = (m[w] || 0) + q; }
    }
    erp.code2sku = code2sku; erp.wh = wh;
    erp.diag = Object.assign(erp.diag || {}, { soh: { raw: list.length, kept, keys: list[0] ? Object.keys(list[0]).slice(0, 30) : [] } });
    erp.soh = soh; erp.at.soh = new Date().toISOString(); erp.sohDate = d;
    await store.putJSON(ERP, erp);
    return { skus: Object.keys(soh).length, pcs: Math.round(Object.values(soh).reduce((a, q) => a + q, 0)) };
  }
  if (!/^\d{4}-\d{2}$/.test(b.month || '')) throw new Error('Pick a month.');
  const [from, to] = monthRange(b.month);
  const out = {};
  if (b.what === 'sales') {
    const list = await runReport('Sales Report by Item & SKU', { company: company(), from_date: from, to_date: to, brand: 'Pandora' });
    erp.grp = erp.grp || {};
    for (const x of list) {
      const s = skuOf(pick(x, 'sku-item', 'sku', 'item_code')); if (!s) continue;
      if (groupOf(x)) erp.grp[s] = groupOf(x).slice(0, 80);
      if (!keepRow(x)) continue;
      out[s] = (out[s] || 0) + num(pick(x, 'stock_qty', 'qty'));
    }
    erp.sold[b.month] = out;
    erp.diag = Object.assign(erp.diag || {}, { sales: { month: b.month, raw: list.length, skus: Object.keys(out).length } });
  } else if (b.what === 'buy') {
    // Stock Ledger, purchases only (Purchase Receipt, or a Purchase Invoice that moved stock)
    let list;
    try { list = await runReport('Stock Ledger', { company: company(), from_date: from, to_date: to, item_group: 'Pandora', valuation_field_type: 'Currency' }); }
    catch (_) { list = await runReport('Stock Ledger', { company: company(), from_date: from, to_date: to, valuation_field_type: 'Currency' }); }
    const c2s = erp.code2sku || {}, types = {};
    for (const x of list) {
      const vt = String(x.voucher_type || ''); types[vt] = (types[vt] || 0) + 1;
      if (!/^Purchase (Receipt|Invoice)$/.test(vt)) continue;
      if (!keepRow(x)) continue;
      const code = skuOf(pick(x, 'item_code', 'item')), s = skuOf(x.sku) || c2s[code] || code, q = num(pick(x, 'in_qty', 'actual_qty', 'qty'));
      if (s && q > 0) out[s] = (out[s] || 0) + q;
    }
    erp.buy[b.month] = out;
    erp.diag = Object.assign(erp.diag || {}, { buy: { month: b.month, raw: list.length, skus: Object.keys(out).length, types, keys: list[0] ? Object.keys(list[0]).slice(0, 30) : [] } });
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
const a2r = a => { a[0] = Math.round(a[0]); a[1] = Math.round(a[1]); };
async function joined() {
  const [av, md, pp, sl, erp] = await Promise.all(['avail', 'master', 'pipe', 'slow'].map(k => store.getJSON('rf/files/' + k + '.json')).concat([store.getJSON(ERP)]));
  if (!av) return { items: [], months: [] };
  const M = new Map((md ? md.rows : []).map(r => [r[0], r]));
  const P = new Map(); (pp ? pp.rows : []).forEach(r => P.set(r[0], (P.get(r[0]) || 0) + r[1]));
  const S = new Set((sl ? sl.rows : []).map(r => r[0]));
  const e = erp || { soh: {}, sold: {}, buy: {} };
  const months = Object.keys(e.sold).sort();
  // item: [sku, available, dv, name, cat, sub, launch, fob, rrp, status, inMaster, soh, pipe, slow, [sold per month], [bought per month], ERP item group, [[store, pcs]]]
  const G = (erp && erp.grp) || {}, OUT = await groupsOut();
  const outGroup = s => !!G[s] && OUT.has(G[s]);
  const items = av.rows.filter(([s]) => { const m = M.get(s); return !(m && notJewel(m[3], m[2])) && !(G[s] && notJewel(G[s], '')) && !outGroup(s); }).map(([s, a]) => {
    const m = M.get(s);
    return [s, a, m ? m[1] : s.split('-')[0], m ? m[2] : '', m ? m[3] : '', m ? m[4] : '', m ? m[5] : '', m ? m[6] : 0, m ? m[7] : 0, m ? m[8] : '', m ? 1 : 0,
      Math.round(e.soh[s] || 0), P.get(s) || 0, S.has(s) ? 1 : 0,
      months.map(k => Math.round((e.sold[k] || {})[s] || 0)), months.map(k => Math.round((e.buy[k] || {})[s] || 0)), G[s] || '', Object.entries((e.wh || {})[s] || {}).filter(x => x[1]).map(([w, q]) => [w, Math.round(q)])];
  });
  // selling, but not on the Available to Order list (for information only)
  const avs = new Set(av.rows.map(r => r[0])), off = new Map();
  for (const k of months) for (const [s, q] of Object.entries(e.sold[k] || {})) {
    if (avs.has(s) || q <= 0) continue;
    const m = M.get(s); if (m && notJewel(m[3], m[2])) continue;
    if (G[s] && notJewel(G[s], '')) continue;
    if (outGroup(s)) continue;
    off.set(s, (off.get(s) || 0) + q);
  }
  const notListed = [...off.entries()].filter(([s]) => /^[12357]\d{4,5}/.test(s) && (M.has(s) || !/BAG|BOX|POUCH/i.test(s))).sort((a, b) => b[1] - a[1]).slice(0, 150).map(([s, q]) => [s, (M.get(s) || [])[2] || '', q, Math.round(e.soh[s] || 0)]);
  // every Pandora SKU (not only Available to Order) added up by category, for the sales vs stock comparison:
  // {category: [soh, pipeline, [sold per month]]}. Category from the master, else from the ERP item group.
  const ercat = g => { const l = String(g || '').toLowerCase(); if (l.includes('earring')) return 'Earrings'; if (l.includes(' ring') || /^rings?/.test(l)) return 'Rings'; if (l.includes('bracelet')) return 'Bracelets'; if (l.includes('necklace') || l.includes('pendant')) return 'Necklaces & Pendants'; if (['charm', 'clip', 'dangle', 'medallion', 'spacer'].some(x => l.includes(x))) return 'Charms'; return ''; };
  const all = new Set([...Object.keys(e.soh || {}), ...P.keys()]); months.forEach(k => Object.keys(e.sold[k] || {}).forEach(x => all.add(x)));
  const allCats = {}, skipped = {}, neg = { pcs: 0, skus: 0 };
  // what is not counted, and why (stock pieces + a few SKUs), so the total can be checked against ERP
  const skip = (why, s) => { const k = skipped[why] || (skipped[why] = { pcs: 0, skus: 0, ex: [] }); k.pcs += Math.round(e.soh[s] || 0); k.skus++; if (k.ex.length < 12 && (e.soh[s] || 0)) k.ex.push(s + ' (' + Math.round(e.soh[s]) + (G[s] ? ', ' + G[s] : '') + ')'); };
  for (const s of all) {
    if (outGroup(s)) { skip('Item group left out', s); continue; }
    if (G[s] && notJewel(G[s], '')) { skip('Service, box or bag group', s); continue; }
    if (!/^[12357]\d{4,5}/.test(s)) { skip('Not a Pandora code', s); continue; }
    const m = M.get(s); if (m && notJewel(m[3], m[2])) { skip('Box or bag in the master', s); continue; }
    let c = m && m[3] ? m[3] : ercat(G[s]); if (c === 'Charm') c = 'Charms'; if (!c) { skip('No category (not in the master, ERP group unknown)', s); continue; }
    if ((e.soh[s] || 0) < 0) { neg.pcs += Math.round(e.soh[s]); neg.skus++; }
    const a = allCats[c] || (allCats[c] = [0, 0, months.map(() => 0)]);
    a[0] += e.soh[s] || 0; // net, like ERP: a negative balance lowers the total
    a[1] += P.get(s) || 0;
    months.forEach((k, i) => { a[2][i] += Math.round((e.sold[k] || {})[s] || 0); });
  }
  for (const c in allCats) a2r(allCats[c]);
  return { items, months, notListed, allCats, allSkipped: skipped, allNeg: neg, allSohRaw: Math.round(Object.values(e.soh || {}).reduce((a, q) => a + q, 0)), sohDate: e.sohDate || '', boughtMonths: Object.keys(e.buy || {}).sort() };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await levelFor(who);
  const url = new URL(req.url, 'https://x.invalid');
  const picReq = req.method === 'GET' && (url.searchParams.get('img') || url.searchParams.get('pics'));
  if (lvl === 'none' && !(picReq && await require('./_dist').levelFor(who) !== 'none')) return send(res, 403, { ok: false, error: 'No access to Refill Order. Ask the super admin.' });
  const by = nameOf(who);

  if (req.method === 'GET' && url.searchParams.get('img')) {
    // the picture saved on the item in ERP, for a design with no picture anywhere else (ERP files need the API key, so it comes through here)
    const dv = skuOf(url.searchParams.get('img'));
    if (!/^[A-Z0-9_]{4,20}$/.test(dv) || !process.env.ERP_URL) return res.status(404).end();
    const base = String(process.env.ERP_URL).replace(/\/+$/, ''), auth = { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}` };
    const cache = (await store.getJSON('rf/erpimg.json')) || {};
    const why = url.searchParams.get('why') === '1', log = [];
    try {
      let path = cache[dv];
      if (why || path === undefined || (path === '' && !(cache['@' + dv] > Date.now() - 864e5))) {
        const erp = (await store.getJSON(ERP)) || {};
        const codes = Object.entries(erp.code2sku || {}).filter(([, sku]) => sku === dv || sku.startsWith(dv + '-')).map(([c]) => c).slice(0, 6);
        path = '';
        log.push('ERP item codes for this design: ' + (codes.join(', ') || 'none known (press Sync from ERP), trying ' + dv));
        for (const c of codes.length ? codes : [dv]) {
          const r = await fetch(base + '/api/resource/Item/' + encodeURIComponent(c), { headers: auth, signal: AbortSignal.timeout(8000) });
          if (!r.ok) { log.push(c + ': ERP answered ' + r.status); continue; }
          const d = (await r.json()).data || {};
          const im = d.image || d.website_image || d.thumbnail;
          log.push(c + ': picture ' + (im || 'none'));
          if (im) { path = String(im); break; }
        }
        cache[dv] = path; cache['@' + dv] = Date.now(); await store.putJSON('rf/erpimg.json', cache);
      }
      if (!path) return why ? send(res, 200, { ok: true, dv, erp: log }) : res.status(404).end();
      const url2 = /^https?:/.test(path) ? path : base + (path.startsWith('/') ? '' : '/') + path;
      const r = await fetch(url2, { headers: url2.startsWith(base) ? auth : {}, signal: AbortSignal.timeout(10000) });
      const type = r.headers.get('content-type') || '';
      if (why) {
        // and what the site gives for the same design
        let site = '';
        try { const r2 = await fetch('https://pandoraeg.com/search/suggest.json?q=' + encodeURIComponent(dv) + '&resources[type]=product&resources[limit]=4', { signal: AbortSignal.timeout(8000) }); site = r2.status + ' ' + (await r2.text()).slice(0, 300); } catch (e) { site = String(e.message || e); }
        return send(res, 200, { ok: true, dv, erp: log, file: url2, fileAnswer: r.status + ' ' + type, site });
      }
      if (!r.ok || !/^image\//.test(type)) return res.status(404).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3e6) return res.status(404).end();
      res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'private, max-age=604800'); res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).end(buf);
    } catch (e) { return why ? send(res, 200, { ok: false, dv, erp: log, error: String(e.message || e) }) : res.status(404).end(); }
  }
  if (req.method === 'GET' && url.searchParams.get('pics')) {
    // pictures the page could not find: search pandoraeg.com for each design (that search cannot be called from the browser)
    const want = [...new Set(url.searchParams.get('pics').split(',').map(d => skuOf(d)).filter(d => /^[A-Z0-9_]{4,20}$/.test(d)))].slice(0, 40);
    const cache = (await store.getJSON('rf/webpics.json')) || {};
    let changed = false;
    await Promise.all(want.filter(d => !cache[d] && !(cache['@' + d] > Date.now() - 864e5)).map(async d => {
      try {
        const r = await fetch('https://pandoraeg.com/search/suggest.json?q=' + encodeURIComponent(d) + '&resources[type]=product&resources[limit]=4', { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        const l = (j.resources && j.resources.results && j.resources.results.products) || [];
        const hit = l.find(x => String(x.handle || x.url || '').toLowerCase().includes(d.toLowerCase()));
        const u = hit && (hit.image || (hit.featured_image && hit.featured_image.url)) || '';
        cache[d] = /^https?:/.test(u) || u.startsWith('//') ? u : ''; cache['@' + d] = Date.now(); changed = true;
      } catch (_) {}
    }));
    if (changed) await store.putJSON('rf/webpics.json', cache);
    const out = {}; want.forEach(d => { if (cache[d]) out[d] = cache[d]; });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).json({ ok: true, map: out });
  }
  if (req.method === 'GET') {
    const id = url.searchParams.get('order');
    if (id) {
      if (!/^[a-f0-9]{12}$/.test(id)) return send(res, 404, { ok: false, error: 'Not found.' });
      const o = await store.getJSON('rf/orders/' + id + '.json');
      if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
      const idx0 = (await store.getJSON(ORDERS)) || [], at = idx0.findIndex(x => x.id === id);
      let prev = null;
      for (let k = at - 1; k >= 0 && !prev; k--) {
        const po = await store.getJSON('rf/orders/' + idx0[k].id + '.json');
        if (po) prev = { name: po.name, status: po.status, at: (po.approved && po.approved.at) || po.createdAt,
          // [sku, proposed, final] — the approved copy, or (not approved) the team's numbers only
          lines: po.approved ? po.approved.lines.map(l => [l[0], l[1], l[2]]) : Object.entries(po.fb || {}).map(([k2, q]) => [k2, null, q]) };
      }
      return send(res, 200, { ok: true, level: lvl, today: cairoToday(), order: o, prev, ...(await joined()) });
    }
    const erp = (await store.getJSON(ERP)) || { at: {}, sold: {}, buy: {} };
    return send(res, 200, {
      ok: true, level: lvl, me: by, today: cairoToday(), files: await fileList(),
      erp: { diag: lvl === 'manage' ? erp.diag || null : null, at: erp.at || {}, sold: Object.keys(erp.sold || {}).sort(), buy: Object.keys(erp.buy || {}).sort(), sohDate: erp.sohDate || '' },
      erpOn: !!(process.env.ERP_URL && process.env.ERP_API_KEY && process.env.ERP_API_SECRET),
      orders: ((await store.getJSON(ORDERS)) || []).slice().reverse(),
      groups: (() => { const c = {}; for (const g of Object.values(erp.grp || {})) c[g] = (c[g] || 0) + 1; return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0])); })(),
      groupsOut: [...(await groupsOut())]
    });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const op = url.searchParams.get('op');
  const b = await readJSON(req) || {};
  const need = { groups: 'manage', file: 'manage', sync: 'manage', new: 'manage', settings: 'manage', delete: 'manage', fb: 'input', status: 'input' }[op];
  if (!need) return send(res, 400, { ok: false, error: 'Unknown action.' });
  if (!atLeast(lvl, need)) return send(res, 403, { ok: false, error: 'Your access does not allow this.' });

  if (op === 'groups') {
    if (!Array.isArray(b.exclude) || b.exclude.length > 500) return send(res, 400, { ok: false, error: 'Bad list.' });
    await store.putJSON(GROUPS, { exclude: [...new Set(b.exclude.map(g => str(g, 80)).filter(Boolean))], by, at: new Date().toISOString() });
    return send(res, 200, { ok: true });
  }
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
      settings: prev ? prev.settings : { pm: 6, lt: 2, cv: 3, mq: 1, nm: 9, budget: 150000 }, stop: prev ? prev.stop : [], stopSub: prev ? prev.stopSub || [] : [],
      fb: {}, notes: {}, reasons: {}, log: [{ at: new Date().toISOString(), by, what: 'Created' }]
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
    o.settings = { pm: cl(s.pm, 1, 24, 6), lt: cl(s.lt, 0, 12, 2), cv: cl(s.cv, 0, 24, 3), mq: Math.round(cl(s.mq, 1, 1000, 1)), nm: cl(s.nm, 0, 36, 9), budget: Math.round(cl(s.budget, 0, 1e8, 0) * 100) / 100,
      tw: Math.round(cl(s.tw, 0, 100, 60)), season: !!s.season, abc: !!s.abc, ca: cl(s.ca, 0, 24, 4), cb: cl(s.cb, 0, 24, 3), cc: cl(s.cc, 0, 24, 2) };
    o.stop = Array.isArray(b.stop) ? b.stop.map(c => str(c, 40)).filter(Boolean).slice(0, 30) : o.stop;
    o.stopSub = Array.isArray(b.stopSub) ? b.stopSub.map(c => str(c, 80)).filter(Boolean).slice(0, 60) : (o.stopSub || []);
    log('Settings changed');
  } else if (op === 'fb') {
    if (!Array.isArray(b.lines) || b.lines.length > 5000) return send(res, 400, { ok: false, error: 'Bad lines.' });
    let n = 0;
    for (const l of b.lines) {
      const s = skuOf(l[0]); if (!SKU.test(s)) continue;
      if (l[1] === null || l[1] === '' || l[1] === undefined) delete o.fb[s]; else o.fb[s] = Math.max(0, Math.min(100000, Math.round(Number(l[1]) || 0)));
      if (l[2] !== undefined) { const t = str(l[2], 200); if (t) o.notes[s] = t; else delete o.notes[s]; }
      if (l[3] !== undefined) { o.reasons = o.reasons || {}; const t = str(l[3], 40); if (t) o.reasons[s] = t; else delete o.reasons[s]; }
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
