// The daily sales table as a picture (PNG) for the Telegram digest. Drawn as SVG and turned into a PNG with sharp.
// Functions have no system fonts, so Inter is bundled in api/_fonts and fontconfig is pointed at it (see vercel.json includeFiles).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '_fonts');
let ready = null;
function setup() {
  if (ready) return ready;
  const tmp = path.join(require('os').tmpdir(), 'pandora-fc');
  fs.mkdirSync(path.join(tmp, 'cache'), { recursive: true });
  const conf = path.join(tmp, 'fonts.conf');
  fs.writeFileSync(conf, '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>' + DIR + '</dir><cachedir>' + path.join(tmp, 'cache') + '</cachedir></fontconfig>');
  process.env.FONTCONFIG_FILE = conf; // must be set before sharp draws its first text
  ready = require('sharp');
  return ready;
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f0 = n => Math.round(n || 0).toLocaleString('en-US');
const cut = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const INK = '#2A1018', PINK = '#FF93A0', MARK = '#D46D83', MUTED = '#8A7D82', LINE = '#EFE4E0', UP = '#1F7A4D', UPBG = '#E3F3EA', DOWN = '#B8435D', DOWNBG = '#FFE7EB', CARD = '#FFFFFF', BG = '#FBF6F3';

// t = { weekday, dateLong, wd (short weekday, "Wed"), net, orders, mtd, mtdLabel, mtdChg, mtdVs, dayChg, rows:[{name, orders, gross, net, mtd, chg}], leader, top, note }
// chg values are percent numbers or null.
function svg(t) {
  const logo = fs.readFileSync(path.join(DIR, 'logo.png')).toString('base64');
  const rows = t.rows, n = rows.length;
  const W = 1200, PAD = 44, R = W - PAD, RH = 72, TOP = 392;
  const H = TOP + RH * n + RH + 215;
  const C = { badge: PAD + 36, name: PAD + 80, inv: 410, gross: 530, net: 664, bar: 686, share: 884, pill: 908, mtd: R - 26 };
  const mx = Math.max(1, ...rows.map(r => r.net));
  const pct = v => Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : (Math.abs(v) < 100 ? 1 : 0)) + '%';
  const kpi = (x, w, label, val, sub, subCol) => `<rect x="${x}" y="176" width="${w}" height="128" rx="20" fill="${CARD}" stroke="${LINE}" stroke-width="2"/><text x="${x + 24}" y="216" font-size="20" font-weight="700" fill="${MUTED}">${esc(label)}</text><text x="${x + 24}" y="266" font-size="38" font-weight="800" fill="${INK}">${esc(val)}</text><text x="${x + 24}" y="293" font-size="19" font-weight="700" fill="${subCol || MUTED}">${esc(sub)}</text>`;
  const kw0 = 330, kw = (W - PAD * 2 - 18 * 3 - kw0) / 3;
  const arrow = v => (v >= 0 ? '▲ ' : '▼ ') + pct(v);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">
<defs><linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="${MARK}"/></linearGradient>
<linearGradient id="hd" x1="0" x2="1"><stop offset="0" stop-color="#FF93A0"/><stop offset="1" stop-color="#FFB3BC"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="${BG}"/>
<rect width="${W}" height="150" fill="url(#hd)"/>
<circle cx="${PAD + 44}" cy="75" r="44" fill="#fff"/><image x="${PAD + 16}" y="47" width="56" height="56" href="data:image/png;base64,${logo}"/>
<text x="${PAD + 110}" y="66" font-size="30" font-weight="800" fill="${INK}">Pandora Egypt</text>
<text x="${PAD + 110}" y="100" font-size="22" font-weight="600" fill="${INK}" opacity=".8">Daily sales report · all stores</text>
<text x="${R}" y="66" font-size="30" font-weight="800" fill="${INK}" text-anchor="end">${esc(t.weekday)}</text>
<text x="${R}" y="100" font-size="22" font-weight="600" fill="${INK}" opacity=".8" text-anchor="end">${esc(t.dateLong)}</text>`;
  const dc = t.dayChg;
  s += kpi(PAD, kw0, 'Net sales (no VAT)', 'EGP ' + f0(t.net), dc == null ? 'no comparison yet' : arrow(dc) + ' vs last ' + t.wd, dc == null ? MUTED : dc >= 0 ? UP : DOWN);
  s += kpi(PAD + kw0 + 18, kw, 'Invoices', String(t.orders), 'across ' + n + ' branch' + (n === 1 ? '' : 'es'));
  s += kpi(PAD + kw0 + 18 + (kw + 18), kw, 'Average invoice', 'EGP ' + f0(t.orders ? t.net / t.orders : 0), 'net per invoice');
  const mv = t.mtd >= 1e6 ? (t.mtd / 1e6).toFixed(2) + 'M' : f0(t.mtd);
  s += kpi(PAD + kw0 + 18 + (kw + 18) * 2, kw, 'Month to date', 'EGP ' + mv, t.mtdChg == null ? t.mtdLabel : arrow(t.mtdChg) + ' vs ' + t.mtdVs, t.mtdChg == null ? MUTED : t.mtdChg >= 0 ? UP : DOWN);
  s += `<rect x="${PAD}" y="${TOP - 62}" width="${W - PAD * 2}" height="${RH * (n + 1) + 80}" rx="24" fill="${CARD}" stroke="${LINE}" stroke-width="2"/>`;
  const hy = TOP - 22;
  s += `<g font-size="18" font-weight="800" fill="${MUTED}" letter-spacing=".6"><text x="${C.name}" y="${hy}">BRANCH</text><text x="${C.inv}" y="${hy}" text-anchor="end">INVOICES</text><text x="${C.gross}" y="${hy}" text-anchor="end">GROSS</text><text x="${C.net}" y="${hy}" text-anchor="end">NET</text><text x="${C.share}" y="${hy}" text-anchor="end">SHARE</text><text x="${C.pill + 52}" y="${hy}" text-anchor="middle">VS LAST ${esc(t.wd.toUpperCase())}</text><text x="${C.mtd}" y="${hy}" text-anchor="end">MTD</text></g><rect x="${PAD + 20}" y="${TOP - 8}" width="${W - PAD * 2 - 40}" height="2" fill="${LINE}"/>`;
  let tg = 0;
  rows.forEach((r, i) => {
    tg += r.gross;
    const y = TOP + i * RH, cy = y + RH / 2 + 8, has = r.chg != null, flat = has && Math.abs(r.chg) < 0.5, up = has && r.chg >= 0;
    const nm = cut(r.name, 17);
    if (i > 0) s += `<rect x="${PAD + 20}" y="${y}" width="${W - PAD * 2 - 40}" height="1.5" fill="${LINE}"/>`;
    s += `<circle cx="${C.badge}" cy="${y + RH / 2}" r="19" fill="${i === 0 ? PINK : '#F6EEEB'}"/><text x="${C.badge}" y="${cy - 1}" font-size="19" font-weight="800" fill="${INK}" text-anchor="middle">${i + 1}</text>
  <text x="${C.name}" y="${cy}" font-size="${nm.length > 14 ? 22 : 25}" font-weight="${i === 0 ? 800 : 700}" fill="${INK}">${esc(nm)}</text>
  <g font-size="24" fill="${INK}"><text x="${C.inv}" y="${cy}" text-anchor="end">${r.orders}</text><text x="${C.gross}" y="${cy}" text-anchor="end" fill="#5C4F55">${f0(r.gross)}</text><text x="${C.net}" y="${cy}" text-anchor="end" font-weight="800">${f0(r.net)}</text><text x="${C.mtd}" y="${cy}" text-anchor="end" fill="#5C4F55">${f0(r.mtd)}</text></g>
  <rect x="${C.bar}" y="${y + RH / 2 - 6}" width="104" height="12" rx="6" fill="#F6EEEB"/><rect x="${C.bar}" y="${y + RH / 2 - 6}" width="${Math.max(10, 104 * Math.max(0, r.net) / mx)}" height="12" rx="6" fill="url(#bar)"/>
  <text x="${C.share}" y="${cy}" font-size="22" font-weight="700" fill="${MUTED}" text-anchor="end">${t.net > 0 ? (r.net / t.net * 100).toFixed(1) : '0.0'}%</text>
  <rect x="${C.pill}" y="${y + RH / 2 - 19}" width="104" height="38" rx="19" fill="${!has || flat ? '#F2ECE9' : up ? UPBG : DOWNBG}"/><text x="${C.pill + 52}" y="${cy - 1}" font-size="21" font-weight="800" text-anchor="middle" fill="${!has || flat ? MUTED : up ? UP : DOWN}">${has ? arrow(r.chg) : '–'}</text>`;
  });
  const ty = TOP + n * RH + 8, tc = ty + RH / 2 + 5;
  s += `<rect x="${PAD + 14}" y="${ty}" width="${W - PAD * 2 - 28}" height="${RH - 6}" rx="18" fill="${INK}"/><g font-size="25" font-weight="800" fill="#fff"><text x="${C.name}" y="${tc}">Total</text><text x="${C.inv}" y="${tc}" text-anchor="end">${t.orders}</text><text x="${C.gross}" y="${tc}" text-anchor="end">${f0(tg)}</text><text x="${C.net}" y="${tc}" text-anchor="end" fill="${PINK}">${f0(t.net)}</text><text x="${C.share}" y="${tc}" text-anchor="end" fill="#D9C9CE">100%</text><text x="${C.mtd}" y="${tc}" text-anchor="end">${f0(t.mtd)}</text></g>`;
  let fy = ty + RH + 56;
  if (t.leader) { s += `<text x="${PAD + 6}" y="${fy}" font-size="21" font-weight="700" fill="${INK}">${esc(t.leader)}</text>`; fy += 34; }
  if (t.top) { s += `<text x="${PAD + 6}" y="${fy}" font-size="21" font-weight="600" fill="${INK}">${esc(t.top)}</text>`; fy += 34; }
  s += `<text x="${PAD + 6}" y="${fy}" font-size="18" fill="${MUTED}">All figures in EGP · net = without VAT${t.note ? ' · ' + esc(t.note) : ''}</text></svg>`;
  return s;
}

async function render(t) {
  const sharp = setup();
  return sharp(Buffer.from(svg(t))).png({ compressionLevel: 9 }).toBuffer();
}
module.exports = { render, svg };
