// VM reports. The super admin feeds them; the VM account only views them.
// Money never reaches storage: every upload is cleaned on the server, and only item/category/store/date/quantity columns are kept.
//   GET  /api/vm            list of reports (super admin and VM account)
//   GET  /api/vm?id=<id>    one report
//   GET  /api/vm?explorer=<id>  Category explorer data for that report's dates: quantities only, never any amount
//   GET  /api/vm?stores=1&from=YYYY-MM-DD&to=YYYY-MM-DD  UPT and ATV for each store (and all stores) in those dates; nothing about people
//   POST /api/vm            super admin: upload {file, sheets:[{name, columns, rows}]} (gzip or plain JSON)
//   POST /api/vm?op=delete  super admin: {id}
const zlib = require('zlib');
const store = require('./_store');
const { whoami } = require('./_auth');
const ex = require('./_exclude');

const INDEX = 'vm/index.json';
const MAX_CELLS = 400000;
const MAX_REPORTS = 60;

// Keep a column only if it is clearly about where / what / when / how many, and never if it is about money.
const ALLOW = /(^|[^a-z])(store|branch|location|shop|year|month|date|day|week|category|group|class|brand|collection|item|product|sku|code|description|name|material|colou?r|size|qty|quantity|units|pieces|pcs)([^a-z]|$)/i;
const DENY = /(amount|value|revenue|price|vat|tax|cost|margin|profit|gross|net|discount|atv|trx|transaction|invoice|egp|incl|excl|sales\s*(?:amt|amount|value)|turnover|payment)/i;
const keepColumn = name => ALLOW.test(String(name)) && !DENY.test(String(name));

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
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';

// "Sales_QTY_and_Volume_by_category-Jewelry_2026-10-01_2026-10-15_Pandora.xlsx" -> title + period
function describe(file) {
  let n = String(file || 'VM report').replace(/\.[^.]+$/, '');
  let period = '', from = '', to = '';
  const m = n.match(/(\d{4})-(\d{2})-(\d{2})[_\s-]+(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const mo = i => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+i - 1] || m[i];
    period = (m[2] === m[5] && m[1] === m[4]) ? `${+m[3]}–${+m[6]} ${mo(m[2])} ${m[1]}` : `${+m[3]} ${mo(m[2])} ${m[1]} – ${+m[6]} ${mo(m[5])} ${m[4]}`;
    from = `${m[1]}-${m[2]}-${m[3]}`; to = `${m[4]}-${m[5]}-${m[6]}`;
    n = n.replace(m[0], ' ');
  }
  n = n.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' – ').replace(/\s+/g, ' ').replace(/(\s*[–-]\s*)+$/, '').trim();
  return { title: n.slice(0, 80) || 'VM report', period, from, to };
}

function cleanSheet(sh) {
  const keep = [];
  sh.columns.forEach((c, i) => { if (keepColumn(c)) keep.push(i); });
  const dropped = sh.columns.filter((c, i) => !keep.includes(i)).map(String);
  const columns = keep.map(i => String(sh.columns[i] == null ? '' : sh.columns[i]).slice(0, 80));
  const rows = [];
  for (const r of sh.rows) {
    const first = r.find(v => typeof v === 'string' && v.trim());
    if (first && /^(grand\s*)?total/i.test(first.trim())) continue; // total rows are not data
    const out = keep.map(i => { const v = r[i]; return v === undefined ? null : (typeof v === 'string' ? v.slice(0, 120) : v); });
    if (out.some(v => v !== null && v !== '')) rows.push(out);
  }
  const clean = ex.filterTable(rows); rows.length = 0; rows.push(...clean);
  const find = re => columns.findIndex(c => re.test(c));
  const kind = find(/categor|group|class/i) >= 0 && find(/qty|quantity|units|pieces|pcs/i) >= 0 && find(/store|branch|location|shop/i) >= 0 ? 'qty-by-category' : 'table';
  return { columns, rows, dropped, kind };
}

