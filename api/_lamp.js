// The lamp pull-cord that replaces the sun/moon switch on every page except sign-in (small screens keep the normal switch).
// Pull the cord down: light mode on. Pull it again: dark mode. It saves the same choice ("pandora-theme") as the old switch.
const LAMP = String.raw`<style id="pandora-lamp-css">
.pandora-lamp{display:none}
@media (min-width:701px){html.haslamp #themeBtn{display:none!important}
.pandora-lamp{display:block;position:fixed;top:0;left:50%;margin-left:-32px;width:64px;z-index:2147483000;--p:0px;animation:plampin .9s cubic-bezier(.2,.9,.3,1) .3s both}}
@keyframes plampin{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}}
.pandora-lamp svg{display:block;width:64px;height:auto;overflow:visible}
.pandora-lamp .wire{stroke:#9a928b;stroke-width:1.6}
.pandora-lamp .shade{fill:#FF93A0}.pandora-lamp .rim{fill:#e8707f}
.pandora-lamp .bulb{fill:#4a4440;transition:fill .3s,filter .3s}
.pandora-lamp.on .bulb{fill:#ffe08a;filter:drop-shadow(0 0 7px rgba(255,214,110,.95))}
.pandora-lamp .beam{position:absolute;left:50%;top:44px;width:170px;height:130px;margin-left:-85px;pointer-events:none;opacity:0;transition:opacity .35s;clip-path:polygon(38% 0,62% 0,100% 100%,0 100%);background:linear-gradient(to bottom,rgba(255,224,138,.26),rgba(255,224,138,0))}
.pandora-lamp.on .beam{opacity:1}
.pandora-lamp .pullb{position:absolute;left:44px;top:42px;width:22px;margin-left:-11px;padding:0;border:0;background:none;cursor:grab;touch-action:none;display:flex;flex-direction:column;align-items:center;-webkit-tap-highlight-color:transparent}
.pandora-lamp .pullb:active{cursor:grabbing}
.pandora-lamp .pullb:focus-visible{outline:2px solid #FF93A0;outline-offset:4px;border-radius:8px}
.pandora-lamp .cl{display:block;width:1.8px;height:calc(30px + var(--p));background:#9a928b;transition:height .45s cubic-bezier(.3,1.9,.5,1)}
.pandora-lamp .ball{display:block;width:13px;height:13px;border-radius:50%;background:#241d1f;box-shadow:0 0 0 3px #FFE4E8;margin-top:-1px}
:root[data-theme="dark"] .pandora-lamp .ball{background:#f7f2ed;box-shadow:0 0 0 3px #4a3038}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pandora-lamp .ball{background:#f7f2ed;box-shadow:0 0 0 3px #4a3038}}
.pandora-lamp.drag .cl{transition:none}
.themefade,.themefade *{transition:background-color .45s,color .45s,border-color .45s,fill .45s!important}
</style><script>(function(){try{
var root=document.documentElement,L=document.createElement("div");L.className="pandora-lamp hideclean";
L.innerHTML='<span class="beam"></span><svg viewBox="0 0 64 56" aria-hidden="true"><line class="wire" x1="32" y1="-2" x2="32" y2="18"/><path class="shade" d="M9 44Q9 22 32 19Q55 22 55 44Z"/><rect class="rim" x="7" y="42" width="50" height="4" rx="2"/><ellipse class="bulb" cx="32" cy="48" rx="8" ry="6"/></svg><button class="pullb" type="button" role="switch" aria-checked="false" aria-label="Lamp: pull to switch between light and dark mode"><span class="cl"></span><span class="ball"></span></button>';
document.body.appendChild(L);root.classList.add("haslamp");
var B=L.querySelector(".pullb");
function cur(){return root.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}
function sync(){var light=cur()==="light";L.classList.toggle("on",light);B.setAttribute("aria-checked",light);B.title=light?"Pull the cord: dark mode":"Pull the cord: light mode"}
function flip(){var n=cur()==="dark"?"light":"dark";root.classList.add("themefade");root.setAttribute("data-theme",n);try{localStorage.setItem("pandora-theme",n)}catch(e){}sync();setTimeout(function(){root.classList.remove("themefade")},600)}
function tug(px){L.style.setProperty("--p",px+"px");setTimeout(function(){L.style.setProperty("--p","0px")},110)}
var y0=null,dy=0;sync();
B.addEventListener("pointerdown",function(e){y0=e.clientY;dy=0;L.classList.add("drag");try{B.setPointerCapture(e.pointerId)}catch(_){}});
B.addEventListener("pointermove",function(e){if(y0==null)return;dy=Math.max(0,Math.min(38,e.clientY-y0));L.style.setProperty("--p",dy+"px")});
B.addEventListener("pointerup",function(){if(y0==null)return;var m=dy;y0=null;L.classList.remove("drag");
if(m<4){tug(24);flip()}else{L.style.setProperty("--p",m+"px");requestAnimationFrame(function(){L.style.setProperty("--p","0px")});if(m>=16)flip()}});
B.addEventListener("pointercancel",function(){y0=null;L.classList.remove("drag");L.style.setProperty("--p","0px")});
B.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();tug(24);flip()}});
}catch(e){}})();</script>`;
module.exports = { LAMP };
