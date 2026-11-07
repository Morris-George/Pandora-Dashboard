// TEMPORARY diagnostics: runs the real sign-in handler in-process (no tokens or secrets returned)
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const hdr = {}; let code = 200, body = null;
  const mock = { setHeader: (k, v) => { hdr[k.toLowerCase()] = v; }, status(c) { code = c; return this; }, json(o) { body = o; return this; }, end() { return this; } };
  await require('./login')({ method: 'POST', body: { username: q.e, password: q.p }, headers: req.headers, socket: req.socket }, mock);
  const sc = hdr['set-cookie'];
  res.status(200).json({ code, body, setCookie: sc ? [].concat(sc).map(c => c.split('=')[0] + ' [' + c.length + ']') : null });
};
