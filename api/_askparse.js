// Understands a question typed in plain English (and the basics in Arabic) WITHOUT any AI service, so the Pandora Assistant is free and
// nothing leaves the server. It finds: the dates, the stores, the categories, an item code or item words, what to split by (every store,
// day by day, top products ...), what to compare with, and what kind of question it is:
//   sales | stock | why (what moved the numbers) | forecast (month end) | cover (restock / slow items) | brief (how are we doing) | links | help
// It forgives typos ("charsm", "yesterdya"), understands rankings ("which store sold the most"), two periods ("october vs november"),
// and short follow-ups ("and for Point 90?", "why?"). It returns the arguments the lookups in api/_assistant.js take; those do the real work.
//   parse(text, { today, prev, apps, vocab }) -> { kind, args, notes, ar, rank, focus, vs, given }
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

// ---- typos: a word 1 edit away from a word we know (2 for long words) is read as that word ----
const VOC = ['yesterday', 'today', 'sales', 'stock', 'inventory', 'store', 'stores', 'branch', 'branches', 'every', 'charms', 'charm', 'bracelets', 'bracelet', 'necklace', 'necklaces', 'pendant', 'pendants',
  'earrings', 'earring', 'rings', 'accessories', 'accessory', 'services', 'compare', 'compared', 'versus', 'products', 'product', 'items', 'daily', 'weekday', 'weekdays', 'category', 'categories', 'collection', 'collections',
  'payment', 'payments', 'forecast', 'projection', 'projected', 'restock', 'reorder', 'selling', 'average', 'orders', 'pieces', 'units', 'quantity', 'revenue', 'turnover', 'briefing', 'summary', 'overview',
  'available', 'online', 'website', 'egypt', 'arabia', 'almaza', 'alexandria', 'festival', 'stars', 'january', 'february', 'march', 'april', 'august', 'september', 'october', 'november', 'december', 'sunday', 'monday',
  'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'gross', 'highest', 'lowest', 'weakest', 'strongest', 'biggest', 'worst', 'between', 'during', 'month', 'months', 'previous', 'current', 'running',
  'moving', 'overstock', 'invoices', 'transactions', 'performance', 'warehouse', 'total', 'sold', 'weeks', 'where', 'which', 'explain', 'happened'];
const VOCSET = new Set(VOC);
const COMMON = new Set(['stuck', 'chart', 'charts', 'charge', 'change', 'changed', 'share', 'shares', 'order', 'stocks', 'there', 'three', 'these', 'those', 'while', 'whole', 'whose', 'their', 'other', 'about', 'after', 'again', 'being', 'below', 'could',
  'first', 'found', 'great', 'large', 'least', 'might', 'never', 'often', 'right', 'since', 'small', 'still', 'think', 'under', 'until', 'using', 'value', 'values', 'would', 'years', 'price', 'prices', 'count', 'level', 'money', 'sizes',
  'night', 'weekly', 'hours', 'times', 'brand', 'brands', 'point', 'cairo', 'color', 'colour', 'gold', 'silver', 'heart', 'hearts', 'shine', 'stone', 'stones', 'crown', 'tennis', 'snake', 'chain', 'chains', 'beads', 'bead', 'sparkling', 'timeless', 'moments']);
