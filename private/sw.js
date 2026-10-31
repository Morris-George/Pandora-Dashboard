/* Pandora Stock Count: works without internet.
   - the Stock Count page is saved on the device each time it opens online, and opened from that copy when there is no internet
   - the libraries it needs (Excel reader, barcode scanner, QR code, fonts) and the product pictures are saved too
   - the data itself (count, scans waiting to sync) is kept by the page in the device storage, never here
   This file never touches /api: every data call goes straight to the network. */
const V = 'pandora-sc-__BUILD__';
const PAGE = '/stockcount';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
];
const LOCAL = ['/favicon.png?v=2', '/pandora-logo.png', '/icon-192.png', '/icon-512.png', '/stockcount.webmanifest',
  '/stockcount-pics-1.js', '/stockcount-pics-2.js', '/stockcount-pics-3.js', '/stockcount-pics-4.js'];
const CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pandora-sc-') && k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isPage = u => u.origin === self.location.origin && /^\/stockcount(\.html|\/)?$/.test(u.pathname);
const isLocalStatic = u => u.origin === self.location.origin && /^\/(stockcount-pics-[1-9]\.js|pandora-logo\.png|favicon\.png|icon-(192|512)\.png|stockcount\.webmanifest)$/.test(u.pathname);
const isCdn = u => CDN.includes(u.hostname);
const good = r => !!r && (r.type === 'opaque' || (r.ok && !r.redirected));   // a redirect to the sign-in page is never saved

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin && u.pathname.startsWith('/api/')) return;   // data is never cached here
  if (req.mode === 'navigate' && isPage(u)) { e.respondWith(openPage(e)); return; }
  if (isLocalStatic(u) || isCdn(u)) e.respondWith(fromCacheFirst(req));
});

/* the page: the internet copy when it answers (and keep it), the saved copy when it does not */
async function openPage(e) {
  const cache = await caches.open(V);
  const net = fetch(e.request).then(async r => {
    if (r && r.ok && r.type === 'basic' && /text\/html/i.test(r.headers.get('content-type') || '')) await cache.put(PAGE, r.clone());
    return r;
  });
  const saved = await cache.match(PAGE);
  if (!saved) return net;                       // first time on this device: needs the internet once
  e.waitUntil(net.catch(() => {}));
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
  } catch (_) { return saved; }
}

/* libraries, fonts and pictures: saved copy first, otherwise fetch and save */
async function fromCacheFirst(req) {
  const cache = await caches.open(V);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (good(r)) cache.put(req, r.clone()).catch(() => {});
    return r;
  } catch (err) {
    return Response.error();
  }
}

async function put(cache, url, opts) {
  try {
    if (await cache.match(url)) return true;
    const r = await fetch(url, opts);
    if (!good(r)) return false;
    await cache.put(url, r.clone());
    return r;
  } catch (_) { return false; }
}

/* the page asks for everything to be saved once it is open: after this the site works with no internet */
async function warm() {
  const cache = await caches.open(V);
  let pageOk = false;
  try {
    const r = await fetch(PAGE, { credentials: 'same-origin', cache: 'reload' });
    if (r.ok && !r.redirected && r.type === 'basic' && /text\/html/i.test(r.headers.get('content-type') || '')) { await cache.put(PAGE, r); pageOk = true; }
  } catch (_) {}
  if (!pageOk) pageOk = !!(await cache.match(PAGE));
  const results = await Promise.all([...LIBS.map(u => put(cache, u, { mode: 'no-cors' })), ...LOCAL.map(u => put(cache, u))]);
  // fonts: the stylesheet, then the font files it points to
  try {
    let css = await cache.match(FONT_CSS), text = '';
    if (!css) {
      const r = await fetch(FONT_CSS);
      if (r.ok) { await cache.put(FONT_CSS, r.clone()); text = await r.text(); }
    } else text = await css.clone().text();
    const urls = [...new Set((text.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || []))];
    await Promise.all(urls.map(u => put(cache, u, { mode: 'no-cors' })));
  } catch (_) {}
  const libsOk = results.slice(0, LIBS.length).every(Boolean);
  return pageOk && libsOk;
}

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'warm') {
    const src = e.source;
    e.waitUntil(warm().then(ok => src && src.postMessage({ type: 'warm-done', ok }), () => src && src.postMessage({ type: 'warm-done', ok: false })));
  }
});
