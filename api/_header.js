// The dashboard header look, shared by every page with the standard <header class="top"> (injected by api/site.js after the
// page chrome): flowing pink band, light sweep, floating rings, pulsing logo badge, pill buttons, springy button motion.
// The dashboard (index.html) and Refill Order carry their own copy and have no header.top, so this leaves them alone.
module.exports = String.raw`<style id="pandora-header">
@keyframes pzflow{to{background-position:100% 50%}}
@keyframes pzfloat{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(14px) rotate(25deg)}}
@keyframes pzsweep{0%,70%{left:-30%}100%{left:130%}}
@keyframes pzpulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.75),0 8px 20px rgba(176,58,79,.28)}100%{box-shadow:0 0 0 16px rgba(255,255,255,0),0 8px 20px rgba(176,58,79,.28)}}
@keyframes pzbob{50%{transform:translateY(-3px) rotate(-4deg)}}
@keyframes pztwirl{0%,100%{transform:rotate(0) scale(1)}50%{transform:rotate(180deg) scale(1.35)}}
@keyframes pzslide{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
@keyframes pzpop{from{opacity:0;transform:translateY(-14px) scale(.8)}to{opacity:1;transform:none}}
header.top.pz-hdr{position:relative;isolation:isolate;overflow:hidden;padding:18px 26px;border-radius:26px;color:#2A1018;background:linear-gradient(110deg,#FF93A0 0%,#FFA7B0 26%,#FFC0B8 50%,#FFA7B0 74%,#FF93A0 100%);background-size:240% 100%;animation:pzflow 14s ease-in-out infinite alternate;box-shadow:0 14px 34px rgba(255,147,160,.4);align-items:center}
header.top.pz-hdr::before{content:"";position:absolute;z-index:-1;right:14%;top:-52px;width:132px;height:132px;border-radius:50%;border:20px solid rgba(255,255,255,.3);animation:pzfloat 7s ease-in-out infinite}
header.top.pz-hdr::after{content:"";position:absolute;z-index:-1;top:0;bottom:0;left:-30%;width:22%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.5),transparent);transform:skewX(-20deg);animation:pzsweep 9s ease-in-out infinite}
.pz-brand{position:relative;display:flex;align-items:center;gap:14px;min-width:0;animation:pzslide .7s cubic-bezier(.2,.8,.2,1) both}
.pz-brand::after{content:"";position:absolute;z-index:-1;left:52%;bottom:-40px;width:62px;height:62px;border-radius:50%;border:10px solid rgba(255,255,255,.28);animation:pzfloat 9s ease-in-out -3s infinite}
.pz-badge{flex:0 0 auto;width:52px;height:52px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;animation:pzpulse 2.6s ease-out infinite}
.pz-mark{width:34px;height:36px;object-fit:contain;filter:brightness(0)!important;animation:pzbob 5s ease-in-out infinite}
.pz-bt{min-width:0;padding-left:14px;border-left:1px solid rgba(42,16,24,.18)}
.pz-hdr h1{color:#2A1018!important}.pz-hdr h1::after{content:"✦";display:inline-block;margin-left:9px;color:#fff;font-size:.78em;animation:pztwirl 3.4s ease-in-out infinite}
.pz-hdr .sub,.pz-hdr .crumb{color:rgba(42,16,24,.72)!important}
.pz-eyebrow{display:block;font-size:9.5px;font-weight:800;letter-spacing:.18em;color:rgba(42,16,24,.7);margin-bottom:2px}
.pz-hdr .actions{position:relative}.pz-corner{display:flex;align-items:center;gap:8px;margin-left:auto}
.pz-hdr>.pz-brand{order:0;flex:1 1 auto}.pz-hdr>.pz-corner{order:1}.pz-hdr>:not(.pz-brand):not(.pz-corner){order:2;flex:1 1 100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end}.pz-hdr .actions>a.btn{text-decoration:none}
.pz-hdr .btn,.pz-hdr .actions>button:not(.pandora-sw),.pz-hdr .actions>a{border-radius:999px!important;padding:9px 17px;font-weight:750;color:#2A1018!important;background:rgba(255,255,255,.4)!important;border:1px solid rgba(255,255,255,.75)!important;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);box-shadow:none}
.pz-hdr .btn:hover,.pz-hdr .actions>button:not(.pandora-sw):hover,.pz-hdr .actions>a:hover{background:#fff!important;transform:translateY(-3px)}
.pz-hdr .actions>*{animation:pzpop .55s cubic-bezier(.3,1.5,.5,1) both}.pz-hdr .actions>:nth-child(2){animation-delay:.1s}.pz-hdr .actions>:nth-child(3){animation-delay:.2s}.pz-hdr .actions>:nth-child(4){animation-delay:.3s}
.btn,button.secondary{transition:transform .25s cubic-bezier(.3,1.7,.5,1),box-shadow .2s,background .2s,border-color .2s}
.btn:not(:disabled):hover{transform:translateY(-2px)}.btn:not(:disabled):active{transform:scale(.95)}
@media(max-width:640px){header.top.pz-hdr{padding:14px 16px;border-radius:20px}.pz-badge{width:44px;height:44px}.pz-mark{width:28px;height:30px}}
@media (prefers-reduced-motion:reduce){.pz-hdr,.pz-hdr *,.pz-hdr::before,.pz-hdr::after,.pz-brand::after,.btn{animation:none!important;transition:none!important}}
</style><script>(function(){
  var h=document.querySelector('header.top');if(!h||h.classList.contains('pz-hdr'))return;
  var info=null;for(var i=0;i<h.children.length;i++){var c=h.children[i];if(!c.classList.contains('actions')&&c.querySelector('h1')){info=c;break}}
  if(!info)return;
  h.classList.add('pz-hdr');
  var brand=document.createElement('div');brand.className='pz-brand';
  var badge=document.createElement('span');badge.className='pz-badge';
  var img=document.createElement('img');img.src='/pandora-logo.png';img.alt='Pandora';img.className='pz-mark';badge.appendChild(img);
  h.insertBefore(brand,info);brand.appendChild(badge);brand.appendChild(info);info.classList.add('pz-bt');
  var h1=info.querySelector('h1');if(h1){var ey=document.createElement('span');ey.className='pz-eyebrow';ey.textContent='RETAIL INTELLIGENCE';h1.parentNode.insertBefore(ey,h1)}
  // Home, theme and Log out together in the right corner, like Refill Order. A header with no button bar gets one,
  // and the floating buttons move into it. The page's own "Home" link becomes the Home pill when there is none.
  var a=h.querySelector('.actions');if(!a){a=document.createElement('div');a.className='actions';h.appendChild(a)}
  a.classList.add('pz-corner');
  var fl=document.querySelectorAll('body>.pandora-fab,body>.pandora-sw.fixed');
  for(var f=0;f<fl.length;f++){var el=fl[f];el.classList.remove('pandora-fab','fixed');if(el.tagName==='BUTTON'&&!el.classList.contains('pandora-sw'))el.classList.add('btn');a.appendChild(el)}
  var home=false;for(var k=0;k<a.children.length;k++)if(a.children[k].textContent.trim()==='Home')home=true;
  var cr=info.querySelector('a.crumb[href="/"]');
  if(cr){if(home)cr.style.display='none';else{cr.textContent='Home';cr.className='btn';a.insertBefore(cr,a.firstChild)}}
})();</script>`;
