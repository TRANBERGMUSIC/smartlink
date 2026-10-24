/* SmartLink – Wolfmix-konsollen: en tegning af pulten (uden branding). Klik på en knap i appen → tryk på samme knap på pulten → de er forbundet.
 * Når et signal kommer ind, lyser den forbundne knap i appen. Bygger på wolfpage.js (wmiState, WMI, wmiOptions) og actions.js.
 * Gemmes i wmiState.layout = { kontrol: signal-id }. Pads er pr. preset-side (10 sider à 20): "p3.pad5" = side 3, pad 5 (preset 45).
 */
'use strict';
// farver som på pulten: [id, tekst, farve top, farve bund, 'mode' = lyser svagt som på pulten (SHIFT/PRESET)]
const WC_LEFT = [['home', 'HOME', '#f4f5f7', '#9aa0aa'], ['colorfx', 'COLOR FX', '#79e6ff', '#4d7bff'], ['movefx', 'MOVE FX', '#d4ff70', '#33cf78'], ['beamfx', 'BEAM FX', '#ff93e8', '#9466ff'], ['|static'], ['color', 'COLOR', '#94d4ff', '#4a86ff'], ['position', 'POSITION', '#ddff6e', '#4fcf68'], ['gobo', 'GOBO', '#ffa196', '#ff4d6a'], ['liveedit', 'LIVE EDIT', '#ffb86e', '#ff473b'], ['|/static'], ['shift', 'SHIFT', '#d2c6ff', '#9b8bff', 'mode']];
const WC_RIGHT = [['bpmtap', 'BPM TAP', '#ffffff', '#a9afba'], ['groups', 'GROUPS', '#6e8bff', '#2c49ff'], ['strobe', 'STROBE', '#ffffff', '#a9afba'], ['blinder', 'BLINDER', '#ffffff', '#a9afba'], ['speed', 'SPEED', '#ffffff', '#a9afba'], ['blackout', 'BLACKOUT', '#d3dbff', '#6a82ff'], ['smoke', 'SMOKE', '#ffffff', '#a9afba'], ['preset', 'PRESET', '#ffbaa3', '#ff6b57', 'mode']];
const WC_PAGES = 10, WC_PADS = 20;
const WC = { sel: null, listen: false, els: {}, timers: {}, page: 1, msg: null, litKeys: new Set() };
const wcLayout = () => (wmiState.layout = wmiState.layout || {});
const wcKey = (domId) => (/^pad\d+$/.test(domId) ? `p${WC.page}.${domId}` : domId); // knap i tegningen → logisk kontrol
const wcPadOf = (key) => { const m = /^p(\d+)\.pad(\d+)$/.exec(key); return m ? { page: +m[1], n: +m[2] } : null; };
const wcPresetNo = (page, n) => (page - 1) * WC_PADS + n;
function wcLabel(key) {
  const f = [...WC_LEFT, ...WC_RIGHT].find((c) => c[0] === key); if (f) return f[1];
  if (/^enc/.test(key)) return t('wc.enc', { n: key.slice(3) });
  const p = wcPadOf(key); if (p) return t('wc.preset', { n: wcPresetNo(p.page, p.n), p: p.page });
  return key;
}
const wcControlsFor = (sigId) => Object.entries(wcLayout()).filter(([, s]) => s === sigId).map(([c]) => c);
function wcFuncText(sigId) { // kort tekst: hvad gør signalet
  const b = sigId && wmiState.bindings[sigId]; if (!b) return '';
  return ['onPress', 'onChange', 'onRelease'].map((k) => b[k] && SL_ACTIONS.byId[b[k]] ? SL_ACTIONS.label(SL_ACTIONS.byId[b[k]]) : '').filter(Boolean).join(' · ');
}
function wcMigrate() { // før 5.4: pads hed "pad1" (= side 1)
  const L = wcLayout(); for (const k of Object.keys(L)) if (/^pad\d+$/.test(k)) { L['p1.' + k] = L['p1.' + k] || L[k]; delete L[k]; }
  WC.page = clamp(wmiState.wcPage | 0 || 1, 1, WC_PAGES);
}

