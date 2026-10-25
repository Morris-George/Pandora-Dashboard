// Pulls the sales reports straight from ERPNext and saves them where the uploaded Excel files go,
// so the pages read them exactly as if the file had been added on All Uploads.
//   POST /api/erp?month=2026-10          super admin: sync that month now (default: this month)
//   GET  /api/erp                        Vercel cron (Authorization: Bearer CRON_SECRET): sync this month
//   GET  /api/erp?status=1               super admin: when the last sync ran
// Sales Report by Item & SKU  -> Pandora Dashboards (dash/f/erp-YYYY-MM.json)
// Sales Person-wise ... Store -> Staff Performance   (data/current.json)
// Env vars: ERP_URL, ERP_API_KEY, ERP_API_SECRET (read-only ERPNext user), CRON_SECRET; ERP_COMPANY optional (else taken from the sales rows).
const activity = require('./_activity');
const store = require('./_store');
const { whoami } = require('./_auth');
const ex = require('./_exclude');

const DASH_INDEX = 'dash/index.json';
const STATUS = 'erp/status.json';
const SALES_REPORT = 'Sales Report by Item & SKU';
const STAFF_REPORT = 'Sales Person-wise Transaction Summary By Store';

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const num = v => { const n = Number(v); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; };
const iso = v => String(v || '').slice(0, 10);
const pad = n => String(n).padStart(2, '0');

