// Numbers for one sales person's own page, worked out on the server so that a sales person's phone
// never receives colleagues' rows. Same rules as the pages: VAT 1.14, item groups in `ex` left out.
const VAT = 1.14;

function aggregate(d) {
  const ex = new Set();
  (d.ex || []).forEach(g => { const i = d.groups.indexOf(g); if (i >= 0) ex.add(i); });
  const P = d.people.map(() => ({ inv: new Map(), g: new Map(), qty: 0, amt: 0 }));
  for (const r of d.rows) {
    if (ex.has(r[1])) continue;
    const p = P[r[0]]; if (!p) continue;
    const iv = p.inv.get(r[2]) || { q: 0 }; iv.q += r[3]; p.inv.set(r[2], iv);
    p.qty += r[3]; p.amt += r[4];
    const g = p.g.get(r[1]) || { a: 0, inv: new Set() }; g.a += r[4]; g.inv.add(r[2]); p.g.set(r[1], g);
  }
  return P;
}

function pool(P, idxs) {
  let n = 0, inv = 0, qty = 0, amt = 0;
  const pen = new Map(), gamt = new Map(), b = [0, 0, 0, 0];
  for (const i of idxs) {
    const p = P[i]; if (!p.inv.size) continue;
    n++; inv += p.inv.size; qty += p.qty; amt += p.amt;
    for (const [g, v] of p.g) { pen.set(g, (pen.get(g) || 0) + v.inv.size); gamt.set(g, (gamt.get(g) || 0) + v.a); }
    for (const v of p.inv.values()) { if (v.q > 0) b[v.q <= 1 ? 0 : v.q <= 2 ? 1 : v.q <= 3 ? 2 : 3]++; }
  }
  return { n, inv, qty, amt, pen: [...pen], gamt: [...gamt], b };
}

function rankOf(P, idxs, me) {
  const act = idxs.filter(i => P[i].inv.size).sort((a, b) => P[b].amt - P[a].amt);
  return { rank: act.indexOf(me) + 1, count: act.length };
}

// what one sales person is allowed to receive
function staffView(d, store, name) {
  const si = d.stores.indexOf(store);
  const pi = d.people.findIndex(p => p[0] === name && d.stores[p[1]] === store);
  const base = { file: d.file, period: d.period, groups: d.groups, ex: d.ex || [], self: { store, name }, dayMin: d.dayMin || null, dayMax: d.dayMax || null, from: d.from || null, to: d.to || null };
  if (si < 0 || pi < 0) return { ...base, stores: [store], people: [], items: [], rows: [], bench: null };
  const P = aggregate(d);
  const all = d.people.map((_, i) => i), mates = all.filter(i => d.people[i][1] === si);
  const rs = rankOf(P, mates, pi), rc = rankOf(P, all, pi);
  // own rows only, with item numbers renumbered so the full catalogue is not sent
  const items = [], imap = new Map();
  const rows = [];
  for (const r of d.rows) {
    if (r[0] !== pi) continue;
    const c = r.slice(); c[0] = 0;
    if (c[6] != null && d.items && d.items[c[6]]) {
      if (!imap.has(c[6])) { imap.set(c[6], items.length); items.push(d.items[c[6]]); }
      c[6] = imap.get(c[6]);
    } else c[6] = null;
    rows.push(c);
  }
  return {
    ...base, stores: [store], people: [[name, 0]], items, rows,
    bench: { store: pool(P, mates), company: pool(P, all), rankStore: rs.rank, storeCount: rs.count, rankCompany: rc.rank, companyCount: rc.count }
  };
}

module.exports = { VAT, staffView };
