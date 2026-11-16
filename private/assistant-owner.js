/* Owner-only extension of the chat. It is only ever sent to the owner's logged-in browser (api/site.js), and everything it calls
   is checked again on the server (api/_askclaude.js), so hiding is never the only lock. It lives beside the chat and changes nothing in it. */
(function () {
  'use strict';
  if (window.__pzOwnerOn) return; window.__pzOwnerOn = 1;
  var API = '/api/vm?askclaude=1', RUNS = [11, 15, 20]; // the hours (Cairo) the scheduled task looks at the inbox
  var MODE_KEY = 'pz-ac-mode', SHOWN_KEY = 'pz-ac-told';
  function start(tries) {
    var host = document.getElementById('pandora-assistant'), root = host && host.shadowRoot;
    var ft = root && root.querySelector('.ft');
    if (!ft) { if (tries < 40) setTimeout(function () { start(tries + 1); }, 250); return; }
    var LOG = root.querySelector('.log'), TA = root.querySelector('textarea'), SEND = root.querySelector('.send'), FAB = root.querySelector('.fab'), BUB = root.querySelector('.bub'), WIN = root.querySelector('.win'), W = root.querySelector('.w');
    var on = false, items = [], timer = 0;
    try { on = sessionStorage.getItem(MODE_KEY) === '1'; } catch (e) {}

    var st = document.createElement('style');
    st.textContent =
      '.acm{display:flex;gap:6px;padding:0 0 8px}.acm button{border:1px solid var(--line);background:var(--surface);color:var(--muted);font:inherit;font-size:12px;font-weight:750;border-radius:99px;padding:5px 12px;cursor:pointer}' +
      '.acm button.on{background:var(--soft);color:var(--text);border-color:var(--pink)}.acm button:focus-visible{outline:2px solid var(--pinkd);outline-offset:2px}' +
      '.acm i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--pink);margin-inline-start:6px;vertical-align:1px}' +
      '#ac-log{flex:1;overflow:auto;padding:14px;display:none;flex-direction:column;gap:10px}.w.ac #ac-log{display:flex}.w.ac .log{display:none}' +
      '.ac-me{align-self:flex-end;background:var(--ink);color:#fff;border-radius:16px 16px 4px 16px;padding:8px 12px;max-width:88%;white-space:pre-wrap;word-break:break-word}.w.dark .ac-me{color:#1c1412}' +
      '.ac-st{align-self:flex-start;background:var(--soft);border-radius:14px;padding:8px 12px;font-size:12.5px;font-weight:650;max-width:92%}' +
      '.ac-ai{align-self:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:16px 16px 16px 4px;padding:10px 12px;max-width:96%}' +
      '.ac-ai h4{margin:0 0 4px;font-size:14px}.ac-ai p{margin:0 0 7px;white-space:pre-wrap;word-break:break-word}.ac-ai small{color:var(--muted);font-size:11.5px}' +
      '.ac-bar{display:grid;grid-template-columns:minmax(70px,34%) 1fr auto;gap:8px;align-items:center;font-size:12.5px;margin:3px 0}.ac-bar span.t{height:9px;background:var(--bar);border-radius:9px;overflow:hidden}.ac-bar span.t i{display:block;height:100%;background:var(--pink);border-radius:9px}.ac-bar b{font-variant-numeric:tabular-nums}' +
      '.ac-tb{width:100%;border-collapse:collapse;font-size:12.5px;margin:6px 0}.ac-tb th,.ac-tb td{padding:5px 6px;border-bottom:1px solid var(--line);text-align:start}.ac-tb th{color:var(--muted);font-size:11px;text-transform:uppercase}' +
      '.ac-hello{color:var(--muted);font-size:13px;padding:6px 2px}' +
      '.fab .acdot{position:absolute;top:6px;right:8px;width:13px;height:13px;border-radius:50%;background:#17805a;border:2px solid var(--surface);display:none}.fab.acn .acdot{display:block}';
    root.appendChild(st);

    var mode = document.createElement('div'); mode.className = 'acm';
    mode.innerHTML = '<button type="button" data-m="0">Instant</button><button type="button" data-m="1">Ask Claude<i hidden></i></button>';
    ft.insertBefore(mode, ft.firstChild);
    var pane = document.createElement('div'); pane.id = 'ac-log'; pane.setAttribute('aria-live', 'polite'); LOG.parentNode.insertBefore(pane, LOG.nextSibling);
    var dot = document.createElement('span'); dot.className = 'acdot'; FAB.appendChild(dot);
    var phOld = TA.placeholder;

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function nextRun() {
      var now = new Date(), parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false }).formatToParts(now), h = +parts.filter(function (p) { return p.type === 'hour'; })[0].value % 24;
      var n = RUNS.filter(function (x) { return x > h; })[0];
      return n == null ? 'tomorrow around ' + RUNS[0] + ':00' : 'around ' + n + ':00';
    }
    function answer(a) {
      var box = el('div', 'ac-ai');
      if (a.title) box.appendChild(el('h4', '', a.title));
      String(a.text || '').split(/\n{2,}/).forEach(function (p) { if (p.trim()) box.appendChild(el('p', '', p.trim())); });
      if (a.bars && a.bars.length) {
        var mx = Math.max.apply(null, a.bars.map(function (b) { return Math.abs(b.value); }).concat(1));
        a.bars.forEach(function (b) { var r = el('div', 'ac-bar'); r.appendChild(el('span', '', b.label)); var t = el('span', 't'), f = el('i'); f.style.width = Math.max(2, Math.abs(b.value) / mx * 100).toFixed(1) + '%'; t.appendChild(f); r.appendChild(t); r.appendChild(el('b', '', b.show || String(b.value))); box.appendChild(r); });
      }
      if (a.table && a.table.rows && a.table.rows.length) {
        var tb = el('table', 'ac-tb'), tr;
        if (a.table.head && a.table.head.length) { tr = el('tr'); a.table.head.forEach(function (h) { tr.appendChild(el('th', '', h)); }); tb.appendChild(tr); }
        a.table.rows.forEach(function (r) { tr = el('tr'); r.forEach(function (c) { tr.appendChild(el('td', '', c)); }); tb.appendChild(tr); });
        box.appendChild(tb);
      }
      box.appendChild(el('small', '', 'Answered by Claude' + (a.at ? ' · ' + new Date(a.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')));
      return box;
    }
    function draw() {
      pane.textContent = '';
      if (!items.length) pane.appendChild(el('div', 'ac-hello', 'Ask Claude for deeper work: analysis, a plan, a written briefing. It is answered at set times (about ' + RUNS.join(', ') + ' Cairo), not instantly. For quick figures use Instant.'));
      items.slice().reverse().forEach(function (it) {
        pane.appendChild(el('div', 'ac-me', it.q));
        if (it.status === 'done' && it.ans) pane.appendChild(answer(it.ans));
        else pane.appendChild(el('div', 'ac-st', 'Saved. Claude will answer ' + nextRun() + ' (Cairo time).'));
      });
      pane.scrollTop = pane.scrollHeight;
      var unseen = items.filter(function (i) { return i.status === 'done' && !i.seen; }).length;
      mode.querySelector('i').hidden = !unseen; FAB.classList.toggle('acn', !!unseen && !(W.classList.contains('open') && on));
    }
    function call(method, url, body) {
      return fetch(url || API, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
    }
    function load() {
      return call('GET').then(function (j) {
        if (!j.ok) return;
        items = j.items || []; draw(); tell(); markSeen();
        clearTimeout(timer); if (!document.hidden) timer = setTimeout(load, items.some(function (i) { return i.status === 'waiting'; }) ? 60000 : 300000);
      }).catch(function () { timer = setTimeout(load, 300000); });
    }
    function tell() { // the mascot says so once per answer
      var told = []; try { told = JSON.parse(sessionStorage.getItem(SHOWN_KEY) || '[]'); } catch (e) {}
      var n = items.filter(function (i) { return i.status === 'done' && !i.seen && told.indexOf(i.id) < 0; });
      if (!n.length || (W.classList.contains('open') && on)) return;
      n.forEach(function (i) { told.push(i.id); }); try { sessionStorage.setItem(SHOWN_KEY, JSON.stringify(told.slice(-40))); } catch (e) {}
      if (BUB) { BUB.textContent = 'Claude replied'; BUB.classList.add('on'); setTimeout(function () { BUB.classList.remove('on'); }, 6000); }
    }
    function markSeen() {
      if (!on || !W.classList.contains('open') || !items.some(function (i) { return i.status === 'done' && !i.seen; })) return;
      call('GET', API + '&seen=1').then(function () { items.forEach(function (i) { if (i.status === 'done') i.seen = true; }); draw(); });
    }
    function setMode(v) {
      on = !!v; try { sessionStorage.setItem(MODE_KEY, on ? '1' : '0'); } catch (e) {}
      W.classList.toggle('ac', on);
      Array.prototype.forEach.call(mode.querySelectorAll('button'), function (b) { b.classList.toggle('on', (b.dataset.m === '1') === on); b.setAttribute('aria-pressed', (b.dataset.m === '1') === on ? 'true' : 'false'); });
      TA.placeholder = on ? 'Ask Claude something deeper' : phOld;
      if (on) { load(); markSeen(); }
    }
    mode.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('button'); if (b) setMode(b.dataset.m === '1'); });

    function submit() {
      var q = TA.value.trim(); if (!q) return;
      SEND.disabled = true;
      call('POST', API, { q: q }).then(function (j) {
        if (j.ok) { TA.value = ''; TA.dispatchEvent(new Event('input')); return load(); }
        pane.appendChild(el('div', 'ac-st', j.error || 'Could not save that. Try again.')); pane.scrollTop = pane.scrollHeight;
      }).catch(function () { pane.appendChild(el('div', 'ac-st', 'No connection. Try again.')); })
        .then(function () { SEND.disabled = !TA.value.trim(); });
    }
    // in Ask Claude mode the send button and Enter save the request instead of running the instant answer
    ft.addEventListener('click', function (e) { if (on && e.target.closest && e.target.closest('.send')) { e.stopPropagation(); e.preventDefault(); submit(); } }, true);
    ft.addEventListener('keydown', function (e) { if (on && e.target === TA && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.stopPropagation(); e.preventDefault(); submit(); } }, true);
    FAB.addEventListener('click', function () { setTimeout(markSeen, 400); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });

    setMode(on); load();
  }
  start(0);
})();
