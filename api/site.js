
const fs = require('fs');
const path = require('path');
const { appsFor, sessionFacts, greetName } = require('./_apps');

const PRIVATE_DIR = path.join(process.cwd(), 'private');

// ---- shared page chrome: theme (light/dark) + Switch project + Log out ----
const THEME_HEAD = '<style id="pandora-theme-css">' +
  ':root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}' +
  '.pandora-sw{position:relative;width:58px;height:30px;padding:0;border:1px solid rgba(128,128,128,.45);border-radius:999px;cursor:pointer;flex:0 0 auto;background:#efe7e1;transition:background .2s}.pandora-sw.is-dark{background:#3a3530}.pandora-sw .k{position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#ffd27a;color:#5a3d00;transition:transform .2s,background .2s,color .2s}.pandora-sw.is-dark .k{transform:translateX(28px);background:#4b5078;color:#e8ecff}.pandora-sw svg{width:14px;height:14px;display:block}.pandora-sw .moon{display:none}.pandora-sw.is-dark .moon{display:block}.pandora-sw.is-dark .sun{display:none}.pandora-sw:focus-visible{outline:2px solid #d85b83;outline-offset:2px}.pandora-sw.fixed{position:fixed;top:12px;right:12px;z-index:9999}@media (prefers-reduced-motion:reduce){.pandora-sw,.pandora-sw .k{transition:none}}' +
  '.pandora-fab{position:fixed;top:12px;right:12px;z-index:9999;border:1px solid rgba(128,128,128,.4);' +
  'background:rgba(255,255,255,.9);color:#282522;border-radius:10px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}' +
  ':root[data-theme="dark"] .pandora-fab{background:rgba(33,31,29,.92);color:#f7f2ed}' +
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pandora-fab{background:rgba(33,31,29,.92);color:#f7f2ed}}' +
  '</style><script>(function(){try{var t=localStorage.getItem("pandora-theme");' +
  'if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();</script>';

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
  't.innerHTML="<span class=k><svg class=sun viewBox=\\"0 0 24 24\\" fill=none stroke=currentColor stroke-width=2.4 stroke-linecap=round><circle cx=12 cy=12 r=4.2 fill=currentColor /><path d=\\"M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7\\"/></svg><svg class=moon viewBox=\\"0 0 24 24\\" fill=currentColor><path d=\\"M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z\\"/></svg></span>";' +
  'function sync(){var d=cur()==="dark";t.classList.toggle("is-dark",d);t.setAttribute("aria-checked",d);t.setAttribute("aria-label",d?"Switch to light mode":"Switch to dark mode");t.title=d?"Light mode":"Dark mode"}sync();' +
  't.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";' +
  'document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("pandora-theme",n)}catch(e){}sync()});' +
  'if(kind==="staff"||kind==="dashboards"||kind==="vm"){if(multi){var hm=mk("Home");hm.addEventListener("click",function(){location.href="/"});place(hm);}}' +
  'place(t);' +
  'if(kind!=="login"){' +
  'var lo=mk("Log out");lo.addEventListener("click",function(){lo.disabled=true;lo.textContent="Logging out\\u2026";' +
  'try{localStorage.removeItem("storeStaffSummary.v1");sessionStorage.removeItem("storeStaffSummary.v1")}catch(e){}' +
  'fetch("/api/logout",{method:"POST",credentials:"same-origin"}).then(function(r){' +
  'if(r.ok){location.replace("/login.html");}else{throw new Error("x");}' +
  '}).catch(function(){lo.disabled=false;lo.textContent="Log out";});});place(lo);' +
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
    html = html.slice(0, at) + chromeScript(kind, multi) + html.slice(at);
    return Buffer.from(html, 'utf8');
  };
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

  // Everything below needs a login. Which logins this browser holds decides what it can open.
  const facts = await sessionFacts(req);
  const signedIn = facts.dash || facts.staff;
  const multi = appsFor(facts).length > 1;
  const toLogin = () => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Location', '/login.html'); return res.status(302).end(); };
  const toHome = () => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Location', '/'); return res.status(302).end(); };
  if (!signedIn && !facts.vm) return toLogin();

  // Home: the options this person can open
  if (requestedPath === '/' || requestedPath === '/home.html') {
    const label = facts.vm ? facts.vmName : facts.staff ? (facts.staff.role === 'staff' || facts.staff.role === 'store' ? facts.staff.name : facts.staff.label) : 'Pandora Dashboards';
    const boot = JSON.stringify({ ok: true, label, greet: greetName(facts), apps: appsFor(facts) }).replace(/</g, '\\u003c');
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
      if (who.info.role !== 'admin') { res.setHeader('Location', '/staff'); return res.status(302).end(); }
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

  // All Uploads (super admin only) and the file readers it shares with the Dashboards page
  if (requestedPath === '/uploads' || requestedPath === '/uploads/' || requestedPath === '/uploads.html') {
    if (!(facts.staff && facts.staff.role === 'admin')) return toHome();
    return sendFile(res, 'uploads.html', 'text/html; charset=utf-8', withChrome('staff', multi));
  }
  if (requestedPath === '/parsers.js') {
    if (!(facts.staff && facts.staff.role === 'admin') && !facts.dash) return res.status(404).end();
    return sendFile(res, 'parsers.js', 'application/javascript; charset=utf-8');
  }

  // VM Zones: the VM account and the super admin place collections in store zones and see the effect on sales
  if (requestedPath === '/vm/zones' || requestedPath === '/vm/zones/' || requestedPath === '/vmzones.html') {
    const admin = !!facts.staff && facts.staff.role === 'admin';
    if (!admin && !facts.vm) return toHome();
    return sendFile(res, 'vmzones.html', 'text/html; charset=utf-8', withChrome('vm', multi));
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

  // Pandora Dashboards
  if (requestedPath === '/dashboards' || requestedPath === '/dashboards/' || requestedPath === '/index.html') {
    if (!facts.dash) return toHome();
    return sendFile(res, 'index.html', 'text/html; charset=utf-8', withChrome('dashboards', multi));
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).end();
};
