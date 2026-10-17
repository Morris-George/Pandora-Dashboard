// Laderach is no longer part of the dashboards: its branches, categories and items are left out everywhere.
// Used when data comes in (ERP sync, uploads) and again when saved data is read, so older saved files are cleaned too.
const plain = v => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '');
const RX = /laderach/i;
const hit = v => typeof v === 'string' && RX.test(plain(v));
const anyHit = (...vals) => vals.some(hit);
// "Sales Team" is not a store: it is left out of every Staff Performance report (all roles, including super admin).
const hideTeam = v => typeof v === 'string' && /^\s*sales\s*team\s*$/i.test(v);

// Pandora Dashboards sales line: [date, invoice, qty, net, gross, sku, name, branch, category, payment, collection (ERP lines only)]
const keepSale = r => !anyHit(r[5], r[6], r[7], r[8]);
const filterSales = rows => rows.filter(keepSale);

// Staff Performance data {stores, people:[[name, storeIdx]], groups, items:[[name, code]], rows:[[personIdx, groupIdx, invoice, qty, amt, day, itemIdx]]}
function filterStaff(d) {
  if (!d || !Array.isArray(d.stores) || !Array.isArray(d.people) || !Array.isArray(d.groups) || !Array.isArray(d.rows)) return d;
  const items = Array.isArray(d.items) ? d.items : [];
  const badStore = d.stores.map(v => hit(v) || hideTeam(v)), badGroup = d.groups.map(hit), badItem = items.map(i => Array.isArray(i) ? anyHit(i[0], i[1]) : hit(i));
  if (![...badStore, ...badGroup, ...badItem].some(Boolean)) return d;
  const remap = (flags, list) => { const m = new Map(), out = []; list.forEach((x, i) => { if (!flags[i]) { m.set(i, out.length); out.push(x); } }); return { m, out }; };
  const S = remap(badStore, d.stores), G = remap(badGroup, d.groups), I = remap(badItem, items);
  const pMap = new Map(), people = [];
  d.people.forEach((p, i) => { if (S.m.has(p[1])) { pMap.set(i, people.length); people.push([p[0], S.m.get(p[1])]); } });
  const rows = [];
  for (const r of d.rows) {
    const np = pMap.get(r[0]), ng = G.m.get(r[1]);
    if (np === undefined || ng === undefined) continue;
    if (r[6] != null && badItem[r[6]]) continue;
    const c = r.slice(); c[0] = np; c[1] = ng;
    if (c[6] != null) c[6] = I.m.has(c[6]) ? I.m.get(c[6]) : null;
    rows.push(c);
  }
  const ex = Array.isArray(d.ex) ? d.ex.filter(x => !hit(x)) : d.ex;
  return { ...d, stores: S.out, people, groups: G.out, items: I.out, rows, ex };
}

// VM report rows (arrays of cells): drop any row that mentions Laderach in any cell
const filterTable = rows => rows.filter(r => !r.some(hit));

module.exports = { hit, anyHit, filterSales, filterStaff, filterTable };
