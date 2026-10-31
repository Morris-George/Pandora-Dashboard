
const fs = require('fs');
const path = require('path');
const { appsFor, sessionFacts, greetName } = require('./_apps');
const pair = require('./_pair');
const MOTION = require('./_motion');
const HEADER = require('./_header');

const PRIVATE_DIR = path.join(process.cwd(), 'private');

// ---- shared page chrome: theme (light/dark) + Switch project + Log out ----
const THEME_HEAD = '<style id="pandora-theme-css">' +
  ':root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}' +
  '.pandora-sw{position:relative;width:58px;height:30px;padding:0;border:1px solid rgba(128,128,128,.45);border-radius:999px;cursor:pointer;flex:0 0 auto;background:#efe7e1;transition:background .2s}.pandora-sw.is-dark{background:#3a3530}.pandora-sw .pknob{position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#ffd27a;color:#5a3d00;transition:transform .2s,background .2s,color .2s}.pandora-sw.is-dark .pknob{transform:translateX(28px);background:#4b5078;color:#e8ecff}.pandora-sw svg{width:14px;height:14px;display:block}.pandora-sw .moon{display:none}.pandora-sw.is-dark .moon{display:block}.pandora-sw.is-dark .sun{display:none}.pandora-sw:focus-visible{outline:2px solid #d85b83;outline-offset:2px}.pandora-sw.fixed{position:fixed;top:12px;right:12px;z-index:9999}@media (prefers-reduced-motion:reduce){.pandora-sw,.pandora-sw .pknob{transition:none}}' +
  '.pandora-fab{position:fixed;top:12px;right:12px;z-index:9999;border:1px solid rgba(128,128,128,.4);' +
  'background:rgba(255,255,255,.9);color:#282522;border-radius:10px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}' +
  ':root[data-theme="dark"] .pandora-fab{background:rgba(33,31,29,.92);color:#f7f2ed}' +
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pandora-fab{background:rgba(33,31,29,.92);color:#f7f2ed}}' +
  '</style><script>(function(){try{var t=localStorage.getItem("pandora-theme");' +
  'if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();</script>' + MOTION;

// Activity log (api/_activity.js): tells the server which page was opened and for how long it was actually in use
// (page visible and the person touching it; a page left open and idle is not counted). Nothing about what is on the page is sent.
const BEACON = String.raw`<script>(function(){try{
var p=location.pathname;if(p.replace(/\/+$/,'')==='/activity')return;
var id=Math.random().toString(36).slice(2,12),x='',act=0,last=Date.now();
try{if(/^\/staff\/person/.test(p)){var q=new URLSearchParams(location.search);x=[q.get('name'),q.get('store')].filter(Boolean).join(' · ')}}catch(e){}
function send(o){try{var j=JSON.stringify(o);if(!(navigator.sendBeacon&&navigator.sendBeacon('/api/activity',new Blob([j],{type:'application/json'}))))fetch('/api/activity',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:j,keepalive:true}).catch(function(){})}catch(e){}}
['pointerdown','keydown','scroll','touchstart','mousemove'].forEach(function(n){addEventListener(n,function(){last=Date.now()},{passive:true,capture:true})});
setInterval(function(){if(document.visibilityState==='visible'&&Date.now()-last<120000)act+=5},5000);
setTimeout(function(){send({t:'open',id:id,p:p,x:x})},1200);
function leave(){if(act>=5){send({t:'leave',id:id,p:p,x:x,secs:act});act=0}}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')leave()});
addEventListener('pagehide',leave);
}catch(e){}})();</script>`;

// kind: 'dashboards' | 'staff' | 'home' | 'login'.  multi: the person can open more than one thing, so a Home button is shown.
function chromeScript(kind, multi) {
  return '<script>(function(){' +
  'var kind=' + JSON.stringify(kind) + ',multi=' + (multi ? 'true' : 'false') + ';' +
  'var bar=document.querySelector(".top-actions")||document.querySelector(".actions");' +
  'var cls=document.querySelector(".top-actions")?"secondary":(document.querySelector(".actions")?"btn":"pandora-fab");' +
  'function mk(text){var b=document.createElement("button");b.type="button";b.className=(bar?cls:"pandora-fab")+" hideclean";b.textContent=text;' +
  'if(!bar){b.style.cssText="";}return b}' +
  'function place(el){if(bar)bar.appendChild(el);else{document.body.appendChild(el);}}' +
  'function cur(){return document.documentElement.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}' +
  'var t=document.createElement("button");t.type="button";t.id="themeBtn";t.setAttribute("role","switch");t.className="pandora-sw hideclean"+(bar?"":" fixed");' +
  't.innerHTML="<span class=pknob><svg class=sun viewBox=\\"0 0 24 24\\" fill=none stroke=currentColor stroke-width=2.4 stroke-linecap=round><circle cx=12 cy=12 r=4.2 fill=currentColor /><path d=\\"M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7\\"/></svg><svg class=moon viewBox=\\"0 0 24 24\\" fill=currentColor><path d=\\"M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z\\"/></svg></span>";' +
  'function sync(){var d=cur()==="dark";t.classList.toggle("is-dark",d);t.setAttribute("aria-checked",d);t.setAttribute("aria-label",d?"Switch to light mode":"Switch to dark mode");t.title=d?"Light mode":"Dark mode"}sync();' +
  't.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";' +
  'document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("pandora-theme",n)}catch(e){}sync()});' +
  'if(kind==="staff"||kind==="dashboards"||kind==="vm"){if(multi){var hm=mk("Home");hm.addEventListener("click",function(){window.__pandoraGo?window.__pandoraGo("/"):(location.href="/")});place(hm);}}' +
  'place(t);' +
  'if(kind!=="login"){' +
  'var lo=mk("Log out");lo.addEventListener("click",function(){lo.style.minWidth=lo.offsetWidth+"px";lo.disabled=true;lo.style.opacity=".55";lo.style.whiteSpace="nowrap";' +
  'try{localStorage.removeItem("storeStaffSummary.v1");sessionStorage.removeItem("storeStaffSummary.v1")}catch(e){}' +
  'fetch("/api/logout",{method:"POST",credentials:"same-origin"}).then(function(r){' +
  'if(r.ok){location.replace("/login.html");}else{throw new Error("x");}' +
  '}).catch(function(){lo.disabled=false;lo.style.opacity="";});});place(lo);' +
  '}' +
  '})();</script>';
}

function withChrome(kind, multi) {
  return function (buf) {
    let html = buf.toString('utf8');
    const h = html.search(/<\/head>/i);
    if (h !== -1) html = html.slice(0, h) + THEME_HEAD + html.slice(h);
    const i = html.lastIndexOf('</body>');
    const at = i === -1 ? html.length : i;
    html = html.slice(0, at) + chromeScript(kind, multi) + (kind === 'login' ? '' : BEACON) + HEADER + html.slice(at);
    return Buffer.from(html, 'utf8');
  };
}

// The service worker's cache name carries a fingerprint of the product-picture files and of the worker itself,
// so a new version of either makes every device fetch fresh copies.
let SW_CACHE = null;
function swSource() {
  if (!SW_CACHE) {
    const crypto = require('crypto');
    const raw = fs.readFileSync(path.join(PRIVATE_DIR, 'sw.js'), 'utf8');
    const h = crypto.createHash('md5').update(raw);
    for (let i = 1; i <= 4; i++) { try { h.update(fs.readFileSync(path.join(PRIVATE_DIR, 'stockcount-pics-' + i + '.js'))); } catch (_) {} }
    SW_CACHE = raw.replace('__BUILD__', h.digest('hex').slice(0, 10));
  }
  return SW_CACHE;
}

function sendFile(res, filename, contentType, transform) {
  try {
    let content = fs.readFileSync(
      path.join(PRIVATE_DIR, filename)
    );
    if (transform) content = transform(content);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    return res.status(200).send(content);
  } catch (_) {
    return res.status(500).send('Site file unavailable.');
  }
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://vercel.invalid');

  const requestedPath = url.searchParams.has('path')
    ? '/' + (url.searchParams.get('path') || '').replace(/^\/+/, '')
    : url.pathname;

  if (requestedPath === '/login.html') {
    return sendFile(res, 'login.html', 'text/html; charset=utf-8', withChrome('login'));
  }

  if (requestedPath === '/signup.html' || requestedPath === '/signup') {
    return sendFile(res, 'signup.html', 'text/html; charset=utf-8', withChrome('login'));
  }

  if (requestedPath === '/forgot.html' || requestedPath === '/forgot') {
    return sendFile(res, 'forgot.html', 'text/html; charset=utf-8', withChrome('login'));
  }

  if (requestedPath === '/pandora-logo.png') {
    return sendFile(res, 'pandora-logo.png', 'image/png');
  }

  if (requestedPath === '/favicon.png' || requestedPath === '/favicon.ico') {
    return sendFile(res, 'favicon.png', 'image/png');
  }

  // Offline support for Stock Count (public files: no data in them, and the page itself still needs the sign-in).
  if (requestedPath === '/sw.js') {
    try {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(swSource());
    } catch (_) { return res.status(500).send('Site file unavailable.'); }
  }
  if (requestedPath === '/stockcount.webmanifest') {
    return sendFile(res, 'stockcount.webmanifest', 'application/manifest+json; charset=utf-8');
  }
  if (requestedPath === '/icon-192.png' || requestedPath === '/icon-512.png') {
    return sendFile(res, requestedPath.slice(1), 'image/png');
  }

  // A phone paired from Stock Count: the link carries a signed token. Valid -> keep it in a cookie that opens only
  // Stock Count, drop it from the address, and open the page ready to scan. Not valid -> the normal sign-in rules below.
  const isCount = requestedPath === '/stockcount' || requestedPath === '/stockcount/' || requestedPath === '/stockcount.html';
  if (isCount && url.searchParams.get('pair') && pair.validToken(url.searchParams.get('pair'), process.env.PANDORA_AUTH_SECRET)) {
    const nm = String(url.searchParams.get('n') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    res.setHeader('Set-Cookie', pair.cookieHeader(url.searchParams.get('pair')));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/stockcount' + (nm ? '#phone=' + encodeURIComponent(nm) : '#phone='));
    return res.status(302).end();
  }
  if ((isCount || /^\/stockcount-pics-[1-9]\.js$/.test(requestedPath)) && pair.hasPair(req)) {
    const f0 = await sessionFacts(req);
    if (!(f0.staff && f0.staff.role === 'admin')) {
      if (isCount) return sendFile(res, 'stockcount.html', 'text/html; charset=utf-8', withChrome('staff', false));
      try {
        const body = fs.readFileSync(path.join(PRIVATE_DIR, requestedPath.slice(1)));
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(body);
      } catch (_) { return res.status(404).end(); }
    }
  }

  // A phone paired from Stock Checker: the link carries a signed token (valid 12 hours). Valid -> keep it in a cookie that
  // opens only Stock Checker, drop it from the address, and open the camera page. Not valid -> the normal sign-in rules below.
  const isChecker = requestedPath === '/stockchecker' || requestedPath === '/stockchecker/' || requestedPath === '/stockchecker.html';
  if (isChecker && url.searchParams.get('pair') && pair.validToken(url.searchParams.get('pair'), process.env.PANDORA_AUTH_SECRET, 'checker')) {
    res.setHeader('Set-Cookie', pair.cookieHeader(url.searchParams.get('pair'), 'checker'));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/stockchecker');
    return res.status(302).end();
  }
  if (isChecker && pair.hasPair(req, 'checker')) {
    const f1 = await sessionFacts(req);
    if (!(f1.staff && f1.staff.role === 'admin' && !f1.staff.overseer)) {
      // not signed in as someone who may open it: the paired phone sees only this page (no Home link, nothing else)
      const chrome = withChrome('staff', false);
      return sendFile(res, 'stockchecker.html', 'text/html; charset=utf-8', function (buf) {
        let html = buf.toString('utf8');
        const h = html.search(/<\/head>/i);
        if (h !== -1) html = html.slice(0, h) + '<script>window.__PAIRED=true;</script>' + html.slice(h);
        return chrome(Buffer.from(html, 'utf8'));
      });
    }
  }

  // Everything below needs a login. Which logins this browser holds decides what it can open.
  const facts = await sessionFacts(req);
  const signedIn = facts.dash || facts.staff || facts.hr;
  const multi = appsFor(facts).length > 1;
  const toLogin = () => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Location', '/login.html'); return res.status(302).end(); };
  const toHome = () => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Location', '/'); return res.status(302).end(); };
  if (!signedIn && !facts.vm && !facts.sc) return toLogin();

  // Reports the super admin switched off for this person (Report access page) are closed here, and hidden on the home screen
  if (facts.hidden && facts.hidden.length) {
    const role = facts.staff && facts.staff.role;
    const P = requestedPath.replace(/\/+$/, '') || '/';
    let id = '';
    if (P === '/dashboards' || P === '/index.html') id = 'dashboards';
    else if (P === '/staff' || P === '/staff.html' || P === '/staff/index.html' || P === '/staff/person') id = role === 'staff' ? 'mysales' : role === 'store' ? 'storeteam' : 'staff';
    else if (P === '/staff/me') id = 'mysales2';
    else if (P === '/staff/accounts') id = 'approvals';
    else if (P === '/uploads' || P === '/uploads.html') id = 'uploads';
    else if (P === '/activity' || P === '/activity.html') id = 'activity';
    else if (P === '/film' || P === '/film.html') id = 'film';
    else if (P === '/daily' || P === '/daily.html') id = 'daily';
    else if (P === '/schedule' || P === '/schedule.html') id = 'schedule';
    else if (P === '/vm/zones' || P === '/vmzones.html') id = 'vmzones';
    else if (P === '/vm/stock' || P === '/zonestock.html') id = 'zonestock';
    else if (P === '/stock' || P === '/stock.html') id = 'stock';
    else if (P === '/stockcount' || P === '/stockcount.html') id = 'stockcount';
    else if (P === '/stockchecker' || P === '/stockchecker.html') id = 'stockchecker';
    else if (P === '/refill' || P === '/refill.html') id = 'refill';
    else if (P === '/slow' || P === '/slow.html') id = 'slow';
    else if (P === '/distribution' || P === '/distribution.html') id = 'dist';
    else if (P === '/receiving' || P === '/receiving.html') id = 'recv';
    else if (P === '/vm' || P === '/vm.html') id = 'vm';
    if (id && facts.hidden.includes(id)) return requestedPath === '/' ? toHome() : toHome();
  }

  // Home: the options this person can open
  if (requestedPath === '/' || requestedPath === '/home.html') {
    const label = facts.vm || facts.sc || facts.hr ? facts.vmName : facts.staff ? (facts.staff.role === 'staff' || facts.staff.role === 'store' ? facts.staff.name : facts.staff.label) : 'Pandora Dashboards';
    const homeOrder = (await require('./_store').getJSON('access/home.json').catch(() => null)) || [];
    const boot = JSON.stringify({ ok: true, label, greet: greetName(facts), apps: appsFor(facts), homeOrder }).replace(/</g, '\\u003c');
    const chrome = withChrome('home', multi);
    return sendFile(res, 'home.html', 'text/html; charset=utf-8', function (buf) {
      let html = buf.toString('utf8');
      const h = html.search(/<\/head>/i);
      if (h !== -1) html = html.slice(0, h) + '<script>window.__HOME=' + boot + ';</script>' + html.slice(h);
      return chrome(Buffer.from(html, 'utf8'));
    });
  }

  // Staff Performance: super admin, area managers and sales people (each sees only their part)
  const STAFF_PATHS = ['/staff', '/staff/', '/staff.html', '/staff/index.html', '/staff/person', '/staff/person/', '/staff/accounts', '/staff/accounts/', '/staff/me', '/staff/me/'];
  if (STAFF_PATHS.includes(requestedPath)) {
    const who = facts.staff && facts.staff.who;
    if (!who) return toHome();
    let page, roleInfo = who.info;
    const isMe = requestedPath === '/staff/me' || requestedPath === '/staff/me/';
    if (who.kind === 'staff' && !who.info.storeManager) {
      page = 'person.html'; // a sales person only ever sees their own page
    } else if (who.kind === 'staff' && isMe) {
      page = 'person.html'; // a store manager's own sales page: shown exactly like a sales person's
      roleInfo = { role: 'staff', label: 'Sales person', zone: null, allow: null, zones: null, self: who.info.self };
    } else if (isMe) {
      return toHome();
    } else if (requestedPath.startsWith('/staff/accounts')) {
      if (who.info.role !== 'admin' || who.info.overseer) { res.setHeader('Location', '/staff'); return res.status(302).end(); }
      page = 'accounts.html';
    } else {
      page = requestedPath.startsWith('/staff/person') ? 'person.html' : 'staff.html';
    }
    const chrome = withChrome('staff', multi);
    const info = JSON.stringify(roleInfo).replace(/</g, '\\u003c');
    return sendFile(res, page, 'text/html; charset=utf-8', function (buf) {
      let html = buf.toString('utf8');
      const h = html.search(/<\/head>/i);
      if (h !== -1) html = html.slice(0, h) + '<script>window.__PANDORA_ROLE=' + info + ';</script>' + html.slice(h);
      return chrome(Buffer.from(html, 'utf8'));
    });
  }

  // Launch Film: a 15-second motion film of the dashboards (super admin and overseer)
  if (requestedPath === '/film' || requestedPath === '/film/' || requestedPath === '/film.html') {
    if (!(facts.staff && facts.staff.role === 'admin')) return toHome();
    if (url.searchParams.get('data')) { // the live figures the film plays with (same numbers as the Dashboards page)
      res.setHeader('Cache-Control', 'no-store');
      try { return res.status(200).json(await require('./_film').build()); } catch (e) { return res.status(200).json({ ok: false, error: String((e && e.message) || e).slice(0, 160) }); }
    }
    return sendFile(res, 'film.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }

  // Report access (super admin only, not the Overseer): who may open which report
  if (requestedPath === '/access' || requestedPath === '/access/' || requestedPath === '/access.html') {
    if (!(facts.staff && facts.staff.role === 'admin' && !facts.staff.overseer)) return toHome();
    return sendFile(res, 'access.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }

  // Activity (super admin; the Overseer only after the super admin switches it on inside the page)
  if (requestedPath === '/activity' || requestedPath === '/activity/' || requestedPath === '/activity.html') {
    if (!facts.activity) return toHome();
    return sendFile(res, 'activity.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }

  // All Uploads (super admin only) and the file readers it shares with the Dashboards page
  if (requestedPath === '/uploads' || requestedPath === '/uploads/' || requestedPath === '/uploads.html') {
    if (!(facts.staff && facts.staff.role === 'admin')) return toHome();
    return sendFile(res, 'uploads.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }
  if (requestedPath === '/parsers.js') {
    if (!(facts.staff && facts.staff.role === 'admin') && !facts.dash) return res.status(404).end();
    return sendFile(res, 'parsers.js', 'application/javascript; charset=utf-8');
  }

  // Daily Store Report: everyone with a Staff Performance login (sales people and store managers: their own store; area managers: their zone; super admin: all)
  if (requestedPath === '/daily' || requestedPath === '/daily/' || requestedPath === '/daily.html') {
    if (!facts.staff) return toHome();
    return sendFile(res, 'daily.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }

  // Weekly Schedule: managers (super admin, area managers, store managers) plan; sales people only look at their own store's who works Morning, Between and Night shifts
  if (requestedPath === '/schedule' || requestedPath === '/schedule/' || requestedPath === '/schedule.html') {
    if (!facts.staff && !facts.hr) return toHome();
    return sendFile(res, 'schedule.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }

  // VM Zones: the VM account and the super admin place collections in store zones and see the effect on sales
  if (requestedPath === '/vm/zones' || requestedPath === '/vm/zones/' || requestedPath === '/vmzones.html') {
    const admin = !!facts.staff && facts.staff.role === 'admin';
    if (!admin && !facts.vm) return toHome();
    return sendFile(res, 'vmzones.html', 'text/html; charset=utf-8', withChrome('vm', multi));
  }

  // Zone stock: what is in each VM zone; store managers open it for their own store
  if (requestedPath === '/vm/stock' || requestedPath === '/vm/stock/' || requestedPath === '/zonestock.html') {
    const admin = !!facts.staff && facts.staff.role === 'admin';
    const mgr = !!facts.staff && facts.staff.role === 'store';
    if (!admin && !mgr && !facts.vm) return toHome();
    return sendFile(res, 'zonestock.html', 'text/html; charset=utf-8', withChrome(facts.vm ? 'vm' : 'staff', multi));
  }

  // VM report: the VM account (view only) and the super admin (who feeds it)
  if (requestedPath === '/vm' || requestedPath === '/vm/' || requestedPath === '/vm.html') {
    const admin = !!facts.staff && facts.staff.role === 'admin';
    if (!admin && !facts.vm) return toHome();
    const chrome = withChrome('vm', multi);
    const info = JSON.stringify({ role: admin ? 'admin' : 'vm' });
    return sendFile(res, 'vm.html', 'text/html; charset=utf-8', function (buf) {
      let html = buf.toString('utf8');
      const h = html.search(/<\/head>/i);
      if (h !== -1) html = html.slice(0, h) + '<script>window.__PANDORA_ROLE=' + info + ';</script>' + html.slice(h);
      return chrome(Buffer.from(html, 'utf8'));
    });
  }

  // Stock balance: super admin, area managers (their zone only) and the VM (pieces only). Never sales people or store managers.
  if (requestedPath === '/stock' || requestedPath === '/stock/' || requestedPath === '/stock.html') {
    const okStock = !!facts.vm || (!!facts.staff && facts.staff.role !== 'staff' && facts.staff.role !== 'store');
    if (!okStock) return toHome();
    return sendFile(res, 'stock.html', 'text/html; charset=utf-8', withChrome(facts.vm ? 'vm' : 'staff', multi));
  }

  // Stock Count: super admin and the Stock Count only accounts
  if (requestedPath === '/stockcount' || requestedPath === '/stockcount/' || requestedPath === '/stockcount.html') {
    if (!(facts.staff && facts.staff.role === 'admin') && !facts.sc) return toHome();
    return sendFile(res, 'stockcount.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }
  // Stock Checker: the super admin only
  if (requestedPath === '/stockchecker' || requestedPath === '/stockchecker/' || requestedPath === '/stockchecker.html') {
    if (!(facts.staff && facts.staff.role === 'admin' && !facts.staff.overseer)) return toHome();
    return sendFile(res, 'stockchecker.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }
  // Refill Order: whoever the super admin gave access to (Staff approvals)
  if (requestedPath === '/refill' || requestedPath === '/refill/' || requestedPath === '/refill.html') {
    if (!facts.refill || facts.refill === 'none') return toHome();
    return sendFile(res, 'refill.html', 'text/html; charset=utf-8', withChrome(facts.vm ? 'vm' : 'staff', multi));
  }
  // Orders Distribution and Slow Moving
  if (requestedPath === '/distribution' || requestedPath === '/distribution/' || requestedPath === '/distribution.html') {
    if (!facts.dist || facts.dist === 'none') return toHome();
    return sendFile(res, 'distribution.html', 'text/html; charset=utf-8', withChrome(facts.vm ? 'vm' : 'staff', multi));
  }
  if (requestedPath === '/receiving' || requestedPath === '/receiving/' || requestedPath === '/receiving.html') {
    if (!facts.recv || facts.recv === 'none') return toHome();
    return sendFile(res, 'receiving.html', 'text/html; charset=utf-8', withChrome(facts.vm ? 'vm' : 'staff', multi));
  }
  if (requestedPath === '/slow' || requestedPath === '/slow/' || requestedPath === '/slow.html') {
    if (!facts.refill || facts.refill === 'none') return toHome();
    return sendFile(res, 'slow.html', 'text/html; charset=utf-8', withChrome(facts.vm ? 'vm' : 'staff', multi));
  }
  // its product pictures, in pieces (one response may not pass 4.5 MB); super admin only, kept by the browser for a day
  const picPart = /^\/stockcount-pics-([1-9])\.js$/.exec(requestedPath);
  if (picPart) {
    if (!(facts.staff && facts.staff.role === 'admin') && !facts.sc && !(facts.refill && facts.refill !== 'none') && !(facts.dist && facts.dist !== 'none') && !(facts.recv && facts.recv !== 'none')) return res.status(404).end();
    try {
      const body = fs.readFileSync(path.join(PRIVATE_DIR, 'stockcount-pics-' + picPart[1] + '.js'));
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(body);
    } catch (_) { return res.status(404).end(); }
  }

  // Pandora Dashboards
  if (requestedPath === '/dashboards' || requestedPath === '/dashboards/' || requestedPath === '/index.html') {
    if (!facts.dash) return toHome();
    return sendFile(res, 'index.html', 'text/html; charset=utf-8', withChrome('dashboards', multi));
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).end();
};
