// Shipment Receiving: the admin uploads the commercial invoice (SKU, EAN, quantity, cost in USD), then two teams count the
// same shipment box by box, each on its own: Accounts and Warehouse. The report lines up invoice, accounts and warehouse.
//   GET  /api/recv                     shipments
//   GET  /api/recv?id=<id>             one shipment with every team's counts (Finance and Warehouse see the report too)
//   POST /api/recv?op=new      manage  {name, invoice, boxes, lines:[[sku, ean, qty, cost, pool]]}
//   POST /api/recv?op=status   manage  {id, status: Open|Closed}
//   POST /api/recv?op=delete   manage  {id}
//   POST /api/recv?op=scan     team    {id, box, code (EAN or SKU), n: 1|-1}
//   POST /api/recv?op=clearbox team    {id, box, item?}   wipes what the caller's team scanned into that box (or only that item)
// Each person's scans live in their own file (rc/x/<id>/<team>/<person>.json), so people scanning at the same time never
// overwrite each other; the report adds the files up.
// /api/recv is rewritten to /api/erp?recv=1 (vercel.json): the Hobby plan allows 12 functions.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');
const { keyOf } = require('./_refill');

const ACCESS = 'rc/access.json';
const INDEX = 'rc/index.json';
const LEVELS = ['none', 'accounts', 'warehouse', 'view', 'manage'];
const TEAMS = { accounts: 'Finance', warehouse: 'Warehouse' };
const MAX_BOXES = 50;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
async function readJSON(req) {
  let b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (!b) { const chunks = []; for await (const c of req) chunks.push(c); b = Buffer.concat(chunks); }
  try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : b); } catch (_) { return null; }
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const num = v => { const n = Number(String(v == null ? 0 : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
const skuOf = v => str(v, 40).toUpperCase().replace(/\.0$/, '');
const eanOf = v => str(v, 20).replace(/\.0$/, '').replace(/\D/g, '');
const isAdmin = who => !!who && who.kind === 'env' && who.info.role === 'admin' && !who.info.overseer;
async function levelFor(who) {
  if (!who) return 'none';
  if (isAdmin(who)) return 'manage';
  const acc = (await store.getJSON(ACCESS)) || {};
  return LEVELS.includes(acc[keyOf(who)]) ? acc[keyOf(who)] : 'none';
}
const nameOf = who => who.kind === 'env' ? String((who.user && who.user.name) || who.account.user || 'Admin') : String((who.user && (who.user.name || who.user.username)) || '');
const personKey = who => crypto.createHash('sha1').update(keyOf(who)).digest('hex').slice(0, 12);
const fileOf = (id, team, pk) => 'rc/x/' + id + '/' + team + '/' + pk + '.json';

// every person's file of one shipment, read in parallel: [{team, file, data}]
async function scansOf(id) {
  const paths = (await store.list('rc/x/' + id + '/')).filter(p => /\.json$/.test(p));
  const out = await Promise.all(paths.map(async p => ({ team: p.split('/')[3], file: p, data: await store.getJSON(p) })));
  return out.filter(x => x.data && TEAMS[x.team]);
}
// per team: {boxes:{box:{code:n}}, people:[{by, pcs, at}]}
function addUp(files, onlyTeam) {
  const out = {};
  for (const t of Object.keys(TEAMS)) if (!onlyTeam || t === onlyTeam) out[t] = { boxes: {}, people: [] };
  for (const f of files) {
    if (!out[f.team]) continue;
    const T = out[f.team]; let pcs = 0;
    for (const [bx, m] of Object.entries(f.data.boxes || {})) for (const [c, n] of Object.entries(m)) { if (!n) continue; const B = T.boxes[bx] || (T.boxes[bx] = {}); B[c] = (B[c] || 0) + n; pcs += n; }
    T.people.push({ by: f.data.by || '', pcs, at: f.data.at || '' });
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const lvl = await levelFor(who);
  if (lvl === 'none') return send(res, 403, { ok: false, error: 'No access to Shipment Receiving. Ask the super admin.' });
  const url = new URL(req.url, 'https://x.invalid'), by = nameOf(who), mg = lvl === 'manage', sees = true, team = TEAMS[lvl] ? lvl : '';

  if (req.method === 'GET') {
    const idx = (await store.getJSON(INDEX)) || [];
    const id = url.searchParams.get('id');
    if (!id) {
      const list = idx.slice().reverse().filter(s => sees || s.status === 'Open').map(s => sees ? s : { id: s.id, name: s.name, invoice: s.invoice, status: s.status, boxes: s.boxes });
      return send(res, 200, { ok: true, level: lvl, team, teams: TEAMS, shipments: list });
    }
    if (!/^[a-f0-9]{12}$/.test(id)) return send(res, 404, { ok: false, error: 'Not found.' });
    const o = await store.getJSON('rc/s/' + id + '.json');
    if (!o || (!sees && o.status !== 'Open')) return send(res, 404, { ok: false, error: 'Not found.' });
    const files = await scansOf(id);
    if (sees) return send(res, 200, { ok: true, level: lvl, team, teams: TEAMS, shipment: o, counts: addUp(files) });
    // a scanner: the codes to recognise a piece (no quantities, no costs) and only its own team's counts
    return send(res, 200, { ok: true, level: lvl, team, teams: TEAMS, shipment: { id: o.id, name: o.name, invoice: o.invoice, status: o.status, boxes: o.boxes, lines: o.lines.map(l => [l[0], l[1]]) }, counts: addUp(files, team) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  const op = url.searchParams.get('op'), b = await readJSON(req);
  if (!b) return send(res, 400, { ok: false, error: 'Bad request.' });

  if (op === 'scan' || op === 'clearbox') {
    // a manager may scan for either team; everyone else scans for their own team only
    const t = mg && TEAMS[b.team] ? b.team : team;
    if (!t) return send(res, 403, { ok: false, error: 'Your access does not allow scanning.' });
    const id = str(b.id, 12); if (!/^[a-f0-9]{12}$/.test(id)) return send(res, 404, { ok: false, error: 'Not found.' });
    const o = await store.getJSON('rc/s/' + id + '.json');
    if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
    if (o.status !== 'Open') return send(res, 409, { ok: false, error: 'This shipment is closed. Ask the admin to open it again.' });
    const box = Math.round(num(b.box));
    if (!(box >= 1 && box <= (o.boxes || MAX_BOXES))) return send(res, 400, { ok: false, error: 'Pick a box first.' });
    if (op === 'clearbox') {
      // the whole team's scans in that box, whoever scanned them
      const files = (await scansOf(id)).filter(f => f.team === t);
      let gone = 0;
      if (b.item != null) {
        // only one item of the box, whoever of the team scanned it
        const item = str(b.item, 41);
        for (const f of files) { const m = (f.data.boxes || {})[box]; if (!m || !m[item]) continue; gone += m[item]; delete m[item]; if (!Object.keys(m).length) delete f.data.boxes[box]; f.data.at = new Date().toISOString(); await store.putJSON(f.file, f.data); }
        return send(res, 200, { ok: true, box, cleared: gone });
      }
      for (const f of files) { const m = (f.data.boxes || {})[box]; if (!m) continue; gone += Object.values(m).reduce((a, n) => a + n, 0); delete f.data.boxes[box]; f.data.at = new Date().toISOString(); await store.putJSON(f.file, f.data); }
      return send(res, 200, { ok: true, box, cleared: gone });
    }
    const raw = str(b.code, 40), e = eanOf(raw), s = skuOf(raw);
    const l = o.lines.find(x => (e && x[1] === e) || x[0] === s);
    const code = l ? l[0] : '?' + (e || s);   // a piece that is not on the invoice is kept under "?<code>"
    if (!raw) return send(res, 400, { ok: false, error: 'Scan a code.' });
    const n = b.n === -1 ? -1 : 1, file = fileOf(id, t, personKey(who));
    const me = (await store.getJSON(file)) || { by, boxes: {} };
    const m = me.boxes[box] || (me.boxes[box] = {});
    if (n < 0 && !(m[code] > 0)) return send(res, 409, { ok: false, error: 'Nothing of ' + (l ? l[0] : raw) + ' to take back in box ' + box + ' (only your own scans can be taken back).' });
    m[code] = (m[code] || 0) + n; if (!m[code]) delete m[code];
    me.by = by; me.at = new Date().toISOString();
    await store.putJSON(file, me);
    return send(res, 200, { ok: true, code, known: !!l, box, mine: m[code] || 0 });
  }

  if (!mg) return send(res, 403, { ok: false, error: 'Only the admin can do this.' });
  const idx = (await store.getJSON(INDEX)) || [];
  if (op === 'new') {
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 5000).map(l => [skuOf(l[0]), eanOf(l[1]), Math.max(0, Math.round(num(l[2]))), Math.round(num(l[3]) * 100) / 100, str(l[4], 30)]).filter(l => l[0] && l[2] > 0);
    if (!lines.length) return send(res, 400, { ok: false, error: 'The invoice has no lines with a SKU and a quantity.' });
    // the same SKU twice on the invoice: one line, quantities added
    const one = new Map();
    for (const l of lines) { const x = one.get(l[0]); if (x) { x[2] += l[2]; x[1] = x[1] || l[1]; } else one.set(l[0], l); }
    const id = crypto.randomBytes(6).toString('hex'), at = new Date().toISOString();
    const o = { id, name: str(b.name, 80) || 'Shipment', invoice: str(b.invoice, 40), boxes: Math.min(MAX_BOXES, Math.max(1, Math.round(num(b.boxes)) || MAX_BOXES)), status: 'Open', at, by, lines: [...one.values()], log: [{ at, by, what: 'Uploaded' }] };
    await store.putJSON('rc/s/' + id + '.json', o);
    idx.push({ id, name: o.name, invoice: o.invoice, boxes: o.boxes, status: o.status, at, by, skus: o.lines.length, pcs: o.lines.reduce((a, l) => a + l[2], 0), usd: Math.round(o.lines.reduce((a, l) => a + l[2] * l[3], 0) * 100) / 100 });
    await store.putJSON(INDEX, idx);
    return send(res, 200, { ok: true, id });
  }
  const id = str(b.id, 12), i = idx.findIndex(s => s.id === id);
  if (i < 0) return send(res, 404, { ok: false, error: 'Not found.' });
  if (op === 'status') {
    const st = b.status === 'Closed' ? 'Closed' : 'Open', o = await store.getJSON('rc/s/' + id + '.json');
    if (!o) return send(res, 404, { ok: false, error: 'Not found.' });
    o.status = st; (o.log = o.log || []).push({ at: new Date().toISOString(), by, what: st === 'Closed' ? 'Closed' : 'Opened again' });
    await store.putJSON('rc/s/' + id + '.json', o);
    idx[i].status = st; await store.putJSON(INDEX, idx);
    return send(res, 200, { ok: true, status: st });
  }
  if (op === 'delete') {
    for (const p of await store.list('rc/x/' + id + '/')) await store.del(p).catch(() => {});
    await store.del('rc/s/' + id + '.json').catch(() => {});
    idx.splice(i, 1); await store.putJSON(INDEX, idx);
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { ok: false, error: 'Unknown action.' });
};
module.exports.levelFor = levelFor;
module.exports.LEVELS = LEVELS;
module.exports.ACCESS = ACCESS;
