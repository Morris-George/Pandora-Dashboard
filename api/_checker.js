// Stock Checker access (reached at /api/checker, rewritten to api/vm.js: the Hobby plan allows 12 functions).
//   GET /api/checker   what this person may open: { role, by, own, stores:[...] }
// Stock Checker is only a counting helper: scans, names and totals live on the phone / tablet that made them (browser storage).
// Nothing is saved on the server, so there is no scan data to protect or clean up. This file only decides WHICH STORE a person counts for:
//   super admin = any store; area managers = the stores of their zone; store managers and sales people = their own store;
//   a phone opened from a store's QR code (no login) = that one store (the store is inside the signed link, see api/_pair.js).
const { whoami } = require('./_auth');
const pair = require('./_pair');
const { CANON, canon } = require('./_daily');

function send(res, code, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}
const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const firstName = u => { const f = String(u || '').trim().split(/[\s._-]+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ''; };

// -> { role:'admin'|'area'|'store'|'staff'|'phone', by, own?, allow? } | { code }
async function access(req) {
  const who = await whoami(req);
  if (who) {
    if (who.kind === 'env') {
      if (who.info.overseer) return { code: 403 }; // the brand manager does not use Stock Checker
      if (who.info.role === 'admin') return { role: 'admin', by: 'Super admin' };
      return { role: 'area', by: firstName(who.account.user) || who.account.label || 'Area manager', allow: (who.info.allow || []).map(a => new RegExp(a, 'i')) };
    }
    if (who.kind === 'staff' && who.info.self && who.info.self.store) {
      if (/online|e-?commerce|website/i.test(who.info.self.store)) return { code: 403 };
      return { role: who.info.role === 'store' ? 'store' : 'staff', by: cleanName(who.user.name) || 'Staff', own: canon(who.info.self.store) };
    }
    return { code: 403 };
  }
  const ps = pair.storeOf(req, 'checker'); // a phone that opened a store's QR code
  if (ps) return { role: 'phone', by: '', own: canon(ps) };
  return { code: 401 };
}
const storesFor = a => a.role === 'admin' ? CANON.map(c => c.name) : a.role === 'area' ? CANON.map(c => c.name).filter(n => a.allow.some(rx => rx.test(n))) : [a.own];

module.exports = async function handler(req, res) {
  const a = await access(req);
  if (a.code) return send(res, a.code, { ok: false, error: a.code === 401 ? 'Please sign in again.' : 'You do not have access to Stock Checker.' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  return send(res, 200, { ok: true, role: a.role, by: a.by, own: a.own || '', stores: storesFor(a) });
};
module.exports.access = access;
