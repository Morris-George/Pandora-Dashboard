// VM Zones (reached at /api/vmzones, rewritten to api/vm.js): which collection is merchandised in which zone of each store, and what it did to sales.
// The super admin and the VM account both use it (place collections, draw zones, add floor plans / photos).
//   GET  /api/vmzones                          stores that have sales, plus the caller's role
//   GET  /api/vmzones?store=<name>             layout, placements and the results of every placement
//   GET  /api/vmzones?store=<name>&file=<id>&part=<n>   one piece of an uploaded floor plan / photo / PDF (the page joins the pieces)
//   POST /api/vmzones?op=layout   {store, zones:[{id, x, y, w, h, where}]}   zones are numbered right to left from the entrance
//   POST /api/vmzones?op=place    {store, zone, col, start} or {store, zone, start, list:{name, file, skus, dvs}}
//                                 a whole collection, or the SKUs / DVs of an uploaded Excel list; ends whatever was in that zone the day before
//   POST /api/vmzones?op=unplace  {store, id}                                 removes a placement made by mistake
//   POST /api/vmzones?op=file     {store, name, type, data(base64 piece), part, parts, upload, plan}
//                                 big files come in pieces (each request stays under Vercel's 4.5 MB); plan:true = image shown behind the zones
//   POST /api/vmzones?op=delfile  {store, id}
//   POST /api/vmzones?op=settings {hide:{zone, compare, daily, excel, photos}}   super admin: parts of the page the VM account does not get
// A placement's results are the store's sales of that collection while it sat in the zone (sales are not recorded per zone).
// Money: the super admin gets EGP figures. The VM account gets pieces, UPT, ATV, shares and % changes only, never sales totals.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');
const { dashRows } = require('./_sales');

