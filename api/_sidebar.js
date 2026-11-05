// Report list on the left for the super admin (and the brand manager, who sees everything the same way).
// Injected by api/site.js into every report page, so the report can be changed in one click instead of going Home first.
// Same sections and order as the home screen (including the order the super admin saved there), same pink look.
const BASE = [
  ['Sales', ['overview', 'insights', 'dashboards', 'staff', 'daily', 'film']],
  ['Stock', ['stock', 'stockcount', 'stockchecker', 'slow', 'transfer']],
  ['Ordering', ['refill', 'dist', 'recv']],
  ['Visual Merchandising', ['vmzones', 'zonestock', 'vm']],
  ['Team & Access', ['schedule', 'approvals', 'access', 'activity', 'uploads']]
];

// facts = what api/_apps.js sessionFacts() returned. Returns null when this person does not get the list.
async function dataFor(facts) {
  try {
    if (!(facts && facts.staff && facts.staff.role === 'admin')) return null;
    const { appsFor } = require('./_apps');
    const apps = appsFor(facts).filter(a => a.id !== 'film'); // the launch film is a presentation, not a report
    let saved = [];
    try { saved = (await require('./_store').getJSON('access/home.json')) || []; } catch (_) {}
    const order = Array.isArray(saved) && saved.length
      ? saved.map(([n, ids]) => { const b = BASE.find(x => x[0] === n); return [n, (ids || []).concat(b ? b[1].filter(i => !(ids || []).includes(i)) : [])]; })
          .concat(BASE.filter(b => !saved.some(x => x[0] === b[0])))
      : BASE;
    const used = new Set(), groups = [];
    order.forEach(([name, ids]) => {
      const list = ids.map(id => apps.find(a => a.id === id)).filter(Boolean).filter(a => !used.has(a.id));
      list.forEach(a => used.add(a.id));
      if (list.length) groups.push({ name, items: list.map(a => ({ id: a.id, t: a.id === 'approvals' ? 'Staff Approvals' : a.title, h: a.href })) });
    });
    const rest = apps.filter(a => !used.has(a.id));
    if (rest.length) groups.push({ name: 'More', items: rest.map(a => ({ id: a.id, t: a.title, h: a.href })) });
    return groups.length ? { groups } : null;
  } catch (_) { return null; }
}

