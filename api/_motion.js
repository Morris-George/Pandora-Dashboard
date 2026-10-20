// Page motion shared by every page (injected by api/site.js with the theme code):
//  - opening a page: a pink curtain with the logo lifts away, then the page's blocks rise in one after another
//  - leaving by a link or the Home button: the curtain comes back down, then the next page opens
// Pages that run their own intro (home, login) carry data-nopw on <body> and only use the curtain.
module.exports = String.raw`<style id="pandora-motion">
html::before{content:"";position:fixed;left:0;right:0;top:0;height:calc(100% + 140px);z-index:2147483000;pointer-events:none;background:linear-gradient(165deg,#FF93A0 0%,#FFB3BC 100%);border-radius:0 0 50% 50% / 0 0 130px 130px;transform:translateY(-130%);animation:pwlift .85s cubic-bezier(.75,0,.2,1) .18s backwards}
html::after{content:"";position:fixed;left:50%;top:50%;width:70px;height:78px;margin:-39px 0 0 -35px;z-index:2147483001;pointer-events:none;background:url(/pandora-logo.png) center/contain no-repeat;opacity:0;animation:pwlogo .85s ease .0s backwards}
@keyframes pwlift{0%,12%{transform:translateY(0)}100%{transform:translateY(-130%)}}
@keyframes pwlogo{0%{opacity:0;transform:scale(.7)}30%,55%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.15) translateY(-30px)}}
html.pw-out::before{animation:pwdrop .5s cubic-bezier(.7,0,.3,1) forwards;transform:translateY(0);border-radius:50% 50% 0 0 / 130px 130px 0 0;top:-140px}
html.pw-out::after{animation:pwlogoin .4s ease .15s forwards}
@keyframes pwdrop{from{transform:translateY(110%)}to{transform:translateY(0)}}
@keyframes pwlogoin{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}
[data-pw]{animation:pwrise .75s cubic-bezier(.2,.8,.2,1) calc(.55s + var(--pwi,0) * .07s) backwards}
@keyframes pwrise{from{opacity:0;transform:translateY(28px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){html::before,html::after{display:none!important}[data-pw]{animation:none!important}}
</style><script>(function(){
var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches,de=document.documentElement;
function skip(e){return /^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(e.tagName)||e.hidden||/(pandora-fab|pandora-sw|hideclean|tip)/.test(e.className+" "+e.id)||getComputedStyle(e).position==="fixed"}
function stagger(){
  if(reduce||!document.body||document.body.hasAttribute("data-nopw"))return;
  var top=[].filter.call(document.body.children,function(e){return !skip(e)});
  var list=top;
  if(top.length===1){var c=[].filter.call(top[0].children,function(e){return !skip(e)});if(c.length>1)list=c}
  list.slice(0,14).forEach(function(e,i){e.setAttribute("data-pw","");e.style.setProperty("--pwi",i)});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",stagger);else stagger();
function go(url,replace){
  if(reduce){replace?location.replace(url):(location.href=url);return}
  if(de.classList.contains("pw-out"))return;
  de.classList.add("pw-out");
  setTimeout(function(){replace?location.replace(url):(location.href=url)},470);
  setTimeout(function(){de.classList.remove("pw-out")},4000); // safety: if the page did not change (for example a download)
}
window.__pandoraGo=go;
addEventListener("pageshow",function(e){if(e.persisted)de.classList.remove("pw-out")});
document.addEventListener("click",function(e){
  if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var a=e.target.closest&&e.target.closest("a[href]");if(!a||a.target||a.hasAttribute("download")||a.hasAttribute("data-nopw"))return;
  var u;try{u=new URL(a.href,location.href)}catch(_){return}
  if(u.origin!==location.origin||!/^https?:$/.test(u.protocol)||u.pathname.indexOf("/api/")===0)return;
  if(u.pathname===location.pathname&&u.search===location.search)return; // same page, anchors
  e.preventDefault();go(u.href);
});
})();</script>`;
