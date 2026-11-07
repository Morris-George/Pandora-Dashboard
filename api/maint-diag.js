// TEMPORARY diagnostics: does this site reach the Maintenance app with the shared secret? (no secrets returned)
const maint = require('./_maintenance');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const configured = maint.configured();
  const r = configured ? await maint.list() : null;
  res.status(200).json({ configured, secretLen: (process.env.MAINTENANCE_SSO_SECRET || '').length, status: r && r.status, ok: r && r.json && r.json.ok, count: r && r.json && r.json.users && r.json.users.length });
};
