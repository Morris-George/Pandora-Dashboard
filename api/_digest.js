// Daily WhatsApp digest: yesterday's sales in a short message, sent every morning after the ERP sync.
// Reached at /api/digest (vercel.json rewrites it to api/erp.js: the Hobby plan allows 12 functions).
//   GET  /api/digest                 Vercel cron (Authorization: Bearer CRON_SECRET): send yesterday's digest, once per day
//   GET  /api/digest?preview=1       super admin: the message as it would be sent now (&date=YYYY-MM-DD for another day), nothing is sent
//   POST /api/digest                 super admin: send it now
// Env vars: TELEGRAM_BOT_TOKEN (+ optional TELEGRAM_CHAT_ID) for Telegram.
// The numbers follow Pandora Dashboards: net sales (without VAT), an order = an invoice (per branch) with sales and pieces above zero.
const store = require('./_store');
const { whoami } = require('./_auth');
const { dashRows } = require('./_sales');

const STATUS = 'digest/status.json';
const DAY = 864e5;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const addD = (s, n) => new Date(t(s) + n * DAY).toISOString().slice(0, 10);
const cairoToday = () => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()); } catch (_) { return new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10); } };
const fDay = s => `${WD[new Date(t(s)).getUTCDay()]} ${+s.slice(8)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
const egp = n => 'EGP ' + Math.round(n || 0).toLocaleString('en-US');
const short = n => { const a = Math.abs(n); return 'EGP ' + (a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1e4 ? Math.round(n / 1e3) + 'K' : Math.round(n).toLocaleString('en-US')); };
// "▲ 12%" / "▼ 8%" / "" when there is nothing to compare with
const chg = (a, b) => { if (!(b > 0)) return ''; const d = a / b - 1; if (Math.abs(d) < 0.0005) return '= 0%'; return (d > 0 ? '▲ ' : '▼ ') + (Math.abs(d) * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0) + '%'; };

// Line: [date, invoice, qty, net, gross, sku, name, branch, category, payment, collection]
function agg(rows) {
  let net = 0, units = 0; const inv = new Map();
  for (const r of rows) {
    const v = Number(r[3]) || 0, q = Number(r[2]) || 0; net += v; units += q;
    const k = r[7] + '|' + r[1]; let o = inv.get(k); if (!o) inv.set(k, o = { v: 0, q: 0 }); o.v += v; o.q += q;
  }
  let orders = 0, ov = 0, oq = 0;
  for (const o of inv.values()) if (o.v > 0 && o.q > 0) { orders++; ov += o.v; oq += o.q; }
  return { net, units, orders, atv: orders ? ov / orders : 0, upt: orders ? oq / orders : 0 };
}
const byBranch = rows => { const m = new Map(); for (const r of rows) { const b = String(r[7] || 'Unspecified'); m.set(b, (m.get(b) || 0) + (Number(r[3]) || 0)); } return m; };

// The message for one day. `want` = the day asked for (yesterday in Cairo by default); when it has no sales the newest day with sales is used and the message says so.
function build(rows, want, today) {
  const dates = new Set(rows.map(r => r[0]));
  if (!dates.size) return { ok: false, error: 'No sales are saved yet. Run Sync from ERP on the All Uploads page.' };
  let day = want, note = '';
  if (!dates.has(day)) {
    const older = [...dates].filter(d => d <= want).sort();
    if (!older.length) return { ok: false, error: 'No sales are saved for ' + fDay(want) + ' or any day before it.' };
    day = older[older.length - 1];
    note = `No sales are saved for ${fDay(want)} yet, so this is the latest day with sales. Check Sync from ERP on All Uploads.`;
  }
  const of = d => rows.filter(r => r[0] === d);
  const cur = of(day), wk = addD(day, -7), prev = of(wk);
  const a = agg(cur), p = prev.length ? agg(prev) : null;
  const L = [];
  L.push('*Pandora daily sales*');
  L.push(fDay(day));
  if (note) L.push('_' + note + '_');
  L.push('');
  L.push(`*Sales: ${egp(a.net)}* (net, without VAT)`);
  if (p && p.net > 0) L.push(`${chg(a.net, p.net)} vs last ${WD[new Date(t(day)).getUTCDay()]} (${egp(p.net)})`);
  L.push(`Orders ${a.orders.toLocaleString('en-US')} · Avg order ${egp(a.atv)} · Units per order ${a.upt.toFixed(2)}`);

  // every store, best first, each against the same weekday last week
  const cb = byBranch(cur), pb = byBranch(prev);
  const stores = [...cb.entries()].filter(x => Math.round(x[1]) !== 0).sort((x, y) => y[1] - x[1]);
  if (stores.length) {
    L.push('');
    L.push('*Stores*');
    stores.forEach(([b, v], i) => { const c = chg(v, pb.get(b) || 0); L.push(`${i + 1}. ${b}: ${egp(v)}${c ? '  ' + c : ''}`); });
  }

  // best seller of the day (by sales)
  const pm = new Map();
  for (const r of cur) { const k = String(r[5] || r[6]); let o = pm.get(k); if (!o) pm.set(k, o = { sku: String(r[5] || ''), name: String(r[6] || 'Unspecified'), u: 0, v: 0 }); o.u += Number(r[2]) || 0; o.v += Number(r[3]) || 0; }
  const top = [...pm.values()].sort((x, y) => y.v - x.v)[0];
  L.push('');
  if (top && top.v > 0) L.push(`*Top item:* ${top.name}${top.sku ? ' (' + top.sku + ')' : ''}: ${Math.round(top.u)} pcs, ${egp(top.v)}`);

  // the month so far against the same dates last month
  const m0 = day.slice(0, 8) + '01';
  const mtd = rows.filter(r => r[0] >= m0 && r[0] <= day);
  const pmEnd = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, 0)); // last day of the month before
  const pmKey = pmEnd.toISOString().slice(0, 8), pmTo = pmKey + String(Math.min(+day.slice(8), pmEnd.getUTCDate())).padStart(2, '0');
  const lm = rows.filter(r => r[0] >= pmKey + '01' && r[0] <= pmTo);
  const mn = mtd.reduce((s, r) => s + (Number(r[3]) || 0), 0), ln = lm.reduce((s, r) => s + (Number(r[3]) || 0), 0);
  L.push('');
  L.push(`*${MONL[+day.slice(5, 7) - 1]} so far:* ${short(mn)}${ln > 0 ? `  ${chg(mn, ln)} vs the same dates in ${MONL[pmEnd.getUTCMonth()]}` : ''}`);
  return { ok: true, day, wanted: want, fallback: day !== want, text: L.join('\n'), sales: Math.round(a.net), orders: a.orders, today };
}

// The numbers for the picture: one row per store (best first) with invoices, gross, net, change against the same weekday last week, and the month so far.
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function tableData(rows, day, note) {
  const cur = rows.filter(r => r[0] === day), prev = rows.filter(r => r[0] === addD(day, -7));
  const m0 = day.slice(0, 8) + '01', mtd = rows.filter(r => r[0] >= m0 && r[0] <= day);
  const by = (list, k) => { const m = new Map(); for (const r of list) { const b = String(r[7] || 'Unspecified'); (m.get(b) || m.set(b, []).get(b)).push(r); } return m; };
  const cb = by(cur), pb = by(prev), mb = by(mtd);
  const sum = (list, i) => list.reduce((x, r) => x + (Number(r[i]) || 0), 0);
  const pc = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);
  const out = [...cb.entries()].map(([name, l]) => ({ name, orders: agg(l).orders, gross: sum(l, 4), net: sum(l, 3), mtd: sum(mb.get(name) || [], 3), chg: pb.has(name) ? pc(sum(l, 3), sum(pb.get(name), 3)) : null }))
    .filter(r => Math.round(r.net) !== 0).sort((x, y) => y.net - x.net);
  const a = agg(cur), pa = prev.length ? agg(prev) : null;
  const pmEnd = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, 0));
  const pmKey = pmEnd.toISOString().slice(0, 8), pmTo = pmKey + String(Math.min(+day.slice(8), pmEnd.getUTCDate())).padStart(2, '0');
  const ln = sum(rows.filter(r => r[0] >= pmKey + '01' && r[0] <= pmTo), 3), mn = sum(mtd, 3);
  const d0 = new Date(t(day)).getUTCDay();
  const pm = new Map();
  for (const r of cur) { const k = String(r[5] || r[6]); let o = pm.get(k); if (!o) pm.set(k, o = { sku: String(r[5] || ''), name: String(r[6] || 'Unspecified'), u: 0, v: 0 }); o.u += Number(r[2]) || 0; o.v += Number(r[3]) || 0; }
  const top = [...pm.values()].sort((x, y) => y.v - x.v)[0];
  const tot = out.reduce((x, r) => x + r.net, 0) || 1;
  return {
    weekday: WDL[d0], dateLong: `${+day.slice(8)} ${MONL[+day.slice(5, 7) - 1]} ${day.slice(0, 4)}`, wd: WD[d0],
    net: a.net, orders: out.reduce((x, r) => x + r.orders, 0), mtd: mn, mtdLabel: `net sales, 1–${+day.slice(8)} ${MON[+day.slice(5, 7) - 1]}`,
    mtdChg: ln > 0 ? pc(mn, ln) : null, mtdVs: MONL[pmEnd.getUTCMonth()], dayChg: pa && pa.net > 0 ? pc(a.net, pa.net) : null,
    rows: out,
    leader: out.length ? `${out[0].name} led the day with ${Math.round(out[0].net / tot * 100)}% of net sales.` : '',
    top: top && top.v > 0 ? `Top item: ${top.name.length > 38 ? top.name.slice(0, 37) + '…' : top.name}${top.sku ? ' (' + top.sku + ')' : ''}: ${Math.round(top.u)} pcs, ${egp(top.v)}` : '',
    note: note || ''
  };
}
// The table in the order of the ERP "Pandora Sales / POS" report. A store with no sales that day still shows (its month to date is still real).
const { storeKey } = require('./_storekey');
// Pieces are counted for jewellery only: the five categories plus Accessories (the same names as the Pandora Dashboards "Category explorer", where an item
// with no category is placed by its name and what is left is Accessories). Services never count, and only priced lines count: a line sold at 0 (a gift) or a return is not a piece sold.
function qtyCat(c, name) {
  const n = String(name || '').toLowerCase(); c = String(c || '');
  if (c === 'Services') return '';
  if (c === 'Necklaces') return 'Necklace and Pendant';
  if (c && c !== 'Other' && c !== 'Unspecified') return c;
  if (/safety/.test(n)) return 'Charms'; if (/bracelet|bangle/.test(n)) return 'Bracelets'; if (/pendant|necklace|collier/.test(n)) return 'Necklace and Pendant';
  if (/charm|clip|dangle|spacer|medallion|murano/.test(n)) return 'Charms'; if (/earring|stud|hoop|huggie/.test(n)) return 'Earrings'; if (/\bring/.test(n)) return 'Rings';
  return 'Accessories';
}
const QTY_CATS = new Set(['Charms', 'Bracelets', 'Necklace and Pendant', 'Rings', 'Earrings', 'Accessories']);
const piecesOf = list => list.reduce((x, r) => x + ((Number(r[3]) > 0 && Number(r[2]) > 0 && QTY_CATS.has(qtyCat(r[8], r[6]))) ? Number(r[2]) : 0), 0);
const ERP_ORDER = [['cfc', 'Pandora CFC'], ['point90', 'Pandora Point 90'], ['moe', 'Pandora Mall of Egypt'], ['citystars', 'Pandora City Stars'], ['almaza', 'Pandora CC Almaza'], ['moa', 'Pandora Mall of Arabia'], ['alex', 'Pandora Alex'], ['online', 'Pandora Online']];
function tableErp(rows, day, note) {
  const m0 = day.slice(0, 8) + '01', cur = rows.filter(r => r[0] === day), mtd = rows.filter(r => r[0] >= m0 && r[0] <= day);
  const nameOf = b => { const k = storeKey(b); const hit = ERP_ORDER.find(x => x[0] === k); return { k: hit ? hit[0] : 'x:' + String(b || 'Unspecified'), name: hit ? hit[1] : String(b || 'Unspecified').replace(/\s+-\s+[A-Za-z]{1,5}\s*$/, '') }; };
  const map = new Map(); ERP_ORDER.forEach(([k, name]) => map.set(k, { name, c: [], m: [] }));
  const put = (list, f) => { for (const r of list) { const { k, name } = nameOf(r[7]); let o = map.get(k); if (!o) map.set(k, o = { name, c: [], m: [] }); o[f].push(r); } };
  put(cur, 'c'); put(mtd, 'm');
  const sum = (list, i) => list.reduce((x, r) => x + (Number(r[i]) || 0), 0), d0 = new Date(t(day)).getUTCDay();
  const out = [...map.values()].filter(o => o.c.length || o.m.length || ERP_ORDER.some(x => x[1] === o.name && x[0] !== 'online'))
    .map(o => ({ name: o.name, orders: agg(o.c).orders, qty: piecesOf(o.c), gross: sum(o.c, 4), net: sum(o.c, 3), mtd: sum(o.m, 3), mtdQty: piecesOf(o.m) }));
  return { weekday: WDL[d0], date: `${day.slice(8)}-${day.slice(5, 7)}-${day.slice(0, 4)}`, rows: out, note: note || '' };
}
// 1 USD in EGP for the SAME day as the report, read by itself from ERPNext (its Currency Exchange records, the newest one on or before that day).
// Every rate found is saved per day, so if ERP does not answer one morning the last saved rate is used and the picture says whose day it is.
// USD_RATE in Vercel forces one fixed rate. { v: 0 } = unknown: the picture then leaves the USD column empty.
const RATES = 'digest/usd.json';
let rateMemo = { day: '', v: 0, at: 0 };
async function usdRate(day) {
  const fixed = Number(process.env.USD_RATE); if (fixed > 0) return { v: fixed, of: '' };
  if (rateMemo.v > 0 && rateMemo.day === day && Date.now() - rateMemo.at < 6 * 3600 * 1000) return { v: rateMemo.v, of: rateMemo.of || '' };
  const base = String(process.env.ERP_URL || '').replace(/\/+$/, ''), auth = { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: 'application/json' };
  let v = 0;
  // 1) the market rate of that exact day from a free public daily feed (no key); the ERP here holds no daily rates
  for (const u of ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + day + '/v1/currencies/usd.json', 'https://' + day + '.currency-api.pages.dev/v1/currencies/usd.json']) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
      if (r.ok) { const j = await r.json(); const x = Number(j && j.usd && j.usd.egp); if (x > 20 && x < 200 && (!j.date || String(j.date) === day)) { v = x; break; } }
    } catch (_) { /* next source */ }
  }
  // 2) the ERP, if the public feed did not answer
  if (!(v > 0)) try {
    const r = await fetch(base + '/api/method/erpnext.setup.utils.get_exchange_rate?from_currency=USD&to_currency=EGP&transaction_date=' + day, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (r.ok) v = Number((await r.json()).message) || 0;
  } catch (_) { /* try the list below */ }
  if (!(v > 0)) {
    try {
      const q = 'fields=' + encodeURIComponent('["exchange_rate","date"]') + '&filters=' + encodeURIComponent(JSON.stringify([['from_currency', '=', 'USD'], ['to_currency', '=', 'EGP'], ['date', '<=', day]])) + '&order_by=' + encodeURIComponent('date desc') + '&limit_page_length=1';
      const r = await fetch(base + '/api/resource/Currency%20Exchange?' + q, { headers: auth, signal: AbortSignal.timeout(15000) });
      if (r.ok) v = Number((((await r.json()).data || [])[0] || {}).exchange_rate) || 0;
    } catch (_) { v = 0; }
  }
  let saved = {}; try { saved = (await store.getJSON(RATES)) || {}; } catch (_) { saved = {}; }
  if (v > 0) {
    v = Math.round(v * 1e4) / 1e4; rateMemo = { day, v, at: Date.now(), of: '' };
    if (saved[day] !== v) { saved[day] = v; const keep = Object.keys(saved).sort().slice(-60); try { await store.putJSON(RATES, Object.fromEntries(keep.map(k => [k, saved[k]]))); } catch (_) { /* the rate is still used today */ } }
    return { v, of: '' };
  }
  const last = Object.keys(saved).filter(k => k <= day && saved[k] > 0).sort().pop();
  return last ? { v: saved[last], of: last } : { v: 0, of: '' };
}
async function picture(rows, day, fallback, want) {
  const tbl = tableErp(rows, day, fallback ? 'latest day with sales (none saved for ' + fDay(want) + ')' : '');
  if (!tbl.rows.some(r => r.orders || Math.round(r.net))) throw new Error('no store has sales on ' + day);
  const rt = await usdRate(day); tbl.rate = rt.v; if (rt.of) tbl.rateNote = 'rate of ' + rt.of.slice(8) + '-' + rt.of.slice(5, 7) + '-' + rt.of.slice(0, 4) + ' (no source answered)';
  return require('./_digestimg').render(tbl);
}

// ---- where it is sent: Telegram only (the WhatsApp/CallMeBot sender was removed at the owner's request, Nov 16) ----
// Telegram: TELEGRAM_BOT_TOKEN (from @BotFather). TELEGRAM_CHAT_ID is optional: when it is missing the chat is found from the
// newest message sent to the bot (so the person only has to press Start once) and remembered in digest/tgchat.json.
const tgOn = () => !!String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const configured = () => tgOn();
const where = () => (tgOn() ? 'Telegram' : '');

const escH = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// the message is written with WhatsApp marks (*bold*, _italic_); Telegram gets the same text as HTML
const toHtml = text => escH(text).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\n)_([^_\n]+)_(?=\n|$)/g, '$1<i>$2</i>');

async function tgCall(method, body) {
  const r = await fetch('https://api.telegram.org/bot' + String(process.env.TELEGRAM_BOT_TOKEN).trim() + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.description ? 'Telegram said: ' + j.description : 'Telegram did not answer (' + r.status + ')');
  return j.result;
}
async function tgChat() {
  const fixed = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (fixed) return fixed;
  const saved = await store.getJSON('digest/tgchat.json');
  if (saved && saved.id) return String(saved.id);
  const ups = await tgCall('getUpdates', { limit: 20, allowed_updates: ['message'] });
  const m = ups.map(u => u.message).filter(m => m && m.chat && m.chat.type === 'private').pop();
  if (!m) throw new Error('Telegram does not know you yet: open your bot in Telegram, press Start, then try again.');
  await store.putJSON('digest/tgchat.json', { id: m.chat.id, name: [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') });
  return String(m.chat.id);
}
async function sendTelegram(text) {
  const chat = await tgChat();
  await tgCall('sendMessage', { chat_id: chat, text: toHtml(text), parse_mode: 'HTML', disable_web_page_preview: true });
  return 'Telegram';
}

async function sendTelegramPhoto(png, caption) {
  const chat = await tgChat();
  const fd = new FormData();
  fd.append('chat_id', chat);
  fd.append('caption', caption);
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'pandora-daily-sales.png');
  const r = await fetch('https://api.telegram.org/bot' + String(process.env.TELEGRAM_BOT_TOKEN).trim() + '/sendPhoto', { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.description ? 'Telegram said: ' + j.description : 'Telegram did not answer (' + r.status + ')');
  return 'Telegram (picture)';
}

// every channel that is set up; it counts as sent when at least one took it
// The picture goes to Telegram instead of the text. If the picture cannot be made or sent, the text goes instead, so a day is never missed.
async function sendAll(text, png, caption) {
  if (!configured()) throw new Error('Nothing is connected yet: add TELEGRAM_BOT_TOKEN (Telegram) in Vercel.');
  const jobs = [];
  const prob = [];
  if (tgOn()) jobs.push(png ? sendTelegramPhoto(png, caption).catch(e => { prob.push('Picture not sent (' + String(e && e.message || e).slice(0, 120) + '), sent the text instead.'); return sendTelegram(text); }) : sendTelegram(text));
  const res = await Promise.allSettled(jobs);
  const ok = res.filter(x => x.status === 'fulfilled').map(x => x.value), bad = res.filter(x => x.status === 'rejected').map(x => String(x.reason && x.reason.message || x.reason));
  if (!ok.length) throw new Error(bad.join(' · ').slice(0, 280));
  return { via: ok, problems: prob.concat(bad) };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const url = new URL(req.url, 'https://x.invalid');
  const cron = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron) {
    const who = await whoami(req);
    if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
    if (!(who.kind === 'env' && who.info.role === 'admin')) return send(res, 403, { ok: false, error: 'Only the super admin can use the daily digest.' });
    if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  }
  const today = cairoToday();
  const asked = url.searchParams.get('date');
  const want = ISO.test(asked || '') && asked < today ? asked : addD(today, -1);
  const status = await store.getJSON(STATUS);
  const base = { configured: configured(), to: where(), status: status || null };
  let d, all;
  try { all = await dashRows(); d = build(all, want, today); } catch (e) { return send(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 300), ...base }); }

  if (!cron && req.method === 'GET' && url.searchParams.get('image')) {
    if (!d.ok) return send(res, 404, { ...d, ...base });
    try { const png = await picture(all, d.day, d.fallback, want); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'image/png'); return res.status(200).send(png); }
    catch (e) { return send(res, 500, { ok: false, error: 'Could not draw the picture: ' + String(e && e.message || e).slice(0, 200), ...base }); }
  }
  if (!cron && req.method === 'GET') return send(res, d.ok ? 200 : 404, { ...d, ...base });

  // The cron sends once per day: a second call the same day (a retry) does nothing.
  if (cron && status && status.ok && status.sentOn === today) return send(res, 200, { ok: true, skipped: 'already sent today', ...base });
  if (!d.ok) { await store.putJSON(STATUS, { ok: false, at: new Date().toISOString(), error: d.error }); return send(res, 404, { ...d, ...base }); }
  try {
    let png = null, pbad = '';
    if (tgOn()) { try { png = await picture(all, d.day, d.fallback, want); } catch (e) { pbad = 'Could not draw the picture (' + String(e && e.message || e).slice(0, 120) + '), sent the text instead.'; } }
    const sent = await sendAll(d.text, png, 'Pandora daily sales · ' + fDay(d.day));
    if (pbad) sent.problems.unshift(pbad);
    const st = { ok: true, at: new Date().toISOString(), via: sent.via.join(' + '), problems: sent.problems.join(' · ').slice(0, 200), sentOn: cron ? today : (status && status.sentOn) || '', day: d.day, by: cron ? 'schedule' : 'button' };
    await store.putJSON(STATUS, st);
    return send(res, 200, { ok: true, day: d.day, text: d.text, ...base, status: st });
  } catch (e) {
    const st = { ok: false, at: new Date().toISOString(), error: String(e && e.message || e).slice(0, 300), sentOn: (status && status.sentOn) || '' };
    await store.putJSON(STATUS, st);
    return send(res, 502, { ok: false, error: st.error, text: d.text, ...base, status: st });
  }
};
module.exports.build = build;
module.exports.toHtml = toHtml;
module.exports.tableData = tableData;
module.exports.tableErp = tableErp;
module.exports.qtyCat = qtyCat;
