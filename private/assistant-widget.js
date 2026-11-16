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
.w{--bg:#FCF5F4;--surface:#fff;--glass:rgba(255,255,255,.74);--glassb:rgba(255,255,255,.95);--serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;--soft:#FFF0F2;--text:#26211f;--muted:#857d77;--line:#ece3de;--pink:#FF93A0;--pinkd:#f0788a;--ink:#2A1018;--up:#17805a;--upbg:#e3f5ec;--down:#c0364f;--downbg:#fde8ec;--bar:#FFD3D9;--shadow:0 50px 100px -24px rgba(224,112,138,.55),0 18px 40px -14px rgba(42,16,24,.22),0 0 0 1px rgba(42,16,24,.05);
  font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--text);word-spacing:.06em}
.w.dark{--glass:rgba(255,255,255,.07);--glassb:rgba(255,255,255,.12);--bg:#181514;--surface:#221e1c;--soft:#33202a;--text:#f3eadb;--muted:#b3a9a1;--line:#38322f;--ink:#f3eadb;--up:#5fd3a1;--upbg:#173528;--down:#ff8fa3;--downbg:#3f1c26;--bar:#5a2d38;--shadow:0 22px 60px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4)}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
svg{display:block}
.fab{position:fixed;left:0;top:0;width:78px;height:82px;padding:0;border-radius:0;background:none;color:#2A1018;display:block;transition:transform 4s cubic-bezier(.45,0,.2,1),opacity .2s;will-change:transform;touch-action:manipulation}
.fab .mc{display:block;width:100%;height:100%;transition:transform .5s ease;transform:rotate(var(--lean,0deg));filter:drop-shadow(0 8px 10px rgba(200,80,110,.28))}
.fab .mc{perspective:420px}
.fab .mc svg{width:100%;height:100%;overflow:visible;transform-style:preserve-3d;animation:mcturn 6s ease-in-out infinite}
@keyframes mcturn{0%,100%{transform:rotateY(-12deg) rotateX(3deg)}50%{transform:rotateY(12deg) rotateX(-3deg)}}
.fab:hover .mc{transform:scale(1.1) rotate(-4deg)}.fab:active .mc{transform:scale(.92)}
.fab.going .mc svg{animation:mchop .55s ease-in-out infinite}
.fab.jump .mc svg{animation:mcjump .6s cubic-bezier(.3,1.6,.5,1)}
@keyframes mchop{0%,100%{transform:translateY(0) rotateY(-24deg)}50%{transform:translateY(-7px) rotateY(24deg)}}
@keyframes mcjump{0%{transform:translateY(0) scale(1,1) rotateY(0)}25%{transform:translateY(0) scale(1.1,.88) rotateY(0)}55%{transform:translateY(-22px) scale(.95,1.08) rotateY(200deg)}100%{transform:translateY(0) scale(1,1) rotateY(360deg)}}
.fab .bub{position:absolute;bottom:92%;right:6px;width:max-content;max-width:210px;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:14px 14px 4px 14px;padding:8px 12px;font-size:12.5px;font-weight:650;line-height:1.35;text-align:start;box-shadow:0 8px 22px rgba(42,16,24,.16);opacity:0;transform:translateY(6px) scale(.94);transform-origin:100% 100%;pointer-events:none;transition:opacity .2s,transform .25s cubic-bezier(.3,1.5,.5,1)}
.fab .bub.on{opacity:1;transform:none}.fab .bub.l{right:auto;left:6px;border-radius:14px 14px 14px 4px;transform-origin:0 100%}.fab .bub.dn{bottom:auto;top:92%;transform-origin:100% 0}
.badge svg{width:84px;height:88px;overflow:visible;filter:drop-shadow(0 10px 12px rgba(200,80,110,.25))}
@media (max-height:720px){.hd{height:124px}.badge svg{width:62px;height:65px}.hc .ht b{font-size:19px}}.still *{animation:none!important}

.mc-float{animation:mc-float 3.2s ease-in-out infinite;transform-origin:120px 140px}
.mc-shadow{animation:mc-shadow 3.2s ease-in-out infinite;transform-origin:120px 236px}
.mc-eye{transform-origin:152px 138px;animation:mc-blink 5s infinite}
.mc-wink{animation:mc-wink 7s infinite;transform-origin:108px 138px}
.mc-spark1{transform-origin:206px 60px;animation:mc-tw 2.6s ease-in-out infinite}
.mc-spark2{transform-origin:40px 204px;animation:mc-tw 3.1s ease-in-out .8s infinite}
.mc-ticks{animation:mc-tick 3.2s ease-in-out infinite;transform-origin:44px 70px}
.mc-ring{transform-origin:120px 80px;animation:mc-ring 3.2s ease-in-out infinite}
.mc-cupR{transform-origin:200px 136px;animation:mc-cup 1.6s ease-in-out infinite}
@keyframes mc-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-9px) rotate(2deg)}}
@keyframes mc-shadow{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(.8);opacity:.35}}
@keyframes mc-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@keyframes mc-wink{0%,40%,100%{transform:scaleY(1)}44%{transform:scaleY(.2)}48%{transform:scaleY(1)}}
@keyframes mc-tw{0%,100%{transform:scale(.7) rotate(0);opacity:.55}50%{transform:scale(1.15) rotate(20deg);opacity:1}}
@keyframes mc-tick{0%,70%,100%{opacity:0;transform:translate(3px,3px)}78%,92%{opacity:1;transform:none}}
@keyframes mc-ring{0%,100%{transform:rotate(0)}50%{transform:rotate(4deg)}}
@keyframes mc-cup{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.94)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}