function osa(a, b) {
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) { d[i] = [i]; }
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
function closest(tok, list, maxLen2) {
  const max = tok.length >= (maxLen2 || 8) ? 2 : 1;
  let best = '', bd = 99, bg = 99, tie = false;
  for (const v of list) {
    if (Math.abs(v.length - tok.length) > max) continue;
    const d = osa(tok, v);
    const gap = Math.abs(v.length - tok.length);
    if (d < bd || (d === bd && gap < bg)) { best = v; bd = d; bg = gap; tie = false; } else if (d === bd && gap === bg && v !== best) tie = true;
  }
  return best && !tie && bd <= max && (bd === 1 || tok[0] === best[0]) ? best : '';
}
function fixTypos(w) {
  return w.replace(/[a-z]{5,}/g, tok => (VOCSET.has(tok) || COMMON.has(tok)) ? tok : (closest(tok, VOC) || tok));
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
const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
const WDN = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// ---- dates: returns { from, to } or null (and removes what it read from S) ----
function parseDates(S, today) {
  const Y = +today.slice(0, 4), M = +today.slice(5, 7) - 1;
  const mk = (y, m, d, hasY) => { if (y < 100) y += 2000; let s = isoOf(y, m, d); if (s && !hasY && s > today) s = isoOf(y - 1, m, d); return s; };
  const found = []; const push = s => { if (s) found.push(s); };
  let m, n;
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
  const lastMonth = () => [M === 0 ? isoOf(Y - 1, 11, 1) : isoOf(Y, M - 1, 1), M === 0 ? monthEnd(Y - 1, 11) : monthEnd(Y, M - 1)];
  const rel = [
    [/\bday before yesterday\b/, () => [add(today, -2), add(today, -2)]],
    [R(AR_B + '(?:امس|امبارح|يوم امس)' + AR_E), () => [ye, ye]],
    [/\byesterday(?:'s)?\b/, () => [ye, ye]],
    [R(AR_B + '(?:اليوم|النهارده|دلوقتي)' + AR_E), () => [today, today]],
    [/\b(?:so far )?today(?:'s)?\b/, () => [today, today]],
    [/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/, x => [add(today, -Math.min(366, +x[1])), ye]],
    [/\b(?:last|past)\s+week\b/, x => { const s = weekStart(today); return /\bpast\b/.test(x[0]) ? [add(today, -7), ye] : [add(s, -7), add(s, -1)]; }],
    [R(AR_B + '(?:الاسبوع الماضي|الاسبوع اللي فات|الاسبوع الي فات)' + AR_E), () => { const s = weekStart(today); return [add(s, -7), add(s, -1)]; }],
    [/\b(?:this|current)\s+week\b|\bweek to date\b/, () => [weekStart(today), today]],
    [R(AR_B + '(?:هذا الاسبوع|الاسبوع ده|الاسبوع دا|الاسبوع الحالي)' + AR_E), () => [weekStart(today), today]],
    [/\b(?:last|previous)\s+month\b/, lastMonth],
    [R(AR_B + '(?:الشهر الماضي|الشهر اللي فات|الشهر الي فات|الشهر الفائت)' + AR_E), lastMonth],
    [/\b(?:this|current)\s+month\b|\bmonth to date\b|\bmtd\b/, () => [isoOf(Y, M, 1), today]],
    [R(AR_B + '(?:هذا الشهر|الشهر ده|الشهر دا|الشهر الحالي)' + AR_E), () => [isoOf(Y, M, 1), today]],
    [/\b(?:last|previous)\s+year\b/, () => [isoOf(Y - 1, 0, 1), isoOf(Y - 1, 11, 31)]],
    [/\b(?:this|current)\s+year\b|\byear to date\b|\bytd\b/, () => [isoOf(Y, 0, 1), today]],
    [R(AR_B + '(?:هذه السنه|السنه دي|السنه الحاليه|هذا العام|العام ده)' + AR_E), () => [isoOf(Y, 0, 1), today]]
  ];
  for (const [rx, f] of rel) { if ((m = S.eat(rx))) { const r = f(m); if (r[0] && r[1]) return { from: r[0], to: r[1] }; } }

  m = S.eat(R('\\b(?:in|for|during|of|throughout)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?' + MON + '\\b(?:,?\\s*(20\\d\\d))?')) || S.eat(R('\\b' + MON + ',?\\s+(20\\d\\d)\\b')) || S.eat(R('\\b' + FULLMON + '\\b(?:,?\\s*(20\\d\\d))?'));
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
// words that are never an item name
const STOP = new Set(('a an the of in on at to for and or is are was were be been do does did we i me my you our it its this that these those what which who whom how when where why show give tell get see please can could would should will much many some any all only just ' +
  'with without by from as than then there here have has had so if about into over under per each every sales sale sold sell selling store stores branch branches item items product products total summary number pcs pieces piece vs versus compare compared day days week weeks month months year years last next ' +
  'top best worst most least high higher highest low lower lowest big biggest small smallest good bad more less same other another also still yet now today yesterday tomorrow data report reports figures figure numbers need want like look find let make take put ' +
  'net gross vat egp money revenue income turnover amount value orders order invoice invoices up down drop dropped fall fell rise rose increase decrease change changed happened going doing done did tell me us them they he she him her his hers ' +
  'stock inventory available left remaining having us name names code codes sku skus design designs').split(' '));

const REPORT_KEYS = [
  ['daily', /\b(?:daily (?:store )?report|daily sheet|targets?|visitors?|footfall|conversion|traffic)\b/],
  ['refill', /\b(?:refill|pipeline|sell[\s-]*out|budget)\b/],
  ['reorder', /\b(?:smart re-?order|what to buy|next order|season order)\b/],
  ['transfer', /\b(?:transfers?|move items|move stock)\b/],
  ['dist', /\b(?:distribution|distribute|split (?:a |the )?shipment)\b/],
  ['recv', /\b(?:receiving|commercial invoice|receive (?:a |the )?shipment)\b/],
  ['stockcount', /\bstock[\s-]*count(?:ing)?\b|\bcount (?:a |the )?store\b/],
  ['stockchecker', /\bstock[\s-]*checker\b|\bscan(?:ning)? barcodes?\b/],
  ['schedule', /\b(?:schedules?|shifts?|roster|rota|who works)\b/],
  ['vmzones', /\bvm zones?\b|\bzones?\b/],
  ['zonestock', /\bzone stock\b/],
  ['vm', /\b(?:vm report|visual merchandis\w*|\bvm\b)/],
  ['overview', /\b(?:store overview|overview page)\b/],
  ['activity', /\b(?:activity|who signed in|who logged in|login history)\b/],
  ['uploads', /\b(?:uploads?|upload a file|all uploads)\b/],
  ['access', /\b(?:access|privileges|permissions)\b/],
  ['approvals', /\b(?:approvals?|new users?|reset (?:a )?password|sign[\s-]*ups?)\b/],
  ['maintenance', /\b(?:maintenance|repairs?|faults?)\b/]
];

function readCtx(s) {
  s = String(s || ''); const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try { const o = JSON.parse(s.slice(i, j + 1)); if (o && o.a && typeof o.a === 'object') return { kind: o.k, args: o.a }; } catch (_) { /* not ours */ }
  return null;
}
const slotKind = k => (k === 'stock' || k === 'cover') ? 'stock' : (k === 'staff' || k === 'slow') ? k : 'sales'; // sales, why, brief, forecast share the same filters; stock and cover share theirs

// "A vs B" where both sides are dates: october vs november, 15 nov vs 8 nov
function twoPeriods(S, today) {
  const m = /^(.*?)\b(?:vs\.?|versus|against|compared?\s+(?:to|with))\b(.*)$/.exec(S.w) || /\bcompare\s+(.+?)\s+(?:with|and|to|against)\s+(.+)$/.exec(S.w);
  if (!m) return null;
  const L = mkS(m[1]), Rr = mkS(m[2]);
  const a = parseDates(L, today), b = parseDates(Rr, today);
  if (!a || !b || (a.from === b.from && a.to === b.to)) return null;
  S.w = (L.w + ' ' + Rr.w).replace(/\bcompare\b/g, ' ');
  return { a, b };
}

function parse(text, o) {
  o = o || {};
  const today = o.today;
  const raw = String(text || '');
  const ar = /[؀-ۿ]/.test(raw);
  let first = norm(raw);
  if (!ar) first = fixTypos(first);
  const S = mkS(first);
  const out = { ar, kind: '', args: {}, notes: [], given: {} };
  const given = out.given;
  const wordsN = first.split(/\s+/).filter(Boolean).length;

  // greetings and "what can you do"
  if (wordsN <= 6 && /^(?:help|hi|hello|hey|thanks?|thank you|good (?:morning|evening)|what can you do|how (?:do|does) (?:you|this) work|مرحبا|اهلا|السلام عليكم|ازيك|شكرا|مساعده)(?:\s|$|[!.?])/.test(first) && !/\b(?:sales?|stock)\b|مبيعات|مخزون/.test(first)) { out.kind = 'help'; return out; }

  // sync from ERP: "sync", "sync october", "when was the last sync" (the assistant only shows a button; the super admin taps it)
  if (wordsN <= 9 && (/(?:^|\s)(?:sync|synch|synchronize|synchronise|resync|refresh data|update data|refresh the data|update the data|pull from erp|erp sync)(?=\s|$)/.test(first) || /مزامن|سينك|حدث الداتا|حدث البيانات/.test(raw))) {
    out.kind = 'sync';
    out.args = { mode: /\b(?:when|status|latest|did)\b|\blast (?:sync|time)\b/.test(first) ? 'status' : 'run' };
    const MN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const t = today || new Date().toISOString().slice(0, 10), ty = +t.slice(0, 4), tm = +t.slice(5, 7);
    const mi = MN.findIndex(m => new RegExp('(?:^|\\s)' + m.slice(0, 3) + '(?:' + m.slice(3) + ')?(?=\\s|$)').test(first));
    if (/\blast month\b/.test(first)) { const y = tm === 1 ? ty - 1 : ty, m = tm === 1 ? 12 : tm - 1; out.args.month = y + '-' + String(m).padStart(2, '0'); }
    else if (mi >= 0) { const y = mi + 1 > tm ? ty - 1 : ty; out.args.month = y + '-' + String(mi + 1).padStart(2, '0'); }
    return out;
  }

  // links: "open stock balance"
  if (/\b(?:open|go to|take me to|link to|where (?:can|do) i find|show me the)\b|(?:^|\s)(?:افتح|وديني)(?=\s|$)/.test(first) && Array.isArray(o.apps)) {
    const ids = [];
    for (const a of o.apps) { const t = norm(a.title).replace(/\s*\/.*$/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); if (t && first.replace(/[^a-z0-9 ]/g, ' ').includes(t)) ids.push(a.id); }
    if (ids.length) { out.kind = 'links'; out.args = { ids: ids.slice(0, 4) }; return out; }
  }

  // text inside quotes is an item search
  let search = '';
  { const m = S.eat(/"([^"]{2,40})"/); if (m) { search = m[1].trim(); given.search = true; } }

  // ---- what kind of question: read before anything is removed ----
  const w0 = S.w;
  const I = {
    why: /\bwhy\b|\bwhat(?:'s| is| was| has)?\s*(?:happened|going on|driving|behind|caused|changed)\b|\bexplain\b|\bhow come\b/.test(w0),
    forecast: /\b(?:forecast|projection|projected|project|predict(?:ion)?|run[\s-]*rate|on track|end of (?:the )?month|month[\s-]*end|will we (?:reach|hit|make|finish|close)|how much will we|where will we (?:end|finish|land)|expected (?:sales|total))\b/.test(w0),
    slow: /\b(?:slow[\s-]*moving|slow movers?|dead stock|not selling|(?:is|are)n'?t selling|never sold|overstock(?:ed)?|excess stock|stuck stock|not moving)\b/.test(w0) || (/\bslow\b/.test(w0) && /\b(?:items?|stock|products?|skus?|designs?|movers?|moving)\b/.test(w0)),
    restock: /\b(?:re-?stock|re-?order|running (?:out|low)|run(?:ning)? out|low stock|low on stock|out of stock|sold out|stock[\s-]?outs?|about to run out|need(?:s)? (?:to )?(?:order|reorder|restock|buy|refill)|what (?:should|do) (?:i|we) (?:order|reorder|restock|buy|refill)|refill|replenish\w*)\b/.test(w0),
    brief: /\bhow\s+(?:are|were|is|was|did)\s+(?:we|sales|business|things|it|the (?:day|week|month)|yesterday|today|this (?:week|month)|last (?:week|month))\b|\b(?:summary|briefing|overview|snapshot|recap|digest|update me|status)\b/.test(w0)
  };
  const nameHit = !!(o.people && o.people.size) && (w0.match(/\b[a-z]{3,}\b/g) || []).some(t => !STOP.has(t) && !VOCSET.has(t) && o.people.has(t));
  const staffIntent = (nameHit || /\b(?:staff|sales[\s-]*(?:person|people|persons|man|men|woman|women|associates?|reps?|team|advisors?|assistants?)|employees?|cashiers?|consultants?|advisors?|performers?)\b|\bwho (?:sold|sells|is selling|are selling|did (?:the )?best|is (?:the )?best|is top|performed)\b|\b(?:leaderboard|commission)\b/.test(w0) || /(?:^|\s)(?:موظف|موظفين|موظفه|البائع|البائعين|الفريق|اداء الفريق)(?=\s|$)/.test(w0)) && !/\bbest[\s-]*sellers?\b/.test(w0);
  const slowWord = /\b(?:slow[\s-]*moving|slowmoving|stuck|slow movers?|dead[\s-]*stock|stuck|not selling|(?:is|are)n'?t selling|never sold|over[\s-]*stock(?:ed)?|excess stock|not moving|slow)\b/.test(w0) && (/\b(?:slow[\s-]*moving|slowmoving|stuck|dead[\s-]*stock|over[\s-]*stock|not selling|(?:is|are)n'?t selling|never sold|not moving|excess)\b/.test(w0) || /\b(?:items?|stock|products?|skus?|designs?|movers?|moving)\b/.test(w0));
  const stockIntent = /\b(?:stock|inventory|on hand|soh|available|availability|remaining|do we have|have we got|where (?:is|are|can i find)|who has|which (?:stores?|branch(?:es)?) (?:has|have)|how many (?:\w+\s+){0,3}(?:do )?(?:we|i) (?:have|got))\b/.test(w0) || /(?:^|\s)(?:مخزون|ستوك|المتاح|الموجود|متاح)(?=\s|$)/.test(w0);
  const salesIntent = /\b(?:sales?|sold|sell(?:ing)?|revenue|turnover|income)\b/.test(w0) || /(?:^|\s)(?:مبيعات|بيع|ايراد)(?=\s|$)/.test(w0);

  // a ranking: "which store sold the most charms", "best day this month", "weakest category"
  let rank = null;
  {
    const m = /\b(most|best|top|highest|biggest|largest|strongest|least|lowest|worst|weakest|smallest|slowest)\b/.exec(w0);
    const asks = /\b(?:which|what|who|where)\b/.test(w0) || /\b(?:best|worst|top|weakest|strongest|highest|lowest|biggest|slowest)\s+(?:performing\s+|selling\s+)?(?:store|branch|shop|category|day|weekday|product|item|design|collection|month)\b/.test(w0);
    if (m && asks && !/\b(?:top|best|first)\s+\d/.test(w0) && !I.why && !I.restock && !I.slow) {
      const dimOf = s => /\b(?:stores?|branch(?:es)?|shops?|locations?|showrooms?)\b/.test(s) ? 'store' : /\bcategor(?:y|ies)\b/.test(s) ? 'category' : /\bweekdays?\b|\bday of (?:the )?week\b/.test(s) ? 'weekday' : /\bdays?\b/.test(s) ? 'day' : /\bmonths?\b/.test(s) ? 'month' : /\bcollections?\b/.test(s) ? 'collection' : /\b(?:products?|items?|designs?|skus?|sellers?|models?)\b/.test(s) ? 'product' : '';
      rank = { dir: /^(?:least|lowest|worst|weakest|smallest|slowest)$/.test(m[1]) ? 'bottom' : 'top', dim: dimOf(w0) };
      if (!rank.dim && /\b(?:sold|sell|selling|seller)\b/.test(w0)) rank.dim = 'product';
    }
  }

  // two periods to compare: october vs november (the second one is what the first is compared with)
  let custom = null;
  if (!/\b(?:vs\.?|versus|compared?\s+(?:to|with)|against|than)\s+(?:the\s+)?(?:same\s+(?:day|period|dates?)\s+)?(?:last\s+(?:week|month|year)|previous|a\s+(?:week|month|year)\s+ago)\b/.test(S.w) && /\b(?:vs\.?|versus|compare|compared|against)\b/.test(S.w)) custom = twoPeriods(S, today);

  // what to compare with
  let compare;
  if (custom) { compare = 'custom'; given.compare = true; given.dates = true; }
  else {
    const m = S.eat(/\b(?:vs\.?|versus|compared?\s+(?:to|with)|compared|against|than)\s+(?:the\s+)?(?:same\s+(?:day|period|dates?)\s+)?(last\s+week|last\s+month|last\s+year|previous(?:\s+(?:period|day|days))?|a\s+week\s+ago|a\s+year\s+ago|a\s+month\s+ago)\b/);
    if (m) { const t = m[1]; compare = /year/.test(t) ? 'last_year' : /month/.test(t) ? 'last_month' : /week/.test(t) ? 'last_week' : 'previous_period'; given.compare = true; }
    else if (S.eat(/\b(?:no|without)\s+compar(?:ison|e|ing)\b/)) { compare = 'none'; given.compare = true; }
  }
  // net or gross
  let basis;
  if (S.eat(/\b(?:gross|with vat|incl(?:uding|\.)?\s*vat|vat included)\b/)) { basis = 'gross'; given.basis = true; }
  else if (S.eat(/\b(?:net|without vat|excl(?:uding|\.)?\s*vat|ex vat)\b/)) { basis = 'net'; given.basis = true; }

  // averages
  let focus = '';
  if (S.eat(/\b(?:average|avg)\s+(?:order|ticket|basket|invoice|sale|transaction|spend)(?:\s+(?:value|size))?\b|\batv\b|\bbasket\s+(?:size|value)\b/)) focus = 'atv';
  else if (S.eat(/\bupt\b|\b(?:pieces|units|items|pcs)\s+per\s+(?:order|ticket|basket|invoice|transaction|customer)\b|\bunits per transaction\b/)) focus = 'upt';
  else if (S.eat(/\b(?:average|avg)\s+(?:daily\s+)?(?:sales|revenue)?\s*(?:per day|a day|daily)\b|\bdaily average\b|\baverage daily\b|\bper day\b/)) focus = 'daily';

  // for restock / slow items a number of days is a threshold, not a period
  let spanDays = 0;
  if (I.restock || I.slow) {
    const m = S.eat(/\b(\d{1,3})\s*(days?|weeks?|months?)\b/);
    if (m) spanDays = Math.min(365, +m[1] * (/^d/.test(m[2]) ? 1 : /^w/.test(m[2]) ? 7 : 30));
  }

  // how many to list
  let limit = 0, product = false;
  { const m = S.eat(/\b(?:top|best|first)\s+(\d{1,2})\b/) || S.eat(R(AR_B + '(?:اعلي|اكتر|افضل)\\s+(\\d{1,2})(?=\\s|$)')); if (m) { limit = Math.min(50, +m[1]); product = true; } }
  if (S.eat(/\b(?:top|best)[\s-]*(?:selling|sellers?|sold)\b|\b(?:top|best)\s+(?:items?|products?|skus?|designs?)\b|\bmost\s+sold\b|\bbest\s*sellers?\b|\bbest[\s-]selling\b/) || S.eat(R(AR_B + '(?:اعلي|اكتر|افضل)\\s+(?:منتج|منتجات|صنف|اصناف|قطع)(?=\\s|$)'))) product = true;

  // everything again ("all stores", "all categories") clears what an earlier answer filtered on
  let allStores = !!S.eat(/\ball\s+(?:the\s+)?(?:stores|branches|shops)\b/), allCats = !!S.eat(/\ball\s+(?:the\s+)?categories\b|\beverything\b/);

  // what to split by
  const g = {};
  if (S.eat(/\b(?:every|each|all|per|by)\s+(?:the\s+)?(?:store|branch|shop|location|showroom)s?\b|\b(?:store|branch)[\s-]*(?:by|wise)[\s-]*(?:store|branch)?\b|\bbranches\b|\bin\s+(?:all\s+)?(?:the\s+)?stores\b|\bacross\s+(?:all\s+)?(?:the\s+)?stores\b/) || S.eat(R(AR_B + '(?:كل فرع|كل الفروع|كل محل|كل المحلات|في كل فرع|الفروع)(?=\\s|$)'))) g.store = true;
  if (S.eat(/\bday[\s-]*by[\s-]*day\b|\bdaily\b|\b(?:each|every|per|by)\s+day\b/) || S.eat(R(AR_B + '(?:يوم بيوم|كل يوم)(?=\\s|$)'))) g.day = true;
  if (S.eat(/\bmonth[\s-]*by[\s-]*month\b|\bmonthly\b|\b(?:each|every|per|by)\s+month\b/)) g.month = true;
  if (S.eat(/\b(?:by|per|each|every)\s+weekday\b|\bweekdays\b|\bday of (?:the )?week\b/)) g.weekday = true;
  if (S.eat(/\b(?:by|per|each|every)\s+categor(?:y|ies)\b|\bcategories\b|\bcategory (?:breakdown|split)\b/)) g.category = true;
  if (S.eat(/\bcollections?\b/)) g.collection = true;
  if (S.eat(/\b(?:payments?|payment methods?)\b|\bcash\b|\bvisa\b|\bvalu\b/)) g.payment = true;
  const items = !!S.eat(/\b(?:items?|products?|skus?|designs?|models?)\b/);
  const gKeys = Object.keys(g);
  if (gKeys.length) given.group = true;
  if (focus === 'daily' && !gKeys.length) g.day = true;

  // dates
  let dt = custom ? custom.a : parseDates(S, today);
  if (dt) given.dates = true;

  // stores
  const stores = [];
  for (const [name, en, arx] of STORES) { const m = S.eat(en) || S.eat(arx); if (m && !stores.includes(name)) stores.push(name); }
  if (stores.length) given.stores = true;
  // categories
  const cats = [];
  for (const [name, en, arx] of CATS) { for (let k = 0; k < 3; k++) { const m = S.eat(en) || S.eat(arx); if (m && !cats.includes(name)) cats.push(name); if (!m) break; } }
  if (cats.length) given.cats = true;

  // an item code: 4+ characters with at least 3 digits (a year or a plain number is not one)
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
  // item words ("heart", "tennis", "snake chain"): only words that really appear in product names or collections
  if (!search && o.vocab && o.vocab.size) {
    const hit = [];
    for (let t of (S.w.match(/\b[a-z]{3,}\b/g) || [])) {
      if (STOP.has(t) || VOCSET.has(t)) continue;
      if (!o.vocab.has(t)) { const c = t.length >= 4 ? closest(t, [...o.vocab].filter(v => Math.abs(v.length - t.length) <= 1)) : ''; if (!c) continue; t = c; }
      if (!hit.includes(t)) hit.push(t);
    }
    if (hit.length && hit.length <= 3) { search = hit.join(' '); given.search = true; given.words = true; }
  }

  // pieces / orders instead of money
  let sortBy = '';
  if (focus === 'atv') sortBy = 'atv'; else if (focus === 'upt') sortBy = 'upt';
  else if (S.has(/\b(?:pieces|pcs|units?|qty|quantity|how many (?:\w+\s+){0,2}(?:sold|did we sell|were sold)|number sold)\b/)) sortBy = 'units';
  else if (S.has(/\b(?:orders|invoices|transactions|tickets|baskets)\b/) && !salesIntent) sortBy = 'orders';

  const softIntent = /\b(?:top|best|worst|lowest|highest|compare|total|how much|orders?|invoices?|pieces|units|pcs|qty|quantity|performance)\b/.test(w0) || !!product || gKeys.length > 0 || !!focus || !!rank;

  // ---- what kind of question ----
  let kind = '', mode = '';
  if (I.why) kind = 'why';
  else if (slowWord && !salesIntent) { kind = 'slow'; }
  else if (staffIntent && !I.forecast) kind = 'staff';
  else if (I.forecast) kind = 'forecast';
  else if (I.restock && !salesIntent) { kind = 'cover'; mode = 'restock'; }
  else if (I.brief && !stockIntent && !product && !gKeys.length) kind = 'brief';
  else if (salesIntent) kind = 'sales';
  else if (stockIntent) kind = 'stock';
  else if (softIntent || dt || stores.length || cats.length || search || compare) kind = 'sales';

  // a question about a report itself ("where do I plan the shifts", "open the transfer page"): open it
  if (!kind || (kind === 'sales' && !salesIntent && !product && !gKeys.length && !search && !rank)) {
    const rk = Array.isArray(o.apps) ? REPORT_KEYS.filter(([id, rx]) => rx.test(w0) && o.apps.some(a => a.id === id)).map(x => x[0]) : [];
    if (rk.length && !stockIntent && !I.restock && !I.forecast) { out.kind = 'links'; out.args = { ids: rk.slice(0, 3) }; return out; }
  }
  // a short follow-up ("and for point 90?", "why?", "top products") keeps what the last answer used
  const prev = o.prev && o.prev.args ? o.prev : null;
  const cue = /^(?:and|also|what about|how about|same|now|then|ok(?:ay)?|for)\b/.test(first) || /^(?:و|طب|وبالنسبه|ماشي)(?:\s|$)/.test(first);
  if (!kind && prev && wordsN <= 6) kind = slotKind(prev.kind) === 'stock' ? 'stock' : 'sales';
  if (!kind) { out.kind = 'help'; return out; }
  const follow = !!prev && (slotKind(kind) === slotKind(prev.kind) ? (cue || wordsN <= 6 || (kind === 'why' && wordsN <= 9)) : (kind === 'stock' && wordsN <= 6));
  const P = follow ? prev.args : {};
  if (follow) out.notes.push('follow');

  const args = {};
  const pickStores = () => { if (given.stores) return stores; if (allStores || g.store || (rank && rank.dim === 'store')) return []; return P.stores || []; };
  const pickCats = () => { if (given.cats) return cats; if (allCats || g.category || (rank && rank.dim === 'category')) return []; return P.categories || []; };
  const baseDates = dflt => {
    if (dt) return [dt.from, dt.to];
    if (P.from) { out.notes.push('samedates'); return [P.from, P.to]; }
    if (dflt === 'yesterday') { out.notes.push('nodate'); return [add(today, -1), add(today, -1)]; }
    return dflt;
  };

  if (kind === 'sales' || kind === 'why' || kind === 'brief') {
    const [f, t] = baseDates('yesterday'); args.from = f; args.to = t;
    args.stores = pickStores(); args.categories = pickCats();
    if (search) args.search = search; else if (P.search && !allCats) args.search = P.search;
    args.basis = basis || P.basis || 'net';
    args.sort_by = sortBy || (P.sort_by && P.sort_by !== 'sales' && kind === 'sales' && !salesIntent ? P.sort_by : 'sales');
    if (kind === 'sales') {
      let by = '', then = '';
      const dimBy = rank && rank.dim ? rank.dim : '';
      if (product || dimBy === 'product') { by = 'product'; args.limit = limit || 10; }
      else if (g.store && g.category) { by = 'store'; then = 'category'; }
      else if (g.store || dimBy === 'store') by = 'store';
      else if (g.category || dimBy === 'category') by = 'category';
      else if (g.day || dimBy === 'day') by = 'day';
      else if (g.month || dimBy === 'month') by = 'month';
      else if (g.weekday || dimBy === 'weekday') by = 'weekday';
      else if (g.collection || dimBy === 'collection') by = 'collection';
      else if (g.payment) by = 'payment';
      else if (P.group_by && !(given.stores && P.group_by === 'store') && !(given.cats && P.group_by === 'category')) { by = P.group_by; then = P.then_by || ''; if (P.limit) args.limit = P.limit; }
      else if (args.stores.length === 1) by = args.from === args.to ? 'category' : 'day';
      else by = 'store';
      args.group_by = by; if (then) args.then_by = then;
    }
    if (compare === 'custom') { args.compare = 'custom'; args.cmp_from = custom.b.from; args.cmp_to = custom.b.to; }
    else if (compare) args.compare = compare;
    else if (!dt && P.compare && P.from) { args.compare = P.compare; if (P.compare === 'custom' && P.cmp_from) { args.cmp_from = P.cmp_from; args.cmp_to = P.cmp_to; } }
    else {
      const sameMonth = args.from.slice(0, 7) === args.to.slice(0, 7) && args.from.slice(8) === '01';
      args.compare = args.from === args.to ? 'last_week' : sameMonth ? 'last_month' : 'previous_period';
    }
  } else if (kind === 'staff') {
    const mstart = today.slice(0, 7) + '-01';
    if (dt) { args.from = dt.from; args.to = dt.to; } else if (P.from) { args.from = P.from; args.to = P.to; out.notes.push('samedates'); } else { args.from = mstart; args.to = today; out.notes.push('nodatemonth'); }
    args.stores = pickStores(); args.categories = pickCats(); args.basis = basis || P.basis || 'net';
    if (!given.stores && !P.stores && !allStores) { /* all stores */ }
    // a name: words that are the start of a sales person's name
    let person = '';
    if (o.people && o.people.size) {
      const hit = [];
      for (const t of (S.w.match(/\b[a-z]{3,}\b/g) || [])) { if (STOP.has(t) || VOCSET.has(t) || /^(?:staff|person|people|performance|team|employees?|cashiers?|associates?)$/.test(t)) continue; if (o.people.has(t) && !hit.includes(t)) hit.push(t); }
      if (hit.length) person = hit.join(' ');
    }
    if (person) args.person = person; else if (P.person && !given.stores && !allStores && wordsN <= 4) args.person = P.person;
    args.group_by = person ? 'person' : (g.store || (rank && rank.dim === 'store')) ? 'store' : (args.stores.length === 1 || !given.stores) && !g.store ? 'person' : 'person';
    if (g.store && !given.stores) args.group_by = 'store';
    args.limit = limit || 10;
    args.sort_by = sortBy || 'sales';
    if (compare && compare !== 'custom') args.compare = compare; else if (P.compare && !dt && P.from) args.compare = P.compare;
  } else if (kind === 'slow') {
    args.stores = pickStores(); args.categories = pickCats();
    if (search) args.search = search; else if (P.search && !allCats) args.search = P.search;
    args.group_by = g.store || (rank && rank.dim === 'store') ? 'store' : (args.search || items || product) ? 'item' : (g.category ? 'category' : 'store');
    if (args.stores.length === 1 && !g.store && !g.category) args.group_by = 'item';
    args.limit = limit || 12;
  } else if (kind === 'forecast') {
    const d = dt ? dt.to : today;
    args.month = d.slice(0, 7);
    args.stores = pickStores(); args.categories = pickCats(); args.basis = basis || P.basis || 'net';
    if (search) args.search = search;
  } else if (kind === 'stock' || kind === 'cover') {
    args.stores = pickStores(); args.categories = pickCats();
    if (search) args.search = search; else if (P.search && !allCats) args.search = P.search;
    if (kind === 'stock') {
      if (g.store || (rank && rank.dim === 'store')) args.group_by = 'store';
      else if (g.category) args.group_by = 'category';
      else if (args.search && !given.cats) args.group_by = 'item';
      else if (items || product) { args.group_by = 'item'; args.limit = limit || 12; }
      else args.group_by = ['store', 'item', 'category'].includes(P.group_by) && !(given.stores && P.group_by === 'store') ? P.group_by : 'store';
      if (limit) args.limit = limit;
    } else { args.mode = mode; if (spanDays) args.days = spanDays; if (limit) args.limit = limit; }
  }
  out.kind = kind; out.args = args; out.rank = rank; out.focus = focus; out.mode = mode;
  out.vs = stores.length === 2 && /\b(?:vs\.?|versus|compare|compared|against|or)\b/.test(w0);
  return out;
}

module.exports = { parse, readCtx, norm, parseDates, mkS, fixTypos };
