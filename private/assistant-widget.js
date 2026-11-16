/* Pandora Assistant: the chat button and its popup, put on every page by api/site.js for the people who may use it (api/_assistant.js).
   It lives inside its own shadow root, so no page style can change it and it changes no page. The chat is kept for the browser tab
   (sessionStorage), so it is still there after moving to another report. Nothing here holds data: every answer comes from /api/assistant. */
(function () {
  'use strict';
  if (window.__pzaiOn || !document.body || !document.body.attachShadow) return;
  window.__pzaiOn = true;
  var CFG = window.__PZAI || {};
  var KEY = 'pandora-assist.v1';

  var CSS = `
:host{all:initial}
*{box-sizing:border-box}
.w{--bg:#FBF7F4;--surface:#fff;--soft:#FFF0F2;--text:#26211f;--muted:#857d77;--line:#ece3de;--pink:#FF93A0;--pinkd:#f0788a;--ink:#2A1018;--up:#17805a;--upbg:#e3f5ec;--down:#c0364f;--downbg:#fde8ec;--bar:#FFD3D9;--shadow:0 22px 60px rgba(42,16,24,.26),0 2px 8px rgba(42,16,24,.1);
  font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--text);word-spacing:.06em}
.w.dark{--bg:#181514;--surface:#221e1c;--soft:#33202a;--text:#f3eadb;--muted:#b3a9a1;--line:#38322f;--ink:#f3eadb;--up:#5fd3a1;--upbg:#173528;--down:#ff8fa3;--downbg:#3f1c26;--bar:#5a2d38;--shadow:0 22px 60px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4)}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
svg{display:block}
.fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#FFA9B3,#FF93A0 55%,#f7798b);color:#2A1018;display:grid;place-items:center;box-shadow:0 10px 26px rgba(255,147,160,.55),0 2px 6px rgba(42,16,24,.18);transition:transform .25s cubic-bezier(.3,1.6,.5,1),box-shadow .2s}
.fab:hover{transform:translateY(-3px) scale(1.04)}.fab:active{transform:scale(.94)}
.fab:focus-visible,.ib:focus-visible,.send:focus-visible,.chip:focus-visible,.link:focus-visible{outline:2px solid var(--pinkd);outline-offset:2px}
.fab svg{width:26px;height:26px}
.fab .ring{position:absolute;inset:0;border-radius:50%;border:2px solid #FF93A0;animation:ring 2.4s ease-out 3}
@keyframes ring{from{transform:scale(1);opacity:.8}to{transform:scale(1.55);opacity:0}}
.w.open .fab{transform:scale(.86);opacity:.0;pointer-events:none}
.win{position:fixed;right:20px;bottom:20px;width:430px;max-width:calc(100vw - 24px);height:min(660px,calc(100vh - 40px));height:min(660px,calc(100dvh - 40px));background:var(--bg);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(14px) scale(.97);transform-origin:100% 100%;pointer-events:none;visibility:hidden;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.9,.3,1),width .22s ease,height .22s ease,visibility 0s .22s}
.w.open .win{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.9,.3,1),width .22s ease,height .22s ease}
.w.wide .win{width:min(900px,calc(100vw - 40px));height:min(860px,calc(100vh - 40px));height:min(860px,calc(100dvh - 40px))}
.hd{flex:0 0 auto;display:flex;align-items:center;gap:11px;padding:13px 12px 13px 16px;color:#2A1018;background:linear-gradient(110deg,#FF93A0,#FFB3B6 55%,#FFA7B0)}
.badge{width:38px;height:38px;border-radius:50%;background:#fff;display:grid;place-items:center;flex:0 0 auto}
.badge img{width:24px;height:26px;object-fit:contain;filter:brightness(0)}
.ht{min-width:0;flex:1}.ht b{display:block;font-size:15px;font-weight:800;letter-spacing:.01em}.ht span{display:block;font-size:11.5px;font-weight:600;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ib{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.36);transition:background .15s}.ib:hover{background:#fff}.ib svg{width:17px;height:17px}
.log{position:relative;flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:16px 14px 6px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}
.hello{margin:auto 0;padding:10px 6px 4px;text-align:center}
.hello h2{margin:0 0 4px;font-size:19px;font-weight:800}.hello p{margin:0 auto 16px;max-width:300px;color:var(--muted);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:8px 13px;font-size:12.5px;font-weight:650;text-align:start;transition:border-color .15s,transform .15s}.chip:hover{border-color:var(--pink);transform:translateY(-1px)}
.me{align-self:flex-end;max-width:86%;background:var(--ink);color:var(--bg);padding:9px 14px;border-radius:18px 18px 5px 18px;font-weight:550;white-space:pre-wrap;overflow-wrap:anywhere}
.w.dark .me{background:#FF93A0;color:#2A1018}
.ai{align-self:stretch;display:flex;flex-direction:column;gap:9px;min-width:0}
.tx{background:var(--surface);border:1px solid var(--line);border-radius:5px 18px 18px 18px;padding:10px 14px;align-self:flex-start;max-width:100%;overflow-wrap:anywhere}
.tx b{font-weight:800}.tx ul{margin:4px 0 0;padding-inline-start:18px}.tx p{margin:0}.tx p+p{margin-top:6px}
.tx.err{border-color:var(--down);color:var(--down);background:var(--downbg)}
.retry{margin-top:8px;display:inline-block;border-radius:999px;padding:6px 12px;background:var(--surface);border:1px solid currentColor;font-weight:700;font-size:12px}
.wait{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12.5px;font-weight:600}
.dots{display:inline-flex;gap:4px}.dots i{width:7px;height:7px;border-radius:50%;background:var(--pink);animation:dot 1.1s ease-in-out infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes dot{0%,70%,100%{transform:translateY(0);opacity:.45}35%{transform:translateY(-5px);opacity:1}}
.pn{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:14px;min-width:0;animation:rise .28s ease both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ph{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.ph h3{margin:0;font-size:14.5px;font-weight:800}.ph small{display:block;color:var(--muted);font-size:11.5px;font-weight:600;margin-top:2px}
.tot{margin:10px 0 2px;display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 10px}
.big{font-size:26px;font-weight:850;letter-spacing:-.01em;white-space:nowrap}.big small{font-size:.5em;font-weight:750;color:var(--muted);margin-inline-end:5px;letter-spacing:.04em}
.meta{color:var(--muted);font-size:12px;font-weight:600;width:100%}
.dl{display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:800;white-space:nowrap}.dl.up{color:var(--up);background:var(--upbg)}.dl.dn{color:var(--down);background:var(--downbg)}.dl.eq{color:var(--muted);background:var(--soft)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:9px;margin-top:12px}
.cd{border:1px solid var(--line);border-radius:14px;padding:11px 12px;background:var(--bg);min-width:0;position:relative;overflow:hidden}
.cd.top{border-color:var(--pink);background:var(--soft)}
.cd .rk{position:absolute;top:9px;inset-inline-end:10px;font-size:10.5px;font-weight:800;color:var(--muted)}
.cd h4{margin:0 22px 5px 0;font-size:12.5px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cd .v{font-size:19px;font-weight:850;white-space:nowrap;letter-spacing:-.01em}.cd .v small{font-size:.55em;font-weight:750;color:var(--muted);margin-inline-end:4px}
.cd .m{color:var(--muted);font-size:11.5px;font-weight:600;margin-top:2px;display:flex;flex-wrap:wrap;gap:3px 8px;align-items:center}
.sh{height:5px;border-radius:99px;background:var(--line);margin-top:9px;overflow:hidden}.sh i{display:block;height:100%;border-radius:99px;background:var(--pink)}
.sub{margin-top:8px;border-top:1px dashed var(--line);padding-top:6px;display:grid;gap:2px}.sub div{display:flex;justify-content:space-between;gap:8px;font-size:11.5px}.sub span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}.sub b{font-weight:750;white-space:nowrap;flex:none}
.rows{margin-top:10px;display:grid;gap:2px}
.rw{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:7px 4px;border-radius:10px}.rw+.rw{border-top:1px solid var(--line);border-radius:0}
.rw .n{min-width:0}.rw .n b{display:block;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rw .n small{display:block;color:var(--muted);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rw .bar{height:5px;border-radius:99px;background:var(--line);margin-top:5px;overflow:hidden}.rw .bar i{display:block;height:100%;background:var(--pink);border-radius:99px}
.rw .r{text-align:end;white-space:nowrap}.rw .r b{display:block;font-weight:800;font-size:13px}.rw .r small{display:block;color:var(--muted);font-size:11px;font-weight:600}
.rw .k{width:20px;padding-top:1px;text-align:center;color:var(--muted);font-weight:800;font-size:11.5px}
.pic{width:42px;height:42px;border-radius:10px;background:var(--soft);border:1px solid var(--line);overflow:hidden;display:grid;place-items:center;flex:0 0 auto;color:var(--pink)}.pic img{width:100%;height:100%;object-fit:cover;display:block}.pic svg{width:18px;height:18px}.pic.has{cursor:zoom-in}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-top:12px}.tile{border:1px solid var(--line);border-radius:12px;padding:9px 11px;background:var(--bg)}.tile span{display:block;color:var(--muted);font-size:11px;font-weight:700}.tile b{display:block;font-size:16px;font-weight:850;white-space:nowrap}
.chart{margin-top:10px;position:relative}.chart svg{width:100%;height:auto;overflow:visible}.chart rect.b{fill:var(--pink);transition:fill .12s}.chart rect.b.on{fill:var(--pinkd)}.chart rect.hit{fill:transparent;cursor:pointer}.chart text{fill:var(--muted);font:600 10px Inter,system-ui,sans-serif}.chart line{stroke:var(--line)}
.tip{position:absolute;top:0;transform:translate(-50%,-100%);background:var(--ink);color:var(--bg);border-radius:10px;padding:6px 10px;font-size:11.5px;font-weight:650;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s}.tip.on{opacity:1}.tip b{display:block;font-weight:850;font-size:13px}
.w.dark .tip{background:#FF93A0;color:#2A1018}
.note{margin-top:10px;font-size:11.5px;font-weight:600;color:var(--muted);background:var(--soft);border-radius:10px;padding:7px 10px}
.pf{margin-top:10px;display:flex;justify-content:flex-end}
.link{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:750;color:var(--text);text-decoration:none;background:var(--bg);transition:border-color .15s}.link:hover{border-color:var(--pink)}.link svg{width:13px;height:13px}
.links{display:flex;flex-wrap:wrap;gap:8px}
.ft{flex:0 0 auto;padding:10px 12px 12px;border-top:1px solid var(--line);background:var(--bg)}
.box{display:flex;align-items:flex-end;gap:8px;background:var(--surface);border:1.5px solid var(--line);border-radius:18px;padding:6px 6px 6px 14px;transition:border-color .15s}.box:focus-within{border-color:var(--pink)}
textarea{flex:1;min-width:0;border:0;outline:0;resize:none;background:transparent;color:var(--text);font:inherit;font-size:14.5px;line-height:1.4;padding:7px 0;max-height:120px;height:34px}
textarea::placeholder{color:var(--muted)}
.send{width:36px;height:36px;border-radius:50%;background:var(--pink);color:#2A1018;display:grid;place-items:center;flex:0 0 auto;transition:transform .15s,opacity .15s}.send svg{width:17px;height:17px}.send:disabled{opacity:.4;cursor:default}.send:not(:disabled):hover{transform:scale(1.07)}
.fine{margin-top:6px;text-align:center;color:var(--muted);font-size:10.5px;font-weight:600}
.lb{position:fixed;inset:0;background:rgba(20,10,14,.78);display:grid;place-items:center;z-index:5;cursor:zoom-out;padding:20px}.lb img{max-width:min(92vw,720px);max-height:86vh;border-radius:16px;background:#fff}
@media (max-width:640px){
  .win,.w.wide .win{right:0;bottom:0;left:0;top:0;width:auto;max-width:none;height:auto;border-radius:0;border:0}
  .fab{right:14px;bottom:14px;width:52px;height:52px}
  .ib.wd{display:none}
  .cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cd .v{font-size:17px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{.w{display:none}}
`;

  var IC = {
    spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.2 3.6c.3-1 1.7-1 2 0l1.2 4.1c.4 1.300 1.400 2.300 2.700 2.700l4.100 1.200c1 .3 1 1.700 0 2l-4.100 1.200a4 4 0 0 0-2.700 2.700l-1.200 4.100c-.3 1-1.700 1-2 0L9 17.500a4 4 0 0 0-2.700-2.700l-4.100-1.200c-1-.3-1-1.700 0-2l4.100-1.200A4 4 0 0 0 9 7.700z"/><circle cx="19.500" cy="4.500" r="1.800"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    wide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    fresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    gem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12l4 6-10 11L2 10z"/><path d="M2 10h20M9 4l-2 6 5 11 5-11-2-6"/></svg>'
  };

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US'); };
  var money = function (n) { return '<small>EGP</small>' + num(n); };
  var moneyT = function (n) { return 'EGP ' + num(n); };
  var pct = function (x) { var v = (Number(x) || 0) * 100; return (v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)) + '%'; };
  function delta(d, prev, isMoney) {
    if (d == null) return '';
    var k = Math.abs(d) < 0.05 ? 'eq' : d > 0 ? 'up' : 'dn', a = Math.abs(d);
    return '<span class="dl ' + k + '"' + (prev != null ? ' title="Was ' + esc(isMoney === false ? num(prev) : moneyT(prev)) + '"' : '') + '>' + (k === 'eq' ? '=' : k === 'up' ? '&#9650;' : '&#9660;') + ' ' + (a >= 100 ? Math.round(a) : a.toFixed(1)) + '%</span>';
  }
  // the little formatting Claude may use: **bold**, line breaks and "- " lists. Everything else is shown as typed.
  function rich(s) {
    var out = [], ul = null;
    String(s || '').split(/\n+/).forEach(function (line) {
      var m = /^\s*[-•]\s+(.*)$/.exec(line), h = esc(m ? m[1] : line).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if (m) { if (!ul) { ul = []; out.push(ul); } ul.push('<li>' + h + '</li>'); } else if (line.trim()) { ul = null; out.push('<p dir="auto">' + h + '</p>'); }
    });
    return out.map(function (x) { return Array.isArray(x) ? '<ul dir="auto">' + x.join('') + '</ul>' : x; }).join('');
  }

  // ---- state ----
  var S = { open: false, wide: false, msgs: [] };
  try { var sv = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (sv && Array.isArray(sv.msgs)) { S.msgs = sv.msgs.slice(-40); S.open = !!sv.open; S.wide = !!sv.wide; } } catch (e) {}
  function save() {
    try {
      var keep = S.msgs.filter(function (m) { return !m.wait; }).slice(-40), j = JSON.stringify({ open: S.open, wide: S.wide, msgs: keep });
      while (j.length > 900000 && keep.length > 2) { keep = keep.slice(2); j = JSON.stringify({ open: S.open, wide: S.wide, msgs: keep }); }
      sessionStorage.setItem(KEY, j);
    } catch (e) {}
  }

  // ---- shell ----
  var host = document.createElement('div');
  host.id = 'pandora-assistant'; host.className = 'hideclean';
  host.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147482000';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + CSS + '</style><div class="w" part="w">' +
    '<button class="fab" type="button" aria-label="Open the Pandora Assistant" title="Ask the Pandora Assistant"><span class="ring"></span>' + IC.spark + '</button>' +
    '<section class="win" role="dialog" aria-label="Pandora Assistant" aria-hidden="true">' +
      '<header class="hd"><span class="badge"><img src="/pandora-logo.png" alt=""></span><div class="ht"><b>Pandora Assistant</b><span>Sales and stock, from your live data</span></div>' +
        '<button class="ib nw" type="button" title="New chat" aria-label="Start a new chat">' + IC.fresh + '</button>' +
        '<button class="ib wd" type="button" title="Bigger or smaller" aria-label="Make the window bigger or smaller">' + IC.wide + '</button>' +
        '<button class="ib cl" type="button" title="Close" aria-label="Close the assistant">' + IC.x + '</button></header>' +
      '<div class="log" aria-live="polite"></div>' +
      '<footer class="ft"><div class="box"><textarea rows="1" maxlength="800" dir="auto" placeholder="Ask about sales or stock" aria-label="Your question"></textarea><button class="send" type="button" aria-label="Send" disabled>' + IC.send + '</button></div>' +
      '<div class="fine">Figures come straight from the saved sales and stock. Net of VAT unless you ask.</div></footer>' +
    '</section></div>';
  document.body.appendChild(host);
  var $ = function (q) { return root.querySelector(q); };
  var W = $('.w'), LOG = $('.log'), TA = $('textarea'), SEND = $('.send'), WIN = $('.win');
  host.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape' && S.open) { if ($('.lb')) $('.lb').remove(); else toggle(false); } });
  ['keyup', 'keypress'].forEach(function (n) { host.addEventListener(n, function (e) { e.stopPropagation(); }); });

  // follow the site's light / dark switch
  function dark() { var a = document.documentElement.getAttribute('data-theme'); return a === 'dark' || (a !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function theme() { W.classList.toggle('dark', dark()); }
  theme();
  try { new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme); } catch (e) {}

  // ---- pictures (the same source as the reports: /api/pic) ----
  var PICS = {};
  function picFor(sku, el) {
    var base = String(sku || '').toUpperCase().split('-')[0];
    if (!/^[A-Z0-9]{4,20}$/.test(base)) return;
    (PICS[base] || (PICS[base] = fetch('/api/pic?sku=' + encodeURIComponent(base), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { return (j && j.url) || ''; }).catch(function () { return ''; })))
      .then(function (u) {
        if (!u || !el.isConnected) return;
        var img = new Image(); img.alt = '';
        img.onload = function () { el.textContent = ''; el.appendChild(img); el.classList.add('has'); el.dataset.full = u; el.setAttribute('role', 'button'); el.tabIndex = 0; el.title = 'See it bigger'; };
        img.src = u + (u.indexOf('?') < 0 ? '?' : '&') + 'width=120';
      });
  }
  function zoom(u) {
    var d = document.createElement('div'); d.className = 'lb'; d.innerHTML = '<img alt="">'; d.firstChild.src = u + (u.indexOf('?') < 0 ? '?' : '&') + 'width=900';
    d.addEventListener('click', function () { d.remove(); }); W.appendChild(d);
  }

  // ---- panels ----
  var unitWord = function (n) { return Math.round(n) === 1 ? 'pc' : 'pcs'; };
  function head(p) {
    var sub = [p.range, p.filters, p.type === 'sales' ? (p.basis === 'gross' ? 'with VAT' : 'net of VAT') : ''].filter(Boolean).join(' · ');
    return '<div class="ph"><div><h3 dir="auto">' + esc(p.title) + '</h3><small>' + esc(sub) + '</small></div></div>';
  }
  function foot(p) {
    return (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
      (p.href ? '<div class="pf"><a class="link" href="' + esc(p.href) + '">' + (p.type === 'stock' ? 'Open Stock balance' : 'Open in Pandora Dashboards') + IC.go + '</a></div>' : '');
  }
  function subRows(g, by, short) {
    if (!g.sub || !g.sub.length) return '';
    return '<div class="sub">' + g.sub.map(function (s) { return '<div><span title="' + esc(s.name) + '">' + esc(s.name) + '</span><b>' + (by === 'units' || s.sales == null ? num(s.units) + ' ' + unitWord(s.units) : (short ? num(s.sales) : moneyT(s.sales))) + '</b></div>'; }).join('') + '</div>';
  }
  function chart(p) {
    var G = p.groups, n = G.length, Wd = 560, H = 150, padL = 4, padB = 18, top = 8, m = p.metric === 'units' ? 'units' : p.metric === 'orders' ? 'orders' : 'sales';
    var mx = Math.max.apply(null, G.map(function (g) { return Math.max(0, g[m]); })) || 1, bw = (Wd - padL * 2) / n, gap = Math.min(6, bw * 0.22);
    var every = Math.ceil(n / 7), s = '<svg viewBox="0 0 ' + Wd + ' ' + H + '" role="img" aria-label="' + esc(p.title) + '"><line x1="0" x2="' + Wd + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '"/>';
    G.forEach(function (g, i) {
      var h = Math.max(0, g[m]) / mx * (H - padB - top), x = padL + i * bw;
      s += '<rect class="b" data-i="' + i + '" x="' + (x + gap / 2).toFixed(1) + '" y="' + (H - padB - Math.max(h, g[m] > 0 ? 2 : 0)).toFixed(1) + '" width="' + Math.max(1, bw - gap).toFixed(1) + '" height="' + Math.max(h, g[m] > 0 ? 2 : 0).toFixed(1) + '" rx="' + Math.min(4, (bw - gap) / 2).toFixed(1) + '"/>';
      if (i % every === 0) s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle">' + esc(g.name) + '</text>';
      s += '<rect class="hit" data-i="' + i + '" x="' + x.toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (H - padB) + '"/>';
    });
    return '<div class="chart" data-m="' + m + '">' + s + '</svg><div class="tip"></div></div>';
  }
  function salesPanel(p) {
    var T = p.total || {}, G = p.groups || [], m = p.metric === 'units' ? 'units' : p.metric === 'orders' ? 'orders' : 'sales';
    var val = function (g) { return m === 'units' ? '<small>PCS</small>' + num(g.units) : m === 'orders' ? '<small>ORDERS</small>' + num(g.orders) : money(g.sales); };
    var h = head(p) + '<div class="tot"><span class="big">' + money(T.sales) + '</span>' + delta(T.d, T.prev) + (p.cmp ? '<span class="meta" style="width:auto">vs ' + esc(p.cmp) + '</span>' : '') +
      '<span class="meta">' + num(T.units) + ' ' + unitWord(T.units) + ' · ' + num(T.orders) + (T.orders === 1 ? ' order' : ' orders') + (T.orders ? ' · avg order ' + moneyT(T.atv) + ' · ' + (Number(T.upt) || 0).toFixed(2) + ' pcs per order' : '') + '</span></div>';
    if (p.by === 'store') {
      var mx = Math.max.apply(null, G.map(function (g) { return g[m]; }).concat(1));
      h += '<div class="cards">' + G.map(function (g, i) {
        return '<div class="cd' + (i === 0 && g[m] > 0 && G.length > 1 ? ' top' : '') + '"><span class="rk">#' + (i + 1) + '</span><h4 title="' + esc(g.name) + '">' + esc(g.name) + '</h4><div class="v">' + val(g) + '</div>' +
          '<div class="m">' + delta(g.d, g.prev) + '<span>' + (m === 'sales' ? num(g.units) + ' ' + unitWord(g.units) : moneyT(g.sales)) + '</span><span>' + (m === 'orders' ? num(g.units) + ' ' + unitWord(g.units) : num(g.orders) + (g.orders === 1 ? ' order' : ' orders')) + '</span></div>' +
          '<div class="sh" title="' + pct(g.share) + ' of the total"><i style="width:' + Math.max(g[m] > 0 ? 2 : 0, g[m] / mx * 100).toFixed(1) + '%"></i></div><div class="m"><span>' + pct(g.share) + ' of sales</span></div>' + subRows(g, m, true) + '</div>';
      }).join('') + '</div>';
    } else if ((p.by === 'day' || p.by === 'month') && G.length > 1) {
      h += chart(p);
      if (G.length <= 12) h += rowsList(p, G, m, false);
    } else if (p.by !== 'none' && G.length) {
      h += rowsList(p, G, m, p.by === 'product');
    } else if (p.by === 'none') {
      h += '<div class="tiles">' + [['Sales', moneyT(T.sales)], ['Orders', num(T.orders)], ['Average order', moneyT(T.atv)], ['Pieces', num(T.units)], ['Pieces per order', (Number(T.upt) || 0).toFixed(2)]].map(function (t) { return '<div class="tile"><span>' + t[0] + '</span><b>' + t[1] + '</b></div>'; }).join('') + '</div>';
    }
    return h + foot(p);
  }
  function rowsList(p, G, m, pics) {
    var mx = Math.max.apply(null, G.map(function (g) { return Math.max(0, g[m]); }).concat(1));
    return '<div class="rows">' + G.map(function (g, i) {
      var main = m === 'units' ? num(g.units) + ' ' + unitWord(g.units) : m === 'orders' ? num(g.orders) + ' orders' : moneyT(g.sales);
      var second = (m === 'sales' ? num(g.units) + ' ' + unitWord(g.units) : moneyT(g.sales)) + (p.by !== 'day' && p.by !== 'month' ? ' · ' + pct(g.share) : '');
      return '<div class="rw">' + (pics ? '<span class="pic" data-sku="' + esc(g.sku || '') + '">' + IC.gem + '</span>' : '<span class="k">' + (p.by === 'day' || p.by === 'month' || p.by === 'weekday' ? '' : i + 1) + '</span>') +
        '<div class="n"><b title="' + esc(g.name) + '">' + esc(g.name) + '</b>' + (pics ? '<small>' + esc([g.sku, g.cat].filter(Boolean).join(' · ')) + '</small>' : '') + '<div class="bar"><i style="width:' + (Math.max(0, g[m]) / mx * 100).toFixed(1) + '%"></i></div>' + subRows(g, m) + '</div>' +
        '<div class="r"><b>' + main + '</b><small>' + second + '</small>' + (g.d != null ? delta(g.d, g.prev) : '') + '</div></div>';
    }).join('') + '</div>';
  }
  function stockPanel(p) {
    var T = p.total || {}, G = p.groups || [];
    var h = head(p) + '<div class="tot"><span class="big"><small>PCS</small>' + num(T.qty) + '</span><span class="meta">' + num(T.items) + ' different ' + (T.items === 1 ? 'item' : 'items') + ' in stock</span></div>';
    var mx = Math.max.apply(null, G.map(function (g) { return Math.max(0, g.qty); }).concat(1));
    if (p.by === 'store') {
      h += '<div class="cards">' + G.map(function (g, i) {
        return '<div class="cd' + (g.qty <= 0 ? '' : i === 0 && G.length > 1 ? ' top' : '') + '"><h4 title="' + esc(g.name) + '">' + esc(g.name) + '</h4><div class="v"><small>PCS</small>' + num(g.qty) + '</div><div class="m"><span>' + (g.qty > 0 ? num(g.items) + (g.items === 1 ? ' item' : ' items') + ' · ' + pct(g.share) : 'None in stock') + '</span></div><div class="sh"><i style="width:' + (Math.max(0, g.qty) / mx * 100).toFixed(1) + '%"></i></div></div>';
      }).join('') + '</div>';
    } else {
      h += '<div class="rows">' + G.map(function (g, i) {
        return '<div class="rw">' + (p.by === 'item' ? '<span class="pic" data-sku="' + esc(g.sku || '') + '">' + IC.gem + '</span>' : '<span class="k">' + (i + 1) + '</span>') + '<div class="n"><b title="' + esc(g.name) + '">' + esc(g.name) + '</b>' + (p.by === 'item' ? '<small>' + esc([g.sku, g.cat].filter(Boolean).join(' · ')) + '</small>' : '') + '<div class="bar"><i style="width:' + (Math.max(0, g.qty) / mx * 100).toFixed(1) + '%"></i></div>' + subRows(g, 'units') + '</div><div class="r"><b>' + num(g.qty) + ' ' + unitWord(g.qty) + '</b>' + (p.by !== 'item' ? '<small>' + num(g.items) + ' items</small>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    return h + foot(p);
  }
  function panelEl(p) {
    var d = document.createElement('div'); d.className = 'pn';
    try {
      if (p.type === 'links') { d.innerHTML = '<div class="links">' + (p.items || []).map(function (i) { return '<a class="link" href="' + esc(/^\/[^/\\]/.test(i.href) ? i.href : '/') + '">' + esc(i.title) + IC.go + '</a>'; }).join('') + '</div>'; return d; }
      d.innerHTML = p.type === 'stock' ? stockPanel(p) : salesPanel(p);
    } catch (e) { d.innerHTML = '<div class="note">This panel could not be drawn.</div>'; return d; }
    Array.prototype.forEach.call(d.querySelectorAll('.pic[data-sku]'), function (el) { picFor(el.dataset.sku, el); });
    var ch = d.querySelector('.chart');
    if (ch) {
      var tip = ch.querySelector('.tip'), m = ch.dataset.m, bars = ch.querySelectorAll('rect.b');
      var show = function (i) {
        var g = p.groups[i]; if (!g) return;
        Array.prototype.forEach.call(bars, function (b, k) { b.classList.toggle('on', k === +i); });
        tip.innerHTML = esc(g.name) + '<b>' + (m === 'units' ? num(g.units) + ' pcs' : m === 'orders' ? num(g.orders) + ' orders' : moneyT(g.sales)) + '</b>' + (m === 'sales' ? num(g.units) + ' pcs · ' + num(g.orders) + ' orders' : moneyT(g.sales));
        var x = (+i + 0.5) / p.groups.length * 100; tip.style.left = Math.min(86, Math.max(14, x)) + '%'; tip.style.top = '6px'; tip.style.transform = 'translate(-50%,0)'; tip.classList.add('on');
      };
      ch.addEventListener('pointermove', function (e) { var r = e.target.closest ? e.target.closest('rect.hit') : null; if (r) show(r.dataset.i); });
      ch.addEventListener('pointerdown', function (e) { var r = e.target.closest ? e.target.closest('rect.hit') : null; if (r) show(r.dataset.i); });
      ch.addEventListener('pointerleave', function () { tip.classList.remove('on'); Array.prototype.forEach.call(bars, function (b) { b.classList.remove('on'); }); });
    }
    return d;
  }

  // ---- the conversation ----
  var CHIPS = ['Sales of every store yesterday', 'Charms sales in every store yesterday', 'Top 10 products this month', 'Sales day by day this month', 'Stock of bracelets in every store'];
  var WAITS = ['Reading your question', 'Looking up the figures', 'Adding it up', 'Drawing the answer'];
  var waitTimer = 0;
  function draw() {
    clearInterval(waitTimer);
    LOG.textContent = '';
    if (!S.msgs.length) {
      var h = document.createElement('div'); h.className = 'hello';
      h.innerHTML = '<h2>' + esc(CFG.name ? 'Hello ' + CFG.name : 'Hello') + '</h2><p>Ask about sales or stock: say a date, a store, a category and how to split it. I answer with the real figures.</p><div class="chips">' + CHIPS.map(function (c) { return '<button class="chip" type="button">' + esc(c) + '</button>'; }).join('') + '</div>';
      LOG.appendChild(h);
      return;
    }
    S.msgs.forEach(function (m, idx) {
      if (m.role === 'user') { var u = document.createElement('div'); u.className = 'me'; u.dir = 'auto'; u.textContent = m.text; LOG.appendChild(u); return; }
      var a = document.createElement('div'); a.className = 'ai';
      if (m.wait) {
        a.innerHTML = '<div class="wait"><span class="dots"><i></i><i></i><i></i></span><span class="wt">' + WAITS[0] + '</span></div>';
        var k = 0, wt = a.querySelector('.wt'); waitTimer = setInterval(function () { k = Math.min(k + 1, WAITS.length - 1); wt.textContent = WAITS[k]; }, 2600);
      } else {
        (m.panels || []).forEach(function (p) { a.appendChild(panelEl(p)); });
        if (m.text) { var t = document.createElement('div'); t.className = 'tx' + (m.err ? ' err' : ''); t.innerHTML = rich(m.text) + (m.err && idx === S.msgs.length - 1 ? '<button class="retry" type="button">Try again</button>' : ''); a.insertBefore(t, m.err ? null : a.firstChild); }
      }
      LOG.appendChild(a);
    });
  }
  function toEnd(smooth) {
    var last = LOG.lastElementChild; if (!last) return;
    // a fresh answer is read from its top: bring the question and the start of the answer into view rather than the very end
    var q = last.previousElementSibling, top = (q && q.classList.contains('me') ? q.offsetTop : last.offsetTop) - 12;
    try { LOG.scrollTo({ top: Math.min(top, LOG.scrollHeight), behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { LOG.scrollTop = top; }
  }
  var busy = false;
  function ask(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    busy = true; SEND.disabled = true;
    S.msgs.push({ role: 'user', text: text }); S.msgs.push({ role: 'assistant', wait: true });
    TA.value = ''; grow(); draw(); LOG.scrollTop = LOG.scrollHeight;
    var hist = S.msgs.filter(function (m) { return !m.wait && !m.err; }).slice(-16).map(function (m) { return { role: m.role, text: m.text || '', ctx: m.ctx || undefined }; });
    fetch('/api/assistant', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: hist }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        S.msgs.pop();
        if (x.j && x.j.ok) {
          S.msgs.push({ role: 'assistant', text: x.j.text || '', panels: x.j.panels || [], ctx: x.j.ctx || '' });
          // an answer with store cards or a chart reads better in the bigger window (computers only; the person can make it small again)
          if (!S.wide && window.innerWidth >= 900 && (x.j.panels || []).some(function (p) { return (p.by === 'store' && (p.groups || []).length > 2) || ((p.by === 'day' || p.by === 'month') && (p.groups || []).length > 8); })) setWide(true);
        } else S.msgs.push({ role: 'assistant', err: true, text: x.status === 401 ? 'You were signed out. Sign in again, then ask once more.' : (x.j && x.j.error) || 'Something went wrong while answering. Try again.' });
      })
      .catch(function () { S.msgs.pop(); S.msgs.push({ role: 'assistant', err: true, text: 'No connection. Check the internet and try again.' }); })
      .then(function () { busy = false; draw(); save(); toEnd(true); SEND.disabled = !TA.value.trim(); });
  }
  function grow() { TA.style.height = '34px'; TA.style.height = Math.min(120, TA.scrollHeight) + 'px'; SEND.disabled = busy || !TA.value.trim(); }
  function setWide(v) { S.wide = !!v; W.classList.toggle('wide', S.wide); save(); }
  function toggle(v) {
    S.open = v == null ? !S.open : !!v;
    W.classList.toggle('open', S.open); WIN.setAttribute('aria-hidden', S.open ? 'false' : 'true');
    save();
    if (S.open) { draw(); LOG.scrollTop = LOG.scrollHeight; if (window.innerWidth > 640) setTimeout(function () { try { TA.focus({ preventScroll: true }); } catch (e) {} }, 60); }
    else { try { $('.fab').focus({ preventScroll: true }); } catch (e) {} }
  }

  $('.fab').addEventListener('click', function () { toggle(true); });
  $('.cl').addEventListener('click', function () { toggle(false); });
  $('.wd').addEventListener('click', function () { setWide(!S.wide); });
  $('.nw').addEventListener('click', function () { if (busy) return; S.msgs = []; save(); draw(); try { TA.focus(); } catch (e) {} });
  SEND.addEventListener('click', function () { ask(TA.value); });
  TA.addEventListener('input', grow);
  TA.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(TA.value); } });
  LOG.addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (c) return ask(c.textContent);
    var r = e.target.closest('.retry'); if (r) { var q = ''; for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].role === 'user') { q = S.msgs[i].text; S.msgs = S.msgs.slice(0, i); break; } return ask(q); }
    var p = e.target.closest('.pic.has'); if (p) return zoom(p.dataset.full);
  });
  LOG.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('has')) zoom(e.target.dataset.full); });

  W.classList.toggle('wide', S.wide);
  if (S.open) { W.classList.add('open'); WIN.setAttribute('aria-hidden', 'false'); draw(); LOG.scrollTop = LOG.scrollHeight; }
  window.PandoraAssistant = { open: function () { toggle(true); }, close: function () { toggle(false); }, ask: function (q) { toggle(true); ask(q); } };
})();
