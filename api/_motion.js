// Page motion shared by every page (injected by api/site.js with the theme code).
// Kept deliberately simple: a page just fades in softly when it opens. No curtain, no staggering.
// window.__pandoraGo(url) is kept so older callers (the Home button) still work; it just navigates.
module.exports = String.raw`<style id="pandora-motion">
body{animation:pwfade .3s ease-out}
@keyframes pwfade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){body{animation:none}}
</style><script>window.__pandoraGo=function(u,r){r?location.replace(u):(location.href=u)};</script>`;
