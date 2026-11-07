// Stock Checker: scans saved on the server by store, by day and by person (reached at /api/checker, rewritten to api/vm.js: the Hobby plan allows 12 functions).
//   GET  /api/checker                                what this person may open: { role, by, own, stores, manager }
//   GET  /api/checker?store=NAME&day=YYYY-MM-DD      one store, one day (default today). Managers get everyone; sales people and QR phones get only their own scans.
//                                                    Managers also get `days`: the last 30 days of that store with totals.
//   GET  /api/checker?overview=1&day=YYYY-MM-DD      managers: every store they may see, that day: people, scans, SKUs, last scan
//   GET  /api/checker?pic=DV&code=BARCODE            the item's picture (pandoraeg.com, else the picture saved on the item in ERP); works for a QR-paired phone too
//   POST /api/checker?op=scan    {store, code, t?, by?}      add one scan (always on its own day: today, or the day the phone scanned it offline)
//   POST /api/checker?op=adj     {store, code, d:1|-1}       plus / minus on an item you already scanned today (+1 adds a scan, -1 removes your latest scan of that item)
//   POST /api/checker?op=verdict {store, day, t, v:'ok'|'swapped'|''}   mark one of YOUR scans
//   POST /api/checker?op=undo    {store}                     remove YOUR last scan of today
//   POST /api/checker?op=reset   {store, day, person}        erase YOUR scans of that day (person omitted); another person ('name') or '*' (the whole store that day) = managers only
// Who: super admin = every store; area managers = the stores of their zone; store managers = their own store; all three are "managers" and see every person.
//      Item names and SKUs come from the ERP stock list (item code = barcode), so every device shows the same name and picture; no catalog needed on the phone.
//      Sales people = their own store, their own scans only. A phone opened from a store's QR code (no login) = that one store, its own scans only.
//      Nobody ever sees another store's scans.
// Stored per day and person at chk/<store slug>/<YYYY-MM-DD>/<person slug>.json = { store, name, day, ev:[{t, c, v}] } so two phones never overwrite each other.
const store = require('./_store');
const { whoami } = require('./_auth');
const pair = require('./_pair');
const { CANON, canon } = require('./_daily');

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EV = 30000; // one person, one store, one day (a full store count is about 7,000 scans)
const COOLDOWN_MS = 900; // the page keeps 2 seconds; the server only stops obvious double posts
const cairoDay = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); // YYYY-MM-DD in Cairo time

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
const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const cleanCode = v => { const c = String(v || '').trim(); return /^[A-Za-z0-9._\-\/ ]{1,40}$/.test(c) ? c : ''; };
const firstName = u => { const f = String(u || '').trim().split(/[\s._-]+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ''; };

// -> { role:'admin'|'area'|'store'|'staff'|'phone', by, own?, allow? } | { code }
async function access(req) {
  const who = await whoami(req);
  if (who) {
    if (who.kind === 'env') {
      if (who.info.overseer) return { code: 403 }; // the brand manager does not use Stock Checker
      if (who.info.role === 'admin') return { role: 'admin', by: (who.user && who.user.name) || require('./_projects').ADMIN_NAME };
      return { role: 'area', by: firstName(who.account.user) || who.account.label || 'Area manager', allow: (who.info.allow || []).map(a => new RegExp(a, 'i')) };
    }
    if (who.kind === 'staff' && who.info.self && who.info.self.store) {
      if (/online|e-?commerce|website/i.test(who.info.self.store)) return { code: 403 };
      return { role: who.info.role === 'store' ? 'store' : 'staff', by: cleanName(who.user.name) || 'Staff', own: canon(who.info.self.store) };
    }
    return { code: 403 };
  }
  const ps = pair.storeOf(req, 'checker'); // a phone that opened a store's QR code
  if (ps) return { role: 'phone', by: '', own: canon(ps) };
  return { code: 401 };
}
const mayStore = (a, name) => {
  const n = canon(name);
  if (!n) return false;
  if (a.role === 'admin') return true;
  if (a.role === 'area') return a.allow.some(rx => rx.test(n));
  return n === a.own;
};
const storesFor = a => a.role === 'admin' ? CANON.map(c => c.name) : a.role === 'area' ? CANON.map(c => c.name).filter(n => a.allow.some(rx => rx.test(n))) : [a.own];
const manager = a => a.role === 'admin' || a.role === 'area' || a.role === 'store';

const dirOf = (st, day) => 'chk/' + slug(st) + '/' + day + '/';
const pathOf = (st, day, person) => dirOf(st, day) + (slug(person) || 'x') + '.json';

async function readDay(st, day) {
  const paths = (await store.list(dirOf(st, day))).filter(p => /\.json$/.test(p)).slice(0, 80);
  const files = await Promise.all(paths.map(p => store.getJSON(p).catch(() => null)));
  return files.filter(f => f && Array.isArray(f.ev) && f.ev.length);
}

function summarize(files) {
  const skus = new Set(); let scans = 0, last = 0;
  for (const f of files) for (const e of f.ev) { scans++; skus.add(e.c); if (e.t > last) last = e.t; }
  return { people: files.length, scans, skus: skus.size, last };
}

function build(st, day, files, me, mgr) {
  const shown = mgr ? files : files.filter(f => String(f.name).toLowerCase() === String(me).toLowerCase()); // sales people and phones only ever get their own scans
  const people = [], items = new Map(), recent = [];
  let total = 0, mineN = 0;
  const mineSk = new Set(), meLow = String(me || '').toLowerCase();
  for (const f of shown) {
    const skus = new Set();
    let last = 0;
    for (const e of f.ev) {
      total++; skus.add(e.c); if (e.t > last) last = e.t;
      if (String(f.name).toLowerCase() === meLow) { mineN++; mineSk.add(e.c); }
      let o = items.get(e.c); if (!o) items.set(e.c, o = { c: e.c, n: 0, sw: 0, last: 0, by: {} });
      o.n++; if (e.v === 'swapped') o.sw++; if (e.t > o.last) o.last = e.t;
      o.by[f.name] = (o.by[f.name] || 0) + 1;
      recent.push({ name: f.name, c: e.c, t: e.t, v: e.v || '' });
    }
    people.push({ name: f.name, scans: f.ev.length, skus: skus.size, last });
  }
  people.sort((a, b) => b.last - a.last);
  recent.sort((a, b) => b.t - a.t);
  return { store: st, day, total, skus: items.size, mineScans: mineN, mineSkus: mineSk.size, people, items: [...items.values()].sort((a, b) => b.last - a.last).slice(0, 400), recent: recent.slice(0, 40), me: me || '' };
}

// ERP item names read "583050C00-18-5700303037288": the SKU, then the barcode (same reading as the Slow Moving report)
const skuFromName = v => { const m = /^\s*([0-9]{5,6}[A-Z0-9]{0,6}(?:-[A-Z0-9]{1,4})?)(?=-\d{8,14}\b|\s|$)/i.exec(String(v || '')); return m ? m[1].toUpperCase() : ''; };
const eanFromName = v => { const m = /-(\d{8,14})\b/.exec(String(v || '')); return m ? m[1] : ''; };
// ---- barcode -> SKU + name, from the ERP stock list (item code = barcode, item name = SKU, description = product name) ----
let IDX = null, IDX_AT = 0, IDX_P = null;
async function buildIndex() {
  const m = new Map();
  const add = (k, sku, name, ic) => { k = String(k || '').trim().toUpperCase(); if (!k) return; const o = m.get(k); if (!o) m.set(k, { sku: sku || '', name: name || '', ic: ic ? String(ic) : '' }); else { if (!o.sku && sku) o.sku = sku; if (!o.name && name) o.name = name; } };
  try {
    const today = cairoDay(Date.now()), from = today.slice(0, 8) + '01';
    let c = await store.getJSON('stock/r/' + from + '_' + today + '.json').catch(() => null);
    if (!(c && c.rows && c.rows.length)) { const ix = (await store.getJSON('stock/index.json').catch(() => null)) || []; if (ix.length) c = await store.getJSON(ix[ix.length - 1]).catch(() => null); }
    let rows = c && c.rows;
    if (!(rows && rows.length)) { const s = await store.getJSON('stock/current.json').catch(() => null); rows = s && s.rows; }
    for (const r of rows || []) {
      const nm = String(r[1] || '').trim(), name = String(r[9] || '').trim();
      const sku = skuFromName(nm) || skuFromName(r[0]) || nm, ean = eanFromName(nm) || (/^\d{8,14}$/.test(String(r[0]).trim()) ? String(r[0]).trim() : '');
      add(r[0], sku, name, r[0]); add(nm, sku, name, r[0]); add(sku, sku, name, r[0]); if (ean) add(ean, sku, name, r[0]);
    }
    const erp = await store.getJSON('rf/erp.json').catch(() => null); // ERP item code -> SKU, saved by the Refill Order sync
    if (erp && erp.code2sku) for (const k of Object.keys(erp.code2sku)) add(k, erp.code2sku[k], '');
  } catch (_) { /* names and pictures are a bonus: scanning still works without them */ }
  return m;
}
// A barcode that is not in the stock list (out of stock, never stocked here): ask ERP's Item list directly and remember the answer.
const SKU_RX = /\b\d{5,6}[A-Z]\d{2}(?:-[0-9A-Z]+)?\b/, DESIGN_RX = /\b\d{6}(?:-\d{1,3})?\b/;
async function erpLookup(code) {
  const base = String(process.env.ERP_URL || '').replace(/\/+$/, '');
  if (!base || !process.env.ERP_API_KEY) return null;
  const auth = { Authorization: 'token ' + process.env.ERP_API_KEY + ':' + process.env.ERP_API_SECRET, Accept: 'application/json' };
  const f = 'fields=' + encodeURIComponent('["name","item_name","description"]') + '&limit_page_length=1';
  const get = async flt => { try { const r = await fetch(base + '/api/resource/Item?' + f + '&filters=' + encodeURIComponent(JSON.stringify(flt)), { headers: auth, signal: AbortSignal.timeout(6000) }); return r.ok ? ((await r.json()).data || []) : []; } catch (_) { return []; } };
  let l = await get([['Item Barcode', 'barcode', '=', code]]);
  if (!l.length) l = await get([['name', '=', code]]);
  if (!l.length) l = await get([['item_name', 'like', '%-' + code]]);
  if (!l.length) return null;
  const x = l[0], nm = String(x.item_name || '').trim(), dc = String(x.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const sku = skuFromName(nm) || skuFromName(x.name) || (SKU_RX.exec(dc) || [''])[0].toUpperCase();
  return { sku, name: dc || (nm !== sku && nm !== (sku + '-' + code) ? nm : ''), ic: String(x.name || '') };
}
async function itemInfo(codes) {
  if (!IDX || Date.now() - IDX_AT > 10 * 60 * 1000) {
    if (!IDX_P) IDX_P = buildIndex().then(m => { if (m.size || !IDX) { IDX = m; IDX_AT = Date.now(); } return IDX; }).finally(() => { IDX_P = null; });
    await IDX_P;
  }
  const out = {};
  const miss = [];
  for (const c of codes) { const o = IDX && IDX.get(String(c).trim().toUpperCase()); if (o && (o.sku || o.name)) out[c] = o; else miss.push(c); }
  if (miss.length) { // not in stock: earlier ERP answers are kept (a miss for a day), new ones are asked now (a few at a time)
    const memo = (await store.getJSON('chk/items.json').catch(() => null)) || {};
    const ask = [];
    for (const c of miss) {
      const m = memo[c];
      if (m && m.sku) out[c] = m; else if (!(m && m.at > Date.now() - 864e5)) ask.push(c);
    }
    const got = await Promise.all(ask.slice(0, 6).map(c => erpLookup(c).catch(() => null)));
    let changed = false;
    ask.slice(0, 6).forEach((c, i) => { memo[c] = got[i] ? { ...got[i], at: Date.now() } : { at: Date.now() }; changed = true; if (got[i] && (got[i].sku || got[i].name)) out[c] = got[i]; });
    if (changed) { const ks = Object.keys(memo); if (ks.length > 3000) ks.slice(0, 500).forEach(k => delete memo[k]); await store.putJSON('chk/items.json', memo).catch(() => {}); }
  }
  return out;
}
const dvOf = v => String(v || '').trim().toUpperCase().split('-')[0];

// The pictures already built into the site (private/stockcount-pics-N.js, one JPEG per design) work for any design, in stock or not.
let BUILT = null;
function builtPic(dv) {
  if (!BUILT) {
    BUILT = new Map();
    const fs = require('fs'), path = require('path');
    for (let i = 1; i <= 9; i++) {
      try {
        const t = fs.readFileSync(path.join(__dirname, '..', 'private', 'stockcount-pics-' + i + '.js'), 'utf8');
        const rx = /"([A-Z0-9_]{4,20})":"([A-Za-z0-9+\/=]+)"/g; let m;
        while ((m = rx.exec(t))) BUILT.set(m[1], m[2]);
      } catch (_) { /* that file is not there */ }
    }
  }
  return BUILT.get(dv) || '';
}

// the picture of one item: the full-size pandoraeg.com picture (same as the other reports), then the built-in small one (same source as the other reports), else the picture saved on the item in ERP
async function sendPic(res, dv, code, w) {
  if (!/^[A-Z0-9_]{4,20}$/.test(dv)) return res.status(404).end();
  try {
    const u = await require('./_pic').find(dv);
    if (u) {
      const x = new URL(u); x.searchParams.set('width', String(w || 900)); // full size by default, small (list thumbnails) when the page asks for it
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Location', x.toString());
      return res.status(302).end();
    }
  } catch (_) { /* try the built-in picture */ }
  const b64 = builtPic(dv); // small, only when the full-size picture cannot be found
  if (b64) { res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=3600'); res.setHeader('X-Content-Type-Options', 'nosniff'); return res.status(200).end(Buffer.from(b64, 'base64')); }
  try {
    const base = String(process.env.ERP_URL || '').replace(/\/+$/, '');
    const known = (await itemInfo([String(code || '').trim()]).catch(() => ({})))[String(code || '').trim()];
    const c = String((known && known.ic) || code || '').trim();
    if (!base || !/^[A-Za-z0-9._\-\/ ]{1,40}$/.test(c)) return res.status(404).end();
    const auth = { Authorization: 'token ' + process.env.ERP_API_KEY + ':' + process.env.ERP_API_SECRET };
    const r0 = await fetch(base + '/api/resource/Item/' + encodeURIComponent(c), { headers: auth, signal: AbortSignal.timeout(8000) });
    if (!r0.ok) return res.status(404).end();
    const d = (await r0.json()).data || {};
    const im = d.image || d.website_image || d.thumbnail;
    if (!im) return res.status(404).end();
    const u2 = /^https?:/.test(im) ? String(im) : base + (String(im).startsWith('/') ? '' : '/') + im;
    const r = await fetch(u2, { headers: u2.startsWith(base) ? auth : {}, signal: AbortSignal.timeout(10000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//.test(type)) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3e6) return res.status(404).end();
    res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(buf);
  } catch (_) { return res.status(404).end(); }
}

const lastDays = (day, n) => { const out = [], base = Date.parse(day + 'T12:00:00Z'); for (let i = 0; i < n; i++) out.push(new Date(base - i * 86400000).toISOString().slice(0, 10)); return out; };

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const a = await access(req);
  if (a.code) return send(res, a.code, { ok: false, error: a.code === 401 ? 'Please sign in again.' : 'You do not have access to Stock Checker.' });
  const url = new URL(req.url, 'https://x.invalid'), q = url.searchParams;
  const today = cairoDay(Date.now());
  const dayQ = DAY.test(q.get('day') || '') ? q.get('day') : today;

  if (req.method === 'GET' && q.get('pic')) return sendPic(res, dvOf(q.get('pic')), q.get('code'), Math.min(900, Math.max(60, Number(q.get('w')) || 900)));

  if (req.method === 'GET') {
    if (q.get('overview')) {
      if (!manager(a)) return send(res, 403, { ok: false, error: 'Only managers can see the overview.' });
      const rows = await Promise.all(storesFor(a).map(async st => ({ name: st, ...summarize(await readDay(st, dayQ)) })));
      return send(res, 200, { ok: true, day: dayQ, today, stores: rows });
    }
    const st = q.get('store');
    if (!st) return send(res, 200, { ok: true, role: a.role, by: a.by, own: a.own || '', stores: storesFor(a), manager: manager(a), today });
    if (!mayStore(a, st)) return send(res, 403, { ok: false, error: 'That is not your store.' });
    const me = a.role === 'phone' ? cleanName(q.get('by')) : a.by;
    const out = build(canon(st), dayQ, await readDay(canon(st), dayQ), me, manager(a));
    const info = await itemInfo(out.items.map(i => i.c));
    for (const it of out.items) { const o = info[it.c]; if (o) { if (o.sku) it.sku = o.sku; if (o.name) it.name = o.name; } }
    if (manager(a) && q.get('days')) { // the last 30 days of this store, for the monitor (asked for now and then, not on every refresh)
      out.days = await Promise.all(lastDays(today, 30).map(async d => ({ day: d, ...summarize(await readDay(canon(st), d)) })));
    }
    return send(res, 200, { ok: true, today, ...out });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }

  const b = await readBody(req);
  if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'Bad request.' });
  const op = q.get('op');
  const st = canon(b.store);
  if (!mayStore(a, st)) return send(res, 403, { ok: false, error: 'That is not your store.' });
  // the person: the signed-in name for logged in people, the typed name for a phone opened from a QR code
  const by = a.role === 'phone' ? cleanName(b.by) : a.by;
  if (!by) return send(res, 400, { ok: false, error: 'Type your name first.' });
  const day = DAY.test(b.day || '') ? b.day : today;

  if (op === 'scan') {
    const c = cleanCode(b.code);
    if (!c) return send(res, 400, { ok: false, error: 'That code could not be read.' });
    const now = Date.now();
    // a phone that was offline sends the time it scanned; it is only trusted when it is recent
    let t = Number(b.t) || now; if (!(t <= now && t > now - 36 * 3600 * 1000)) t = now;
    const d = cairoDay(t);
    const file = pathOf(st, d, by);
    const cur = (await store.getJSON(file).catch(() => null)) || { store: st, name: by, day: d, ev: [] };
    const last = cur.ev[cur.ev.length - 1];
    if (last && now - last.t < COOLDOWN_MS && t >= now - COOLDOWN_MS) return send(res, 429, { ok: false, error: 'cooldown' });
    if (last && t <= last.t) t = last.t + 1;
    cur.store = st; cur.name = by; cur.day = d;
    cur.ev.push({ t, c, v: '' });
    if (cur.ev.length > MAX_EV) cur.ev.splice(0, cur.ev.length - MAX_EV);
    await store.putJSON(file, cur);
    return send(res, 200, { ok: true, t, day: d, mine: cur.ev.filter(e => e.c === c).length });
  }
  if (op === 'adj') {
    // plus / minus on an item the person already scanned: always today's scans, always the person's own file
    const c = cleanCode(b.code);
    if (!c) return send(res, 400, { ok: false, error: 'That code could not be read.' });
    const file = pathOf(st, today, by);
    const cur = (await store.getJSON(file).catch(() => null)) || { store: st, name: by, day: today, ev: [] };
    if (Number(b.d) < 0) {
      let i = -1; for (let k = cur.ev.length - 1; k >= 0; k--) if (cur.ev[k].c === c) { i = k; break; }
      if (i < 0) return send(res, 200, { ok: true, mine: 0, removed: false });
      cur.ev.splice(i, 1);
      if (cur.ev.length) await store.putJSON(file, cur); else await store.del(file);
      return send(res, 200, { ok: true, mine: cur.ev.filter(e => e.c === c).length, removed: true });
    }
    const last = cur.ev[cur.ev.length - 1];
    const t = Math.max(Date.now(), last ? last.t + 1 : 0);
    cur.store = st; cur.name = by; cur.day = today;
    cur.ev.push({ t, c, v: '' });
    if (cur.ev.length > MAX_EV) cur.ev.splice(0, cur.ev.length - MAX_EV);
    await store.putJSON(file, cur);
    return send(res, 200, { ok: true, t, mine: cur.ev.filter(e => e.c === c).length });
  }
  if (op === 'verdict') {
    const file = pathOf(st, day, by);
    const cur = await store.getJSON(file).catch(() => null);
    const e = cur && cur.ev.find(x => x.t === Number(b.t));
    if (!e) return send(res, 404, { ok: false, error: 'That scan was not found.' });
    e.v = b.v === 'ok' || b.v === 'swapped' ? b.v : '';
    await store.putJSON(file, cur);
    return send(res, 200, { ok: true });
  }
  if (op === 'undo') {
    const file = pathOf(st, today, by);
    const cur = await store.getJSON(file).catch(() => null);
    const e = cur && cur.ev.pop();
    if (e) { if (cur.ev.length) await store.putJSON(file, cur); else await store.del(file); }
    return send(res, 200, { ok: true, removed: e ? e.c : '' });
  }
  if (op === 'reset') {
    const person = cleanName(b.person) || by;
    if (b.person === '*' || person.toLowerCase() !== by.toLowerCase()) {
      if (!manager(a)) return send(res, 403, { ok: false, error: 'You can only erase your own scans.' });
      if (b.person === '*') {
        const paths = (await store.list(dirOf(st, day))).filter(p => /\.json$/.test(p));
        for (const p of paths) await store.del(p);
        return send(res, 200, { ok: true, cleared: paths.length });
      }
    }
    await store.del(pathOf(st, day, person));
    return send(res, 200, { ok: true, cleared: 1 });
  }
  return send(res, 400, { ok: false, error: 'Unknown action.' });
};
module.exports.access = access;
