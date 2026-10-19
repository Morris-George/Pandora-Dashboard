// Zone stock: how many pieces of each item sit in each VM zone of a store.
// A count (from the Stock Count tool or typed here) sets a zone; goods received are scanned into a zone;
// moves (and the branch manager's "distribute") take pieces from one zone to another; ERP sales take pieces off
// automatically every day. The next count shows what is missing.
//   GET  /api/zonestock                       stores this account can open
//   GET  /api/zonestock?store=X               zones, stock now, movements and count differences (pieces only, never money)
//   GET  /api/zonestock?store=X&plan=1&part=n one piece of the store's floor plan image
//   POST /api/zonestock?op=count  {store, counts:[{zone, lines:[[sku, qty, name]]}]}
//   POST /api/zonestock?op=in     {store, zone, lines}
//   POST /api/zonestock?op=move   {store, moves:[{from, to, lines}]}
//   POST /api/zonestock?op=undo   {store, id}
// Who: super admin and VM account (every store), store managers (their own store only).
// Day rule: counts, receipts and moves of a day are applied before that day's ERP sales.
// ERP sales have no zone: each piece comes off the display zone holding the most of that item, then back stock;
// what cannot be placed is shown as "sold, not in any zone". Returns go back to back stock.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');
const vz = require('./_vmzones');
const { load, storeDaily, slug, readJSON, send, today } = vz;

const BS = 'BS'; // back stock
const MAX_EVENTS = 6000, MAX_LINES = 5000;
const SKU = /^[A-Z0-9][A-Z0-9\-_.]{1,39}$/;
const key = st => 'zs/' + slug(st) + '.json';
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function access(req) {
  const who = await whoami(req);
  if (!who) return { code: 401 };
  if (who.kind === 'env' && who.info.role === 'admin') return { role: 'admin', by: 'Super admin' };
  if (who.kind === 'vm') return { role: 'vm', by: (who.user && who.user.name) || 'VM' };
  if (who.kind === 'staff' && who.info.role === 'store' && who.info.self && who.info.self.store) {
    return { role: 'store', by: who.user.name || 'Store manager', own: who.info.self.store };
  }
  return { code: 403 };
}
// a store manager's store name may be written a little differently from the ERP branch name
function ownBranch(own, branches) {
  return branches.find(b => b === own) || branches.find(b => norm(b) === norm(own)) || own;
}

function cleanLines(lines, allowZero) {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) return null;
  const m = new Map(), names = {};
  for (const l of lines) {
    if (!Array.isArray(l)) return null;
    const sku = String(l[0] || '').trim().toUpperCase(), q = Math.round(Number(l[1]));
    if (!SKU.test(sku) || !Number.isFinite(q) || q < 0 || q > 100000) return null;
    if (!allowZero && q === 0) continue;
    m.set(sku, (m.get(sku) || 0) + q);
    if (l[2]) names[sku] = String(l[2]).slice(0, 80);
  }
  return { lines: [...m.entries()], names };
}

// Replay every event and every day of ERP sales from the first count on.
function replay(data, sd, zoneIds) {
  const stock = new Map(), base = new Map(), info = new Map();
  const zs = [...zoneIds, BS];
  zs.forEach(z => { stock.set(z, new Map()); base.set(z, new Map()); info.set(z, { counted: null, inQ: 0, outQ: 0, sold: new Map(), recv: new Map() }); });
  const ev = data.events.slice().sort((a, b) => a.day.localeCompare(b.day) || a.t - b.t);
  const variance = [];
  let unplaced = 0; const unplacedBy = new Map();
  const get = (z, s) => stock.get(z).get(s) || 0;
  const put = (z, s, q) => { if (q) stock.get(z).set(s, q); else stock.get(z).delete(s); };
  const first = (ev.find(e => e.type === 'count') || {}).day;
  if (!first) return { stock, base, info, variance, unplaced, unplacedBy, first: null };
  const days = [...new Set([...ev.map(e => e.day), ...[...sd.days.keys()].filter(d => d >= first)])].sort();
  const byDay = new Map(); ev.forEach(e => { if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); });
  const display = zoneIds;
  for (const day of days) {
    for (const e of byDay.get(day) || []) {
      if (e.type === 'count') {
        for (const c of e.counts) {
          if (!stock.has(c.zone)) continue;
          const now = new Map(c.lines), seen = new Set([...stock.get(c.zone).keys(), ...now.keys()]);
          for (const s of seen) {
            const exp = get(c.zone, s), act = now.get(s) || 0;
            if (exp !== act && day >= first && info.get(c.zone).counted) variance.push([day, c.zone, s, exp, act, e.by]);
          }
          stock.set(c.zone, new Map([...now].filter(x => x[1] > 0)));
          base.set(c.zone, new Map(stock.get(c.zone)));
          info.set(c.zone, { counted: day, inQ: 0, outQ: 0, sold: new Map(), recv: new Map() });
        }
      } else if (e.type === 'in') {
        if (!stock.has(e.zone)) continue;
        const inf = info.get(e.zone);
        for (const [s, q] of e.lines) { put(e.zone, s, get(e.zone, s) + q); inf.inQ += q; inf.recv.set(s, (inf.recv.get(s) || 0) + q); }
      } else if (e.type === 'move') {
        for (const m of e.moves) {
          if (!stock.has(m.from) || !stock.has(m.to)) continue;
          for (const [s, q0] of m.lines) {
            const q = Math.min(q0, get(m.from, s)); if (!q) continue;
            put(m.from, s, get(m.from, s) - q); put(m.to, s, get(m.to, s) + q);
            info.get(m.from).outQ += q; info.get(m.to).inQ += q;
            info.get(m.to).recv.set(s, (info.get(m.to).recv.get(s) || 0) + q);
          }
        }
      }
    }
    const x = sd.days.get(day); if (!x) continue;
    x.k.forEach((k, sku) => {
      let q = Math.round(k.qty); if (!q) return;
      if (q < 0) { put(BS, sku, get(BS, sku) - q); return; } // a return goes back to back stock
      while (q > 0) {
        let best = null, bq = 0;
        for (const z of display) { const h = get(z, sku); if (h > bq) { best = z; bq = h; } }
        if (!best && get(BS, sku) > 0) best = BS;
        if (!best) { unplaced += q; unplacedBy.set(sku, (unplacedBy.get(sku) || 0) + q); break; }
        const take = 1; // one piece at a time, so a sale spreads over the zones that hold the most
        put(best, sku, get(best, sku) - take);
        const sold = info.get(best).sold; sold.set(sku, (sold.get(sku) || 0) + take);
        q -= take;
      }
    });
  }
  return { stock, base, info, variance, unplaced, unplacedBy, first };
}

