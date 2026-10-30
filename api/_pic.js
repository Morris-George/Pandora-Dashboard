// Product picture address by SKU (reached at /api/pic, rewritten to api/erp.js: the Hobby plan allows 12 functions, so this is a helper).
//   GET /api/pic?sku=594594C00-17   any signed-in user -> { ok, url } (the pandoraeg.com picture) or { ok, url: '' }
// The browser cannot ask pandoraeg.com itself (blocked by the site's cross-origin rules), so the server does it and remembers the answer.
const { whoami } = require('./_auth');

const memo = new Map(); // base sku -> { url, at }
const DAY = 24 * 3600 * 1000;

function send(res, code, obj) {
  res.setHeader('Cache-Control', code === 200 ? 'private, max-age=86400' : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(code).json(obj);
}

async function find(base) {
  const hit = memo.get(base);
  if (hit && Date.now() - hit.at < DAY) return hit.url;
  let url = '';
  try {
    const r = await fetch('https://pandoraeg.com/search/suggest.json?q=' + encodeURIComponent(base) + '&resources[type]=product&resources[limit]=4', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      const list = (j.resources && j.resources.results && j.resources.results.products) || [];
      const b = base.toLowerCase();
      const p = list.find(x => String(x.handle || x.url || '').toLowerCase().includes(b)) || list[0];
      const u = p && (p.image || (p.featured_image && p.featured_image.url));
      if (u && /^https?:\/\/[^/]*(shopify|pandoraeg)[^/]*\//i.test(u)) url = String(u).replace(/^http:/, 'https:');
    }
  } catch (_) { /* leave empty: the page keeps its small picture */ }
  if (memo.size > 3000) memo.clear();
  memo.set(base, { url, at: Date.now() });
  return url;
}

module.exports = async function pic(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!(await whoami(req))) return send(res, 401, { ok: false, error: 'sign-in-required' });
  const u = new URL(req.url, 'https://x.invalid');
  const base = String(u.searchParams.get('sku') || '').trim().toUpperCase().split('-')[0];
  if (!/^[A-Z0-9]{4,20}$/.test(base)) return send(res, 200, { ok: true, url: '' });
  return send(res, 200, { ok: true, url: await find(base) });
};