// ---------- tegning ----------
function wcBuild() {
  const root = $('#wc'); if (!root) return; WC.els = {};
  const btn = (id, label, color, cls, color2) => { const b = document.createElement('button'); b.className = 'wc-btn ' + (cls || ''); b.dataset.c = id; b.style.setProperty('--c', color || '#dfe4ee'); b.style.setProperty('--c2', color2 || color || '#dfe4ee'); b.innerHTML = `<span class="wc-lbl">${label}</span><span class="wc-fn"></span>`; b.onclick = () => wcSelect(wcKey(id)); WC.els[id] = b; return b; };
  const col = (list, el) => { el.innerHTML = ''; let grp = null; for (const c of list) { if (c[0] === '|static') { grp = document.createElement('div'); grp.className = 'wc-static'; grp.innerHTML = '<span class="wc-static-lbl">STATIC</span>'; el.appendChild(grp); continue; } if (c[0] === '|/static') { grp = null; continue; } (grp || el).appendChild(btn(c[0], c[1], c[2], 'wc-side' + (c[0] === 'groups' ? ' wc-groups' : '') + (c[4] === 'mode' ? ' wc-mode' : ''), c[3])); } };
  col(WC_LEFT, $('#wcLeft')); col(WC_RIGHT, $('#wcRight'));
  const encs = $('#wcEncs'); encs.innerHTML = '';
  for (let i = 1; i <= 4; i++) { const b = btn('enc' + i, '', '#31f3ac', 'wc-enc'); b.insertAdjacentHTML('afterbegin', '<span class="wc-knob"><i></i></span>'); encs.appendChild(b); }
  const pads = $('#wcPads'); pads.innerHTML = '';
  for (let i = 1; i <= WC_PADS; i++) pads.appendChild(btn('pad' + i, String(i), '#ff9a3c', 'wc-pad'));
  wcRefresh();
}
function wcRefresh() { // mærkater + tilstand for alle knapper (pads for den viste side)
  const L = wcLayout();
  for (const [dom, el] of Object.entries(WC.els)) {
    const key = wcKey(dom), sig = L[key], s = sig && wmiState.signals[sig], pad = wcPadOf(key);
    if (pad) el.querySelector('.wc-lbl').textContent = wcPresetNo(pad.page, pad.n);
    el.classList.toggle('linked', !!sig); el.classList.toggle('sel', WC.sel === key); el.classList.toggle('listening', WC.sel === key && WC.listen);
    el.classList.toggle('lit', WC.litKeys.has(key));
    el.querySelector('.wc-fn').textContent = sig ? ((s && s.name) || wcFuncText(sig) || sig) : '';
    el.title = sig ? `${wcLabel(key)} → ${sig}${s && s.name ? ' (' + s.name + ')' : ''}\n${wcFuncText(sig) || t('wc.noFunc')}` : t('wc.clickToLink');
  }
  wcScreen(); wcInspector();
}
function wcSetPage(p) { WC.page = clamp(p, 1, WC_PAGES); wmiState.wcPage = WC.page; wmiSave(); wcRefresh(); }
// skærmen: preset-gitter for siden (som på pulten) + linje med det seneste signal / lær-besked + side-skift
function wcScreen() {
  const el = $('#wcScreen'); if (!el) return; const L = wcLayout();
  let msg;
  if (WC.listen && WC.sel) msg = `<span class="wc-scr-blink">${t('wc.pressNow')}</span> <span class="muted">${escHtml(wcLabel(WC.sel))} · Esc</span>`;
  else if (WC.msg) { const ev = WC.msg, s = wmiState.signals[ev.id]; msg = `<b>${escHtml((s && s.name) || ev.id)}</b> <span class="muted">${ev.id}</span> → <span class="wc-scr-fn">${escHtml(wcFuncText(ev.id) || (wcControlsFor(ev.id).length ? t('wc.noFunc') : t('wc.unlinked')))}</span>`; }
  else msg = `<span class="muted">${t('wc.linkedN', { n: Object.keys(L).length })}</span>`;
  let cells = '';
  for (let n = 1; n <= WC_PADS; n++) {
    const key = `p${WC.page}.pad${n}`, sig = L[key], s = sig && wmiState.signals[sig];
    cells += `<button class="wc-cell${sig ? ' linked' : ''}${WC.litKeys.has(key) ? ' lit' : ''}${WC.sel === key ? ' sel' : ''}" data-k="${key}" style="--h:${(n - 1) % 4}">${escHtml((s && s.name) || t('wc.presetShort', { n: wcPresetNo(WC.page, n) }))}</button>`;
  }
  el.innerHTML = `<div class="wc-scr-top"><b>PRESET</b><span class="wc-scr-msg">${msg}</span></div><div class="wc-scr-grid">${cells}</div>
    <div class="wc-scr-bot"><span>${t('wc.hint')}</span><span class="wc-pg"><button data-pg="-1">◀</button><b>PAGE</b> <span class="wc-pgn">${WC.page} / ${WC_PAGES}</span><button data-pg="1">▶</button></span></div>`;
  el.querySelectorAll('[data-pg]').forEach((b) => { b.onclick = () => wcSetPage(WC.page + +b.dataset.pg); });
  el.querySelectorAll('.wc-cell').forEach((b) => { b.onclick = () => wcSelect(b.dataset.k); });
}
function wcInspector() {
  const box = $('#wcInsp'); if (!box) return;
  if (!WC.sel) { box.innerHTML = `<h3>${t('wc.inspTitle')}</h3><p class="hint">${t('wc.inspHint')}</p><p class="hint">${t('wc.holdHint')}</p>`; return; }
  const id = WC.sel, sig = wcLayout()[id], s = sig && wmiState.signals[sig], b = (sig && wmiState.bindings[sig]) || {}, isCc = s && s.type === 'cc';
  const seen = Object.entries(wmiState.signals).sort(([a], [c]) => a.localeCompare(c, undefined, { numeric: true }));
  box.innerHTML = `<h3>${escHtml(wcLabel(id))}</h3>
    <div class="wc-i-row"><span class="muted">${t('wc.signal')}</span><b class="mono">${sig || '—'}</b></div>
    ${WC.listen ? `<p class="wc-listen">${t('wc.pressNow')}</p>` : ''}
    <div class="wc-i-btns"><button class="primary small" data-a="listen">${WC.listen ? t('wc.cancel') : sig ? t('wc.relink') : t('wc.link')}</button>${sig ? `<button class="ghost small" data-a="unlink">${t('wc.unlink')}</button><button class="ghost small" data-a="test">▶ ${t('wc.test')}</button>` : ''}</div>
    <label class="wc-i-row"><span class="muted">${t('wc.pick')}</span><select data-a="pick"><option value="">—</option>${seen.map(([sid, x]) => `<option value="${sid}">${escHtml(x.name ? x.name + ' · ' + sid : sid)}</option>`).join('')}</select></label>
    ${sig ? `<label class="wc-i-row"><span class="muted">${t('wmidi.thName')}</span><input data-a="name" placeholder="${t('wmidi.namePh')}"></label>
    <label class="wc-i-row"><span class="muted">${t('wmidi.thPress')}</span><select data-slot="onPress">${WMI.optsT || wmiOptions('trigger')}</select></label>
    <label class="wc-i-row"><span class="muted">${t('wmidi.thRelease')}</span><select data-slot="onRelease">${WMI.optsT || wmiOptions('trigger')}</select></label>
    ${isCc ? `<label class="wc-i-row"><span class="muted">${t('wmidi.thChange')}</span><select data-slot="onChange">${WMI.optsC || wmiOptions('continuous')}</select></label>
    <label class="wc-i-row"><span class="muted">${t('wmidi.thr')}</span><input type="number" data-a="thr" min="0" max="127" class="vec-num"></label>` : ''}
    ${b.onPress && SL_ACTIONS.byId[b.onPress] && SL_ACTIONS.byId[b.onPress].kind === 'hold' ? `<p class="hint">${t('wc.holdNote')}</p>` : ''}` : ''}`;
  box.querySelector('[data-a=listen]').onclick = () => { WC.listen = !WC.listen; wcRefresh(); };
  const ul = box.querySelector('[data-a=unlink]'); if (ul) ul.onclick = () => { delete wcLayout()[id]; wmiSave(true); WC.listen = false; wcRefresh(); };
  const ts = box.querySelector('[data-a=test]'); if (ts) ts.onclick = () => wcTest(id, b, s);
  const pk = box.querySelector('[data-a=pick]'); pk.value = sig || ''; pk.onchange = () => { if (pk.value) wcLink(id, pk.value); };
  const nm = box.querySelector('[data-a=name]'); if (nm) { nm.value = (s && s.name) || ''; const save = () => { if (s && (s.name || '') !== nm.value.trim()) { s.name = nm.value.trim(); wmiSave(true); wmiRender(); wcRefresh(); } }; nm.onblur = save; nm.onkeydown = (e) => { if (e.key === 'Enter') nm.blur(); }; }
  box.querySelectorAll('select[data-slot]').forEach((se) => { se.value = b[se.dataset.slot] || ''; se.onchange = () => { WolfMidi.bind(wmiState, sig, se.dataset.slot, se.value); wmiSave(true); wmiRender(); wcRefresh(); }; });
  const th = box.querySelector('[data-a=thr]'); if (th) { th.value = b.threshold ?? WolfMidi.DEFAULT_THR; th.onchange = () => { const bb = WolfMidi.bind(wmiState, sig, 'onPress', (wmiState.bindings[sig] || {}).onPress); bb.threshold = clamp(+th.value | 0, 0, 127); th.value = bb.threshold; wmiSave(true); }; }
}
function wcTest(key, b, s) { // kør funktionen uden pulten; en hold-funktion holdes i 1 sek.
  const hold = b.onPress && SL_ACTIONS.byId[b.onPress] && SL_ACTIONS.byId[b.onPress].kind === 'hold';
  let any = false; if (b.onPress) any = SL_ACTIONS.run(b.onPress, 1) || any; if (b.onChange) any = SL_ACTIONS.run(b.onChange, ((s && s.lastValue) | 0) / 127) || any;
  if (hold) { wcLight(key, 'hold'); setTimeout(() => { SL_ACTIONS.run(b.onPress, 0); wcLight(key, 'off'); }, 1000); } else wcLight(key, 'flash');
  if (!any) toast(t('wmidi.noBinding'));
}

