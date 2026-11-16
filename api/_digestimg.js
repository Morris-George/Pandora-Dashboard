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
const INK = '#2A1018', PINK = '#FF93A0', MUTED = '#8A7D82', LINE = '#EFE4E0', CARD = '#FFFFFF', BG = '#FBF6F3', NET = '#9C1F4A', USD = '#0E8FB0', MTD = '#2F4C8F';
const f2 = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The same table as the ERP "Pandora Sales / POS" report, tidied up:
// t = { weekday, date ("13-11-2026"), rate (EGP per 1 USD, 0 when unknown), mtdTotal?, note?, rows:[{name, orders, gross, net, mtd}] }
function svg(t) {
  const logo = fs.readFileSync(path.join(DIR, 'logo.png')).toString('base64');
  const rows = t.rows, n = rows.length, rate = Number(t.rate) || 0;
  const W = 1280, PAD = 40, R = W - PAD, RH = 66, HEAD = 64, TB = 198, rowsTop = TB + HEAD, H = rowsTop + RH * (n + 1) + 120;
  const X = { badge: PAD + 44, name: PAD + 88, inv: 480, gross: 665, net: 850, usd: 1020, mtd: R - 26 };
  const tot = rows.reduce((a, r) => ({ o: a.o + r.orders, g: a.g + r.gross, n: a.n + r.net, m: a.m + r.mtd }), { o: 0, g: 0, n: 0, m: 0 });
  const usd = v => rate ? f2(v / rate) : '–';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">
<defs><linearGradient id="hd" x1="0" x2="1"><stop offset="0" stop-color="#FF93A0"/><stop offset="1" stop-color="#FFB3BC"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="${BG}"/><rect width="${W}" height="150" fill="url(#hd)"/>
<circle cx="${PAD + 44}" cy="75" r="44" fill="#fff"/><image x="${PAD + 16}" y="47" width="56" height="56" href="data:image/png;base64,${logo}"/>
<text x="${PAD + 110}" y="68" font-size="32" font-weight="800" fill="${INK}">Pandora Sales / POS</text>
<text x="${PAD + 110}" y="102" font-size="22" font-weight="600" fill="${INK}" opacity=".8">Daily sales · all branches</text>
<text x="${R}" y="68" font-size="32" font-weight="800" fill="${INK}" text-anchor="end">${esc(t.weekday)}</text>
<text x="${R}" y="102" font-size="22" font-weight="600" fill="${INK}" opacity=".8" text-anchor="end">${esc(t.date)}</text>
<rect x="${PAD}" y="${TB}" width="${W - PAD * 2}" height="${HEAD + RH * (n + 1) + 14}" rx="24" fill="${CARD}" stroke="${LINE}" stroke-width="2"/>
<rect x="${PAD + 1}" y="${TB + 1}" width="${W - PAD * 2 - 2}" height="${HEAD}" rx="23" fill="#FFF1F2"/><rect x="${PAD + 1}" y="${TB + 40}" width="${W - PAD * 2 - 2}" height="${HEAD - 40}" fill="#FFF1F2"/>
<g font-size="17" font-weight="800" fill="${MUTED}" letter-spacing=".8"><text x="${X.name}" y="${TB + 40}">BRANCH</text><text x="${X.inv}" y="${TB + 40}" text-anchor="end">INVOICES</text><text x="${X.gross}" y="${TB + 40}" text-anchor="end">GROSS</text><text x="${X.net}" y="${TB + 40}" text-anchor="end">NET</text><text x="${X.usd}" y="${TB + 40}" text-anchor="end">NET USD</text><text x="${X.mtd}" y="${TB + 40}" text-anchor="end">MTD VALUE</text></g>`;
  rows.forEach((r, i) => {
    const y = rowsTop + i * RH, cy = y + RH / 2 + 8, zero = !r.orders && !Math.round(r.net);
    if (i > 0) s += `<rect x="${PAD + 24}" y="${y}" width="${W - PAD * 2 - 48}" height="1.5" fill="${LINE}"/>`;
    s += `<circle cx="${X.badge}" cy="${y + RH / 2}" r="17" fill="#F6EEEB"/><text x="${X.badge}" y="${cy - 1}" font-size="18" font-weight="800" fill="${INK}" text-anchor="middle">${i + 1}</text>
<text x="${X.name}" y="${cy}" font-size="25" font-weight="700" fill="${zero ? MUTED : INK}">${esc(cut(r.name, 26))}</text>
<g font-size="24" text-anchor="end"><text x="${X.inv}" y="${cy}" fill="${zero ? MUTED : INK}">${r.orders}</text><text x="${X.gross}" y="${cy}" fill="${zero ? MUTED : '#5C4F55'}">${f2(r.gross)}</text><text x="${X.net}" y="${cy}" font-weight="800" fill="${zero ? MUTED : NET}">${f2(r.net)}</text><text x="${X.usd}" y="${cy}" font-weight="700" fill="${zero ? MUTED : USD}">${usd(r.net)}</text><text x="${X.mtd}" y="${cy}" font-weight="700" fill="${MTD}">${f2(r.mtd)}</text></g>`;
  });
  const ty = rowsTop + n * RH + 8, tc = ty + RH / 2 + 6;
  s += `<rect x="${PAD + 14}" y="${ty}" width="${W - PAD * 2 - 28}" height="${RH - 4}" rx="18" fill="${INK}"/>
<g font-size="24" font-weight="800" fill="#fff" text-anchor="end"><text x="${X.name}" y="${tc}" font-size="25" text-anchor="start">Total</text><text x="${X.inv}" y="${tc}">${tot.o}</text><text x="${X.gross}" y="${tc}">${f2(tot.g)}</text><text x="${X.net}" y="${tc}" fill="${PINK}">${f2(tot.n)}</text><text x="${X.usd}" y="${tc}" fill="#7FD8EE">${usd(tot.n)}</text><text x="${X.mtd}" y="${tc}">${f2(t.mtdTotal != null ? t.mtdTotal : tot.m)}</text></g>
<text x="${PAD + 6}" y="${ty + RH + 52}" font-size="19" fill="${MUTED}">${rate ? 'Exchange rate: 1 USD = ' + rate + ' EGP' + (t.rateNote ? ' (' + esc(t.rateNote) + ')' : '') + '  ·  ' : 'USD rate not available today  ·  '}Net = without VAT  ·  MTD = month to date${t.note ? '  ·  ' + esc(t.note) : ''}</text></svg>`;
  return s;
}

async function render(t) {
  const sharp = setup();
  return sharp(Buffer.from(svg(t))).png({ compressionLevel: 9 }).toBuffer();
}
module.exports = { render, svg };