function monthRange(m) {
  const now = new Date(Date.now() + 2 * 3600 * 1000); // Cairo time is close enough for picking the month
  const [y, mo] = /^\d{4}-\d{2}$/.test(m || '') ? m.split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { key: `${y}-${pad(mo)}`, from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(last)}` };
}

// These are Custom Reports with saved filters; are_default_filters:false makes ERPNext use ours instead.
async function runReport(name, filters) {
  const base = String(process.env.ERP_URL || '').replace(/\/+$/, '');
  const r = await fetch(base + '/api/method/frappe.desk.query_report.run', {
    method: 'POST',
    headers: {
      Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ report_name: name, filters, are_default_filters: false }),
    signal: AbortSignal.timeout(50000)
  });
  if (!r.ok) throw new Error(`ERP answered ${r.status} for "${name}"` + (r.status === 401 || r.status === 403 ? ' (check ERP_API_KEY / ERP_API_SECRET and the user roles)' : ''));
  const j = await r.json();
  const rows = (j.message && j.message.result) || [];
  // rows are objects keyed by fieldname; a trailing total row can come as an array
  return rows.filter(x => x && !Array.isArray(x));
}

// Like runReport, but also returns the report's columns (label + fieldname) so a caller can decide which columns to keep.
async function runReportRaw(name, filters) {
  const base = String(process.env.ERP_URL || '').replace(/\/+$/, '');
  const r = await fetch(base + '/api/method/frappe.desk.query_report.run', {
    method: 'POST',
    headers: {
      Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ report_name: name, filters, are_default_filters: false }),
    signal: AbortSignal.timeout(50000)
  });
  if (!r.ok) {
    let why = '';
    const txt = await r.text().catch(() => '');
    console.error('ERP_REPORT_ERROR', name, r.status, JSON.stringify(filters), txt.slice(0, 1500));
    try { // ERPNext explains itself in the body: pull out the short reason
      const e = JSON.parse(txt);
      if (!why && e.exc) { try { const t = JSON.parse(e.exc); why = String(t[t.length - 1] || '').trim().split('\n').filter(Boolean).pop() || ''; } catch (_) {} }
      if (e._server_messages) { const ms = JSON.parse(e._server_messages); why = ms.map(x => { try { return JSON.parse(x).message; } catch (_) { return String(x); } }).join(' ').replace(/<[^>]+>/g, ' '); }
      if (!why && e.exception) why = String(e.exception);
      if (!why && Array.isArray(e.exc_type ? [e.exc_type] : [])) why = String(e.exc_type || '');
    } catch (_) {}
    why = why.replace(/\s+/g, ' ').trim().slice(0, 240);
    throw new Error(`ERP answered ${r.status} for "${name}"` + (r.status === 401 || r.status === 403 ? ' (check ERP_API_KEY / ERP_API_SECRET and the user roles)' : r.status === 404 ? ' (is the report name right?)' : '') + (why ? ': ' + why : ''));
  }
  const m = (await r.json()).message || {};
  return { columns: m.columns || [], rows: m.result || [] };
}

// Same cleaning as PandoraParse.dash (private/parsers.js), from ERP fieldnames instead of Excel headers.
function category(group) {
  const low = group.toLowerCase();
  if (low.includes('maintenance') || low.includes('services')) return 'Services';
  if (low.includes('jewellery box') || low.includes('utility')) return 'Accessories';
  if (low.includes('earring')) return 'Earrings';
  if (low.includes(' ring')) return 'Rings';
  if (low.includes('bracelet')) return 'Bracelets';
  if (low.includes('necklace')) return 'Necklaces';
  if (['charm', 'clip', 'dangle', 'medallion', 'spacer'].some(x => low.includes(x))) return 'Charms';
  return 'Other';
}
// "Pandora Moments - Charm" -> "Moments" (the collection, used by the VM Zones page)
const collection = group => (String(group).split(' - ')[0] || '').replace(/^Pandora\s+/i, '').trim().slice(0, 60);
function salesRows(list) {
  const out = [];
  for (const r of list) {
    const invoice = r.invoice, date = iso(r.posting_date);
    if (!invoice || !date) continue;
    const group = String(r.item_group || '');
    if (group.toLowerCase().includes('packaging')) continue;
    if (ex.anyHit(group, r.cost_center, r.item_name, r.description, r.warehouse, r.brand)) continue; // Laderach is left out
    const cat = category(group);
    const net = num(r.amount), gross = num(r.total);
    if (Math.round(net * 100) === 0 && Math.round(gross * 100) === 0) continue;
    const cc = String(r.cost_center || 'Unspecified');
    let branch = cc.includes(' - ') ? cc.split(' - ').slice(1).join(' - ') : cc;
    branch = branch.replace(/ - AN/g, '').replace(/Pandora /g, '').replace(/ Of /g, ' of ').trim() || 'Unspecified';
    const pay = String(r.mode_of_payment || '').trim(), pl = pay.toLowerCase();
    // Only Cash, Visa or Valu are kept: Valu wins, then card, everything else is Cash.
    const payment = /valu/.test(pl) ? 'Valu' : /visa|card|master|credit|debit|pos/.test(pl) ? 'Visa' : 'Cash';
    let name = String(r.description || '').replace(/<[^>]*>/g, ' ').replace(/[|]/g, ' ').replace(/---/g, ' ').replace(/\s+/g, ' ').trim() || String(r.item_name || '');
    name = name.replace(/-one size$/i, '').replace(/-\d+\s*cm$/i, '').replace(/-\d{2}$/, '');
    out.push([date, String(invoice).slice(0, 40), cat === 'Services' ? 0 : num(r.stock_qty), net, gross,
      String(r['sku-item'] || r.sku || '').slice(0, 40), name.slice(0, 120), branch.slice(0, 80), cat, payment.slice(0, 40), collection(group)]);
  }
  return out;
}

// Same shape as PandoraParse.staff (private/parsers.js).
function staffData(list, period, itemNames, keyName) {
  const stores = [], people = [], groups = [], invs = [], items = [], sI = new Map(), pI = new Map(), gI = new Map(), iI = new Map(), tI = new Map(), rows = [];
  const idx = (m, arr, k) => { if (!m.has(k)) { m.set(k, arr.length); arr.push(k); } return m.get(k); };
  for (const r of list) {
    const pn = String(r.sales_person || '').trim(), sn = String(r.parent_sales_person || '').trim();
    if (!pn || !sn) continue;
    const si = idx(sI, stores, sn), pk = si + '|' + pn;
    if (!pI.has(pk)) { pI.set(pk, people.length); people.push([pn, si]); }
    const d = iso(r.posting_date), day = d ? Math.round(Date.parse(d + 'T00:00:00Z') / 86400000) : null;
    const code = String(r.item_code || '').trim();
    let ti = null;
    if (code) { const nm = itemNames.get(code) || ''; const tk = code + '|' + nm; if (!tI.has(tk)) { tI.set(tk, items.length); items.push([nm, code]); } ti = tI.get(tk); }
    rows.push([pI.get(pk), idx(gI, groups, String(r.item_group || '').trim()), idx(iI, invs, r.sales_invoice),
      Number(r.contribution_qty) || 0, Math.round((Number(r.contribution_amt) || 0) * 1000) / 1000, day, ti]);
  }
  return { file: keyName, period, stores, people, groups, items, rows };
}
const fmtPeriod = (a, b) => {
  const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${new Date(a).toLocaleDateString('en-GB', o)} – ${new Date(b).toLocaleDateString('en-GB', { ...o, year: 'numeric' })}`;
};