.fab:focus-visible,.ib:focus-visible,.send:focus-visible,.chip:focus-visible,.link:focus-visible{outline:2px solid var(--pinkd);outline-offset:2px}
.w.open .fab{opacity:0;pointer-events:none}
.win{position:fixed;right:20px;bottom:20px;width:430px;max-width:calc(100vw - 24px);height:min(660px,calc(100vh - 40px));height:min(660px,calc(100dvh - 40px));background:radial-gradient(280px 260px at 0 0,rgba(255,194,203,.85),transparent 72%),radial-gradient(300px 300px at 100% 80%,rgba(255,217,201,.85),transparent 72%),linear-gradient(160deg,#FFF1F3,#FFE8EC 55%,#FFF5F2);border:1px solid rgba(255,255,255,.9);border-radius:30px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(14px) scale(.97);transform-origin:100% 100%;pointer-events:none;visibility:hidden;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.9,.3,1),width .22s ease,height .22s ease,visibility 0s .22s}
.w.open .win{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.9,.3,1),width .22s ease,height .22s ease}
.w.dark .win{background:radial-gradient(280px 260px at 0 0,rgba(255,147,160,.18),transparent 72%),linear-gradient(160deg,#241a1e,#181213);border-color:rgba(255,255,255,.08)}
.w.wide .win{width:min(900px,calc(100vw - 40px));height:min(860px,calc(100vh - 40px));height:min(860px,calc(100dvh - 40px))}
@keyframes hdrise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hd{flex:0 0 auto;height:158px;position:relative;display:flex;align-items:flex-start;justify-content:space-between;padding:12px 12px 0;color:var(--text);background:none}
.hr{display:flex;gap:6px}
.hc{position:absolute;left:0;right:0;margin:0 auto;top:6px;display:flex;flex-direction:column;align-items:center;width:min(60%,260px);pointer-events:none;animation:hdrise .4s ease both}
.badge{display:block;flex:0 0 auto}
.hc .ht{text-align:center;margin-top:2px}
.ht{min-width:0}.ht b{display:block;font:500 22px/1.2 var(--serif);letter-spacing:-.01em}.ht span{display:block;font-size:12.5px;font-weight:500;color:var(--muted);white-space:nowrap;margin-top:3px}
.live{display:inline-block;width:7px;height:7px;border-radius:50%;background:#2fbf8a;margin-inline-end:6px;box-shadow:0 0 0 3px rgba(47,191,138,.18);vertical-align:1px}
.ib{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--glass);color:var(--text);transition:background .15s,transform .15s;position:relative;z-index:1}.ib:hover{background:var(--glassb);transform:scale(1.06)}.ib svg{width:17px;height:17px}
.log{position:relative;flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:12px 18px 8px;display:flex;flex-direction:column;gap:14px;scrollbar-width:thin}
.hello{margin:auto 0 0;padding:0 4px 6px;text-align:center}
.hello h2{margin:0 0 6px;font:500 24px/1.15 var(--serif);letter-spacing:-.01em}.hello p{margin:0 auto 16px;max-width:320px;color:var(--muted);font-size:13px;line-height:1.55}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.gu{color:var(--up)}.gd{color:var(--down)}
.dr{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0 4px}.dr>div{background:var(--soft);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:1px;min-width:0}.dr span{font-size:11px;color:var(--muted);font-weight:650}.dr b{font-size:15px;font-weight:800}.dr small{font-size:11px;color:var(--muted)}
.mh{margin:12px 0 4px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.mvs{display:grid;gap:3px}.mv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 9px;border-radius:9px;background:var(--surface);border:1px solid var(--line)}.mv span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.mv b{white-space:nowrap}
.fc{display:flex;align-items:flex-end;gap:2px;height:84px;margin:12px 0 4px}.fc i{flex:1;min-width:2px;background:var(--pink);border-radius:3px 3px 0 0}.fc i.es{background:repeating-linear-gradient(135deg,var(--bar,#ffd3d8),var(--bar,#ffd3d8) 3px,transparent 3px,transparent 6px);outline:1px dashed var(--pink);outline-offset:-1px}
.fu{display:flex;flex-wrap:wrap;gap:7px;margin:2px 2px 0}.fu .chip{padding:6px 11px;font-size:12px}
.chip{border:0;background:var(--glass);border-radius:999px;padding:10px 15px;min-height:40px;font-size:12.5px;font-weight:650;text-align:start;box-shadow:0 8px 16px -12px rgba(224,112,138,.7);transition:background .15s,transform .15s}.chip:hover{background:var(--glassb);transform:translateY(-1px)}
.me{align-self:flex-end;max-width:86%;background:var(--ink);color:#fff;padding:11px 17px;border-radius:22px 22px 6px 22px;font-weight:550;white-space:pre-wrap;overflow-wrap:anywhere}
.w.dark .me{background:#FF93A0;color:#2A1018}
.ai{align-self:stretch;display:flex;flex-direction:column;gap:9px;min-width:0}
.tx{background:none;border:0;border-radius:0;padding:2px 2px;font-size:14.5px;line-height:1.6;align-self:flex-start;max-width:100%;overflow-wrap:anywhere}
.tx b{font-weight:800}.tx ul{margin:4px 0 0;padding-inline-start:18px}.tx p{margin:0}.tx p+p{margin-top:6px}
.tx.err{border:1px solid var(--down);border-radius:16px;padding:10px 14px;color:var(--down);background:var(--downbg)}
.retry{margin-top:8px;display:inline-block;border-radius:999px;padding:6px 12px;background:var(--surface);border:1px solid currentColor;font-weight:700;font-size:12px}
.wait{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12.5px;font-weight:600}
.dots{display:inline-flex;gap:4px}.dots i{width:7px;height:7px;border-radius:50%;background:var(--pink);animation:dot 1.1s ease-in-out infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes dot{0%,70%,100%{transform:translateY(0);opacity:.45}35%{transform:translateY(-5px);opacity:1}}
.pn{background:var(--glass);border:1px solid var(--glassb);border-radius:24px;padding:16px;box-shadow:0 18px 34px -22px rgba(224,112,138,.6);backdrop-filter:blur(8px);min-width:0;animation:rise .28s ease both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ph{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.ph h3{margin:0;font-size:14.5px;font-weight:800}.ph small{display:block;color:var(--muted);font-size:11.5px;font-weight:600;margin-top:2px}
.tot{margin:10px 0 2px;display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 10px}
.big{font:500 32px/1.1 var(--serif);letter-spacing:-.01em;white-space:nowrap}.big small{font-size:.5em;font-weight:750;color:var(--muted);margin-inline-end:5px;letter-spacing:.04em}
.meta{color:var(--muted);font-size:12px;font-weight:600;width:100%}
.dl{display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:800;white-space:nowrap}.dl.up{color:var(--up);background:var(--upbg)}.dl.dn{color:var(--down);background:var(--downbg)}.dl.eq{color:var(--muted);background:var(--soft)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:9px;margin-top:12px}
.cd{border:1px solid var(--glassb);border-radius:18px;padding:13px 14px;background:var(--glass);box-shadow:0 12px 24px -18px rgba(224,112,138,.6);min-width:0;position:relative;overflow:hidden}
.cd.top{border-color:var(--pink);background:var(--glassb)}
.cd .rk{position:absolute;top:9px;inset-inline-end:10px;font-size:10.5px;font-weight:800;color:var(--muted)}
.cd h4{margin:0 22px 5px 0;font-size:12.5px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cd .v{font:500 21px/1.2 var(--serif);white-space:nowrap;letter-spacing:-.01em}.cd .v small{font-size:.55em;font-weight:750;color:var(--muted);margin-inline-end:4px}
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
.ft{flex:0 0 auto;padding:6px 16px 14px;border-top:0;background:none}
.box{display:flex;align-items:flex-end;gap:8px;background:var(--glassb);border:1px solid rgba(255,255,255,.95);border-radius:28px;padding:6px 6px 6px 20px;box-shadow:0 18px 34px -20px rgba(224,112,138,.7);transition:box-shadow .15s}.box:focus-within{box-shadow:0 0 0 4px rgba(255,147,160,.25),0 18px 34px -20px rgba(224,112,138,.7)}
textarea{flex:1;min-width:0;border:0;outline:0;resize:none;background:transparent;color:var(--text);font:inherit;font-size:14.5px;line-height:1.4;padding:7px 0;max-height:120px;height:34px}
textarea::placeholder{color:var(--muted)}
.send{width:44px;height:44px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;flex:0 0 auto;transition:transform .15s,opacity .15s}.send svg{width:18px;height:18px}.send:disabled{opacity:.35;cursor:default}.send:not(:disabled):hover{transform:scale(1.07)}
.w.dark .send{background:var(--pink);color:#2A1018}
.fine{margin-top:8px;text-align:center;color:var(--muted);font-size:10.5px;font-weight:500}
.lb{position:fixed;inset:0;background:rgba(20,10,14,.78);display:grid;place-items:center;z-index:5;cursor:zoom-out;padding:20px}.lb img{max-width:min(92vw,720px);max-height:86vh;border-radius:16px;background:#fff}
@media (max-width:640px){
  .win,.w.wide .win{right:0;bottom:0;left:0;top:0;width:auto;max-width:none;height:auto;border-radius:0;border:0}
  .ib.wd{display:none}
  .cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cd .v{font-size:17px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{.w{display:none}}
`;

  var MASCOT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 250" aria-hidden="true" focusable="false"><defs><radialGradient id="mcShell" cx=".28" cy=".22" r="1"><stop offset="0" stop-color="#FFF6F8"/><stop offset=".42" stop-color="#F9BDC8"/><stop offset="1" stop-color="#D9788E"/></radialGradient><linearGradient id="mcBand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#FFE2E8"/><stop offset="1" stop-color="#F6AEBB"/></linearGradient><radialGradient id="mcCup" cx=".3" cy=".25" r=".95"><stop offset="0" stop-color="#FFF3F5"/><stop offset=".5" stop-color="#F6B0BD"/><stop offset="1" stop-color="#D2748A"/></radialGradient><linearGradient id="mcTorus" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF4F6"/><stop offset=".5" stop-color="#F5A9B8"/><stop offset="1" stop-color="#CF6C84"/></linearGradient><radialGradient id="mcScreen" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="#3A1520"/><stop offset=".6" stop-color="#12060A"/><stop offset="1" stop-color="#050203"/></radialGradient><linearGradient id="mcGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="mcBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter><filter id="mcBlur2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter></defs><ellipse class="mc-shadow" cx="120" cy="238" rx="54" ry="8" fill="#B8566E" filter="url(#mcBlur)"/><g class="mc-float"><!-- ring and crown, a little torus --><g class="mc-ring"><circle cx="124" cy="70" r="21" fill="none" stroke="#B9566E" stroke-width="12" opacity=".55"/><circle cx="120" cy="64" r="21" fill="none" stroke="#7B2D40" stroke-width="14"/><circle cx="120" cy="64" r="21" fill="none" stroke="url(#mcTorus)" stroke-width="9"/><path d="M104 52 A19 19 0 0 1 124 44" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/><path d="M138 78 A19 19 0 0 1 120 85" fill="none" stroke="#9E4056" stroke-width="2.4" stroke-linecap="round" opacity=".7"/><path d="M102 36 L105 20 L113 31 L120 15 L127 31 L135 20 L138 36 Z" fill="url(#mcTorus)" stroke="#7B2D40" stroke-width="3" stroke-linejoin="round"/><path d="M120 15 L127 31 L135 20 L138 36 L120 36 Z" fill="#CF6C84" opacity=".45"/><path d="M106 32 L107 24" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/></g><!-- left ear cup: a cylinder --><ellipse cx="55" cy="150" rx="17" ry="26" fill="#C9677E" stroke="#7B2D40" stroke-width="3"/><ellipse cx="62" cy="144" rx="17" ry="26" fill="url(#mcCup)" stroke="#7B2D40" stroke-width="3"/><ellipse cx="68" cy="144" rx="8" ry="18" fill="#E896A6" opacity=".9"/><path d="M52 128 Q54 120 60 118" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/><!-- head: extrusion first, then the face of the shell --><path d="M64 100 Q62 80 84 78 L166 84 Q192 88 192 112 L190 152 Q188 182 158 188 L104 194 Q70 192 66 164 Z" transform="translate(6 9)" fill="#C2627A" stroke="#7B2D40" stroke-width="3" stroke-linejoin="round"/><path d="M64 100 Q62 80 84 78 L166 84 Q192 88 192 112 L190 152 Q188 182 158 188 L104 194 Q70 192 66 164 Z" fill="url(#mcShell)" stroke="#7B2D40" stroke-width="3.2" stroke-linejoin="round"/><path d="M64 100 Q62 80 84 78 L166 84 Q190 88 191 108 Q150 100 112 104 Q82 108 70 128 Z" fill="url(#mcBand)"/><path d="M64 100 Q62 80 84 78 L166 84 Q192 88 192 112" fill="none" stroke="#7B2D40" stroke-width="3.2" stroke-linecap="round"/><path d="M76 90 Q80 83 96 83" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".95"/><path d="M72 168 Q78 184 104 187 L150 183" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".4"/><path d="M186 150 Q184 176 158 182" fill="none" stroke="#B3566E" stroke-width="3" stroke-linecap="round" opacity=".55"/><!-- glass screen --><path d="M78 122 Q82 104 106 106 Q142 108 176 120 Q186 140 180 158 Q172 178 142 178 L104 178 Q82 172 78 148 Z" fill="url(#mcScreen)" stroke="#4E1A28" stroke-width="2.4"/><path d="M80 126 Q86 110 106 110 Q130 111 160 118 Q120 118 100 130 Q86 140 82 160 Q78 148 80 126 Z" fill="url(#mcGlass)"/><path d="M176 126 Q182 146 174 162" fill="none" stroke="#F7A0B0" stroke-width="2" stroke-linecap="round" opacity=".28"/><!-- face with a soft glow --><g filter="url(#mcBlur2)" opacity=".75"><path d="M97 142 Q108 126 121 140" fill="none" stroke="#FFB8C4" stroke-width="7" stroke-linecap="round"/><ellipse cx="152" cy="138" rx="12" ry="16" fill="#FFB8C4"/></g><path class="mc-wink" d="M97 142 Q108 126 121 140" fill="none" stroke="#FFE9ED" stroke-width="5" stroke-linecap="round"/><g class="mc-eye"><ellipse cx="152" cy="138" rx="12" ry="16" fill="#FFE9ED"/><ellipse cx="152" cy="145" rx="9" ry="8" fill="#FFC9D3" opacity=".7"/><circle cx="158" cy="130" r="3.6" fill="#fff"/><circle cx="147" cy="146" r="1.8" fill="#fff" opacity=".85"/></g><path d="M126 156 Q135 170 145 156 Q135 159 126 156 Z" fill="#FF93A0" stroke="#FF93A0" stroke-width="2" stroke-linejoin="round"/><g stroke="#FF93A0" stroke-width="3.4" stroke-linecap="round"><path d="M92 156 L95 150"/><path d="M99 158 L102 152"/><path d="M162 160 L165 154"/><path d="M169 158 L172 152"/></g><!-- right ear cup with the raised P plate --><g class="mc-cupR"><ellipse cx="205" cy="146" rx="15" ry="29" fill="#C2627A" stroke="#7B2D40" stroke-width="3"/><ellipse cx="198" cy="138" rx="15" ry="29" fill="url(#mcCup)" stroke="#7B2D40" stroke-width="3"/><circle cx="211" cy="145" r="21" fill="#C2627A" stroke="#7B2D40" stroke-width="3"/><circle cx="207" cy="138" r="21" fill="url(#mcCup)" stroke="#7B2D40" stroke-width="3"/><circle cx="207" cy="138" r="16.5" fill="#FDD3DA" stroke="#E896A6" stroke-width="1.5"/><path d="M194 126 A17 17 0 0 1 208 121" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".95"/><text x="208" y="148.5" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-weight="700" font-size="28" fill="#fff" opacity=".9">P</text><text x="207" y="147.5" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-weight="700" font-size="28" fill="#4A1522">P</text></g></g><g class="mc-spark1"><path d="M206 38 Q208 58 226 60 Q208 62 206 82 Q204 62 186 60 Q204 58 206 38 Z" fill="#FFE9ED" stroke="#E58FA1" stroke-width="2.2" stroke-linejoin="round"/></g><g class="mc-spark2"><path d="M40 186 Q42 202 56 204 Q42 206 40 222 Q38 206 24 204 Q38 202 40 186 Z" fill="#FFE9ED" stroke="#E58FA1" stroke-width="2.2" stroke-linejoin="round"/></g><g class="mc-ticks" stroke="#E0708A" stroke-width="6" stroke-linecap="round"><path d="M30 78 L38 58"/><path d="M58 70 L64 52"/></g></svg>';
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
    '<button class="fab" type="button" aria-label="Open Fawzi" title="Ask me. Double-click to make me quiet or lively."><span class="bub" role="status" aria-live="polite"></span><span class="mc">' + MASCOT + '</span></button>' +
    '<section class="win" role="dialog" aria-label="Fawzi" aria-hidden="true">' +
      '<header class="hd">' +
        '<button class="ib nw" type="button" title="New chat" aria-label="Start a new chat">' + IC.fresh + '</button>' +
        '<div class="hc"><span class="badge">' + MASCOT + '</span><div class="ht"><b>Fawzi</b><span><i class="live"></i>Live sales, stock and staff</span></div></div>' +
        '<div class="hr"><button class="ib wd" type="button" title="Bigger or smaller" aria-label="Make the window bigger or smaller">' + IC.wide + '</button>' +
        '<button class="ib cl" type="button" title="Close" aria-label="Close Fawzi">' + IC.x + '</button></div></header>' +
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
    var sub = [p.range, p.filters, p.type === 'sales' || p.type === 'staff' ? (p.basis === 'gross' ? 'with VAT' : 'net of VAT') : ''].filter(Boolean).join(' · ');
    return '<div class="ph"><div><h3 dir="auto">' + esc(p.title) + '</h3><small>' + esc(sub) + '</small></div></div>';
  }
  function foot(p) {
    return (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
      (p.href ? '<div class="pf"><a class="link" href="' + esc(p.href) + '">' + (p.type === 'stock' || p.type === 'cover' ? 'Open Stock balance' : p.type === 'staff' ? 'Open Staff Performance' : p.type === 'slow' ? 'Open Slowmoving 2.0' : 'Open in Pandora Dashboards') + IC.go + '</a></div>' : '');
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
    var val = function (g) { return p.metric === 'atv' ? '<small>AVG ORDER</small>' + money(g.atv) : p.metric === 'upt' ? '<small>PCS / ORDER</small>' + (Number(g.upt) || 0).toFixed(2) : m === 'units' ? '<small>PCS</small>' + num(g.units) : m === 'orders' ? '<small>ORDERS</small>' + num(g.orders) : money(g.sales); };
    var h = head(p) + '<div class="tot"><span class="big">' + (p.metric === 'atv' ? money(T.atv) : p.metric === 'upt' ? (Number(T.upt) || 0).toFixed(2) + ' <small>PCS / ORDER</small>' : money(T.sales)) + '</span>' + (p.metric === 'atv' || p.metric === 'upt' ? '' : delta(T.d, T.prev)) + (p.cmp ? '<span class="meta" style="width:auto">vs ' + esc(p.cmp) + '</span>' : '') +
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
        '<div class="n"><b title="' + esc(g.name) + '">' + esc(g.name) + '</b>' + (pics ? '<small>' + esc([g.sku, g.cat].filter(Boolean).join(' · ')) + '</small>' : g.store ? '<small>' + esc(g.store) + '</small>' : '') + '<div class="bar"><i style="width:' + (Math.max(0, g[m]) / mx * 100).toFixed(1) + '%"></i></div>' + subRows(g, m) + '</div>' +
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

  // ---- smarter panels: why / forecast / restock & slow ----
  function sgn(n) { return (n >= 0 ? '+' : '−') + moneyT(Math.abs(n)); }
  function whyPanel(p) {
    var T = p.total || {};
    var h = head(p) + '<div class="tot"><span class="big ' + (T.diff >= 0 ? 'gu' : 'gd') + '">' + sgn(T.diff) + '</span>' + delta(T.d, T.prev) + '<span class="meta" style="width:auto">vs ' + esc(p.cmp || 'before') + '</span><span class="meta">' + moneyT(T.sales) + ' now · ' + moneyT(T.prev) + ' before</span></div>';
    h += '<div class="dr">' + (p.drivers || []).map(function (d) {
      var f = d.f === 'egp' ? moneyT : d.f === 'x' ? function (v) { return (Number(v) || 0).toFixed(2); } : num;
      return '<div><span>' + esc(d.name) + '</span><b>' + f(d.cur) + '</b><small>was ' + f(d.prev) + '</small>' + delta(d.d, d.prev) + '</div>';
    }).join('') + '</div>';
    (p.movers || []).forEach(function (m) {
      var row = function (x, up) { return '<div class="mv"><span title="' + esc(x.name) + '">' + esc(x.name) + '</span><b class="' + (up ? 'gu' : 'gd') + '">' + sgn(x.diff) + '</b></div>'; };
      h += '<div class="mh">' + esc(m.dim) + '</div><div class="mvs">' + m.up.map(function (x) { return row(x, 1); }).join('') + m.down.map(function (x) { return row(x, 0); }).join('') + '</div>';
    });
    return h + foot(p);
  }
  function forecastPanel(p) {
    var mx = Math.max.apply(null, (p.daily || []).map(function (d) { return d.v; }).concat(1)), n = (p.daily || []).length || 1;
    var h = head(p) + '<div class="tot"><span class="big">' + money(p.done ? p.soFar : p.projected) + '</span>' + (p.vsLastMonth != null ? delta(p.vsLastMonth, 1) + '<span class="meta" style="width:auto">vs last month</span>' : '') + '<span class="meta" style="width:auto">' + (p.done ? 'final' : 'likely ' + moneyT(p.low) + ' – ' + moneyT(p.high)) + '</span>' +
      '<span class="meta">So far ' + moneyT(p.soFar) + ' in ' + p.daysDone + ' days' + (p.done ? '' : ' · ' + p.daysLeft + ' to go') + ' (to ' + esc(p.through) + ')</span></div>';
    h += '<div class="fc" role="img" aria-label="Daily sales, with the estimated days lighter">' + (p.daily || []).map(function (d) { return '<i class="' + (d.est ? 'es' : '') + '" style="height:' + Math.max(2, d.v / mx * 100).toFixed(1) + '%" title="' + esc(d.d) + ': ' + moneyT(d.v) + (d.est ? ' (estimate)' : '') + '"></i>'; }).join('') + '</div>';
    h += '<div class="dr">' + [['Last month, full', p.lastMonth], ['Last month, same days', p.lastMonthSoFar]].filter(function (x) { return x[1] != null; }).map(function (x) { return '<div><span>' + x[0] + '</span><b>' + moneyT(x[1]) + '</b></div>'; }).join('') +
      (p.paceVsLast != null ? '<div><span>Pace vs same days</span><b>' + (p.paceVsLast >= 0 ? '+' : '−') + Math.abs(p.paceVsLast) + '%</b></div>' : '') + '</div>';
    return h + foot(p);
  }
  function coverPanel(p) {
    var T = p.total || {}, R = p.rows || [];
    var h = head(p) + '<div class="tot"><span class="big">' + num(T.items) + ' <small>' + (p.mode === 'slow' ? 'SLOW ITEMS' : 'TO RESTOCK') + '</small></span><span class="meta">' + num(T.qty) + ' pcs in stock across them</span></div>';
    if (!R.length) return h + '<div class="note">' + (p.mode === 'slow' ? 'No stock without sales. Good.' : 'Nothing is close to running out.') + '</div>' + foot(p);
    h += '<div class="rows">' + R.map(function (g) {
      var urgent = p.mode !== 'slow' && g.days != null && g.days <= 3;
      return '<div class="rw"><span class="pic" data-sku="' + esc(g.sku || '') + '">' + IC.gem + '</span><div class="n"><b title="' + esc(g.name) + '">' + esc(g.name) + '</b><small>' + esc([g.sku, g.cat].filter(Boolean).join(' · ')) + (g.where && g.where[0] ? ' · most in ' + esc(g.where[0].name) : '') + '</small></div>' +
        '<div class="r"><b>' + num(g.qty) + ' ' + unitWord(g.qty) + '</b><small>' + (p.mode === 'slow' ? 'none sold' : (urgent ? '<span class="gd">' + g.days + (g.days === 1 ? ' day left' : ' days left') + '</span>' : g.days + ' days left') + ' · ' + g.perDay + '/day') + '</small></div></div>';
    }).join('') + '</div>';
    return h + foot(p);
  }
  function slowPanel(p) {
    var T = p.total || {}, G = p.groups || [], mx = Math.max.apply(null, G.map(function (g) { return g.qty; }).concat(1));
    var h = head(p) + '<div class="tot"><span class="big"><small>PCS</small>' + num(T.qty) + '</span><span class="meta">' + num(T.skus) + ' different items \u00b7 ' + num(T.lines) + ' item lines' + (T.never ? ' \u00b7 ' + num(T.never) + ' never sold' : '') + '</span></div>';
    h += '<div class="rows">' + G.map(function (g, i) {
      var item = p.by === 'item';
      var where = item && g.sub && g.sub[0] ? ' \u00b7 most in ' + esc(g.sub[0].name) : '';
      return '<div class="rw">' + (item ? '<span class="pic" data-sku="' + esc(g.sku || '') + '">' + IC.gem + '</span>' : '<span class="k">' + (i + 1) + '</span>') + '<div class="n"><b title="' + esc(g.name) + '">' + esc(g.name) + '</b><small>' + (item ? esc([g.sku, g.cat].filter(Boolean).join(' \u00b7 ')) + where : num(g.lines) + ' item lines' + (g.never ? ' \u00b7 ' + num(g.never) + ' never sold' : '')) + '</small><div class="bar"><i style="width:' + Math.max(2, g.qty / mx * 100).toFixed(1) + '%"></i></div></div>' +
        '<div class="r"><b>' + num(g.qty) + ' ' + unitWord(g.qty) + '</b><small>' + (!item ? num(Math.round(g.share * 100)) + '%' : g.oldest && g.oldest < 99 ? g.oldest + '+ months idle' : g.never ? 'never sold' : '') + '</small></div></div>';
    }).join('') + '</div>';
    return h + foot(p);
  }
  function panelEl(p) {
    var d = document.createElement('div'); d.className = 'pn';
    try {
      if (p.type === 'links') { d.innerHTML = '<div class="links">' + (p.items || []).map(function (i) { return '<a class="link" href="' + esc(/^\/[^/\\]/.test(i.href) ? i.href : '/') + '">' + esc(i.title) + IC.go + '</a>'; }).join('') + '</div>'; return d; }
      d.innerHTML = p.type === 'slow' ? slowPanel(p) : p.type === 'stock' ? stockPanel(p) : p.type === 'why' ? whyPanel(p) : p.type === 'forecast' ? forecastPanel(p) : p.type === 'cover' ? coverPanel(p) : salesPanel(p);
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
      h.innerHTML = '<h2>' + esc(CFG.name ? 'Hello ' + CFG.name : 'Hello') + '</h2><p>Ask about sales, stock, staff or slow stock: say a date, a store, a category and how to split it. I answer with the real figures.</p><div class="chips">' + CHIPS.map(function (c) { return '<button class="chip" type="button">' + esc(c) + '</button>'; }).join('') + '</div>';
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
        if (idx === S.msgs.length - 1 && m.follow && m.follow.length && !m.err) { var fu = document.createElement('div'); fu.className = 'fu'; m.follow.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = c; fu.appendChild(b); }); a.appendChild(fu); }
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
          S.msgs.push({ role: 'assistant', text: x.j.text || '', panels: x.j.panels || [], ctx: x.j.ctx || '', follow: x.j.follow || [] });
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
    if (S.open) { try { cancel(); goHome(0); BUB.classList.remove('on'); } catch (e) {} }
    else { try { clearTimeout(tmr); tmr = setTimeout(step, 3500); } catch (e) {} }
    if (S.open) { draw(); LOG.scrollTop = LOG.scrollHeight; if (window.innerWidth > 640) setTimeout(function () { try { TA.focus({ preventScroll: true }); } catch (e) {} }, 60); }
    else { try { $('.fab').focus({ preventScroll: true }); } catch (e) {} }
  }

  $('.fab').addEventListener('click', function () { toggle(true); });

  // ---- the mascot: he roams the page, reacts, and says funny things (double-click him to make him stay put) ----
  var FAB = $('.fab'), BUB = $('.bub');
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ROAMKEY = 'pandora-assist.roam', pos = { x: 0, y: 0 }, tmr = 0, bubT = 0, said = 0, hover = false, ready = false;
  var roamOn = true; try { roamOn = localStorage.getItem(ROAMKEY) !== '0'; } catch (e) {}
  var QUIPS = ['Psst... ask me what sold yesterday.', 'I run on EGP and good vibes.', 'Stock is my cardio.', 'I counted every charm. Twice.', 'Who sold the most? I know. Ask me.', 'Slow stock? I will find it.', 'Just stretching my legs. Carry on.', 'My crown is a ring. Very on brand.', 'Double-click me and I will stay quiet.', 'Numbers look shiny today.'];
  var size = function () { return window.innerWidth <= 640 ? 60 : 78; };
  function home() { var s = size(); return { x: window.innerWidth - s - 16, y: window.innerHeight - s * 1.05 - 16 }; }
  function put(x, y, ms) {
    var s = size(); FAB.style.width = s + 'px'; FAB.style.height = Math.round(s * 1.05) + 'px';
    x = Math.max(8, Math.min(window.innerWidth - s - 8, x)); y = Math.max(8, Math.min(window.innerHeight - s * 1.05 - 8, y));
    var dx = x - pos.x; pos = { x: x, y: y };
    FAB.style.transitionDuration = (ms || 0) + 'ms,.2s';
    FAB.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    if (ms) { FAB.style.setProperty('--lean', (dx > 8 ? 9 : dx < -8 ? -9 : 0) + 'deg'); FAB.classList.add('going'); clearTimeout(put.t); put.t = setTimeout(function () { FAB.classList.remove('going'); FAB.style.setProperty('--lean', '0deg'); }, ms); }
  }
  function say(t, ms) {
    if (!t) return; BUB.textContent = t;
    BUB.classList.toggle('l', pos.x < window.innerWidth / 2 - 40); BUB.classList.toggle('dn', pos.y < 120);
    BUB.classList.add('on'); clearTimeout(bubT); bubT = setTimeout(function () { BUB.classList.remove('on'); }, ms || 4200);
  }
  function jump() { FAB.classList.remove('jump'); void FAB.offsetWidth; FAB.classList.add('jump'); }
  function busyNow() { return S.open || document.hidden || hover || !roamOn || REDUCE; }
  var seq = [];
  function later(f, ms) { seq.push(setTimeout(f, ms)); }
  function cancel() { seq.forEach(clearTimeout); seq = []; clearTimeout(tmr); }
  function type(t, done) {
    BUB.textContent = ''; BUB.classList.toggle('l', false); BUB.classList.add('on'); clearTimeout(bubT);
    var i = 0; (function k() { if (busyNow() && S.open) return; BUB.textContent = t.slice(0, ++i); if (i < t.length) seq.push(setTimeout(k, 34)); else if (done) done(); })();
  }
  // every so often: slide about 2 cm to the left, jump, write a funny line, then slide back (always along the bottom)
  function step() {
    cancel();
    if (busyNow()) { tmr = setTimeout(step, 5000); return; }
    var h = home(), dx = size() === 60 ? 46 : 76, t = QUIPS[Math.floor(Math.random() * QUIPS.length)];
    put(h.x - dx, h.y, 700);
    later(jump, 800);
    later(function () { type(t, function () { jump(); }); }, 1100);
    var total = 1100 + t.length * 34 + 3600;
    later(function () { BUB.classList.remove('on'); }, total);
    later(function () { put(h.x, h.y, 800); }, total + 300);
    tmr = setTimeout(step, total + 1200 + 16000 + Math.random() * 14000);
  }
  function goHome(ms) { var h = home(); put(h.x, h.y, ms || 0); }
  goHome(0);
  FAB.addEventListener('mouseenter', function () {
    hover = true; if (!ready) return; cancel(); BUB.classList.remove('on');
    var r = FAB.getBoundingClientRect(); pos = { x: r.left, y: r.top }; FAB.style.transitionDuration = '0ms,.2s'; FAB.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0)'; FAB.classList.remove('going'); jump();
  });
  FAB.addEventListener('mouseleave', function () { hover = false; clearTimeout(tmr); tmr = setTimeout(step, 1600); });
  FAB.addEventListener('dblclick', function (e) {
    e.preventDefault(); toggle(false);
    roamOn = !roamOn; try { localStorage.setItem(ROAMKEY, roamOn ? '1' : '0'); } catch (x) {}
    if (roamOn) { say('Back to my tricks!'); cancel(); tmr = setTimeout(step, 6000); } else { cancel(); goHome(600); say('Okay, I will stay quiet.'); }
  });
  window.addEventListener('resize', function () { cancel(); goHome(0); if (!S.open && roamOn) tmr = setTimeout(step, 8000); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { clearTimeout(tmr); tmr = setTimeout(step, 1500); } });
  setTimeout(function () {
    ready = true;
    var seen = false; try { seen = sessionStorage.getItem('pandora-assist.hi') === '1'; sessionStorage.setItem('pandora-assist.hi', '1'); } catch (e) {}
    if (!S.open) { jump(); if (!seen) say('Hi! Need any numbers?', 4500); }
    if (roamOn && !REDUCE) tmr = setTimeout(step, seen ? 7000 : 9000);
  }, 1200);

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
