// Maintenance users sign in on the main login page and are managed from Staff approvals.
// Everything goes through the Maintenance app's secret-protected /api/sso routes (shared MAINTENANCE_SSO_SECRET);
// the Maintenance database keys never leave that project.
const crypto = require('crypto');

const BASE = (process.env.MAINTENANCE_API_URL || 'https://pandora-maintenance.vercel.app/maintenance').replace(/\/$/, '');
const secret = () => process.env.MAINTENANCE_SSO_SECRET || '';
const configured = () => secret().length >= 32;

async function call(path, method, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(BASE + path, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-sso-secret': secret() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
  } catch (_) {
    return { status: 0, json: {} };
  } finally { clearTimeout(t); }
}

// short-lived signed hand-over of the Maintenance session; the Maintenance /sso page turns it into the real session
function ticketCookie(j) {
  const payload = Buffer.from(JSON.stringify({ a: j.access_token, r: j.refresh_token, e: Math.floor(Date.now() / 1000) + 90 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `mnt_sso=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=90`;
}

module.exports = {
  configured,
  login: (email, password) => call('/api/sso/login', 'POST', { email, password }),
  ticketCookie,
  list: () => call('/api/sso/users', 'GET'),
  setPassword: (id, password) => call('/api/sso/users', 'POST', { action: 'setpassword', id, password }),
  setActive: (id, active) => call('/api/sso/users', 'POST', { action: 'setactive', id, active }),
};