// ---------- forbind ----------
function wcSelect(key) {
  if (WC.sel === key && WC.listen) { WC.listen = false; } else { WC.sel = key; WC.listen = !wcLayout()[key]; } // ikke forbundet → lyt med det samme
  wcRefresh();
}
function wcLink(key, sigId) { wcLayout()[key] = sigId; WC.listen = false; wmiSave(true); wcRefresh(); wcLight(key, 'flash'); }
// kaldes fra wmiHandle FØR handlinger køres: lytter vi, forbindes signalet og der udføres intet
function wcIntercept(ev) {
  if (!WC.listen || !WC.sel) return false;
  if (ev.event === 'release' || (ev.type === 'cc' && ev.value === 0 && wmiState.signals[ev.id])) return true; // slip efter et tryk: spis det, vent på et rigtigt tryk
  WolfMidi.record(wmiState, ev); const key = WC.sel; wcLink(key, ev.id); WC.msg = ev; wcScreen(); toast(t('wc.linked', { c: wcLabel(key), s: ev.id })); return true;
}
// ---------- lys ----------
function wcLight(key, mode) {
  clearTimeout(WC.timers[key]);
  const apply = () => { const pad = wcPadOf(key); const dom = pad ? (pad.page === WC.page ? 'pad' + pad.n : null) : key; const el = dom && WC.els[dom]; if (el) el.classList.toggle('lit', WC.litKeys.has(key)); const cell = $('#wcScreen') && $('#wcScreen').querySelector(`.wc-cell[data-k="${key}"]`); if (cell) cell.classList.toggle('lit', WC.litKeys.has(key)); };
  if (mode === 'off') { WC.litKeys.delete(key); apply(); return; }
  WC.litKeys.delete(key); apply(); WC.litKeys.add(key); requestAnimationFrame(apply);
  WC.timers[key] = setTimeout(() => { WC.litKeys.delete(key); apply(); }, mode === 'flash' ? 380 : 30000); // hold: lyser til slip (sikkerhedsnet 30 s)
}
function wcSignal(ev) { // kaldes for hvert signal (efter handlinger)
  const keys = wcControlsFor(ev.id);
  const pad = keys.map(wcPadOf).find(Boolean); if (pad && pad.page !== WC.page && !keys.some((k) => !wcPadOf(k))) { WC.page = pad.page; wmiState.wcPage = WC.page; wcRefresh(); } // vis den side presetet ligger på
  for (const c of keys) {
    if (/^enc/.test(c) && ev.type === 'cc') { const k = WC.els[c].querySelector('.wc-knob'); k.style.setProperty('--a', (-135 + ev.value / 127 * 270) + 'deg'); wcLight(c, 'flash'); continue; }
    if (ev.type === 'note' && !ev.zeroPress) wcLight(c, ev.event === 'press' ? 'hold' : 'off'); // preset tændt = lyser, slukket = slukker
    else if (ev.type === 'cc') { const thr = (wmiState.bindings[ev.id] || {}).threshold ?? WolfMidi.DEFAULT_THR; wcLight(c, ev.value >= thr ? 'hold' : 'off'); } // Wolfmix: fx 4 = trykket, 0 = sluppet
    else wcLight(c, 'flash');
  }
  if (!WC.listen) { WC.msg = ev; wcScreen(); }
}
(() => {
  if (!$('#wc')) return; wcMigrate(); wcBuild();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && WC.listen) { WC.listen = false; wcRefresh(); e.stopPropagation(); e.preventDefault(); } }, true);
})();
