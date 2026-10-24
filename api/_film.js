// Launch Film data: the same figures the Pandora Dashboards page shows, worked out on the server from the saved sales lines
// (same rules as the dashboards: Laderach left out, a line in two files counted once, revenue = net excl. VAT, an order = an invoice
// with positive revenue, target = daily target x days of the period). Read-only. Served to the super admin at /film?data=1.
const store = require('./_store');
const { dashRows } = require('./_sales');
const daily = require('./_daily');

const DAILY_TARGET = 600000; // the dashboards' default daily target (EGP)
const ZONES = [
  { label: 'Cairo zone', rx: /almaza|city\s*stars|\bcfc\b|festival|point\s*90/i },
  { label: 'October & Alexandria zone', rx: /mall\s*of\s*egypt|mall\s*of\s*arabia|arabia|alex/i }
];
const iso = v => String(v || '').slice(0, 10);
const dayMs = s => Date.parse(s + 'T12:00:00Z');
const r1 = n => Math.round(n * 10) / 10;

async function dailyReport() {
  // the most recent day with numbers across all store sheets, added up: morning, night and the day's share of the target
  const paths = await store.list('daily/');
  const latest = new Map(); // slug -> latest month
  for (const p of paths) {
    const m = /^daily\/([a-z0-9-]+)\/(\d{4}-\d{2})\.json$/.exec(p);
    if (m && (!latest.has(m[1]) || m[2] > latest.get(m[1]))) latest.set(m[1], m[2]);
  }
  const recs = [];
  for (const [sl, mo] of latest) {
    const rec = await store.getJSON('daily/' + sl + '/' + mo + '.json');
    if (rec && rec.rows) recs.push(rec);
  }
  let day = '';
  for (const rec of recs) for (const d of Object.keys(rec.rows)) { const v = rec.rows[d]; if (v && (+v[5] || 0) + (+v[6] || 0) > 0 && d > day) day = d; }
  if (!day) return null;
  let morning = 0, night = 0, target = 0, stores = 0;
  for (const rec of recs) {
    const v = rec.rows[day];
    if (!v || (+v[5] || 0) + (+v[6] || 0) <= 0) continue;
    morning += +v[5] || 0; night += +v[6] || 0; stores++;
    const dn = +day.slice(8, 10), dim = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 0)).getUTCDate();
    const w = rec.weights && rec.weights[dn] != null ? +rec.weights[dn] : 1 / dim;
    target += (+rec.target || 0) * w;
  }
  const total = morning + night;
  return { date: day, morning: Math.round(morning), night: Math.round(night), target: Math.round(target), pct: target > 0 ? r1(total / target * 100) : null, stores };
}

async function build() {
  const rows = await dashRows();
  if (!rows.length) return { ok: true, empty: true };
  let min = '9999-99-99', max = '0000-00-00', revenue = 0, units = 0;
  const inv = new Set(), byDay = new Map(), byCat = new Map(), byBr = new Map();
  for (const r of rows) {
    const d = iso(r[0]); if (!d || !r[1]) continue; // the dashboards drop lines without a date or an invoice
    const net = Number(r[3]) || 0, qty = Number(r[2]) || 0;
    if (d < min) min = d; if (d > max) max = d;
    revenue += net; units += qty;
    if (net > 0 && r[1]) inv.add(r[1]);
    byDay.set(d, (byDay.get(d) || 0) + net);
    const c = String(r[8] || 'Unspecified'); const co = byCat.get(c) || { name: c, rev: 0, units: 0 }; co.rev += net; co.units += qty; byCat.set(c, co);
    const b = daily.canon(r[7] || 'Unspecified'); const bo = byBr.get(b) || { name: b, rev: 0, units: 0 }; bo.rev += net; bo.units += qty; byBr.set(b, bo);
  }
  const days = Math.max(1, Math.round((dayMs(max) - dayMs(min)) / 86400000) + 1);
  const target = DAILY_TARGET * days, orders = inv.size;
  const cats = [...byCat.values()].sort((a, b) => b.rev - a.rev).map(c => ({ name: c.name, share: r1(c.rev / (revenue || 1) * 100), units: Math.round(c.units), rev: Math.round(c.rev) }));
  const top3 = cats.slice(0, 3), others = cats.slice(3);
  const rest = others.length ? [{ name: 'The rest', share: r1(others.reduce((n, c) => n + c.share, 0)), units: others.reduce((n, c) => n + c.units, 0), rev: others.reduce((n, c) => n + c.rev, 0) }] : [];
  // the last 60 calendar days of the period, one value per day
  const series = [];
  for (let i = Math.min(60, days) - 1; i >= 0; i--) { const d = new Date(dayMs(max) - i * 86400000).toISOString().slice(0, 10); series.push({ d, v: Math.round(byDay.get(d) || 0) }); }
  const brs = [...byBr.values()].filter(b => b.rev > 0).sort((a, b) => b.rev - a.rev).map(b => ({ name: b.name, rev: Math.round(b.rev), units: Math.round(b.units) }));
  const zones = ZONES.map(z => ({ label: z.label, stores: brs.filter(b => z.rx.test(b.name)).slice(0, 4) })).filter(z => z.stores.length);
  let dr = null; try { dr = await dailyReport(); } catch (_) { dr = null; }
  return {
    ok: true, period: [min, max], days, revenue: Math.round(revenue), units: Math.round(units), orders, aov: orders ? Math.round(revenue / orders) : 0,
    dailyTarget: DAILY_TARGET, target, pct: target ? r1(revenue / target * 100) : 0,
    catCount: cats.length, cats: top3.concat(rest), series, stores: brs.slice(0, 6), zones, dailyReport: dr
  };
}

module.exports = { build };