async function readAll(st) {
  const [layout, sd, data] = await Promise.all([load(st), storeDaily(st), store.getJSON(key(st))]);
  const d = data || { store: st, events: [], names: {} };
  const zoneIds = layout.zones.slice().sort((a, b) => a.n - b.n).map(z => z.id);
  return { layout, sd, data: d, zoneIds };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const a = await access(req);
  if (a.code === 401) return send(res, 401, { ok: false, error: 'sign-in-required' });
  if (a.code) return send(res, 403, { ok: false, error: 'No access.' });
  const url = new URL(req.url, 'https://x.invalid');
  const canStore = (st, branches) => a.role !== 'store' || st === ownBranch(a.own, branches);

  if (req.method === 'GET') {
    const st = url.searchParams.get('store');
    if (!st) {
      const sd = await storeDaily('');
      const stores = a.role === 'store' ? [ownBranch(a.own, sd.branches)] : sd.branches;
      return send(res, 200, { ok: true, role: a.role, stores });
    }
    const all = await readAll(st);
    if (!canStore(st, all.sd.branches)) return send(res, 403, { ok: false, error: 'This is not your store.' });
    const { layout, sd, data, zoneIds } = all;
    if (url.searchParams.get('plan')) {
      const part = Number(url.searchParams.get('part') || 0);
      const f = layout.plan && layout.files.find(f => f.id === layout.plan);
      if (!f || !(part >= 0 && part < (f.parts || 1))) return res.status(404).end();
      const p = await store.getJSON('vmz/f/' + slug(st) + '-' + f.id + '-' + part + '.json');
      if (!p) return res.status(404).end();
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Type', f.type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).end(Buffer.from(p.data, 'base64'));
    }
    const r = replay(data, sd, zoneIds);
    const name = s => data.names[s] || sd.names.get(s) || '';
    const zones = [...layout.zones.map(z => ({ id: z.id, n: z.n, where: z.where, x: z.x, y: z.y, w: z.w, h: z.h })), { id: BS, n: 0, where: 'Back stock' }]
      .map(z => {
        const inf = r.info.get(z.id), now = r.stock.get(z.id), base = r.base.get(z.id);
        const skus = [...new Set([...base.keys(), ...now.keys(), ...inf.sold.keys(), ...inf.recv.keys()])].sort();
        // [sku, name, counted, received or moved in, sold, now]
        const items = skus.map(s => [s, name(s), base.get(s) || 0, inf.recv.get(s) || 0, inf.sold.get(s) || 0, now.get(s) || 0]);
        let sold = 0; inf.sold.forEach(q => { sold += q; });
        let pcs = 0; now.forEach(q => { pcs += q; });
        return { ...z, counted: inf.counted, pcs, sold, inQ: inf.inQ, outQ: inf.outQ, items };
      });
    const events = data.events.slice(-300).reverse().map(e => ({
      id: e.id, day: e.day, t: e.t, type: e.type, by: e.by, note: e.note || '',
      zones: e.type === 'count' ? e.counts.map(c => c.zone) : e.type === 'in' ? [e.zone] : e.moves.map(m => m.from + '>' + m.to),
      pcs: e.type === 'count' ? e.counts.reduce((s, c) => s + c.lines.reduce((t, l) => t + l[1], 0), 0)
        : e.type === 'in' ? e.lines.reduce((t, l) => t + l[1], 0) : e.moves.reduce((s, m) => s + m.lines.reduce((t, l) => t + l[1], 0), 0)
    }));
    const plan = layout.plan && layout.files.find(f => f.id === layout.plan);
    return send(res, 200, {
      ok: true, role: a.role, store: st, today: today(), lastSalesDay: sd.maxDay, started: r.first,
      zones, events, plan: plan ? { parts: plan.parts || 1 } : null,
      variance: r.variance.slice(-2000).map(v => [v[0], v[1], v[2], name(v[2]), v[3], v[4], v[5]]),
      unplaced: r.unplaced, unplacedItems: [...r.unplacedBy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 200).map(([s, q]) => [s, name(s), q])
    });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const op = url.searchParams.get('op');
  const b = await readJSON(req);
  if (!b || typeof b.store !== 'string' || !b.store.trim() || b.store.length > 80) return send(res, 400, { ok: false, error: 'Pick a store.' });
  const st = b.store.trim();
  const all = await readAll(st);
  if (!canStore(st, all.sd.branches)) return send(res, 403, { ok: false, error: 'This is not your store.' });
  const { data, zoneIds } = all;
  const zoneOk = z => z === BS || zoneIds.includes(z);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') && b.day <= today() ? b.day : today();
  const note = String(b.note || '').slice(0, 120);
  const e = { id: crypto.randomBytes(6).toString('hex'), day, t: Date.now(), by: a.by, note };
  const addNames = n => Object.assign(data.names, n);

  if (op === 'count') {
    if (a.role === 'vm') return send(res, 403, { ok: false, error: 'Counts are done by the store.' });
    if (!Array.isArray(b.counts) || !b.counts.length || b.counts.length > 40) return send(res, 400, { ok: false, error: 'Nothing to save.' });
    e.type = 'count'; e.counts = [];
    for (const c of b.counts) {
      if (!zoneOk(c.zone)) return send(res, 400, { ok: false, error: 'Unknown zone.' });
      const cl = Array.isArray(c.lines) && !c.lines.length ? { lines: [], names: {} } : cleanLines(c.lines, true);
      if (!cl) return send(res, 400, { ok: false, error: 'Bad count lines. Each line needs a SKU and a quantity.' });
      addNames(cl.names); e.counts.push({ zone: c.zone, lines: cl.lines });
    }
  } else if (op === 'in') {
    if (a.role === 'vm') return send(res, 403, { ok: false, error: 'Goods are received by the store.' });
    if (!zoneOk(b.zone)) return send(res, 400, { ok: false, error: 'Pick a zone.' });
    const cl = cleanLines(b.lines, false);
    if (!cl || !cl.lines.length) return send(res, 400, { ok: false, error: 'Add at least one item with a quantity.' });
    addNames(cl.names); Object.assign(e, { type: 'in', zone: b.zone, lines: cl.lines });
  } else if (op === 'move') {
    if (!Array.isArray(b.moves) || !b.moves.length || b.moves.length > 60) return send(res, 400, { ok: false, error: 'Nothing to move.' });
    // check against the stock now, so nobody moves pieces that are not there
    const r = replay(data, all.sd, zoneIds);
    const left = new Map();
    e.type = 'move'; e.moves = [];
    for (const m of b.moves) {
      if (!zoneOk(m.from) || !zoneOk(m.to) || m.from === m.to) return send(res, 400, { ok: false, error: 'Pick two different zones.' });
      const cl = cleanLines(m.lines, false);
      if (!cl || !cl.lines.length) continue;
      for (const [s, q] of cl.lines) {
        const k = m.from + '|' + s, have = left.has(k) ? left.get(k) : (r.stock.get(m.from).get(s) || 0);
        if (q > have) return send(res, 400, { ok: false, error: `${s}: ${q} pcs asked, only ${have} in ${m.from === BS ? 'back stock' : 'that zone'}.` });
        left.set(k, have - q);
      }
      e.moves.push({ from: m.from, to: m.to, lines: cl.lines });
    }
    if (!e.moves.length) return send(res, 400, { ok: false, error: 'Nothing to move.' });
  } else if (op === 'undo') {
    const i = data.events.findIndex(x => x.id === b.id);
    if (i < 0) return send(res, 404, { ok: false, error: 'Not found.' });
    if (a.role !== 'admin' && data.events[i].by !== a.by) return send(res, 403, { ok: false, error: 'Only the person who saved it, or the super admin, can undo it.' });
    data.events.splice(i, 1);
    await store.putJSON(key(st), data);
    return send(res, 200, { ok: true });
  } else {
    return send(res, 400, { ok: false, error: 'Unknown action.' });
  }
  if (data.events.length >= MAX_EVENTS) return send(res, 400, { ok: false, error: 'This store has too many movements saved. Ask the super admin to archive.' });
  data.events.push(e); data.store = st;
  await store.putJSON(key(st), data);
  return send(res, 200, { ok: true, id: e.id });
};
