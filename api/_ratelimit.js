// Per-visitor limit per hour, kept in the private store.
const crypto = require('crypto');
const store = require('./_store');

async function tooMany(req, scope, limit) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
  const key = 'rl/' + scope + '-' + crypto.createHash('sha1').update(ip).digest('hex').slice(0, 20) + '-' + Math.floor(Date.now() / 3600000) + '.json';
  const cur = (await store.getJSON(key)) || { n: 0 };
  if (cur.n >= limit) return true;
  await store.putJSON(key, { n: cur.n + 1 });
  return false;
}
module.exports = { tooMany };
