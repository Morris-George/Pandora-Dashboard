
const fs = require('fs');
const path = require('path');
const { PROJECTS, validSession, readCookie } = require('./_projects');

const PRIVATE_DIR = path.join(process.cwd(), 'private');

// ---- shared page chrome: theme (light/dark) + Switch project + Log out ----
const THEME_HEAD = '<style id="pandora-theme-css">' +
  ':root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}' +
  '.pandora-fab{position:fixed;top:12px;right:12px;z-index:9999;border:1px solid rgba(128,128,128,.4);' +
  'background:rgba(255,255,255,.9);color:#282522;border-radius:10px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}' +
  ':root[data-theme="dark"] .pandora-fab{background:rgba(33,31,29,.92);color:#f7f2ed}' +
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pandora-fab{background:rgba(33,31,29,.92);color:#f7f2ed}}' +
  '</style><script>(function(){try{var t=localStorage.getItem("pandora-theme");' +
  'if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();</script>';

// kind: 'dashboards' | 'staff' | 'login'
function chromeScript(kind) {
  return '<script>(function(){' +
  'var kind=' + JSON.stringify(kind) + ';' +
  'var bar=document.querySelector(".top-actions")||document.querySelector(".actions");' +
  'var cls=document.querySelector(".top-actions")?"secondary":(document.querySelector(".actions")?"btn":"pandora-fab");' +
  'function mk(text){var b=document.createElement("button");b.type="button";b.className=(bar?cls:"pandora-fab")+" hideclean";b.textContent=text;' +
  'if(!bar){b.style.cssText="";}return b}' +
  'function place(el){if(bar)bar.appendChild(el);else{document.body.appendChild(el);}}' +
  'function cur(){return document.documentElement.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}' +
  'var t=mk("");function label(){t.textContent=cur()==="dark"?"Light mode":"Dark mode"}label();' +
  't.id="themeBtn";t.addEventListener("click",function(){var n=cur()==="dark"?"light":"dark";' +
  'document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("pandora-theme",n)}catch(e){}label()});' +
  'if(kind!=="login"){' +
  'var sw=mk("Switch project");sw.addEventListener("click",function(){location.href="/login.html"});place(sw);' +
  '}' +
  'place(t);' +
  'if(kind!=="login"){' +
  'var lo=mk("Log out");lo.addEventListener("click",function(){lo.disabled=true;lo.textContent="Logging out\\u2026";' +
  'if(kind==="staff"){try{localStorage.removeItem("storeStaffSummary.v1")}catch(e){}}' +
  'fetch("/api/logout"+(kind==="staff"?"?project=staff":""),{method:"POST",credentials:"same-origin"}).then(function(r){' +
  'if(r.ok){location.replace("/login.html"+(kind==="staff"?"?project=staff":""));}else{throw new Error("x");}' +
  '}).catch(function(){lo.disabled=false;lo.textContent="Log out";});});place(lo);' +
  '}' +
  '})();</script>';
}

function withChrome(kind) {
  return function (buf) {
    let html = buf.toString('utf8');
    const h = html.search(/<\/head>/i);
    if (h !== -1) html = html.slice(0, h) + THEME_HEAD + html.slice(h);
    const i = html.lastIndexOf('</body>');
    const at = i === -1 ? html.length : i;
    html = html.slice(0, at) + chromeScript(kind) + html.slice(at);
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

module.exports = function handler(req, res) {
  const url = new URL(req.url, 'https://vercel.invalid');

  const requestedPath = url.searchParams.has('path')
    ? '/' + (url.searchParams.get('path') || '').replace(/^\/+/, '')
    : url.pathname;

  if (requestedPath === '/login.html') {
    return sendFile(res, 'login.html', 'text/html; charset=utf-8', withChrome('login'));
  }

  if (requestedPath === '/pandora-logo.png') {
    return sendFile(res, 'pandora-logo.png', 'image/png');
  }

  if (requestedPath === '/favicon.ico') {
    return res.status(404).end();
  }

  const secret = process.env.PANDORA_AUTH_SECRET;

  // Staff Performance project (its own login and cookie)
  if (['/staff', '/staff/', '/staff.html', '/staff/index.html'].includes(requestedPath)) {
    const ok = validSession('staff', readCookie(req, PROJECTS.staff.cookie), process.env[PROJECTS.staff.userEnv], secret);
    if (!ok) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Location', '/login.html?project=staff');
      return res.status(302).end();
    }
    return sendFile(res, 'staff.html', 'text/html; charset=utf-8', withChrome('staff'));
  }

  // Pandora Dashboards project (original login and cookie)
  const dashOk = validSession('dashboards', readCookie(req, PROJECTS.dashboards.cookie), process.env[PROJECTS.dashboards.userEnv], secret);
  if (!dashOk) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/login.html?project=dashboards');
    return res.status(302).end();
  }

  if (requestedPath === '/' || requestedPath === '/index.html') {
    return sendFile(res, 'index.html', 'text/html; charset=utf-8', withChrome('dashboards'));
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).end();
};