const MAX_FILE = 25 * 1024 * 1024;
const SETTINGS = 'vmz/settings.json';
const PARTS = ['zone', 'compare', 'daily', 'excel', 'photos']; // what the super admin can hide from the VM account
const MAX_PART = 3500000; // base64 characters per piece
const TYPES = /^(image\/(png|jpeg|webp)|application\/pdf)$/;

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
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const key = st => 'vmz/' + slug(st) + '.json';
const CAT_OPTIONS = ['Earrings', 'Rings']; // product categories offered next to the collections when placing
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(Date.now() + 2 * 3600 * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const addDay = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const r2 = v => Math.round(v * 100) / 100;
const newId = () => crypto.randomBytes(6).toString('hex');

// Default layout: five zones around the floor, entrance at the bottom.
const DEFAULT_ZONES = [
  { x: 54, y: 66, w: 30, h: 22, where: 'Window / entrance right' },
  { x: 75, y: 6, w: 22, h: 56, where: 'Right wall' },
  { x: 36, y: 30, w: 28, h: 24, where: 'Center table' },
  { x: 3, y: 6, w: 22, h: 56, where: 'Left wall' },
  { x: 16, y: 66, w: 30, h: 22, where: 'Window / entrance left' }
];
// Zone numbers run right to left as you face the store from the entrance (entrance = bottom of the plan),
// so #1 is the zone furthest right; zones in the same column count from the entrance inwards.
function numberZones(zones) {
  const s = zones.slice().sort((a, b) => (b.x + b.w / 2) - (a.x + a.w / 2) || (b.y + b.h / 2) - (a.y + a.h / 2));
  s.forEach((z, i) => { z.n = i + 1; });
  return zones;
}
async function load(st) {
  const d = await store.getJSON(key(st));
  if (d) return d;
  return { store: st, zones: numberZones(DEFAULT_ZONES.map((z, i) => ({ id: 'default0000' + (i + 1), ...z }))), placements: [], files: [] };
}

// Daily sales of one store: whole store, per collection and per SKU. Lines without a collection (older Excel uploads)
// borrow it from any ERP line with the same SKU.
async function storeDaily(st) {
  const rows = await dashRows();
  const colBySku = new Map();
  for (const r of rows) if (r[10] && r[5] && !colBySku.has(r[5])) colBySku.set(r[5], r[10]);
  // Earrings and Rings are product categories (not ERP collections): they work as extra options next to the collections
  const catBySku = new Map();
  for (const r of rows) if (r[5] && CAT_OPTIONS.includes(r[8])) catBySku.set(String(r[5]).trim().toUpperCase(), r[8]);
  const days = new Map(), cols = new Set(), branches = new Set(), names = new Map();
  let maxDay = '';
  const cell = () => ({ net: 0, qty: 0, inv: new Set() });
  const add = (c, net, qty, inv) => { c.net += net; c.qty += qty; if (net > 0) c.inv.add(inv); };
  for (const r of rows) {
    const branch = String(r[7] || ''); branches.add(branch);
    if (branch !== st) continue;
    const day = String(r[0] || '').slice(0, 10); if (!isDay(day)) continue;
    if (day > maxDay) maxDay = day;
    let d = days.get(day); if (!d) days.set(day, d = { s: cell(), c: new Map(), k: new Map() });
    const net = Number(r[3]) || 0, qty = Number(r[2]) || 0, inv = String(r[1]);
    add(d.s, net, qty, inv);
    const sku = String(r[5] || '').trim().toUpperCase();
    if (sku) { let k = d.k.get(sku); if (!k) d.k.set(sku, k = cell()); add(k, net, qty, inv); if (!names.has(sku)) names.set(sku, String(r[6] || '')); }
    const col = r[10] || colBySku.get(r[5]);
    if (!col) continue;
    cols.add(col);
    let c = d.c.get(col); if (!c) d.c.set(col, c = cell());
    add(c, net, qty, inv);
  }
  return { days, maxDay, names, colOf: sku => colBySku.get(sku), catOf: sku => catBySku.get(sku),
    collections: [...new Set([...cols, ...CAT_OPTIONS])].sort(), branches: [...branches].filter(Boolean).sort() };
}

// "395078C01-45" -> "395078C01": the design (DV) of a sized SKU
const dvOf = sku => sku.replace(/-[^-]+$/, '');
// "Moments Ring, 54" -> "Moments Ring": the size at the end of an item name is left off
const noSize = n => String(n).replace(/[\s,\-–]*\b\d+(\.\d+)?\s*(cm|mm)?\s*$/i, '').trim() || String(n);
// lower case, letters and digits only, single spaces: "Moments Snake-Chain, 18" -> "moments snake chain 18"
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
// Which sales lines belong to a placement: a whole collection, or a list of SKUs / DVs / names / collections.
// Sizes never matter in VM zones: a listed SKU counts every size of its design, and a listed name or collection
// counts every item whose name contains it (or every item of that collection), whatever the size.
function matcher(p, sd) {
  if (!p.list) return CAT_OPTIONS.includes(p.col) ? sku => sd.catOf(sku) === p.col : sku => sd.colOf(sku) === p.col;
  const skus = new Set(p.list.skus || []), dvs = new Set(p.list.dvs || []);
  for (const s of skus) dvs.add(dvOf(s));
  const names = (p.list.names || []).map(norm).filter(Boolean), nameSet = new Set(names);
  const cache = new Map();
  return sku => {
    if (skus.has(sku) || dvs.has(sku) || dvs.has(dvOf(sku))) return true;
    if (!names.length) return false;
    let v = cache.get(sku);
    if (v === undefined) {
      const hay = ' ' + norm(sd.names.get(sku)) + ' ', col = norm(sd.colOf(sku));
      v = (col && nameSet.has(col)) || names.some(n => hay.includes(' ' + n + ' '));
      cache.set(sku, v);
    }
    return v;
  };
}

// Results of one placement: [start, end) where end is the next placement's start (open = up to the last day with sales).
function placementStats(p, sd, avgStoreDay, money) {
  const last = sd.maxDay;
  const stop = p.end || addDay(today(), 1);
  const hit = matcher(p, sd), byItem = new Map();
  let n = 0, net = 0, qty = 0, inv = 0, sNet = 0, sInv = 0;
  const daily = [];
  for (let d = p.start; d < stop && d <= last; d = addDay(d, 1)) {
    const x = sd.days.get(d); n++;
    const c = { net: 0, qty: 0, inv: new Set() };
    if (x) {
      x.k.forEach((k, sku) => {
        if (!hit(sku)) return;
        c.net += k.net; c.qty += k.qty; k.inv.forEach(i => c.inv.add(i));
        const dv = dvOf(sku); // sizes are not counted apart: every size of a design adds to one line
        const it = byItem.get(dv) || { qty: 0, net: 0, sku }; it.qty += k.qty; it.net += k.net; byItem.set(dv, it);
      });
      sNet += x.s.net; sInv += x.s.inv.size;
    }
    net += c.net; qty += c.qty; inv += c.inv.size;
    daily.push(money ? [d, c.qty, Math.round(c.net)] : [d, c.qty, avgStoreDay ? r2(c.net / avgStoreDay * 100) : 0]);
  }
  // every design that sold (all sizes together), best first: [dv, name, pieces, sales EGP (super admin) or % of the placement's sales]
  const items = [...byItem.entries()].sort((a, b) => b[1].net - a[1].net)
    .map(([dv, it]) => [dv, noSize(sd.names.get(it.sku) || ''), it.qty, money ? Math.round(it.net) : (net ? r2(it.net / net * 100) : 0)]);
  const o = {
    days: n, qty, qtyDay: n ? r2(qty / n) : 0,
    upt: inv ? r2(qty / inv) : 0, atv: inv ? Math.round(net / inv) : 0,
    share: sNet ? r2(net / sNet * 100) : 0,                       // % of the store's sales in those days
    index: n && avgStoreDay ? r2(net / n / avgStoreDay * 100) : 0, // sales per day as % of the store's average day (no money)
    storeIndex: n && avgStoreDay ? r2(sNet / n / avgStoreDay * 100) : 0,
    daily, items
  };
  if (money) Object.assign(o, { net: Math.round(net), netDay: n ? Math.round(net / n) : 0, storeNetDay: n ? Math.round(sNet / n) : 0, invoices: inv, storeInvoices: sInv });
  return o;
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const admin = who.kind === 'env' && who.info.role === 'admin';
  if (!admin && who.kind !== 'vm') return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');
  const by = admin ? 'Super admin' : (who.user && who.user.name) || 'VM';

  if (req.method === 'GET') {
    const st = url.searchParams.get('store');
    const fileId = url.searchParams.get('file');
    const hide = admin ? {} : (((await store.getJSON(SETTINGS)) || {}).hide || {});
    if (st && fileId) {
      if (hide.photos) return res.status(404).end();
      const part = Number(url.searchParams.get('part') || 0);
      if (!/^[a-f0-9]{12}$/.test(fileId) || !(part >= 0 && part < 20)) return res.status(404).end();
      const f = await store.getJSON('vmz/f/' + slug(st) + '-' + fileId + '-' + part + '.json');
      if (!f) return res.status(404).end();
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).end(Buffer.from(f.data, 'base64'));
    }
    if (!st) {
      const sd = await storeDaily('');
      const settings = admin ? (await store.getJSON(SETTINGS)) || { hide: {} } : undefined;
      return send(res, 200, { ok: true, role: admin ? 'admin' : 'vm', stores: sd.branches, hide, settings });
    }
    const [layout, sd] = await Promise.all([load(st), storeDaily(st)]);
    let total = 0; sd.days.forEach(d => { total += d.s.net; });
    const avg = sd.days.size ? total / sd.days.size : 0;
    const placements = layout.placements.slice().sort((a, b) => a.start.localeCompare(b.start))
      .map(p => {
        const stats = placementStats(p, sd, avg, admin);
        if (hide.daily) stats.daily = [];
        // nothing that shows results is open to the VM account: send the placements without them
        return hide.zone && hide.compare && hide.excel ? { ...p, stats: { days: stats.days, daily: [] } } : { ...p, stats };
      });
    return send(res, 200, {
      ok: true, role: admin ? 'admin' : 'vm', store: st, today: today(), lastSalesDay: sd.maxDay,
      collections: sd.collections, zones: layout.zones, files: hide.photos ? [] : layout.files, plan: layout.plan || null, placements, hide
    });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const op = url.searchParams.get('op');
  const b = await readJSON(req);
  if (op === 'settings') {
    if (!admin) return send(res, 403, { ok: false, error: 'Only the super admin can change this.' });
    const hide = {};
    PARTS.forEach(k => { if (b && b.hide && b.hide[k]) hide[k] = true; });
    await store.putJSON(SETTINGS, { hide, at: new Date().toISOString() });
    return send(res, 200, { ok: true, hide });
  }
  if (!b || typeof b.store !== 'string' || !b.store.trim() || b.store.length > 80) return send(res, 400, { ok: false, error: 'Pick a store.' });
  const st = b.store.trim();
  const layout = await load(st);

  if (op === 'layout') {
    if (!Array.isArray(b.zones) || !b.zones.length || b.zones.length > 30) return send(res, 400, { ok: false, error: 'A store needs 1 to 30 zones.' });
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
    const ids = new Set(layout.zones.map(z => z.id));
    const zones = b.zones.map(z => ({
      id: ids.has(z.id) ? z.id : newId(),
      x: clamp(z.x, 0, 95), y: clamp(z.y, 0, 95), w: clamp(z.w, 5, 100), h: clamp(z.h, 5, 100),
      where: String(z.where || '').slice(0, 40)
    }));
    const kept = new Set(zones.map(z => z.id));
    if (layout.placements.some(p => !kept.has(p.zone))) return send(res, 400, { ok: false, error: 'A zone that has placements cannot be removed.' });
    layout.zones = numberZones(zones);
  } else if (op === 'place') {
    const z = layout.zones.find(z => z.id === b.zone);
    let col = String(b.col || '').trim().slice(0, 60), list = null;
    if (b.list) { // a list of SKUs / DVs / item names / collection names (typed or from Excel) instead of one whole collection
      const codes = v => Array.isArray(v) ? [...new Set(v.map(x => String(x || '').trim().toUpperCase()).filter(x => /^[A-Z0-9][A-Z0-9\-_.]{1,39}$/.test(x)))] : [];
      const names = v => Array.isArray(v) ? [...new Set(v.map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(x => x.length >= 2))] : [];
      list = { file: String(b.list.file || '').slice(0, 100), skus: codes(b.list.skus).slice(0, 5000), dvs: codes(b.list.dvs).slice(0, 5000), names: names(b.list.names).slice(0, 300) };
      if (!list.skus.length && !list.dvs.length && !list.names.length) return send(res, 400, { ok: false, error: 'No SKU, DV, name or collection was found.' });
      col = String(b.list.name || list.file || list.names.slice(0, 3).join(', ') || 'SKU list').trim().slice(0, 60);
    }
    if (!z || !col || !isDay(b.start)) return send(res, 400, { ok: false, error: 'Pick a zone, a collection and a start date.' });
    const inZone = layout.placements.filter(p => p.zone === z.id);
    if (inZone.some(p => p.start >= b.start)) return send(res, 400, { ok: false, error: 'This zone already has a placement on or after that date. Remove it first.' });
    const cur = inZone.find(p => !p.end);
    if (cur && !list && !cur.list && cur.col === col) return send(res, 400, { ok: false, error: col + ' is already in this zone.' });
    if (cur) cur.end = b.start;
    layout.placements.push({ id: newId(), zone: z.id, col, ...(list ? { list } : {}), start: b.start, end: null, by, at: new Date().toISOString() });
  } else if (op === 'unplace') {
    const p = layout.placements.find(p => p.id === b.id);
    if (!p) return send(res, 404, { ok: false, error: 'Not found.' });
    layout.placements = layout.placements.filter(x => x !== p);
    // the placement before it in the same zone runs on again
    const prev = layout.placements.filter(x => x.zone === p.zone && x.end === p.start)[0];
    if (prev) prev.end = p.end;
  } else if (op === 'file') {
    if (!admin && (((await store.getJSON(SETTINGS)) || {}).hide || {}).photos) return send(res, 403, { ok: false, error: 'Floor plans and photos are switched off for this account.' });
    const type = String(b.type || ''), name = String(b.name || 'file').slice(0, 100);
    if (!TYPES.test(type)) return send(res, 400, { ok: false, error: 'Use a PDF, JPG, PNG or WEBP file.' });
    const data = String(b.data || ''), part = Number(b.part) || 0, parts = Number(b.parts) || 1;
    if (!data || data.length > MAX_PART || !/^[A-Za-z0-9+/=]+$/.test(data)) return send(res, 400, { ok: false, error: 'Bad file piece.' });
    if (!(parts >= 1 && parts <= Math.ceil(MAX_FILE * 4 / 3 / MAX_PART) + 1) || !(part >= 0 && part < parts)) return send(res, 400, { ok: false, error: 'Files must be under 25 MB.' });
    if (layout.files.length >= 40) return send(res, 400, { ok: false, error: 'Too many files for this store. Remove one first.' });
    const id = part === 0 ? newId() : String(b.upload || '');
    if (!/^[a-f0-9]{12}$/.test(id)) return send(res, 400, { ok: false, error: 'Bad upload.' });
    await store.putJSON('vmz/f/' + slug(st) + '-' + id + '-' + part + '.json', { data });
    if (part < parts - 1) return send(res, 200, { ok: true, upload: id }); // more pieces to come; the file is listed after the last one
    const size = Math.min(MAX_FILE, Math.max(0, Number(b.size) || 0));
    layout.files.push({ id, name, type, size, parts, by, at: new Date().toISOString() });
    if (b.plan && type.startsWith('image/')) layout.plan = id;
  } else if (op === 'delfile') {
    if (!layout.files.some(f => f.id === b.id)) return send(res, 404, { ok: false, error: 'Not found.' });
    const f = layout.files.find(f => f.id === b.id);
    for (let i = 0; i < (f.parts || 1); i++) await store.del('vmz/f/' + slug(st) + '-' + b.id + '-' + i + '.json');
    layout.files = layout.files.filter(f => f.id !== b.id);
    if (layout.plan === b.id) layout.plan = null;
  } else if (op === 'plan') {
    const f = layout.files.find(f => f.id === b.id);
    layout.plan = f && f.type.startsWith('image/') ? f.id : null;
  } else {
    return send(res, 400, { ok: false, error: 'Unknown action.' });
  }
  layout.store = st;
  await store.putJSON(key(st), layout);
  return send(res, 200, { ok: true });
};
// shared with the zone stock page (api/_zonestock.js)
Object.assign(module.exports, { load, storeDaily, slug, readJSON, send, today });
