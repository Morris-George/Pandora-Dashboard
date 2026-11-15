// Campaigns (promotions) for the "Campaign uplift" part of Pandora Dashboards: a name, the dates it ran, and (optionally) which weekdays.
// Reached at /api/campaigns (vercel.json rewrites it to api/vm.js: the Hobby plan allows 12 functions).
//   GET  /api/campaigns              anyone who can open Pandora Dashboards: the saved campaigns (+ canEdit)
//   POST /api/campaigns              super admin and overseer: {op:'save', campaign:{id?, name, from, to, days?, note?}} or {op:'delete', id}
// Only names and dates are kept here. The uplift itself is worked out in the page from the sales that person may already see.
const crypto = require('crypto');
const store = require('./_store');
const { whoami } = require('./_auth');

const FILE = 'campaigns/list.json';
const MAX = 200;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = null; } }
  return b && typeof b === 'object' ? b : null;
}
// -> a clean campaign, or a sentence saying what is wrong
function clean(c) {
  if (!c || typeof c !== 'object') return 'Bad campaign.';
  const name = String(c.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return 'Give the campaign a name.';
  let from = String(c.from || ''), to = String(c.to || '');
  if (!ISO.test(from) || !ISO.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return 'Choose the first and the last day of the campaign.';
  if (from > to) [from, to] = [to, from];
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 366) return 'A campaign can run for a year at most.';
  let days = Array.isArray(c.days) ? [...new Set(c.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
  if (days.length === 7) days = []; // every weekday = no weekday rule
  const note = String(c.note || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return { name, from, to, days, note };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return send(res, 503, { ok: false, error: 'storage-not-configured' });
  const who = await whoami(req);
  if (!who) return send(res, 401, { ok: false, error: 'sign-in-required' });
  // the same people who can read the Dashboards sales: super admin, overseers and area managers
  const admin = who.kind === 'env' && who.info.role === 'admin';
  if (!(admin || (who.kind === 'env' && !!who.info.allow))) return send(res, 403, { ok: false, error: 'No access.' });
  const list = ((await store.getJSON(FILE)) || []).filter(c => c && c.id);

  if (req.method === 'GET') return send(res, 200, { ok: true, canEdit: admin && !who.viewAs, campaigns: list });

  if (req.method === 'POST') {
    if (!admin) return send(res, 403, { ok: false, error: 'Only the super admin can change campaigns.' });
    const b = body(req);
    if (!b) return send(res, 400, { ok: false, error: 'Bad request.' });
    if (b.op === 'delete') {
      const id = String(b.id || '');
      const next = list.filter(c => c.id !== id);
      if (next.length === list.length) return send(res, 404, { ok: false, error: 'That campaign is no longer saved.' });
      await store.putJSON(FILE, next);
      return send(res, 200, { ok: true, campaigns: next });
    }
    if (b.op === 'save') {
      const c = clean(b.campaign);
      if (typeof c === 'string') return send(res, 400, { ok: false, error: c });
      const id = String((b.campaign && b.campaign.id) || '');
      const at = new Date().toISOString();
      let next, saved;
      if (id && list.some(x => x.id === id)) { next = list.map(x => x.id === id ? (saved = { ...x, ...c, updatedAt: at }) : x); }
      else {
        if (list.length >= MAX) return send(res, 400, { ok: false, error: 'Too many campaigns. Remove an old one first.' });
        saved = { id: crypto.randomBytes(6).toString('hex'), ...c, createdAt: at };
        next = list.concat(saved);
      }
      next.sort((x, y) => String(y.from).localeCompare(String(x.from)));
      await store.putJSON(FILE, next);
      return send(res, 200, { ok: true, id: saved.id, campaigns: next });
    }
    return send(res, 400, { ok: false, error: 'Bad request.' });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { ok: false, error: 'Method not allowed' });
};
module.exports.clean = clean;
