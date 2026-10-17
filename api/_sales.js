// Shared reader for the saved Pandora Dashboards sales lines (used by the VM report and VM Zones).
const store = require('./_store');
const ex = require('./_exclude');

// Every saved Pandora Dashboards sales line, merged the way the dashboards do it: Laderach left out, a line that is in two files counted once.
// Line: [date, invoice, qty, net, gross, sku, name, branch, category, payment, collection (ERP lines only)]
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

module.exports = { dashRows };