const CSS = String.raw`<style id="pandora-side-css">
html.pzs-on body{margin-left:244px!important;transition:margin-left .2s ease}
html.pzs-on.pzs-min body{margin-left:92px!important}
.pzs{--s-bg:#fff;--s-ink:#282522;--s-mut:#817a74;--s-line:#e9e2dc;--s-soft:#FFE4E8;--s-acc:#FF93A0;--s-on:#2A1018;--s-acct:#2A1F24;
position:fixed;z-index:40;top:12px;left:12px;bottom:12px;width:220px;display:flex;flex-direction:column;background:var(--s-bg);color:var(--s-ink);border:1px solid var(--s-line);border-radius:20px;font:600 13px/1.3 "Plus Jakarta Sans",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;word-spacing:.09em;transition:width .2s ease,transform .2s ease;overflow:hidden}
:root[data-theme="dark"] .pzs{--s-bg:#211f1d;--s-ink:#f7f2ed;--s-mut:#b7aea6;--s-line:#3a3530;--s-soft:#33202a;--s-acct:#FF93A0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pzs{--s-bg:#211f1d;--s-ink:#f7f2ed;--s-mut:#b7aea6;--s-line:#3a3530;--s-soft:#33202a;--s-acct:#FF93A0}}
.pzs *{box-sizing:border-box}
.pzs-top{display:flex;align-items:center;gap:10px;padding:14px 12px 10px 14px;text-decoration:none;color:inherit;flex:0 0 auto}
.pzs-top img{width:30px;height:32px;object-fit:contain;flex:0 0 auto}
:root[data-theme="dark"] .pzs-top img{filter:brightness(0) invert(1)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pzs-top img{filter:brightness(0) invert(1)}}
.pzs-top b{font-size:14px;font-weight:800;letter-spacing:-.01em;white-space:nowrap}.pzs-top small{display:block;font-size:10.5px;font-weight:600;color:var(--s-mut);margin-top:1px}
.pzs-list{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:2px 8px 8px;scrollbar-width:thin;scrollbar-color:var(--s-line) transparent}
.pzs-h{margin:12px 0 4px 8px;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--s-mut);white-space:nowrap}
.pzs-a{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:14px;color:var(--s-ink);text-decoration:none;transition:background .15s}
.pzs-a:hover{background:var(--s-soft)}
.pzs-a:focus-visible,.pzs-top:focus-visible,.pzs-btn:focus-visible{outline:2px solid var(--s-acc);outline-offset:1px}
.pzs-ic{flex:0 0 28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--s-soft);color:var(--s-acct)}.pzs-ic svg{width:15px;height:15px}
.pzs-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pzs-a.on{background:var(--s-acc);color:var(--s-on)}.pzs-a.on .pzs-ic{background:rgba(255,255,255,.6);color:var(--s-on)}
.pzs-foot{flex:0 0 auto;border-top:1px solid var(--s-line);padding:8px}
.pzs-btn{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;color:var(--s-mut);font:inherit;padding:6px 8px;border-radius:14px;cursor:pointer}.pzs-btn:hover{background:var(--s-soft);color:var(--s-ink)}
.pzs-btn svg{width:15px;height:15px;flex:0 0 28px;transition:transform .2s}
.pzs-fab{display:none}.pzs-dim{display:none}
html.pzs-min .pzs{width:68px}
html.pzs-min .pzs-top div,html.pzs-min .pzs-t,html.pzs-min .pzs-btn span{display:none}
html.pzs-min .pzs-h{font-size:0;height:1px;margin:10px 14px;background:var(--s-line)}
html.pzs-min .pzs-a,html.pzs-min .pzs-btn{justify-content:center;padding-left:0;padding-right:0}
html.pzs-min .pzs-top{justify-content:center;padding-left:0;padding-right:0}
html.pzs-min .pzs-btn svg{transform:rotate(180deg);flex-basis:auto}
@media (max-width:1000px){
html.pzs-on body,html.pzs-on.pzs-min body{margin-left:0!important}
.pzs{transform:translateX(calc(-100% - 20px));width:244px!important}
html.pzs-min .pzs-top div,html.pzs-min .pzs-t,html.pzs-min .pzs-btn span{display:revert}
html.pzs-min .pzs-h{font-size:10.5px;height:auto;margin:12px 0 4px 8px;background:none}
html.pzs-min .pzs-a{justify-content:flex-start;padding:6px 8px}html.pzs-min .pzs-top{justify-content:flex-start;padding:14px 12px 10px 14px}
.pzs-btn{display:none}
html.pzs-open .pzs{transform:none;box-shadow:0 18px 50px rgba(0,0,0,.28)}
.pzs-fab{display:grid;place-items:center;position:fixed;z-index:39;left:12px;bottom:14px;width:44px;height:44px;border-radius:50%;border:0;background:#FF93A0;color:#2A1018;box-shadow:0 8px 22px rgba(255,147,160,.5);cursor:pointer}
.pzs-fab svg{width:20px;height:20px}
html.pzs-open .pzs-dim{display:block;position:fixed;z-index:38;inset:0;background:rgba(20,12,14,.4)}
}
@media print{.pzs,.pzs-fab,.pzs-dim{display:none!important}html.pzs-on body{margin-left:0!important}}
@media (prefers-reduced-motion:reduce){.pzs,html.pzs-on body,.pzs-btn svg{transition:none}}
</style>`;

