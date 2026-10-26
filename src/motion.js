/* SmartLink · bevægelse (GSAP, lokal kopi i vendor/). Én signatur + rolig koreografi:
 *  - opstart: ordmærket løfter sig bogstav for bogstav, strålen under toppen tændes, panelerne kommer ind i læseretning
 *  - faneskift: en mint linje glider hen under den aktive fane; den nye sides paneler kommer ind med 50 ms forskydning (én gang pr. skift)
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
  const onLaserChange = () => { syncLaser(); const on = !!(bo && bo.classList.contains('armed')); if (on !== wasOn) { wasOn = on; if (on) sweep(); } };
  if (bo) new MutationObserver(onLaserChange).observe(bo, { attributes: true, attributeFilter: ['class'] }); syncLaser();
  // laseren tændes: én scanlinje løber ned over LIVE-billedet (bekræfter handlingen dér hvor man kigger)
  function sweep() {
    const panel = document.getElementById('previewPanel'); if (!panel || reduce || !panel.offsetParent) return;
    let ln = panel.querySelector('.pv-sweep'); if (!ln) { ln = document.createElement('i'); ln.className = 'pv-sweep'; panel.appendChild(ln); }
    G.fromTo(ln, { y: 0, autoAlpha: 1 }, { y: panel.clientHeight, duration: 0.9, ease: 'power2.inOut', onComplete: () => G.to(ln, { autoAlpha: 0, duration: 0.2 }) });
  }

  // ---- fane-indikator ----
  const tabs = document.querySelector('.tabs'); let ind = null;
  if (tabs) { ind = document.createElement('span'); ind.className = 'tab-ind'; tabs.appendChild(ind); }
  const moveInd = (instant) => { const a = tabs && tabs.querySelector('.tab.active'); if (!a || !ind) return; const x = a.offsetLeft + 10, w = a.offsetWidth - 20; if (instant || reduce) G.set(ind, { x, width: w }); else G.to(ind, { x, width: w, duration: 0.42, ease: EXPO }); };

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
    tl.from('.tabs .tab', { y: -8, autoAlpha: 0, duration: 0.5, stagger: 0.035, clearProps: 'transform,opacity,visibility' }, 0.15);
    tl.from('.topright > *', { y: -8, autoAlpha: 0, duration: 0.5, stagger: 0.05, clearProps: 'transform,opacity,visibility' }, 0.2);
    tl.fromTo('.beam', { scaleX: 0, transformOrigin: '0 50%' }, { scaleX: 1, duration: 1.0, ease: 'power2.inOut' }, 0.1);
    tl.add(() => enter(document.querySelector('.page.active')), 0.25);
  };
  if (document.readyState === 'complete') requestAnimationFrame(intro); else window.addEventListener('load', () => requestAnimationFrame(intro));
  document.fonts && document.fonts.ready.then(() => moveInd(true));
})();
