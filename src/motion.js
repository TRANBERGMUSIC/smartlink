/* SmartLink · bevægelse (GSAP, lokal kopi i vendor/). Én signatur + rolig koreografi:
 *  - opstart: ordmærket løfter sig bogstav for bogstav, strålen under toppen tændes, panelerne kommer ind i læseretning
 *  - faneskift: en 1px mint linje glider op/ned langs skinnens kant; titlen i toppen "dekrypteres" (react-bits DecryptedText);
 *  - klik-gnister på pads, taster og mønsterfelter (react-bits ClickSpark);
 *  - den nye sides paneler kommer ind med 50 ms forskydning (én gang pr. skift)
 *  - tilstand: <body> får laser-on / laser-off, så strålen scanner når laseren er tændt
 *  - skydere: fyldet op til tommelfingeren følger værdien
 * Respekterer "reducér bevægelse" (gsap.matchMedia). Kun transform/opacity animeres.
 */
'use strict';
(() => {
  const G = window.gsap; if (!G) return;
  const mm = G.matchMedia(); let reduce = false;
  mm.add('(prefers-reduced-motion: reduce)', () => { reduce = true; return () => { reduce = false; }; });
  const EXPO = 'expo.out', OUT = 'power3.out';

  // ---- strålen + laser-tilstand på <body> ----
  const top = document.querySelector('.topbar'); if (top && !top.querySelector('.beam')) { const b = document.createElement('div'); b.className = 'beam'; b.innerHTML = '<i></i>'; top.appendChild(b); }
  const bo = document.getElementById('blackout');
  const syncLaser = () => { const on = !!(bo && bo.classList.contains('armed')); document.body.classList.toggle('laser-on', on); document.body.classList.toggle('laser-off', !on); };
  let wasOn = !!(bo && bo.classList.contains('armed'));
  const onLaserChange = () => { syncLaser(); if (typeof railStatus === 'function') setTimeout(railStatus); const on = !!(bo && bo.classList.contains('armed')); if (on !== wasOn) { wasOn = on; if (on) sweep(); } };
  if (bo) new MutationObserver(onLaserChange).observe(bo, { attributes: true, attributeFilter: ['class'] }); syncLaser();
  // laseren tændes: én scanlinje løber ned over LIVE-billedet (bekræfter handlingen dér hvor man kigger)
  function sweep() {
    const panel = document.getElementById('previewPanel'); if (!panel || reduce || !panel.offsetParent) return;
    let ln = panel.querySelector('.pv-sweep'); if (!ln) { ln = document.createElement('i'); ln.className = 'pv-sweep'; panel.appendChild(ln); }
    G.fromTo(ln, { y: 0, autoAlpha: 1 }, { y: panel.clientHeight, duration: 0.9, ease: 'power2.inOut', onComplete: () => G.to(ln, { autoAlpha: 0, duration: 0.2 }) });
  }

  // ---- sidebarens enheder (udseende "Apple"): status læses fra de eksisterende indikatorer – intet nyt gættes ----
  const rd = (id) => document.getElementById(id);
  const railStatus = () => {
    const tt = (k) => (typeof t === 'function' ? t(k) : k), led = rd('connLed'), conn = !!(led && led.classList.contains('ok')), on = document.body.classList.contains('laser-on');
    const L = rd('rdLaser'); if (L) { L.querySelector('.dot').className = 'dot' + (on ? ' on' : conn ? ' ok' : led && led.classList.contains('bad') ? ' bad' : ''); L.querySelector('small').textContent = !conn ? tt('rail.noConn') : on ? tt('rail.on') : tt('rail.off'); }
    const wc = rd('wmidiConn'), W = rd('rdWolf'); if (W) { const ok = !!(wc && wc.classList.contains('ok')); W.querySelector('.dot').className = 'dot' + (ok ? ' ok' : ''); W.querySelector('small').textContent = ok ? 'MIDI · ' + (wc.title.split('\n')[0] || '') : tt('rail.midiOff'); }
    const S = rd('rdSync'), ct = rd('connTxt'); if (S) { S.querySelector('.dot').className = 'dot' + (conn ? ' ok' : ''); S.querySelector('span').textContent = (ct && ct.textContent.trim()) || '—'; }
  };
  setInterval(railStatus, 1000); railStatus();

  // ---- fane-indikator ----
  const tabs = document.querySelector('.tabs'); let ind = null;
  if (tabs) { ind = document.createElement('span'); ind.className = 'tab-ind'; tabs.appendChild(ind); }
  // skinnen er lodret: linjen sidder på skinnens højre kant, lige så høj som den valgte knap
  const moveInd = (instant) => { const a = tabs && tabs.querySelector('.tab.active'); if (!a || !ind) return; const y = a.offsetTop, h = a.offsetHeight; if (instant || reduce) G.set(ind, { y, height: h }); else G.to(ind, { y, height: h, duration: 0.42, ease: EXPO }); setTitle(a, instant); };

  // ---- sidens titel i toppen (react-bits DecryptedText, porteret): bogstaverne falder på plads fra venstre ----
  const CTX = { live: 'DS-3000RGB MK5 · ShowNET Pro · Art-Net 0', wolf: 'Wolfmix W1 MK3 · MIDI', ape: 'Ape Labs Neon Tube PIX · 6 rør · DMX B' };
  const ttl = document.getElementById('pageTitle'), ctx = document.getElementById('pageCtx'); let ttlRun = 0;
  function setTitle(tab, instant) {
    if (!ttl || !tab) return; const label = (tab.querySelector('span') || tab).textContent.trim(); if (ctx) ctx.textContent = CTX[tab.dataset.tab] || '';
    if (ttl.dataset.v === label) return; ttl.dataset.v = label; const run = ++ttlRun;
    if (instant || reduce) { ttl.textContent = label; return; }
    const AB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789', t0 = performance.now(), dur = 340;
    const step = (now) => { if (run !== ttlRun) return; const k = Math.min(1, (now - t0) / dur), n = Math.floor(k * label.length);
      ttl.textContent = label.slice(0, n) + [...label.slice(n)].map((c) => (c === ' ' ? ' ' : AB[(Math.random() * AB.length) | 0])).join('');
      if (k < 1) requestAnimationFrame(step); else ttl.textContent = label; };
    requestAnimationFrame(step);
  }
  // sproget kan skifte: titlen følges med
  if (tabs) new MutationObserver(() => { const a = tabs.querySelector('.tab.active'); if (a && ttl && ttl.dataset.v !== (a.querySelector('span') || a).textContent.trim()) setTitle(a, true); }).observe(tabs, { subtree: true, characterData: true, childList: true });

  // ---- klik-gnister (react-bits ClickSpark, porteret): kort feedback på de knapper man spiller på ----
  const sparkCv = document.createElement('canvas'); sparkCv.className = 'spark-layer'; document.body.appendChild(sparkCv);
  const sg = sparkCv.getContext('2d'); let sparks = [], sparkOn = false;
  const sizeSpark = () => { const d = devicePixelRatio || 1; sparkCv.width = innerWidth * d; sparkCv.height = innerHeight * d; sg.setTransform(d, 0, 0, d, 0, 0); }; sizeSpark(); window.addEventListener('resize', sizeSpark);
  const sparkLoop = (now) => { sg.clearRect(0, 0, innerWidth, innerHeight); sparks = sparks.filter((s) => now - s.t < 420);
    for (const s of sparks) { const k = (now - s.t) / 420, e = 1 - Math.pow(1 - k, 3), r0 = s.r + 22 * e, len = 9 * (1 - k); sg.strokeStyle = s.c; sg.globalAlpha = 1 - k; sg.lineWidth = 1.6; sg.lineCap = 'round';
      for (let i = 0; i < 8; i++) { const a = s.a + (i / 8) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a); sg.beginPath(); sg.moveTo(s.x + cs * r0, s.y + sn * r0); sg.lineTo(s.x + cs * (r0 + len), s.y + sn * (r0 + len)); sg.stroke(); } }
    sg.globalAlpha = 1; if (sparks.length) requestAnimationFrame(sparkLoop); else { sparkOn = false; sg.clearRect(0, 0, innerWidth, innerHeight); } };
  document.addEventListener('pointerdown', (e) => {
    if (reduce || e.button !== 0) return; const el = e.target.closest && e.target.closest('.wc-pad, .wc-btn, .ape-cbtn, .ape-pbtn, .ape-sbtn, .key, .pat, .blackout, .rail .tab'); if (!el) return;
    const cs = getComputedStyle(el), pc = cs.getPropertyValue('--pc').trim(); const c = pc || (el.classList.contains('blackout') && el.classList.contains('armed') ? '#ff4d5e' : '#31f3ac');
    sparks.push({ x: e.clientX, y: e.clientY, t: performance.now(), c, r: 4, a: Math.random() * 0.8 }); if (!sparkOn) { sparkOn = true; requestAnimationFrame(sparkLoop); }
  }, true);

  // ---- sidens paneler kommer ind i læseretning ----
  const enter = (page) => {
    if (!page || reduce) return;
    const items = [...page.querySelectorAll(':scope > *, :scope > .col > *')].filter((el) => el.offsetParent && !el.classList.contains('col'));
    if (!items.length) return;
    G.killTweensOf(items);
    G.fromTo(items, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, ease: EXPO, stagger: { each: 0.05, from: 'start' }, clearProps: 'transform,opacity,visibility' });
    const cells = [...page.querySelectorAll('.wc-pad, .ape-cbtn, .key.set, .pat')].filter((el) => el.offsetParent).slice(0, 80);
    if (cells.length) G.fromTo(cells, { scale: 0.86, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: EXPO, delay: 0.12, stagger: { each: 0.012, grid: 'auto', from: 'center' }, clearProps: 'transform,opacity,visibility' });
  };
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { requestAnimationFrame(() => { moveInd(); enter(document.querySelector('.page.active')); }); }));
  window.addEventListener('resize', () => moveInd(true));
  if (tabs) new MutationObserver(() => moveInd()).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] }); // også når koden selv skifter side

  // ---- ordmærket ----
  const wm = document.querySelector('.wordmark');
  const splitWordmark = () => { // "Smart<b>Link</b>" → bogstaver i spans, uden at ændre teksten
    if (!wm || wm.dataset.split) return []; wm.dataset.split = '1'; const chars = [];
    const walk = (node) => { for (const n of [...node.childNodes]) { if (n.nodeType === 3) { const frag = document.createDocumentFragment(); for (const c of n.textContent) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = c; frag.appendChild(s); chars.push(s); } n.replaceWith(frag); } else walk(n); } };
    walk(wm); return chars;
  };

  // ---- skydere: fyld op til værdien ----
  const fill = (r) => { const min = +r.min || 0, max = +r.max || 100, v = +r.value; r.style.setProperty('--p', ((v - min) / ((max - min) || 1) * 100) + '%'); };
  const fillAll = (root = document) => root.querySelectorAll('input[type=range]').forEach(fill);
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('input[type=range]')) fill(e.target); }, true);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('input[type=range]')) fill(n); else if (n.querySelector) fillAll(n); } }).observe(document.body, { childList: true, subtree: true });
  setInterval(() => fillAll(document.querySelector('.page.active') || document), 400); // værdier sat fra kode (MIDI, telefon, auto) opdateres også

  // ---- dialoger skalerer ind ----
  const pop = (box) => { if (!reduce && box) G.fromTo(box, { y: 10, scale: 0.97, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.32, ease: OUT, clearProps: 'transform,opacity,visibility' }); };
  const watchHidden = (el, boxSel) => { if (!el) return; new MutationObserver(() => { if (!el.hidden) pop(el.querySelector(boxSel)); }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); };
  watchHidden(document.getElementById('modal'), '.modal-box'); watchHidden(document.getElementById('armModal'), '.modal-box, .arm-box');
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.id === 'apeDlg') watchHidden(n, '.ape-dlg-box'); }).observe(document.body, { childList: true });

  // ---- opstart (≤ 1,2 s) ----
  const intro = () => {
    fillAll(); moveInd(true);
    if (reduce) return;
    const chars = splitWordmark(), tl = G.timeline({ defaults: { ease: EXPO } });
    if (chars.length) tl.from(chars, { yPercent: 110, autoAlpha: 0, duration: 0.7, stagger: 0.03 }, 0);
    const logo = document.querySelector('.logo'); if (logo) tl.from(logo, { rotate: -90, scale: 0.6, autoAlpha: 0, duration: 0.8 }, 0);
    tl.from('.rail .tab', { x: -10, autoAlpha: 0, duration: 0.5, stagger: 0.035, clearProps: 'transform,opacity,visibility' }, 0.15);
    tl.from('.topright > *', { y: -8, autoAlpha: 0, duration: 0.5, stagger: 0.05, clearProps: 'transform,opacity,visibility' }, 0.2);
    tl.from('.ttl', { x: -8, autoAlpha: 0, duration: 0.6, clearProps: 'transform,opacity,visibility' }, 0.3);
    tl.fromTo('.beam', { scaleX: 0, transformOrigin: '0 50%' }, { scaleX: 1, duration: 1.0, ease: 'power2.inOut' }, 0.1);
    tl.add(() => enter(document.querySelector('.page.active')), 0.25);
  };
  if (document.readyState === 'complete') requestAnimationFrame(intro); else window.addEventListener('load', () => requestAnimationFrame(intro));
  document.fonts && document.fonts.ready.then(() => moveInd(true));
})();
