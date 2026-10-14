
const fs = require('fs');
const path = require('path');
const { PROJECTS, validSession, readCookie } = require('./_projects');

const PRIVATE_DIR = path.join(process.cwd(), 'private');

const LOGOUT_SNIPPET = '<script>(function(){' +
  "var b=document.createElement('button');" +
  "b.type='button';b.id='logoutBtn';b.className='secondary';b.textContent='Log out';" +
  "b.addEventListener('click',function(){" +
  "b.disabled=true;b.textContent='Logging out\\u2026';" +
  "fetch('/api/logout',{method:'POST',credentials:'same-origin'}).then(function(r){" +
  "if(r.ok){location.replace('/login.html');}else{throw new Error('logout failed');}" +
  "}).catch(function(){b.disabled=false;b.textContent='Log out';});" +
  '});' +
  "var bar=document.querySelector('.top-actions');" +
  'if(bar){bar.appendChild(b);}' +
  "else{b.style.cssText='position:fixed;top:12px;right:12px;z-index:9999';document.body.appendChild(b);}" +
  '})();</script>';

const STAFF_LOGOUT_SNIPPET = '<script>(function(){' +
  "var bar=document.querySelector('.actions');if(!bar)return;" +
  "var a=document.createElement('a');a.href='/login.html';a.className='btn';a.textContent='Switch project';a.style.textDecoration='none';" +
  "var b=document.createElement('button');b.type='button';b.className='btn';b.textContent='Log out';" +
  "b.addEventListener('click',function(){b.disabled=true;" +
  "try{localStorage.removeItem('storeStaffSummary.v1')}catch(e){}" +
  "fetch('/api/logout?project=staff',{method:'POST',credentials:'same-origin'}).then(function(r){" +
  "if(r.ok){location.replace('/login.html?project=staff');}else{throw new Error('x');}" +
  "}).catch(function(){b.disabled=false;});});" +
  "bar.appendChild(a);bar.appendChild(b);" +
  '})();</script>';

function inject(snippet) {
  return function (buf) {
    const html = buf.toString('utf8');
    const i = html.lastIndexOf('</body>');
    const at = i === -1 ? html.length : i;
    return Buffer.from(html.slice(0, at) + snippet + html.slice(at), 'utf8');
  };
}

function addLogoutButton(buf) {
  const html = buf.toString('utf8');
  const i = html.lastIndexOf('</body>');
  if (i === -1) return buf;
  return Buffer.from(html.slice(0, i) + LOGOUT_SNIPPET + html.slice(i), 'utf8');
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
    return sendFile(res, 'login.html', 'text/html; charset=utf-8');
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
    return sendFile(res, 'staff.html', 'text/html; charset=utf-8', inject(STAFF_LOGOUT_SNIPPET));
  }

  // Pandora Dashboards project (original login and cookie)
  const dashOk = validSession('dashboards', readCookie(req, PROJECTS.dashboards.cookie), process.env[PROJECTS.dashboards.userEnv], secret);
  if (!dashOk) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/login.html?project=dashboards');
    return res.status(302).end();
  }

  if (requestedPath === '/' || requestedPath === '/index.html') {
    return sendFile(res, 'index.html', 'text/html; charset=utf-8', addLogoutButton);
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).end();
};