// Small outline icons (same style as the home screen). Reports without one of their own get a plain square.
const ICONS = {
  overview: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  dashboards: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  insights: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v4M17 18h4"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.9.8 3 2.6 3 5.6"/>',
  uploads: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  approvals: '<circle cx="10" cy="8" r="3.2"/><path d="M4 20c0-3.3 2.7-6 6-6 1.4 0 2.6.4 3.6 1.1M15.5 18.5l2 2 4-4.5"/>',
  vm: '<path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4"/>',
  vmzones: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 12h18M12 3v18"/>',
  zonestock: '<path d="M3 9l9-5 9 5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 20v-6h6v6"/>',
  stock: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/>',
  stockcount: '<path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M7 8v8M11 8v8M15 8v8M18 8v8"/>',
  stockchecker: '<path d="M4 6v10M7 6v10M10 6v10M13 6v5"/><circle cx="16.5" cy="15.5" r="3.5"/><path d="M19 18l2.2 2.2"/>',
  slow: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  transfer: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  refill: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>',
  dist: '<path d="M12 3v7M12 10l-7 6M12 10l7 6M5 16v4M19 16v4M12 10v10"/>',
  recv: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M8 12l3 3 5-6"/>',
  access: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  daily: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 15l2.5-2.5 2 2 3.5-3.5"/>',
  schedule: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M13 14h3M8 17h3"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>'
};
const DEF = '<rect x="4" y="4" width="16" height="16" rx="3"/>';

const JS = String.raw`<script>(function(){try{
var D=window.__PZSIDE;if(!D||!D.groups||!D.groups.length||document.querySelector('.pzs'))return;
var IC=__ICONS__,DEF=__DEF__;
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function norm(p){p=String(p||'/').split('?')[0].split('#')[0].replace(/\/+$/,'');return p||'/'}
var here=norm(location.pathname).replace(/\.html$/,'');
if(here==='/index')here='/dashboards';
// the page you are on: the longest matching address wins (so /staff/accounts is not mistaken for /staff)
var best='',bestLen=-1;
D.groups.forEach(function(g){g.items.forEach(function(it){var h=norm(it.h);if((here===h||here.indexOf(h+'/')===0)&&h.length>bestLen){best=it.id;bestLen=h.length}})});
function svg(id){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(IC[id]||DEF)+'</svg>'}
var h='<a class="pzs-top" href="/" title="Home"><img src="/pandora-logo.png" alt="Pandora"><div><b>Pandora</b><small>All reports</small></div></a><nav class="pzs-list" aria-label="Reports">';
D.groups.forEach(function(g){
  h+='<div class="pzs-h">'+esc(g.name)+'</div>';
  g.items.forEach(function(it){h+='<a class="pzs-a'+(it.id===best?' on':'')+'" href="'+esc(it.h)+'" title="'+esc(it.t)+'"'+(it.id===best?' aria-current="page"':'')+'><span class="pzs-ic">'+svg(it.id)+'</span><span class="pzs-t">'+esc(it.t)+'</span></a>'});
});
h+='</nav><div class="pzs-foot"><button type="button" class="pzs-btn" id="pzsMin" title="Make the list smaller"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg><span>Make smaller</span></button></div>';
var nav=document.createElement('aside');nav.className='pzs';nav.innerHTML=h;
var fab=document.createElement('button');fab.type='button';fab.className='pzs-fab';fab.setAttribute('aria-label','Open the reports list');
fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
var dim=document.createElement('div');dim.className='pzs-dim';
var root=document.documentElement;
document.body.appendChild(nav);document.body.appendChild(fab);document.body.appendChild(dim);
root.classList.add('pzs-on');
var KEY='pandora-side-min';
try{if(localStorage.getItem(KEY)==='1')root.classList.add('pzs-min')}catch(e){}
document.getElementById('pzsMin').addEventListener('click',function(){var m=root.classList.toggle('pzs-min');try{localStorage.setItem(KEY,m?'1':'0')}catch(e){}});
function open(v){root.classList.toggle('pzs-open',v)}
fab.addEventListener('click',function(){open(true)});dim.addEventListener('click',function(){open(false)});
document.addEventListener('keydown',function(e){if(e.key==='Escape')open(false)});
// keep the current report in view when the list is long
var on=nav.querySelector('.pzs-a.on');if(on&&on.scrollIntoView){try{on.scrollIntoView({block:'center'})}catch(e){}}
}catch(e){}})();</script>`;

// The block that goes into the page. `data` comes from dataFor().
function inject(data) {
  const boot = '<script>window.__PZSIDE=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';</script>';
  return CSS + boot + JS.replace('__ICONS__', JSON.stringify(ICONS)).replace('__DEF__', JSON.stringify(DEF));
}

module.exports = { dataFor, inject, BASE };
