// Shows which parts of the setup are ready. It never returns any secret, name, number or sales figure.
const store = require('./_store');
const { staffAccounts } = require('./_projects');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { storage: 'not configured', sms: false, accounts: {}, authSecret: !!(process.env.PANDORA_AUTH_SECRET && process.env.PANDORA_AUTH_SECRET.length >= 32) };
  try {
    if (store.configured()) {
      await store.putJSON('health/ping.json', { t: Date.now() });
      const back = await store.getJSON('health/ping.json');
      await store.del('health/ping.json');
      out.storage = back && back.t ? 'ok' : 'write worked but read failed';
    }
  } catch (e) { out.storage = 'error: ' + String(e && e.message || e).slice(0, 120); }
  out.sms = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
  staffAccounts().forEach(a => { out.accounts[a.role] = true; });
  return res.status(200).json(out);
};