async function sync(m) {
  const { key, from, to } = monthRange(m);
  const t0 = Date.now();
  const salesList = await runReport(SALES_REPORT, { from_date: from, to_date: to });
  const company = process.env.ERP_COMPANY || (salesList.find(r => r.company) || {}).company || '';
  const staffList = company ? await runReport(STAFF_REPORT, { from_date: from, to_date: to, company, doc_type: 'Sales Invoice' }) : [];

  // Pandora Dashboards: one saved file per month, replaced on every sync.
  const rows = salesRows(salesList);
  const id = 'erp-' + key, uploadedAt = new Date().toISOString();
  if (rows.length) {
    const dates = rows.map(r => r[0]).sort();
    await store.putJSON('dash/f/' + id + '.json', { rows });
    let idx = ((await store.getJSON(DASH_INDEX)) || []).filter(f => f.id !== id);
    idx.push({ id, name: 'ERP sales ' + key, period: dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + ' → ' + dates[dates.length - 1], rows: rows.length, uploadedAt });
    await store.putJSON(DASH_INDEX, idx);
  }

  // Staff Performance: one month at a time, keeps the admin's hidden item groups.
  const names = new Map();
  for (const r of salesList) if (r.item_code && r.item_name && !names.has(r.item_code)) names.set(r.item_code, String(r.item_name));
  const sd = ex.filterStaff(staffData(staffList, fmtPeriod(from, to), names, 'ERP ' + key));
  let updatedCurrent = false;
  if (sd.rows.length) {
    const prev = await store.getJSON('data/current.json');
    // every month is kept on its own so older months can be opened on Staff Performance
    await store.putJSON('data/m/' + key + '.json', { ...sd, ex: (prev && prev.ex) || undefined, uploadedAt });
    // an older month fetched on request must not replace the month that is shown by default
    const pk = ex.monthKey(prev);
    if (!prev || !pk || key >= pk) { await store.putJSON('data/current.json', { ...sd, ex: (prev && prev.ex) || undefined, uploadedAt }); updatedCurrent = true; }
  }

  const status = { month: key, company, at: uploadedAt, seconds: Math.round((Date.now() - t0) / 100) / 10, sales: rows.length, staff: sd.rows.length };
  if (updatedCurrent || !m) await store.putJSON(STATUS, status); // an older month fetched on request does not change the "last sync" shown
  return status;
}

module.exports = activity.wrap('erp', async function handler(req, res) {
  // /api/stock is rewritten here (vercel.json): the Hobby plan allows 12 functions, so the stock balance lives in _stock.js
  { const u = new URL(req.url, 'https://x.invalid'); if (u.searchParams.get('stock') || u.pathname === '/api/stock') return require('./_stock')(req, res);
    if (u.searchParams.get('refill') || u.pathname === '/api/refill') return require('./_refill')(req, res); // Refill Order (api/_refill.js)
    if (u.searchParams.get('dist') || u.pathname === '/api/dist') return require('./_dist')(req, res); // Orders Distribution (api/_dist.js)
    if (u.searchParams.get('slow') || u.pathname === '/api/slow') return require('./_slow')(req, res); } // Refill Order (api/_refill.js)
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  if (!process.env.ERP_URL || !process.env.ERP_API_KEY || !process.env.ERP_API_SECRET) return send(res, 503, { ok: false, error: 'ERP_URL / ERP_API_KEY / ERP_API_SECRET are not set in Vercel.' });
  const url = new URL(req.url, 'https://x.invalid');

  const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron) {
    const who = await whoami(req);
    if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
    if (!(who.kind === 'env' && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Only the super admin can sync from ERP.' });
    if (req.method === 'GET') return send(res, 200, { ok: true, status: await store.getJSON(STATUS) });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  }

  try {
    return send(res, 200, { ok: true, ...(await sync(url.searchParams.get('month'))) });
  } catch (e) {
    return send(res, 502, { ok: false, error: String(e && e.message || e).slice(0, 300) });
  }
});
module.exports.runReport = runReport;
module.exports.runReportRaw = runReportRaw;