// The dates a report covers. New reports store them; older ones are read back from the period text ("1–15 Oct 2026" or "1 Oct 2026 – 15 Nov 2026"),
// and as a last resort from a date column in the report itself.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
function reportDates(rec) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rec.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(rec.to || '')) return { from: rec.from, to: rec.to };
  const per = String(rec.period || '');
  let m = per.match(/^(\d{1,2})\s*[–-]\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m && MONTHS.includes(m[3].toLowerCase())) { const mo = pad(MONTHS.indexOf(m[3].toLowerCase()) + 1); return { from: `${m[4]}-${mo}-${pad(m[1])}`, to: `${m[4]}-${mo}-${pad(m[2])}` }; }
  m = per.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*[–-]\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m && MONTHS.includes(m[2].toLowerCase()) && MONTHS.includes(m[5].toLowerCase())) {
    return { from: `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`, to: `${m[6]}-${pad(MONTHS.indexOf(m[5].toLowerCase()) + 1)}-${pad(m[4])}` };
  }
  const ci = (rec.columns || []).findIndex(c => /date|day/i.test(String(c)));
  if (ci >= 0) {
    const ds = (rec.rows || []).map(r => String(r[ci] || '').slice(0, 10)).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)).sort();
    if (ds.length) return { from: ds[0], to: ds[ds.length - 1] };
  }
  return null;
}

// Every saved Pandora Dashboards sales line, merged the way the dashboards do it: Laderach left out, a line that is in two files counted once.
// Line: [date, invoice, qty, net, gross, sku, name, branch, category, payment]
async function dashRows() {
  const dash = (await store.getJSON('dash/index.json')) || [];
  const seen = new Set(), out = [];
  for (const f of dash.slice().sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)))) {
    const d = await store.getJSON('dash/f/' + f.id + '.json');
    if (!d || !Array.isArray(d.rows)) continue;
    const mine = [];
    for (const r of d.rows) {
      if (!ex.filterSales([r]).length) continue;
      const k = r[1] + '|' + r[5] + '|' + r[0] + '|' + r[2] + '|' + r[3];
      if (seen.has(k)) continue;
      mine.push([k, r]);
    }
    for (const [k, r] of mine) { seen.add(k); out.push(r); }
  }
  return out;
}

// Category explorer data for one report: the saved sales lines inside the report's dates, reduced to
// branch / category / SKU / name / quantity. Amounts, invoices and payment methods are never copied into the answer.
async function explorerData(rec) {
  const dates = reportDates(rec);
  if (!dates) return { ok: true, noDates: true, rows: [] };
  const agg = new Map();
  for (const r of await dashRows()) {
    const day = String(r[0] || '').slice(0, 10);
    if (day < dates.from || day > dates.to) continue;
    const qty = Number(r[2]); if (!isFinite(qty)) continue;
    const branch = String(r[7] || ''), cat = String(r[8] || ''), sku = String(r[5] || ''), name = String(r[6] || '');
    const key = branch + '\u0001' + cat + '\u0001' + sku + '\u0001' + name;
    const o = agg.get(key); if (o) o[4] += qty; else agg.set(key, [branch, cat, sku, name, qty]);
  }
  return { ok: true, from: dates.from, to: dates.to, rows: [...agg.values()].map(r => [r[0], r[1], r[2], r[3], Math.round(r[4] * 1000) / 1000]) };
}

