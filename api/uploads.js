// All Uploads: one place (super admin only) to see, add and remove every document, grouped by what it feeds.
//   GET  /api/uploads                          the three groups and their documents
//   GET  /api/uploads?area=dashboards&rows=1   every saved Pandora Dashboards sales line (merged; gzip when large)
//   POST /api/uploads?area=dashboards          add a sales file {file, rows:[{date,invoice,qty,net,gross,sku,name,branch,category,payment}]}
//   POST /api/uploads?op=delete                remove a document {area, id}
// Saved Pandora Dashboards data stays until it is removed here.
// Staff Performance data lives in data/current.json (api/data.js) and VM reports in vm/ (api/vm.js); this file lists and removes them.
const zlib = require('zlib');
const store = require('./_store');
const { whoami } = require('./_auth');
const ex = require('./_exclude');

const DASH_INDEX = 'dash/index.json';
const MAX_ROWS = 600000;
const MAX_FILES = 60;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
const slug = s => String(s || 'file').toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'file';
const iso = v => String(v || '').slice(0, 10);
const num = v => { const n = Number(v); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; };

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const url = new URL(req.url, 'https://x.invalid');
  const area = url.searchParams.get('area') || '';
  const isAdmin = who.kind === 'env' && who.info.role === 'admin';
  // Area managers may only READ the Dashboards sales lines, and only for the stores of their zone.
  const zoneRead = req.method === 'GET' && area === 'dashboards' && !!url.searchParams.get('rows') && who.kind === 'env' && !!who.info.allow;
  if (!isAdmin && !zoneRead) return send(res, 403, { ok: false, error: 'Only the super admin can manage uploads.' });
  const zoneRx = zoneRead ? who.info.allow.map(s => new RegExp(s, 'i')) : null;

  if (req.method === 'GET') {
    const dash = (await store.getJSON(DASH_INDEX)) || [];

    if (area === 'dashboards' && url.searchParams.get('rows')) {
      const seen = new Set(), rows = [];
      for (const f of dash.slice().sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)))) {
        const d = await store.getJSON('dash/f/' + f.id + '.json');
        if (!d || !Array.isArray(d.rows)) continue;
        const mine = [];
        for (const r of d.rows) {
          if (!ex.filterSales([r]).length) continue; // Laderach is left out
          if (zoneRx && !zoneRx.some(x => x.test(String(r[7] || '')))) continue; // area manager: only the stores of their zone
          const k = r[1] + '|' + r[5] + '|' + r[0] + '|' + r[2] + '|' + r[3];
          if (seen.has(k)) continue; // the same line already came from an earlier file
          mine.push(r);
        }
        for (const r of mine) { seen.add(r[1] + '|' + r[5] + '|' + r[0] + '|' + r[2] + '|' + r[3]); rows.push(r); }
      }
      const body = Buffer.from(JSON.stringify({ ok: true, files: dash.map(f => ({ id: f.id, name: f.name })), rows }));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (body.length > 1500000) { res.setHeader('Content-Encoding', 'gzip'); return res.status(200).end(zlib.gzipSync(body)); }
      return res.status(200).end(body);
    }

    const cur = await store.getJSON('data/current.json');
    const vm = (await store.getJSON('vm/index.json')) || [];
    const stock = await store.getJSON('stock/current.json');
    return send(res, 200, {
      ok: true,
      groups: [
        { id: 'dashboards', title: 'Pandora Dashboards', hint: 'Sales export (.xlsx). Saved here until you remove it, and added together if you add more than one.',
          items: dash.slice().sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))).map(f => ({ id: f.id, name: f.name, detail: [f.period, f.rows + ' lines'].filter(Boolean).join(' · '), uploadedAt: f.uploadedAt })) },
        { id: 'staff', title: 'Staff Performance', hint: 'The monthly Query Report (.xlsx or .csv). One month at a time: a new file replaces the old one.',
          items: cur ? [{ id: 'current', name: cur.file || 'Query Report', detail: [cur.period, (cur.rows || []).length + ' rows'].filter(Boolean).join(' · '), uploadedAt: cur.uploadedAt || '' }] : [] },
        { id: 'vm', title: 'VM Report', hint: 'Quantity reports for the Visual Merchandiser (.xlsx). Amounts are removed automatically.',
          items: vm.map(r => ({ id: r.id, name: r.title, detail: [r.period, r.rows + ' lines'].filter(Boolean).join(' · '), uploadedAt: r.uploadedAt })) },
        { id: 'stock', title: 'Stock balance', hint: 'Optional. The Stock balance page reads live from ERP. Add the Branches Stock Balance report (.xlsx) here only as a backup, used if ERP cannot be reached. One file at a time: a new file replaces the old one.',
          items: stock ? [{ id: 'current', name: stock.file || 'Stock balance', detail: (stock.rows || []).length.toLocaleString('en-US') + ' lines · as of ' + (stock.asOf || ''), uploadedAt: stock.uploadedAt || '' }] : [] }
      ]
    });
  }

  if (req.method === 'POST') {
    if (url.searchParams.get('op') === 'delete') {
      let b = req.body; if (Buffer.isBuffer(b)) { try { b = JSON.parse(b.toString('utf8')); } catch (_) { b = null; } }
      const a = b && String(b.area || ''), id = b && String(b.id || '');
      if (!a || !/^[a-z0-9-]{1,60}$/.test(id)) return send(res, 400, { ok: false, error: 'Bad request.' });
      if (a === 'dashboards') {
        await store.del('dash/f/' + id + '.json');
        await store.putJSON(DASH_INDEX, ((await store.getJSON(DASH_INDEX)) || []).filter(f => f.id !== id));
      } else if (a === 'staff') {
        await store.del('data/current.json');
      } else if (a === 'stock') {
        await store.del('stock/current.json');
      } else if (a === 'vm') {
        await store.del('vm/r/' + id + '.json');
        await store.putJSON('vm/index.json', ((await store.getJSON('vm/index.json')) || []).filter(r => r.id !== id));
      } else return send(res, 400, { ok: false, error: 'Bad request.' });
      return send(res, 200, { ok: true });
    }

    if (area !== 'dashboards') return send(res, 400, { ok: false, error: 'Add Staff Performance and VM files with their own upload.' });
    let d;
    try {
      let buf = await readBody(req);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 120 * 1024 * 1024 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (_) { return send(res, 400, { ok: false, error: 'Could not read the uploaded data.' }); }
    if (!d || !Array.isArray(d.rows) || !d.rows.length) return send(res, 400, { ok: false, error: 'No sales lines were found in that file.' });
    if (d.rows.length > MAX_ROWS) return send(res, 400, { ok: false, error: 'The file is too large.' });
    const rows = [];
    for (const r of d.rows) {
      if (!r || !r.date || !r.invoice) continue;
      rows.push([iso(r.date), String(r.invoice).slice(0, 40), num(r.qty), num(r.net), num(r.gross), String(r.sku || '').slice(0, 40), String(r.name || '').slice(0, 120), String(r.branch || '').slice(0, 80), String(r.category || '').slice(0, 60), String(r.payment || '').slice(0, 40)]);
    }
    const kept = ex.filterSales(rows); rows.length = 0; rows.push(...kept);
    if (!rows.length) return send(res, 400, { ok: false, error: 'No valid sales lines were found in that file.' });
    const dates = rows.map(r => r[0]).sort();
    const name = String(d.file || 'Sales file').slice(0, 100);
    const id = slug(name);
    let idx = (await store.getJSON(DASH_INDEX)) || [];
    idx = idx.filter(f => f.id !== id);
    if (idx.length >= MAX_FILES) return send(res, 400, { ok: false, error: 'Too many files. Remove an old one first.' });
    const uploadedAt = new Date().toISOString();
    await store.putJSON('dash/f/' + id + '.json', { rows });
    idx.push({ id, name, period: dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + ' → ' + dates[dates.length - 1], rows: rows.length, uploadedAt });
    await store.putJSON(DASH_INDEX, idx);
    return send(res, 200, { ok: true, id, rows: rows.length });
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
