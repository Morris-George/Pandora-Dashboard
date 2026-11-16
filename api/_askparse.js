// Understands a question typed in plain English (and the basics in Arabic) WITHOUT any AI service, so the Pandora Assistant is free and
// nothing leaves the server. It finds: the dates, the stores, the categories, an item code, what to split by (every store, day by day,
// top products ...), what to compare with, and whether the question is about sales or stock. It returns the same arguments the
// "sales" / "stock" lookups in api/_assistant.js take; those lookups do the real work on the saved data.
//   parse(text, { today, prev, apps }) -> { kind: 'sales' | 'stock' | 'links' | 'help', args, notes, ar }
'use strict';

const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const FULLMON = '(january|february|march|april|june|july|august|september|october|november|december)';
const ORD = '(?:st|nd|rd|th)?';
const R = (src, fl) => new RegExp(src, fl || '');
const monIdx = s => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(String(s).slice(0, 3));
const AR_B = '(?:^|\\s)', AR_E = '(?=\\s|$)'; // \b does not work around Arabic letters

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[“”«»]/g, '"').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}
function mkS(w) {
  return {
    w,
    eat(rx) { const m = rx.exec(this.w); if (!m) return null; this.w = this.w.slice(0, m.index) + ' ' + this.w.slice(m.index + m[0].length); return m; },
    has(rx) { return rx.test(this.w); }
  };
}
const isoOf = (y, m, d) => { const x = new Date(Date.UTC(y, m, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : ''; };
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dow = d => new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay();
const monthEnd = (y, m) => isoOf(y, m + 1, 0) || new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
const WDN = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// ---- dates: returns { from, to } or null (and removes what it read from S) ----
function parseDates(S, today) {
  const Y = +today.slice(0, 4), M = +today.slice(5, 7) - 1;
  const mk = (y, m, d, hasY) => { if (y < 100) y += 2000; let s = isoOf(y, m, d); if (s && !hasY && s > today) s = isoOf(y - 1, m, d); return s; };
  const found = []; const push = s => { if (s) found.push(s); };
  let m, n;
  // "15 to 20 november [2026]", "november 15 to 20"
  if ((m = S.eat(R('\\b(\\d{1,2})' + ORD + '\\s*(?:to|-|until|till|through|and)\\s*(\\d{1,2})' + ORD + '\\s+(?:of\\s+)?' + MON + '\\b(?:,?\\s*(20\\d\\d))?')))) {
    const y = m[4] ? +m[4] : Y, mi = monIdx(m[3]); push(mk(y, mi, +m[1], !!m[4])); push(mk(y, mi, +m[2], !!m[4]));
  } else if ((m = S.eat(R('\\b' + MON + '\\.?\\s+(\\d{1,2})' + ORD + '\\s*(?:to|-|until|till|through|and)\\s*(\\d{1,2})(?!\\d)' + ORD + '\\b(?:,?\\s*(20\\d\\d))?')))) {
    const y = m[4] ? +m[4] : Y, mi = monIdx(m[1]); push(mk(y, mi, +m[2], !!m[4])); push(mk(y, mi, +m[3], !!m[4]));
  }
  for (n = 0; n < 4 && (m = S.eat(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/)); n++) push(mk(+m[1], +m[2] - 1, +m[3], true));
  for (n = 0; n < 4 && (m = S.eat(R('\\b(\\d{1,2})' + ORD + '\\s+(?:of\\s+)?' + MON + '\\b(?:,?\\s*(20\\d\\d))?'))); n++) push(mk(m[3] ? +m[3] : Y, monIdx(m[2]), +m[1], !!m[3]));
  for (n = 0; n < 4 && (m = S.eat(R('\\b' + MON + '\\.?\\s+(\\d{1,2})' + ORD + '(?!\\d)\\b(?:,?\\s*(20\\d\\d))?'))); n++) push(mk(m[3] ? +m[3] : Y, monIdx(m[1]), +m[2], !!m[3]));
  for (n = 0; n < 4 && (m = S.eat(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](20\d\d|\d{2}))?\b/)); n++) {
    if (+m[2] >= 1 && +m[2] <= 12) push(mk(m[3] ? +m[3] : Y, +m[2] - 1, +m[1], !!m[3]));
  }
  if (found.length) { found.sort(); return { from: found[0], to: found[found.length - 1], explicit: true }; }

  const weekStart = d => add(d, -((dow(d) + 1) % 7)); // weeks start on Saturday, as on the dashboards
  const ye = add(today, -1);
  const rel = [
    [/\bday before yesterday\b/, () => [add(today, -2), add(today, -2)]],
    [R(AR_B + '(?:امس|امبارح|يوم امس)' + AR_E), () => [ye, ye]],
    [/\byesterday(?:'s)?\b/, () => [ye, ye]],
    [R(AR_B + '(?:اليوم|النهارده|دلوقتي)' + AR_E), () => [today, today]],
    [/\b(?:so far )?today(?:'s)?\b/, () => [today, today]],
    [/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/, x => [add(today, -Math.min(366, +x[1])), ye]],
    [/\b(?:last|past)\s+week\b(?!\s*(?:vs|versus))/, x => { const s = weekStart(today); return /\bpast\b/.test(x[0]) ? [add(today, -7), ye] : [add(s, -7), add(s, -1)]; }],
    [R(AR_B + '(?:الاسبوع الماضي|الاسبوع اللي فات|الاسبوع الي فات)' + AR_E), () => { const s = weekStart(today); return [add(s, -7), add(s, -1)]; }],
    [/\b(?:this|current)\s+week\b|\bweek to date\b/, () => [weekStart(today), today]],
    [R(AR_B + '(?:هذا الاسبوع|الاسبوع ده|الاسبوع دا|الاسبوع الحالي)' + AR_E), () => [weekStart(today), today]],
    [/\b(?:last|previous)\s+month\b/, () => [M === 0 ? isoOf(Y - 1, 11, 1) : isoOf(Y, M - 1, 1), M === 0 ? monthEnd(Y - 1, 11) : monthEnd(Y, M - 1)]],
    [R(AR_B + '(?:الشهر الماضي|الشهر اللي فات|الشهر الي فات|الشهر الفائت)' + AR_E), () => [M === 0 ? isoOf(Y - 1, 11, 1) : isoOf(Y, M - 1, 1), M === 0 ? monthEnd(Y - 1, 11) : monthEnd(Y, M - 1)]],
    [/\b(?:this|current)\s+month\b|\bmonth to date\b|\bmtd\b/, () => [isoOf(Y, M, 1), today]],
    [R(AR_B + '(?:هذا الشهر|الشهر ده|الشهر دا|الشهر الحالي)' + AR_E), () => [isoOf(Y, M, 1), today]],
    [/\b(?:last|previous)\s+year\b/, () => [isoOf(Y - 1, 0, 1), isoOf(Y - 1, 11, 31)]],
    [/\b(?:this|current)\s+year\b|\byear to date\b|\bytd\b/, () => [isoOf(Y, 0, 1), today]],
    [R(AR_B + '(?:هذه السنه|السنه دي|السنه الحاليه|هذا العام|العام ده)' + AR_E), () => [isoOf(Y, 0, 1), today]]
  ];
  for (const [rx, f] of rel) { if ((m = S.eat(rx))) { const r = f(m); if (r[0] && r[1]) return { from: r[0], to: r[1] }; } }

  // a month by name ("in october", "october 2026", "for november"): the whole month, or the month so far
  m = S.eat(R('\\b(?:in|for|during|of|throughout)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?' + MON + '\\b(?:,?\\s*(20\\d\\d))?')) || S.eat(R('\\b' + MON + ',?\\s+(20\\d\\d)\\b')) || S.eat(R('\\b' + FULLMON + '\\b'));
  if (m) {
    const mi = monIdx(m[1]); const y = m[2] && /^20\d\d$/.test(m[2]) ? +m[2] : (mi > M ? Y - 1 : Y);
    const from = isoOf(y, mi, 1), end = monthEnd(y, mi);
    return { from, to: end > today ? today : end };
  }
  m = S.eat(/\b(?:last\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) { let d = add(today, -1); for (let i = 0; i < 7 && dow(d) !== WDN[m[1]]; i++) d = add(d, -1); return { from: d, to: d }; }
  return null;
}

const STORES = [
  ['CFC', /\bcfc\b|festival city/, /(?:^|\s)سي اف سي(?=\s|$)/],
  ['Point 90', /\bpoint\s*90\b|\bp90\b/, /(?:^|\s)بوينت 90(?=\s|$)/],
  ['Mall of Egypt', /\bmall\s*of\s*egypt\b|\bmoe\b/, /(?:^|\s)مول مصر(?=\s|$)/],
  ['City Stars', /\bcity\s*stars?\b/, /(?:^|\s)سيتي ستار[زس]?(?=\s|$)/],
  ['Almaza', /\b(?:cc\s*|city\s*cent(?:er|re)\s*)?almaza\b/, /(?:^|\s)(?:ال)?الماظه(?=\s|$)/],
  ['Mall of Arabia', /\bmall\s*of\s*arabia\b|\bmoa\b/, /(?:^|\s)مول العرب(?=\s|$)/],
  ['Alex', /\balex(?:andria)?\b/, /(?:^|\s)(?:ال)?اسكندريه(?=\s|$)/],
  ['Online', /\bonline\b|\be-?commerce\b|\bwebsite\b/, /(?:^|\s)(?:ال)?(?:اونلاين|موقع)(?=\s|$)/]
];
const CATS = [ // earrings before rings
  ['Earrings', /\b(?:earrings?|studs?|hoops?)\b/, /(?:^|\s)(?:ال)?(?:حلق|حلقان|اقراط)(?=\s|$)/],
  ['Rings', /\brings?\b/, /(?:^|\s)(?:ال)?(?:خاتم|خواتم|دبله)(?=\s|$)/],
  ['Bracelets', /\b(?:bracelets?|bangles?)\b/, /(?:^|\s)(?:ال)?(?:اسواره|اساور|سوار)(?=\s|$)/],
  ['Necklace and Pendant', /\b(?:necklaces?|pendants?|colliers?)\b/, /(?:^|\s)(?:ال)?(?:عقد|عقود|قلاده|قلايد|سلسله)(?=\s|$)/],
  ['Charms', /\b(?:charms?|clips?|dangles?|spacers?|murano)\b/, /(?:^|\s)(?:ال)?(?:تشارم|تشارمز|تشامز|تشارمات)(?=\s|$)/],
  ['Accessories', /\baccessor(?:y|ies)\b/, /(?:^|\s)(?:ال)?(?:اكسسوار|اكسسوارات)(?=\s|$)/],
  ['Services', /\b(?:services?|engraving)\b/, /(?:^|\s)(?:ال)?(?:خدمات|خدمه)(?=\s|$)/]
];

function readCtx(s) {
  s = String(s || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try { const o = JSON.parse(s.slice(i, j + 1)); if (o && o.a && typeof o.a === 'object') return { kind: o.k, args: o.a }; } catch (_) { /* not ours */ }
  return null;
}

function parse(text, o) {
  o = o || {};
  const today = o.today;
  const raw = String(text || '');
  const ar = /[؀-ۿ]/.test(raw);
  const first = norm(raw);
  const S = mkS(first);
  const out = { ar, kind: '', args: {}, notes: [] };
  const given = {};
  const wordsN = first.split(/\s+/).filter(Boolean).length;

  // greetings and "what can you do"
  if (wordsN <= 6 && /^(?:help|hi|hello|hey|thanks?|thank you|good (?:morning|evening)|what can you do|how (?:do|does) (?:you|this) work|مرحبا|اهلا|السلام عليكم|ازيك|شكرا|مساعده)(?:\s|$|[!.?])/.test(first) && !/\b(?:sales?|stock)\b|مبيعات|مخزون/.test(first)) { out.kind = 'help'; return out; }

  // links: "open stock balance"
  if (/\b(?:open|go to|take me to|link to|where (?:can|do) i find|show me the)\b|(?:^|\s)(?:افتح|وديني)(?=\s|$)/.test(first) && Array.isArray(o.apps)) {
    const ids = [];
    for (const a of o.apps) { const t = norm(a.title).replace(/\s*\/.*$/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); if (t && first.replace(/[^a-z0-9 ]/g, ' ').includes(t)) ids.push(a.id); }
    if (ids.length) { out.kind = 'links'; out.args = { ids: ids.slice(0, 4) }; return out; }
  }

  // text inside quotes is an item search
  let search = '';
  { const m = S.eat(/"([^"]{2,40})"/); if (m) { search = m[1].trim(); given.search = true; } }

  // what to compare with
  let compare;
  { const m = S.eat(/\b(?:vs\.?|versus|compared?\s+(?:to|with)|compared|against|than)\s+(?:the\s+)?(?:same\s+(?:day|period|dates?)\s+)?(last\s+week|last\s+month|last\s+year|previous(?:\s+(?:period|day|days))?|a\s+week\s+ago|a\s+year\s+ago|a\s+month\s+ago)\b/);
    if (m) { const t = m[1]; compare = /year/.test(t) ? 'last_year' : /month/.test(t) ? 'last_month' : /week/.test(t) ? 'last_week' : 'previous_period'; given.compare = true; }
    else if (S.eat(/\b(?:no|without)\s+compar(?:ison|e|ing)\b/)) { compare = 'none'; given.compare = true; } }
  // net or gross
  let basis;
  if (S.eat(/\b(?:gross|with vat|incl(?:uding|\.)?\s*vat|vat included)\b/)) { basis = 'gross'; given.basis = true; }
  else if (S.eat(/\b(?:net|without vat|excl(?:uding|\.)?\s*vat|ex vat)\b/)) { basis = 'net'; given.basis = true; }

  // how many to list
  let limit = 0, product = false;
  { const m = S.eat(/\b(?:top|best|first)\s+(\d{1,2})\b/) || S.eat(R(AR_B + '(?:اعلي|اكتر|افضل)\\s+(\\d{1,2})(?=\\s|$)')); if (m) { limit = Math.min(50, +m[1]); product = true; } }
  if (S.eat(/\b(?:top|best)[\s-]*(?:selling|sellers?|sold)\b|\b(?:top|best)\s+(?:items?|products?|skus?|designs?)\b|\bmost\s+sold\b|\bbest\s*sellers?\b|\bbest[\s-]selling\b/) || S.eat(R(AR_B + '(?:اعلي|اكتر|افضل)\\s+(?:منتج|منتجات|صنف|اصناف|قطع)(?=\\s|$)'))) product = true;

  // what to split by
  const g = {};
  if (S.eat(/\b(?:every|each|all|per|by)\s+(?:the\s+)?(?:store|branch|shop|location|showroom)s?\b|\b(?:store|branch)[\s-]*(?:by|wise)[\s-]*(?:store|branch)?\b|\bbranches\b|\bin\s+(?:all\s+)?(?:the\s+)?stores\b|\bacross\s+(?:all\s+)?(?:the\s+)?stores\b/) || S.eat(R(AR_B + '(?:كل فرع|كل الفروع|كل محل|كل المحلات|في كل فرع|الفروع)(?=\\s|$)'))) g.store = true;
  if (S.eat(/\bday[\s-]*by[\s-]*day\b|\bdaily\b|\b(?:each|every|per|by)\s+day\b/) || S.eat(R(AR_B + '(?:يوم بيوم|كل يوم)(?=\\s|$)'))) g.day = true;
  if (S.eat(/\bmonth[\s-]*by[\s-]*month\b|\bmonthly\b|\b(?:each|every|per|by)\s+month\b/)) g.month = true;
  if (S.eat(/\b(?:by|per|each|every)\s+weekday\b|\bweekdays\b|\bday of (?:the )?week\b|\bwhich day\b|\bbest day\b|\bbusiest day\b/)) g.weekday = true;
  if (S.eat(/\b(?:by|per|each|every)\s+categor(?:y|ies)\b|\bcategories\b|\bcategory (?:breakdown|split)\b/)) g.category = true;
  if (S.eat(/\bcollections?\b/)) g.collection = true;
  if (S.eat(/\b(?:payments?|payment methods?)\b|\bcash\b|\bvisa\b|\bvalu\b/)) g.payment = true;
  const items = !!S.eat(/\b(?:items?|products?|skus?|designs?|models?)\b/);
  const gKeys = Object.keys(g);
  if (gKeys.length) given.group = true;

  // sales or stock
  const stockIntent = S.has(/\b(?:stock|inventory|on hand|soh|available|availability|remaining|do we have|have we got|where (?:is|are|can i find)|who has|which (?:stores?|branch(?:es)?) (?:has|have)|how many (?:\w+\s+){0,3}(?:do )?(?:we|i) (?:have|got))\b/) || S.has(R(AR_B + '(?:مخزون|ستوك|المتاح|الموجود|متاح)(?=\\s|$)'));
  const salesIntent = S.has(/\b(?:sales?|sold|sell(?:ing)?|revenue|turnover|income)\b/) || S.has(R(AR_B + '(?:مبيعات|بيع|ايراد)(?=\\s|$)'));
  const softIntent = S.has(/\b(?:top|best|worst|lowest|highest|compare|total|how much|orders?|invoices?|pieces|units|pcs|qty|quantity|performance)\b/) || product || gKeys.length > 0;

  // dates (not needed for stock, which is always "now"; but read so the numbers in them are not taken for an item code)
  const dt = parseDates(S, today);
  if (dt) given.dates = true;

  // stores
  const stores = [];
  for (const [name, en, arx] of STORES) { const m = S.eat(en) || S.eat(arx); if (m && !stores.includes(name)) stores.push(name); }
  if (stores.length) given.stores = true;
  // categories
  const cats = [];
  for (const [name, en, arx] of CATS) { for (let k = 0; k < 3; k++) { const m = S.eat(en) || S.eat(arx); if (m && !cats.includes(name)) cats.push(name); if (!m) break; } }
  if (cats.length) given.cats = true;

  // an item code: 4+ characters with at least 3 digits (a year or a plain number is not one); 3 digits count after "item / code / sku"
  if (!search) {
    const toks = S.w.match(/\b[a-z0-9]{3,14}\b/g) || [];
    const after = /\b(?:item|code|sku|design|product)\s+([a-z0-9]{3,14})\b/.exec(S.w);
    for (const t of toks) {
      const digits = (t.match(/\d/g) || []).length;
      if (!digits || /^(?:19|20)\d\d$/.test(t) || /^\d{1,2}(?:st|nd|rd|th)$/.test(t)) continue;
      if ((digits >= 4 && digits >= t.length - 4) || (digits >= 3 && /^\d{3,}[a-z]?\d{0,3}$/.test(t) && after && after[1] === t) || (digits >= 3 && /^\d{3}$/.test(t) && wordsN <= 5)) { search = t.toUpperCase(); break; }
    }
    if (search) given.search = true;
  }

  // pieces / orders instead of money
  let sortBy = '';
  if (S.has(/\b(?:pieces|pcs|units?|qty|quantity|how many (?:\w+\s+){0,2}(?:sold|did we sell|were sold)|number sold)\b/)) sortBy = 'units';
  else if (S.has(/\b(?:orders|invoices|transactions|tickets|baskets)\b/) && !salesIntent) sortBy = 'orders';

  // ---- decide what kind of question this is ----
  let kind = '';
  if (salesIntent) kind = 'sales';
  else if (stockIntent) kind = 'stock';
  else if (softIntent || dt || stores.length || cats.length || search) kind = 'sales';

  // a short follow-up ("and for point 90?", "what about last week") keeps what the last answer used
  const prev = o.prev && o.prev.args ? o.prev : null;
  const cue = /^(?:and|also|what about|how about|same|now|then|ok(?:ay)?|for)\b/.test(first) || /^(?:و|طب|وبالنسبه|ماشي)(?:\s|$)/.test(first);
  const anything = !!(dt || stores.length || cats.length || search || given.compare || given.basis);
  const follow = !!prev && anything && !salesIntent && !stockIntent && !product && !gKeys.length && (cue || wordsN <= 6);
  if (follow) kind = prev.kind === 'stock' ? 'stock' : 'sales';
  if (!kind) { out.kind = 'help'; return out; }
  const P = follow && prev.kind === kind ? prev.args : {};

  const args = {};
  if (kind === 'sales') {
    if (dt) { args.from = dt.from; args.to = dt.to; }
    else if (P.from) { args.from = P.from; args.to = P.to; }
    else { args.from = args.to = add(today, -1); out.notes.push('nodate'); }
    args.stores = given.stores ? stores : (P.stores || []);
    args.categories = given.cats ? cats : (P.categories || []);
    if (search) args.search = search; else if (P.search) args.search = P.search;
    args.basis = basis || P.basis || 'net';
    args.sort_by = sortBy || (P.sort_by && !salesIntent ? P.sort_by : 'sales');
    // split
    let by = '', then = '';
    if (product) { by = 'product'; args.limit = limit || 10; }
    else if (g.store && g.category) { by = 'store'; then = 'category'; }
    else if (g.store) by = 'store';
    else if (g.category) by = 'category';
    else if (g.day) by = 'day';
    else if (g.month) by = 'month';
    else if (g.weekday) by = 'weekday';
    else if (g.collection) by = 'collection';
    else if (g.payment) by = 'payment';
    else if (P.group_by && !(given.stores && P.group_by === 'store')) { by = P.group_by; then = P.then_by || ''; if (P.limit) args.limit = P.limit; }
    else if (args.stores.length === 1) by = args.from === args.to ? 'category' : 'day';
    else by = 'store';
    if (g.store && args.stores.length === 1 && !g.category) { /* one store asked "in every store": still the cards */ }
    args.group_by = by; if (then) args.then_by = then;
    if (compare) args.compare = compare;
    else if (given.dates || !P.compare) {
      const sameMonth = args.from.slice(0, 7) === args.to.slice(0, 7) && args.from.slice(8) === '01';
      args.compare = args.from === args.to ? 'last_week' : sameMonth ? 'last_month' : 'previous_period';
    } else args.compare = P.compare;
  } else if (kind === 'stock') {
    args.stores = given.stores ? stores : (P.stores || []);
    args.categories = given.cats ? cats : (P.categories || []);
    if (search) args.search = search; else if (P.search) args.search = P.search;
    if (g.store) args.group_by = 'store';
    else if (g.category) args.group_by = 'category';
    else if (args.search && !given.cats) args.group_by = 'item';
    else if (items || product) { args.group_by = 'item'; args.limit = limit || 12; }
    else args.group_by = P.group_by && !(given.stores && P.group_by === 'store') ? P.group_by : 'store';
    if (limit) args.limit = limit;
  }
  out.kind = kind; out.args = args; out.given = given;
  return out;
}

module.exports = { parse, readCtx, norm, parseDates, mkS };
