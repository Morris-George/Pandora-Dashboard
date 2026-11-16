// One place that decides whether two store names are the same store.
// The same store is written differently in each source: "CC Almaza" (accounts), "City Center Almaza" (stock warehouse),
// "Almaza" (refill / slow moving code), "Pandora City Centre Almaza - AN" (ERP). Compare the store, never the spelling.
const KEYS = [
  ['online', /online|e-?commerce|website/i],
  ['almaza', /almaza/i],
  ['citystars', /city\s*stars|^\s*city\s*$/i],
  ['cfc', /\bcfc\b|festival/i],
  ['point90', /point\s*90|^\s*point\s*$/i],
  ['moe', /mall\s*of\s*egypt|\bmoe\b/i],
  ['moa', /arabia|\bmoa\b/i],
  ['alex', /alex/i]
];
const clean = s => String(s || '').replace(/^\s*pandora\s+/i, '').replace(/\s+-\s+[A-Za-z]{1,5}\s*$/, '').trim();
// '' when the name is not one of the selling stores (main warehouse, samples, anything new)
function storeKey(name) {
  const t = clean(name); if (!t) return '';
  if (/sample|main\s*warehouse|transit|damage|defect/i.test(t)) return '';
  const k = KEYS.find(k => k[1].test(t));
  return k ? k[0] : '';
}
const plain = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function sameStore(a, b) {
  const ka = storeKey(a), kb = storeKey(b);
  if (ka || kb) return ka === kb;            // a known store only ever equals itself
  const x = plain(a), y = plain(b);          // unknown names: the old loose comparison
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
}
module.exports = { storeKey, sameStore };