// Store UPT (pieces per invoice) and ATV (average invoice value, incl. VAT, in EGP) for a date range.
// Only these two averages leave the server: no totals, no invoice counts, and nothing about sales people.
// The online shop is not a store the VM works on, so it is left out of this card, and out of the all-stores figure too.
const ONLINE = /online|e-?commerce|web\s*-?\s*(shop|store|site)/i;
async function storeAverages(from, to) {
  const rows = (await dashRows()).filter(r => !ONLINE.test(String(r[7] || '')));
  const days = rows.map(r => String(r[0] || '').slice(0, 10)).filter(Boolean).sort();
  const min = days[0] || '', max = days[days.length - 1] || '';
  const per = new Map(), all = { inv: new Set(), qty: 0, val: 0 };
  for (const r of rows) {
    const day = String(r[0] || '').slice(0, 10);
    if (day < from || day > to) continue;
    const branch = String(r[7] || 'Unspecified'), qty = Number(r[2]) || 0, gross = Number(r[4]) || 0;
    let o = per.get(branch); if (!o) per.set(branch, o = { inv: new Set(), qty: 0, val: 0 });
    o.qty += qty; o.val += gross; all.qty += qty; all.val += gross;
    if (gross > 0) { const id = branch + '|' + r[1]; o.inv.add(id); all.inv.add(id); }
  }
  const fin = o => { const n = o.inv.size; return { upt: n ? Math.round(o.qty / n * 100) / 100 : 0, atv: n ? Math.round(o.val / n) : 0 }; };
  return { ok: true, min, max, from, to, all: fin(all), stores: [...per.entries()].filter(([, o]) => o.inv.size).map(([branch, o]) => ({ branch, ...fin(o) })).sort((a, b) => a.branch.localeCompare(b.branch)) };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const isAdmin = who.kind === 'env' && who.info.role === 'admin';
  if (!isAdmin && who.kind !== 'vm') return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');

  if (req.method === 'GET') {
    if (url.searchParams.get('stores')) {
      const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if ((from && !ok(from)) || (to && !ok(to))) return send(res, 400, { ok: false, error: 'Bad dates.' });
      return send(res, 200, await storeAverages(from || '0000-01-01', to || '9999-12-31'));
    }
    const xid = url.searchParams.get('explorer');
    if (xid) {
      if (!/^[a-z0-9-]{1,60}$/.test(xid)) return send(res, 400, { ok: false, error: 'Bad id.' });
      const rec = await store.getJSON('vm/r/' + xid + '.json');
      return rec ? send(res, 200, await explorerData(rec)) : send(res, 404, { ok: false, error: 'no-data' });
    }
    const id = url.searchParams.get('id');
    if (id) {
      if (!/^[a-z0-9-]{1,60}$/.test(id)) return send(res, 400, { ok: false, error: 'Bad id.' });
      const d = await store.getJSON('vm/r/' + id + '.json');
      if (d && Array.isArray(d.rows)) d.rows = ex.filterTable(d.rows); // Laderach is left out
      return d ? send(res, 200, d) : send(res, 404, { ok: false, error: 'no-data' });
    }
    return send(res, 200, { ok: true, reports: (await store.getJSON(INDEX)) || [] });
  }

  if (req.method === 'POST') {
    if (!isAdmin) return send(res, 403, { ok: false, error: 'Only the super admin can change the reports.' });
    let idx = (await store.getJSON(INDEX)) || [];

    if (url.searchParams.get('op') === 'delete') {
      let b = req.body; if (Buffer.isBuffer(b)) { try { b = JSON.parse(b.toString('utf8')); } catch (_) { b = null; } }
      const id = b && String(b.id || '');
      if (!id || !/^[a-z0-9-]{1,60}$/.test(id)) return send(res, 400, { ok: false, error: 'Bad id.' });
      await store.del('vm/r/' + id + '.json');
      await store.putJSON(INDEX, idx.filter(r => r.id !== id));
      return send(res, 200, { ok: true });
    }

    let d;
    try {
      let buf = await readBody(req);
      if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { maxOutputLength: 60 * 1024 * 1024 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (_) { return send(res, 400, { ok: false, error: 'Could not read the uploaded data.' }); }
    if (!d || !Array.isArray(d.sheets) || !d.sheets.length) return send(res, 400, { ok: false, error: 'The file has no sheets.' });
    let cells = 0;
    for (const sh of d.sheets) {
      if (!sh || typeof sh.name !== 'string' || !Array.isArray(sh.columns) || !Array.isArray(sh.rows) || sh.rows.some(r => !Array.isArray(r))) return send(res, 400, { ok: false, error: 'A sheet is not valid.' });
      cells += sh.rows.reduce((n, r) => n + r.length, 0);
    }
    if (cells > MAX_CELLS) return send(res, 400, { ok: false, error: 'The file is too large.' });

    const meta = describe(d.file), saved = [], droppedAll = new Set();
    for (const sh of d.sheets) {
      const c = cleanSheet(sh);
      if (!c.columns.length || !c.rows.length) continue;
      c.dropped.forEach(x => droppedAll.add(x));
      const multi = d.sheets.length > 1;
      const title = multi ? meta.title + ' · ' + String(sh.name).slice(0, 40) : meta.title;
      const id = slug(multi ? meta.title + '-' + sh.name : meta.title);
      const rec = { id, title, period: meta.period, from: meta.from, to: meta.to, kind: c.kind, columns: c.columns, rows: c.rows, uploadedAt: new Date().toISOString() };
      await store.putJSON('vm/r/' + id + '.json', rec);
      idx = idx.filter(r => r.id !== id);
      idx.push({ id, title, period: meta.period, kind: c.kind, rows: c.rows.length, uploadedAt: rec.uploadedAt });
      saved.push(id);
    }
    if (!saved.length) return send(res, 400, { ok: false, error: 'Nothing to show was found in that file (no item, category or quantity columns).' });
    if (idx.length > MAX_REPORTS) return send(res, 400, { ok: false, error: 'Too many reports. Remove an old one first.' });
    idx.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    await store.putJSON(INDEX, idx);
    return send(res, 200, { ok: true, reports: saved.length, removed: [...droppedAll] });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
