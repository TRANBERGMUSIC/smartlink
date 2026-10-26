/* SmartLink – fanen "Lys": 6× Ape Labs Neon Tube PIX via ÉN Ape Labs CONNECT, 2 etager à 3 rør.
 * SHOW: CONNECT er DMX-transmitter (gruppe 1). Topologi A = Wolfmix-kablet direkte i CONNECT (appen styrer via MIDI til Wolfmix),
 *       B = Wolfmix → DMX-IN → SmartLink (merge) → Art-Net-node → CONNECT, C = kun SmartLink → Art-Net-node → CONNECT.
 * LOUNGE: CONNECT i app-mode; SmartLink sender MIDI til CONNECT-appen ("External control via MIDI"), etager = Ape-gruppe 1 og 2.
 * Al logik ligger i ape_core.js (rene funktioner, testet). Denne fil er UI, DMX-loop, MIDI-ud og telefon-roller.
 */
'use strict';
const T = (da, en) => (typeof LANG !== 'undefined' && LANG === 'en' ? en : da);
const APE_DEF = () => ({
  profile: 'show', topology: 'A', chMode: '64ch', tubes: ApeCore.DEFAULT_TUBES(), artnet: { ip: '2.255.255.255', universe: 1 }, out: false,
  owners: { 1: 'app', 2: 'app' }, locks: { 1: false, 2: false }, sel: [1, 2], tab: 'link', wolfOut: 'B', checks: {},
  colors: [['Rød', [255, 0, 0, 0]], ['Orange', [255, 90, 0, 0]], ['Gul', [255, 200, 0, 0]], ['Grøn', [0, 255, 0, 0]], ['Cyan', [0, 255, 255, 0]], ['Blå', [0, 30, 255, 0]], ['Lilla', [140, 0, 255, 0]], ['Pink', [255, 0, 140, 0]], ['Varm hvid', [0, 0, 0, 255]], ['Kold hvid', [255, 255, 255, 0]]]
    .map(([name, rgbw], i) => ({ id: 'c' + i, name, folder: T('Standard', 'Default'), rgbw })),
  programs: [{ id: 'p0', name: 'Rød/blå', folder: T('Standard', 'Default'), steps: [{ color: [255, 0, 0, 0], fade: 1, hold: 1 }, { color: [0, 30, 255, 0], fade: 1, hold: 1 }] }],
  scenes: [],
  bridge: { port: '', bindings: null, names: {} },
  wolf: { port: '', dim: { 1: { ch: 1, cc: 1 }, 2: { ch: 1, cc: 2 } }, presets: [] },
});
const APE = Object.assign(APE_DEF(), store.get('ape', {}));
let apeState = (() => { const s = ApeCore.newState(), saved = store.get('apeLive', null); if (saved && saved.floors) for (const f of [1, 2]) Object.assign(s.floors[f], saved.floors[f] || {}, { blackoutHold: false, strobeHold: false }); return s; })();
const AP = { uni: new Uint8Array(512), plan: null, wolfIn: null, wolfInAt: 0, ltp: {}, beatAt: 0, sentAt: 0, guide: null, dragId: null, lastWarn: '' };
const apeSave = () => { store.set('ape', APE); };
const apeSaveLive = () => { clearTimeout(AP.liveT); AP.liveT = setTimeout(() => store.set('apeLive', apeState), 500); };
const apeFloorsLabel = (fl) => (fl.length === 2 ? T('Alle', 'All') : T('Etage ', 'Floor ') + fl[0]);
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const rgbwCss = (c) => ApeCore.toCss(c || [0, 0, 0, 0]);

// ---------- beat (samme kilde som laseren/Wolfmix: tap, BPM, mikrofon) ----------
if (typeof onBeat === 'function') { const _ob = onBeat; onBeat = function () { AP.beatAt = performance.now(); return _ob.apply(this, arguments); }; } // eslint-disable-line no-global-assign

// ---------- DMX-loop (40 Hz) ----------
function apePlan() { const p = ApeCore.plan(APE.chMode, APE.tubes); AP.plan = p; return p; }
function apeTick() {
  const p = AP.plan || apePlan(); if (!p.ok) return;
  const now = performance.now(), bpmNow = typeof bpm !== 'undefined' ? bpm : 120, beat = AP.beatAt ? ((now - AP.beatAt) / (60000 / bpmNow)) : null;
  const programs = Object.fromEntries(APE.programs.map((x) => [x.id, x]));
  let u = ApeCore.render(apeState, p, { t: now / 1000, beat: beat != null ? Math.min(beat, 4) : null, programs });
  const wolfLive = AP.wolfIn && Date.now() - AP.wolfInAt < 2000;
  if (APE.topology === 'B' && wolfLive) u = ApeCore.merge(AP.wolfIn, u, p, APE.owners, AP.ltp);
  if (AP.ident) { // rør-test: hvert rør lyser hvidt ét ad gangen (1 → 6), så man kan se at signalet når frem – og i hvilken rækkefølge
    const k = Math.floor((now - AP.ident.t0) / 700); if (k >= p.tubes.length * 2) AP.ident = null;
    else { u = new Uint8Array(512); const tube = p.tubes.slice().sort((a, b) => a.id - b.id)[k % p.tubes.length]; AP.ident.cur = tube.id; u.set(ApeCore.tubeChannels(tube.mode, [[255, 255, 255, 255]], { dimmer: 1, strobeDmx: 0, strobeOn: true }), tube.address - 1); }
  }
  AP.uni = u;
  // vagthund: kun DMX i SHOW og kun når appen faktisk er i kæden (B/C)
  if (APE.out && APE.topology !== 'A') {
    if (!ApeCore.canSendDmx(APE.profile)) { if (AP.lastWarn !== 'lounge') { AP.lastWarn = 'lounge'; toast(T('⚠ DMX ikke sendt: CONNECT er i LOUNGE (app-mode) og ignorerer DMX.', '⚠ DMX not sent: CONNECT is in LOUNGE (app mode) and ignores DMX.'), 6000); } }
    else { AP.lastWarn = ''; window.laser.sendDmx(APE.artnet.universe | 0, APE.artnet.ip, Array.from(u)); AP.sentAt = Date.now(); }
  }
}
setInterval(apeTick, 25);
window.laser.onDmxIn && window.laser.onDmxIn((d) => { if (APE.topology === 'B' && d && d.universe === (APE.wolfInUniverse ?? 2)) { AP.wolfIn = Uint8Array.from(d.data); AP.wolfInAt = Date.now(); } });

// ---------- kommandoer (app, telefoner, Wolfmix) → state + den aktive vej ----------
function apeCmd(cmd, floors, by = 'app') {
  floors = (floors || APE.sel).filter((f) => f === 1 || f === 2); if (!floors.length) return false;
  if (cmd.op === 'scene') { const sc = APE.scenes.find((s) => s.id === cmd.id); if (!sc) return false; const part = { floors: {} }; for (const f of floors) if (sc.floors[f]) part.floors[f] = sc.floors[f]; ApeCore.recallScene(apeState, part, by, Date.now()); if (APE.profile === 'lounge' && sc.lounge) apeBridgeSend(floors, 'scene:' + sc.lounge); }
  else if (!ApeCore.applyCommand(apeState, cmd, floors, by, Date.now())) return false;
  if (APE.profile === 'lounge') apeBridgeCmd(cmd, floors); else if (APE.topology === 'A') apeWolfCmd(cmd, floors);
  apeSaveLive(); apeSyncControls(); return true;
}

// ---------- MIDI-ud (fælles for CONNECT-broen og Wolfmix) ----------
function apeMidiOuts() { return (typeof WMI !== 'undefined' && WMI.access) ? [...WMI.access.outputs.values()] : []; }
function apeMidiSend(portName, bytes) { const o = apeMidiOuts().find((x) => x.name === portName); if (!o) return false; try { o.send(bytes); return true; } catch (_) { return false; } }
// LOUNGE: CONNECT-appen
function apeBindings() { if (!APE.bridge.bindings) { APE.bridge.bindings = ApeCore.defaultBindings(ApeCore.bridgeActions()); apeSave(); } return APE.bridge.bindings; }
function apeBridgeSend(floors, actionId, value) {
  const b = apeBindings(); let ok = true;
  for (const m of ApeCore.loungeMessages(floors, actionId, value)) { const bind = b[m.id]; if (!bind) { ok = false; continue; } ok = apeMidiSend(APE.bridge.port, ApeCore.bindingBytes(bind, m.value ?? 127)) && ok; }
  if (!ok) apeStatus(T('MIDI til CONNECT-appen kunne ikke sendes – vælg udgang under "MIDI-bro".', 'Could not send MIDI to the CONNECT app – pick an output under "MIDI bridge".'), 'bad');
  return ok;
}
function apeBridgeCmd(cmd, floors) {
  switch (cmd.op) {
    case 'color': if (cmd.preset) apeBridgeSend(floors, 'preset:' + cmd.preset); break;
    case 'program': { const p = APE.programs.find((x) => x.id === cmd.program); if (p && p.lounge) apeBridgeSend(floors, 'preset:' + p.lounge); break; }
    case 'brightness': apeBridgeSend(floors, 'brightness', Math.round(cmd.value * 127)); break;
    case 'speed': apeBridgeSend(floors, 'speed', Math.round(cmd.value * 127)); break;
    case 'blackout': apeBridgeSend(floors, cmd.hold != null ? 'blackout.hold' : 'blackout.toggle', cmd.hold === false ? 0 : 127); break;
    case 'strobe': apeBridgeSend(floors, cmd.hold != null ? 'strobe.hold' : 'strobe.toggle', cmd.hold === false ? 0 : 127); break;
    case 'music': apeBridgeSend(floors, 'music:' + ({ off: 'off', lights: 'lights', beat: 'connect' }[cmd.source] || 'off')); apeBridgeSend(floors, 'musicrest:' + (cmd.rest === 0.15 ? 15 : 0)); break;
    case 'fx': if (cmd.fx && cmd.fx !== 'none') apeBridgeSend(floors, 'pixelfx:' + cmd.fx); break;
  }
}
// SHOW topologi A: appen styrer rørene INDIREKTE via Wolfmix (gruppe A = etage 1, B = etage 2)
function apeWolfCmd(cmd, floors) {
  const w = APE.wolf, send = (bytes) => apeMidiSend(w.port, bytes);
  for (const f of floors) {
    const d = w.dim[f] || {}; const cc = (v) => d.cc != null && send([0xb0 | (((d.ch || 1) - 1) & 15), d.cc & 127, Math.round(Math.max(0, Math.min(1, v)) * 127)]);
    const s = apeState.floors[f];
    if (cmd.op === 'brightness' || cmd.op === 'blackout') cc(s.blackout || s.blackoutHold ? 0 : s.brightness);
    if (cmd.op === 'color' && cmd.wolfPreset != null) { const p = w.presets[cmd.wolfPreset]; if (p) { send([0x90 | ((p.ch || 1) - 1), p.note & 127, 127]); setTimeout(() => send([0x80 | ((p.ch || 1) - 1), p.note & 127, 0]), 80); } }
  }
}

// ---------- telefoner (roller) ----------
function apeRemoteCmd(c) { // c._role sættes af serveren ud fra telefonens nøgle – telefonen kan ikke selv vælge den
  const role = c._role || 'admin', a = ApeCore.authorize(role, c, role === 'admin' ? {} : APE.locks);
  if (!a.ok) return;
  const cmd = { ...c }; delete cmd.type; delete cmd._role; delete cmd.floors;
  if (cmd.op === 'colorId') { const col = APE.colors.find((x) => x.id === cmd.id); if (!col) return; cmd.op = 'color'; cmd.color = col.rgbw; }
  apeCmd(cmd, a.floors, role);
}
function apeSnapshot() {
  const p = AP.plan; const tubes = p && p.ok ? ApeCore.decode(AP.uni, p).map((t) => ({ id: t.id, floor: t.floor, px: t.px.filter((_, i) => t.px.length < 17 || i % 2 === 0).map(rgbwCss) })) : [];
  const fl = {}; for (const f of [1, 2]) { const s = apeState.floors[f]; fl[f] = { brightness: s.brightness, speed: s.speed, blackout: s.blackout, strobe: s.strobe, fx: s.fx, music: s.music, look: s.look, color: s.color, program: s.program, lastBy: s.lastBy, locked: !!APE.locks[f] }; }
  return { profile: APE.profile, topology: APE.topology, wolfmix: APE.profile === 'show' && APE.topology !== 'C', floors: fl, tubes, colors: APE.colors.map((c) => ({ id: c.id, name: c.name, folder: c.folder, css: rgbwCss(c.rgbw) })), programs: APE.programs.map((x) => ({ id: x.id, name: x.name, folder: x.folder })), scenes: APE.scenes.map((x) => ({ id: x.id, name: x.name, folder: x.folder, floors: Object.keys(x.floors).map(Number) })) };
}

// blinder: fuldt hvidt (RGB+WW) og fuld lysstyrke mens knappen holdes; slip = tilbage som før
function apeBlinder(floors, on) {
  AP.blind = AP.blind || {};
  for (const f of floors) { const s = apeState.floors[f];
    if (on && !AP.blind[f]) { AP.blind[f] = { look: s.look, color: s.color.slice(), brightness: s.brightness, blackout: s.blackout, fx: s.fx }; apeCmd({ op: 'color', color: [255, 255, 255, 255] }, [f], 'wolfmix'); apeCmd({ op: 'brightness', value: 1 }, [f], 'wolfmix'); apeCmd({ op: 'fx', fx: 'none' }, [f], 'wolfmix'); }
    else if (!on && AP.blind[f]) { const p = AP.blind[f]; delete AP.blind[f]; Object.assign(s, { look: p.look, color: p.color, brightness: p.brightness, blackout: p.blackout, fx: p.fx }); apeCmd({ op: 'brightness', value: p.brightness }, [f], 'wolfmix'); }
  }
}
// ---------- Wolfmix-handlinger (registreres i det fælles handlingsregister) ----------
(() => {
  if (typeof SL_ACTIONS === 'undefined') return;
  const add = (id, labelKey, kind, run) => { const a = { id, labelKey, kind, run, group: 'ape' }; SL_ACTIONS.list.push(a); SL_ACTIONS.byId[id] = a; };
  for (const [fl, sfx, nm] of [[[1], 'f1', 'Etage 1'], [[2], 'f2', 'Etage 2'], [[1, 2], 'all', 'Alle']]) {
    add('ape.' + sfx + '.blackoutHold', `Lys ${nm}: hold blackout`, 'hold', (d) => apeCmd({ op: 'blackout', hold: !!d }, fl, 'wolfmix'));
    add('ape.' + sfx + '.blackout', `Lys ${nm}: blackout til/fra`, 'trigger', () => apeCmd({ op: 'blackout' }, fl, 'wolfmix'));
    add('ape.' + sfx + '.strobeHold', `Lys ${nm}: hold strobe`, 'hold', (d) => apeCmd({ op: 'strobe', hold: !!d }, fl, 'wolfmix'));
    add('ape.' + sfx + '.blinderHold', `Lys ${nm}: hold blinder (fuldt hvidt)`, 'hold', (d) => apeBlinder(fl, !!d));
    add('ape.' + sfx + '.colorNext', `Lys ${nm}: næste farve`, 'trigger', () => { const i = (APE.colors.findIndex((c) => c.rgbw.join() === apeState.floors[fl[0]].color.join()) + 1) % APE.colors.length; apeCmd({ op: 'color', color: APE.colors[i].rgbw }, fl, 'wolfmix'); });
    add('ape.' + sfx + '.fxNext', `Lys ${nm}: næste pixel-effekt`, 'trigger', () => { const i = (ApeCore.FX.indexOf(apeState.floors[fl[0]].fx) + 1) % ApeCore.FX.length; apeCmd({ op: 'fx', fx: ApeCore.FX[i] }, fl, 'wolfmix'); });
    add('ape.' + sfx + '.brightness', `Lys ${nm}: lysstyrke`, 'continuous', (v) => apeCmd({ op: 'brightness', value: v }, fl, 'wolfmix'));
    add('ape.' + sfx + '.speed', `Lys ${nm}: speed`, 'continuous', (v) => apeCmd({ op: 'speed', value: v }, fl, 'wolfmix'));
  }
  for (let i = 1; i <= 8; i++) add('ape.scene.' + i, `Lys: scene ${i}`, 'trigger', () => { const sc = APE.scenes[i - 1]; if (sc) apeCmd({ op: 'scene', id: sc.id }, [1, 2], 'wolfmix'); });
  const _label = SL_ACTIONS.label; SL_ACTIONS.label = (a) => (a && a.group === 'ape' ? a.labelKey : _label(a));
})();

// ---------- UI ----------
function apeStatus(msg, kind) { const el = $('#apeStatus'); if (el) { el.textContent = msg || ''; el.className = 'ape-status ' + (kind || ''); } }
function apeTopBar() {
  const el = $('#apeTop'); if (!el) return; const plan_ = apePlan(), lounge = APE.profile === 'lounge';
  const node = (icon, label, sub, cls = '') => `<div class="ape-node ${cls}"><span class="ape-node-i">${icon}</span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const arrow = '<span class="ape-arrow"></span>';
  const flow = lounge ? [node('⌘', 'SmartLink', 'MIDI'), node('▣', 'CONNECT-app', T('tablet/telefon', 'tablet/phone')), node('◉', 'CONNECT', T('app-mode', 'app mode')), node('▬', T('6 rør', '6 tubes'), T('gruppe 1 + 2', 'group 1 + 2'))]
    : APE.topology === 'A' ? [node('▦', 'Wolfmix', 'DMX ' + (APE.wolfOut || 'B'), 'wolf'), node('◉', 'CONNECT', T('DMX-transmitter', 'DMX transmitter')), node('▬', T('6 rør', '6 tubes'), T('gruppe 1', 'group 1'))]
    : APE.topology === 'B' ? [node('▦', 'Wolfmix', 'DMX-IN', 'wolf'), node('⌘', 'SmartLink', 'merge'), node('⇄', 'Art-Net', T('univers ', 'universe ') + APE.artnet.universe), node('◉', 'CONNECT', 'DMX IN'), node('▬', T('6 rør', '6 tubes'), '')]
    : [node('⌘', 'SmartLink', ''), node('⇄', 'Art-Net', T('univers ', 'universe ') + APE.artnet.universe), node('◉', 'CONNECT', 'DMX IN'), node('▬', T('6 rør', '6 tubes'), '')];
  const sending = APE.out && APE.topology !== 'A' && !lounge;
  const warn = lounge ? T('Wolfmix kan ikke styre rørene i LOUNGE – der er ingen DMX-vej.', 'Wolfmix can not control the tubes in LOUNGE – there is no DMX path.')
    : APE.topology === 'A' ? T('Wolfmix styrer rørene. Appen sender MIDI til Wolfmix; preview viser appens ønske (CONNECT svarer ikke tilbage).', 'Wolfmix drives the tubes. The app sends MIDI to Wolfmix; the preview shows the intent.') : '';
  el.innerHTML = `<div class="ape-modeswitch" role="tablist"><button data-p="show" class="${!lounge ? 'on' : ''}"><b>SHOW</b><small>${T('DMX · Wolfmix', 'DMX · Wolfmix')}</small></button><button data-p="lounge" class="${lounge ? 'on' : ''}"><b>LOUNGE</b><small>${T('CONNECT-appen', 'CONNECT app')}</small></button></div>
    <div class="ape-flowwrap"><div class="ape-flow">${flow.join(arrow)}</div>
      ${!lounge ? `<div class="ape-topo">${[['A', T('Wolfmix direkte', 'Wolfmix direct')], ['B', T('Wolfmix + app', 'Wolfmix + app')], ['C', T('Kun app', 'App only')]].map(([k, l]) => `<button data-topo="${k}" class="${APE.topology === k ? 'on' : ''}"><b>${k}</b> ${l}</button>`).join('')}</div>` : ''}
    </div>
    <button class="ape-linksum ${apeLinkSummary().cls}" id="apeLinkSum">${apeLinkSummary().txt}</button>
    <div class="ape-out">${!lounge && APE.topology !== 'A' ? `<label class="ape-switch"><input type="checkbox" id="apeOut" ${APE.out ? 'checked' : ''}><span></span>${T('Send DMX', 'Send DMX')}</label><span class="ape-dot ${sending ? 'on' : ''}"></span><small>${sending ? T('sender 40 Hz', 'sending 40 Hz') : T('stoppet', 'stopped')} · ${escHtml(APE.artnet.ip)}</small>` : `<small class="muted">${lounge ? T('MIDI → ', 'MIDI → ') + escHtml(APE.bridge.port || T('ingen udgang valgt', 'no output selected')) : T('MIDI → ', 'MIDI → ') + escHtml(APE.wolf.port || T('ingen udgang valgt', 'no output selected'))}</small>`}</div>
    ${warn || !plan_.ok ? `<div class="ape-note ${lounge || !plan_.ok ? 'bad' : ''}">${warn}${plan_.ok ? '' : ' ' + T(`${APE.chMode} × 6 = ${plan_.need} kanaler passer ikke i ét univers (512). Vælg 64ch eller mindre.`, `${APE.chMode} × 6 = ${plan_.need} channels does not fit one universe.`)}</div>` : ''}`;
  el.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { if (b.dataset.p !== APE.profile) apeSwitchDialog(); }; });
  $('#apeLinkSum').onclick = () => { APE.tab = 'link'; apeSave(); apeRenderTabs(); apeRenderLink(); };
  el.querySelectorAll('[data-topo]').forEach((b) => { b.onclick = () => { APE.topology = b.dataset.topo; apeSave(); apeRenderAll(); }; });
  const ob = $('#apeOut'); if (ob) ob.onchange = () => { APE.out = ob.checked; apeSave(); apeTopBar(); };
}
function apeSwitchDialog() {
  const to = APE.profile === 'show' ? 'lounge' : 'show', steps = ApeCore.switchChecklist(to);
  apeDialog(T('Skift til ', 'Switch to ') + ApeCore.PROFILES[to].name, `<p class="hint">${T('Der er ingen tilbagemelding fra CONNECT – SmartLink går ud fra det du bekræfter her.', 'CONNECT gives no feedback – SmartLink trusts what you confirm here.')}</p><ol class="ape-check">${steps.map((s, i) => `<li><label class="chk"><input type="checkbox" data-i="${i}"> ${escHtml(s)}</label></li>`).join('')}</ol>
    <details><summary>${T('Trinliste til CONNECT-appen', 'Step list for the CONNECT app')}</summary><pre class="ape-pre">${escHtml(ApeCore.exportConnectSteps(apePlan(), to))}</pre></details>`,
  [[T('Annullér', 'Cancel'), null], [T('Skift', 'Switch'), () => { APE.profile = to; if (to === 'lounge') APE.out = false; apeSave(); apeRenderAll(); toast(T('Mode: ', 'Mode: ') + ApeCore.PROFILES[to].name); }, 'needAll']]);
}
function apeDialog(title, html, buttons) {
  let ov = $('#apeDlg'); if (!ov) { ov = document.createElement('div'); ov.id = 'apeDlg'; ov.className = 'ape-dlg'; document.body.appendChild(ov); }
  ov.innerHTML = `<div class="ape-dlg-box"><h3>${escHtml(title)}</h3><div class="ape-dlg-body">${html}</div><div class="ape-dlg-btns"></div></div>`; ov.hidden = false;
  const btns = ov.querySelector('.ape-dlg-btns');
  for (const [label, fn, mode] of buttons) { const b = document.createElement('button'); b.textContent = label; b.className = fn ? 'primary' : 'ghost';
    if (mode === 'needAll') { const upd = () => { b.disabled = [...ov.querySelectorAll('.ape-check input')].some((x) => !x.checked); }; ov.querySelectorAll('.ape-check input').forEach((x) => { x.onchange = upd; }); upd(); }
    b.onclick = () => { ov.hidden = true; if (fn) fn(ov); }; btns.appendChild(b); }
  return ov;
}
function apeDrawPreview() { // rørene tegnes som neonrør med glød; etage 2 øverst
  const cv = $('#apeCanvas'); if (!cv || !cv.offsetParent) return; const p = AP.plan; if (!p || !p.ok) return;
  const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1; if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const dec = ApeCore.decode(AP.uni, p), padL = 104, gap = 22, tw = (W - padL - 20 - gap * 2) / 3, th = 18, rowH = H / 2;
  for (const f of [2, 1]) {
    const cy = (f === 2 ? 0 : rowH) + rowH / 2, s = apeState.floors[f], tubes = dec.filter((t) => t.floor === f), sel = APE.sel.includes(f);
    g.fillStyle = sel ? '#e8ecf3' : '#7f8796'; g.font = '600 13px Inter, -apple-system, sans-serif'; g.textBaseline = 'middle'; g.fillText(T('Etage ', 'Floor ') + f, 16, cy - 8);
    g.font = '11px "JetBrains Mono", ui-monospace, monospace'; g.fillStyle = '#8a8c92'; g.fillText((APE.locks[f] ? '🔒 ' : '') + (s.blackout || s.blackoutHold ? 'blackout' : s.lastBy || ''), 14, cy + 9);
    if (sel) { g.fillStyle = '#31f3ac'; g.fillRect(0, cy - 16, 1, 32); }
    tubes.forEach((t, i) => {
      const x0 = padL + i * (tw + gap), y0 = cy - th / 2, pw = tw / t.px.length;
      // lyset fra rørene rammer væggen bag dem og gulvet under (kun en visning – det er de samme pixel-farver)
      g.save(); g.globalCompositeOperation = 'lighter'; g.filter = 'blur(18px)';
      t.px.forEach((c, j) => { const lum = Math.max(c[0], c[1], c[2], c[3]); if (lum < 8) return; g.globalAlpha = 0.42 * lum / 255; g.fillStyle = rgbwCss(c); g.fillRect(x0 + j * pw - pw * 0.3, y0 - th * 1.4, pw * 1.6, th * 3.8); });
      g.filter = 'blur(6px)'; t.px.forEach((c, j) => { const lum = Math.max(c[0], c[1], c[2], c[3]); if (lum < 8) return; g.globalAlpha = 0.16 * lum / 255; g.fillStyle = rgbwCss(c); g.fillRect(x0 + j * pw, y0 + th + 7, pw, 5); });
      g.restore();
      g.fillStyle = '#0b0c0f'; g.strokeStyle = '#25272e'; g.lineWidth = 1; g.beginPath(); g.roundRect(x0 - 4, y0 - 4, tw + 8, th + 8, (th + 8) / 2); g.fill(); g.stroke();
      g.save(); g.beginPath(); g.roundRect(x0, y0, tw, th, th / 2); g.clip();
      t.px.forEach((c, j) => { const css = rgbwCss(c), lum = Math.max(c[0], c[1], c[2], c[3]); g.fillStyle = lum > 4 ? css : '#14171d'; g.shadowColor = css; g.shadowBlur = lum > 20 ? 18 : 0; g.fillRect(x0 + j * pw, y0, pw + 0.6, th); });
      g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,.28)'; for (let j = 1; j < t.px.length; j++) g.fillRect(x0 + j * pw - 0.5, y0, 1, th); /* pixel-segmenterne */
      g.restore();
      const grd = g.createLinearGradient(0, y0, 0, y0 + th); grd.addColorStop(0, 'rgba(255,255,255,.22)'); grd.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.beginPath(); g.roundRect(x0, y0, tw, th / 2, th / 2); g.fill();
      g.fillStyle = '#8a8c92'; g.font = '11px "JetBrains Mono", ui-monospace, monospace'; g.fillText((APE.tubes.find((x) => x.id === t.id) || {}).name || '', x0 + 4, y0 + th + 21);
    });
  }
}
function apeLoop() { apeDrawPreview(); requestAnimationFrame(apeLoop); }

function apeRenderTabs() { $$('#apeTabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === APE.tab)); $$('.ape-pane').forEach((p) => { p.hidden = p.dataset.t !== APE.tab; }); }
function apeRenderAll() { apePlan(); apeTopBar(); apeRenderTabs(); apeRenderLink(); apeRenderControl(); apeRenderPrograms(); apeRenderScenes(); apeRenderPatch(); apeRenderBridge(); apeRenderPhones(); }

// ---- kontrol ----
function apeGrouped(list) { const g = {}; for (const x of list) (g[x.folder || '—'] = g[x.folder || '—'] || []).push(x); return Object.entries(g).sort(([a], [b]) => a.localeCompare(b)); }
function apeSortable(container, list, onDone) { // drag-and-drop-sortering
  container.querySelectorAll('[data-id]').forEach((el) => { el.draggable = true;
    el.ondragstart = () => { AP.dragId = el.dataset.id; el.classList.add('drag'); }; el.ondragend = () => el.classList.remove('drag');
    el.ondragover = (e) => e.preventDefault();
    el.ondrop = (e) => { e.preventDefault(); const from = list.findIndex((x) => x.id === AP.dragId), to = list.findIndex((x) => x.id === el.dataset.id); if (from < 0 || to < 0 || from === to) return; const [m] = list.splice(from, 1); m.folder = list[Math.min(to, list.length - 1)] ? (list[to] || list[to - 1]).folder : m.folder; list.splice(to, 0, m); apeSave(); onDone(); }; });
}
function apeRenderControl() {
  const el = $('#apePaneControl'); if (!el) return; const f0 = apeState.floors[APE.sel[0]], lounge = APE.profile === 'lounge', topoA = APE.profile === 'show' && APE.topology === 'A', names = APE.bridge.names || {};
  const card = (title, body, cls = '') => `<section class="ape-card ${cls}"><h4>${title}</h4>${body}</section>`;
  const seg = (id, opts, val) => `<div class="ape-seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const looks = lounge ? `<div class="ape-grid-btns">${Array.from({ length: 12 }, (_, i) => `<button class="ape-pbtn" data-lp="${i + 1}"><small>#${i + 1}</small>${escHtml(names['preset:' + (i + 1)] || 'Preset ' + (i + 1))}</button>`).join('')}</div><p class="hint">${T('Navne sættes under MIDI-bro.', 'Names are set under MIDI bridge.')}</p>`
    : apeGrouped(APE.colors).map(([fd, cs]) => `<div class="ape-folder"><span class="ape-flabel">${escHtml(fd)}</span><div class="ape-colors">${cs.map((c) => `<button class="ape-cbtn ${f0.look === 'color' && f0.color.join() === c.rgbw.join() ? 'on' : ''}" data-id="${c.id}" title="${escHtml(c.name)} · ${T('højreklik = redigér', 'right-click = edit')}" style="--c:${rgbwCss(c.rgbw)}"><i></i><span>${escHtml(c.name)}</span></button>`).join('')}</div></div>`).join('');
  const mixer = lounge ? '' : `<div class="ape-mix">${[['R', '#ff3b3b'], ['G', '#2bdc6b'], ['B', '#3b6bff'], ['WW', '#ffd9a0']].map(([k, c], i) => `<label style="--t:${c}"><span>${k}</span><input type="range" min="0" max="255" data-c="${i}" value="${f0.color[i] | 0}"><output>${f0.color[i] | 0}</output></label>`).join('')}<div class="ape-mixfoot"><span class="ape-mixsw" style="--c:${rgbwCss(f0.color)}"></span><button class="ghost small" id="apeSaveColor">＋ ${T('Gem som farve', 'Save as colour')}</button></div></div>`;
  const wolfp = topoA && APE.wolf.presets.length ? card(T('Wolfmix-presets', 'Wolfmix presets'), `<div class="ape-grid-btns">${APE.wolf.presets.map((p, i) => `<button class="ape-pbtn" data-wp="${i}">${escHtml(p.name)}</button>`).join('')}</div>`) : '';
  el.innerHTML = `<div class="ape-floorbar">${[[[1], T('Etage 1', 'Floor 1'), 'rør 1–3'], [[2], T('Etage 2', 'Floor 2'), 'rør 4–6'], [[1, 2], T('Begge', 'Both'), T('alle 6 rør', 'all 6')]].map(([fl, l, sub]) => `<button data-fl="${fl.join(',')}" class="${APE.sel.join() === fl.join() ? 'on' : ''}"><b>${l}</b><small>${sub}</small></button>`).join('')}</div>
    <div class="ape-cgrid">
      <div class="ape-col">${card(lounge ? T('CONNECT-presets', 'CONNECT presets') : T('Farver', 'Colours'), looks + mixer)}${wolfp}</div>
      <div class="ape-col">
        ${card(T('Lys', 'Light'), `<label class="ape-big"><span>${T('Lysstyrke', 'Brightness')}</span><input type="range" id="apeBri" min="0" max="100" value="${Math.round(f0.brightness * 100)}"><output id="apeBriV">${Math.round(f0.brightness * 100)}%</output></label><label class="ape-big"><span>Speed</span><input type="range" id="apeSpd" min="0" max="100" value="${Math.round(f0.speed * 100)}"><output id="apeSpdV">${Math.round(f0.speed * 100)}%</output></label>`)}
        ${card(T('Blackout & strobe', 'Blackout & strobe'), `<div class="ape-acts"><button class="ape-hold ape-bo" data-op="blackout"><b>Blackout</b><small>${T('hold nede', 'hold')}</small></button><button class="ape-bo ${f0.blackout ? 'on' : ''}" data-tog="blackout"><b>Blackout</b><small>${T('til/fra', 'on/off')}</small></button><button class="ape-hold ape-st" data-op="strobe"><b>Strobe</b><small>${T('hold nede', 'hold')}</small></button><button class="ape-st ${f0.strobe ? 'on' : ''}" data-tog="strobe"><b>Strobe</b><small>${T('til/fra', 'on/off')}</small></button></div>`)}
        ${card(T('Pixel-effekt', 'Pixel effect'), `<div class="ape-fxgrid" id="apeFx">${ApeCore.FX.map((x) => `<button data-v="${x}" class="${f0.fx === x ? 'on' : ''}"><i class="fx-${x}"></i>${{ none: T('Ingen', 'None'), sparkle: 'Sparkle', sweep: 'Sweep', cascade: 'Cascade', wave: 'Wave' }[x]}</button>`).join('')}</div>`)}
        ${card(T('MusikMode', 'MusicMode'), seg('apeMusic', [['off', 'Off'], ['lights', T('Lampens mik.', 'Lamp mic')], ['beat', lounge ? 'CONNECT' : T('SmartLink-beat', 'SmartLink beat')]], f0.music.source) + `<div class="ape-row"><span class="muted small">${T('Restlys', 'Rest light')}</span>${seg('apeRest', [['0', '0 %'], ['0.15', '15 %']], f0.music.rest || 0)}</div><p class="hint">${!lounge && APE.chMode !== '7ch' && f0.music.source === 'lights' ? T('⚠ Lampens mikrofon findes kun i 7ch. I 64ch: vælg SmartLink-beat.', '⚠ Lamp mic only in 7ch.') : !lounge && f0.music.source === 'beat' ? T('Erstatter CONNECT-beat (findes ikke over DMX): dimmeren pulserer på laserens BPM.', 'Replaces CONNECT beat: the dimmer pulses on the laser BPM.') : ''}</p>`)}
      </div>
    </div>`;
  el.querySelectorAll('[data-fl]').forEach((b) => { b.onclick = (e) => { const fl = b.dataset.fl.split(',').map(Number); APE.sel = e.shiftKey ? [...new Set([...APE.sel, ...fl])].sort() : fl; apeSave(); apeRenderControl(); }; });
  el.querySelectorAll('.ape-cbtn').forEach((b) => { b.onclick = () => { const c = APE.colors.find((x) => x.id === b.dataset.id); if (c) { apeCmd({ op: 'color', color: c.rgbw }); apeRenderControl(); } }; b.oncontextmenu = (e) => { e.preventDefault(); apeEditColor(b.dataset.id); }; });
  el.querySelectorAll('.ape-colors').forEach((c) => apeSortable(c, APE.colors, apeRenderControl));
  el.querySelectorAll('[data-lp]').forEach((b) => { b.onclick = () => apeCmd({ op: 'color', color: apeState.floors[APE.sel[0]].color, preset: +b.dataset.lp }); });
  el.querySelectorAll('[data-wp]').forEach((b) => { b.onclick = () => apeCmd({ op: 'color', color: apeState.floors[APE.sel[0]].color, wolfPreset: +b.dataset.wp }); });
  el.querySelectorAll('.ape-mix input').forEach((r) => { r.oninput = () => { r.nextElementSibling.textContent = r.value; const c = [...el.querySelectorAll('.ape-mix input')].map((x) => +x.value); apeCmd({ op: 'color', color: c }); const sw = el.querySelector('.ape-mixsw'); if (sw) sw.style.setProperty('--c', rgbwCss(c)); }; });
  const sc = el.querySelector('#apeSaveColor'); if (sc) sc.onclick = async () => { const name = await modal(T('Navn på farven (evt. "Mappe/Navn")', 'Colour name (optionally "Folder/Name")'), ''); if (!name) return; const parts = name.split('/'); APE.colors.push({ id: uid('c'), name: parts.pop().trim(), folder: parts.join('/').trim() || T('Mine', 'Mine'), rgbw: apeState.floors[APE.sel[0]].color.slice() }); apeSave(); apeRenderControl(); };
  $('#apeBri').oninput = (e) => { $('#apeBriV').textContent = e.target.value + '%'; apeCmd({ op: 'brightness', value: e.target.value / 100 }); };
  $('#apeSpd').oninput = (e) => { $('#apeSpdV').textContent = e.target.value + '%'; apeCmd({ op: 'speed', value: e.target.value / 100 }); };
  el.querySelectorAll('.ape-hold').forEach((b) => { const op = b.dataset.op; b.onpointerdown = () => { b.classList.add('on'); apeCmd({ op, hold: true }); }; const up = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); apeCmd({ op, hold: false }); }; b.onpointerup = up; b.onpointerleave = up; });
  el.querySelectorAll('[data-tog]').forEach((b) => { b.onclick = () => { apeCmd({ op: b.dataset.tog }); apeRenderControl(); }; });
  $$('#apeFx button').forEach((b) => { b.onclick = () => { apeCmd({ op: 'fx', fx: b.dataset.v }); apeRenderControl(); }; });
  const music = () => ({ source: $('#apeMusic .on').dataset.v, rest: +$('#apeRest .on').dataset.v });
  $$('#apeMusic button, #apeRest button').forEach((b) => { b.onclick = () => { b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); apeCmd({ op: 'music', ...music() }); apeRenderControl(); }; });
}
function apeSyncControls() { const b = $('#apeBri'); if (!b || document.activeElement === b || document.activeElement === $('#apeSpd')) return; const f0 = apeState.floors[APE.sel[0]]; b.value = Math.round(f0.brightness * 100); $('#apeSpd').value = Math.round(f0.speed * 100); $('#apeBriV').textContent = b.value + '%'; $('#apeSpdV').textContent = $('#apeSpd').value + '%'; }
async function apeEditColor(id) {
  const c = APE.colors.find((x) => x.id === id); if (!c) return;
  const r = await modal(T('Farve: navn eller "Mappe/Navn"', 'Colour: name or "Folder/Name"'), (c.folder ? c.folder + '/' : '') + c.name, T('Brug nuværende farve', 'Use current colour'), T('Slet', 'Delete'));
  if (r === null) return; if (r === '__extra2') { APE.colors = APE.colors.filter((x) => x !== c); } else if (r === '__extra') c.rgbw = apeState.floors[APE.sel[0]].color.slice(); else { const p = r.split('/'); c.name = p.pop().trim() || c.name; c.folder = p.join('/').trim(); }
  apeSave(); apeRenderControl();
}
// ---- programmer ----
function apeRenderPrograms() {
  const el = $('#apePanePrograms'); if (!el) return; const lounge = APE.profile === 'lounge';
  el.innerHTML = `<p class="hint">${lounge ? T('I LOUNGE ligger programmerne i CONNECT-appen. Sæt "CONNECT-preset nr." så knappen trigger det.', 'In LOUNGE the programs live in the CONNECT app.') : T('Op til 4 trin: farve eller blackout, fade-tid og hold-tid. Speed skalerer tiden.', 'Up to 4 steps.')}</p>
    ${apeGrouped(APE.programs).map(([fd, ps]) => `<div class="ape-folder"><span class="muted small">${escHtml(fd)}</span><div class="ape-list">${ps.map((p) => `<div class="ape-prog" data-id="${p.id}">
      <div class="ape-prog-head"><input class="ape-pname" value="${escHtml(p.name)}"><input class="ape-pfolder" value="${escHtml(p.folder || '')}" placeholder="${T('Mappe', 'Folder')}">${lounge ? `<label class="small">${T('CONNECT-preset nr.', 'CONNECT preset no.')} <input type="number" class="vec-num ape-plounge" min="1" max="127" value="${p.lounge || ''}"></label>` : ''}<button class="primary small" data-a="play">▶ ${apeFloorsLabel(APE.sel)}</button><button class="ghost small" data-a="del">×</button></div>
      <div class="ape-steps">${[0, 1, 2, 3].map((i) => { const s = p.steps[i]; return `<div class="ape-step ${s ? '' : 'empty'}" data-i="${i}">${s ? `<input type="color" value="${s.color ? '#' + s.color.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('') : '#000000'}" ${s.color ? '' : 'disabled'}><label class="chk small"><input type="checkbox" class="ape-bo" ${s.color ? '' : 'checked'}> blackout</label><label class="small">fade <input type="number" class="vec-num ape-fade" step="0.1" min="0" value="${s.fade}"></label><label class="small">hold <input type="number" class="vec-num ape-holdt" step="0.1" min="0" value="${s.hold}"></label><button class="ghost small" data-a="rm">×</button>` : `<button class="ghost small" data-a="addstep">+ ${T('trin', 'step')}</button>`}</div>`; }).join('')}</div></div>`).join('')}</div></div>`).join('')}
    <button class="ghost" id="apeNewProg">+ ${T('Nyt program', 'New program')}</button>`;
  el.querySelectorAll('.ape-prog').forEach((row) => {
    const p = APE.programs.find((x) => x.id === row.dataset.id); const sv = () => { apeSave(); };
    row.querySelector('.ape-pname').onchange = (e) => { p.name = e.target.value; sv(); }; row.querySelector('.ape-pfolder').onchange = (e) => { p.folder = e.target.value; sv(); apeRenderPrograms(); };
    const lg = row.querySelector('.ape-plounge'); if (lg) lg.onchange = (e) => { p.lounge = +e.target.value || null; sv(); };
    row.querySelector('[data-a=play]').onclick = () => apeCmd({ op: 'program', program: p.id });
    row.querySelector('[data-a=del]').onclick = () => { APE.programs = APE.programs.filter((x) => x !== p); sv(); apeRenderPrograms(); };
    row.querySelectorAll('.ape-step').forEach((st_) => { const i = +st_.dataset.i, s = p.steps[i];
      const add = st_.querySelector('[data-a=addstep]'); if (add) { add.onclick = () => { p.steps.push({ color: [255, 255, 255, 0], fade: 1, hold: 1 }); sv(); apeRenderPrograms(); }; return; }
      st_.querySelector('input[type=color]').oninput = (e) => { const h = e.target.value; s.color = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)).concat([s.color ? s.color[3] : 0]); sv(); };
      st_.querySelector('.ape-bo').onchange = (e) => { s.color = e.target.checked ? null : [255, 255, 255, 0]; sv(); apeRenderPrograms(); };
      st_.querySelector('.ape-fade').onchange = (e) => { s.fade = Math.max(0, +e.target.value || 0); sv(); }; st_.querySelector('.ape-holdt').onchange = (e) => { s.hold = Math.max(0, +e.target.value || 0); sv(); };
      st_.querySelector('[data-a=rm]').onclick = () => { p.steps.splice(i, 1); sv(); apeRenderPrograms(); }; });
  });
  el.querySelectorAll('.ape-list').forEach((c) => apeSortable(c, APE.programs, apeRenderPrograms));
  $('#apeNewProg').onclick = () => { APE.programs.push({ id: uid('p'), name: T('Nyt program', 'New program'), folder: T('Mine', 'Mine'), steps: [{ color: [255, 255, 255, 0], fade: 1, hold: 1 }] }); apeSave(); apeRenderPrograms(); };
}
// ---- scener ----
function apeRenderScenes() {
  const el = $('#apePaneScenes'); if (!el) return; const lounge = APE.profile === 'lounge';
  el.innerHTML = `<div class="ape-row"><button class="primary" id="apeSnap">${T('Gem nu som scene', 'Save now as scene')} (${apeFloorsLabel(APE.sel)})</button><span class="muted small">${T('Recall påvirker kun de etager scenen er gemt med.', 'Recall only affects the floors stored in the scene.')}</span></div>
    ${lounge ? `<div class="ape-row"><button class="ghost small" data-l="scene.prev">◀ ${T('Forrige CONNECT-scene', 'Previous CONNECT scene')}</button><button class="ghost small" data-l="scene.next">${T('Næste CONNECT-scene', 'Next CONNECT scene')} ▶</button></div>` : ''}
    ${apeGrouped(APE.scenes).map(([fd, ss]) => `<div class="ape-folder"><span class="muted small">${escHtml(fd)}</span><div class="ape-list ape-scenes">${ss.map((s) => `<div class="ape-scene" data-id="${s.id}"><button class="ape-sbtn">${escHtml(s.name)}<small>${Object.keys(s.floors).map((f) => T('E', 'F') + f).join(' + ')}</small></button><input class="ape-sfolder" value="${escHtml(s.folder || '')}" placeholder="${T('Mappe', 'Folder')}">${lounge ? `<input type="number" class="vec-num ape-slounge" min="1" max="127" placeholder="CONNECT #" value="${s.lounge || ''}">` : ''}<button class="ghost small" data-a="ren">✎</button><button class="ghost small" data-a="del">×</button></div>`).join('')}</div></div>`).join('') || `<p class="hint">${T('Ingen scener endnu.', 'No scenes yet.')}</p>`}`;
  $('#apeSnap').onclick = async () => { const name = await modal(T('Navn på scenen', 'Scene name'), 'Scene ' + (APE.scenes.length + 1)); if (!name) return; const sc = ApeCore.snapshotScene(apeState, APE.sel); APE.scenes.push({ id: uid('s'), name, folder: T('Mine', 'Mine'), floors: sc.floors }); apeSave(); apeRenderScenes(); };
  el.querySelectorAll('[data-l]').forEach((b) => { b.onclick = () => apeBridgeSend(APE.sel, b.dataset.l); });
  el.querySelectorAll('.ape-scene').forEach((row) => { const s = APE.scenes.find((x) => x.id === row.dataset.id);
    row.querySelector('.ape-sbtn').onclick = () => apeCmd({ op: 'scene', id: s.id }, Object.keys(s.floors).map(Number));
    row.querySelector('.ape-sfolder').onchange = (e) => { s.folder = e.target.value; apeSave(); apeRenderScenes(); };
    const lg = row.querySelector('.ape-slounge'); if (lg) lg.onchange = (e) => { s.lounge = +e.target.value || null; apeSave(); };
    row.querySelector('[data-a=ren]').onclick = async () => { const n = await modal(T('Nyt navn', 'New name'), s.name); if (n) { s.name = n; apeSave(); apeRenderScenes(); } };
    row.querySelector('[data-a=del]').onclick = () => { APE.scenes = APE.scenes.filter((x) => x !== s); apeSave(); apeRenderScenes(); }; });
  el.querySelectorAll('.ape-scenes').forEach((c) => apeSortable(c, APE.scenes, apeRenderScenes));
}
// ---- rør & patch ----
function apeRenderPatch() {
  const el = $('#apePanePatch'); if (!el) return; const p = apePlan();
  el.innerHTML = `<div class="ape-row"><label>${T('DMX-mode for alle rør', 'DMX mode for all tubes')} <select id="apeChMode">${['4ch', '7ch', '32ch', '64ch', '128ch'].map((m) => `<option ${m === APE.chMode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <span class="${p.ok ? 'muted' : 'ape-bad'} small">${p.ok ? T(`${p.total} af 512 kanaler brugt`, `${p.total} of 512 channels used`) : T(`${p.need} kanaler – passer IKKE i ét univers. Én CONNECT = ét univers.`, `${p.need} channels – does NOT fit one universe.`)}</span></div>
    <table class="vec-table ape-tubes"><tr><th>${T('Navn', 'Name')}</th><th>${T('Etage', 'Floor')}</th><th>${T('Rækkefølge', 'Order')}</th><th>${T('Vend', 'Flip')}</th><th>Mode</th><th>${T('Adresse', 'Address')}</th><th>${T('Gruppe SHOW / LOUNGE', 'Group SHOW / LOUNGE')}</th><th>${T('Batteri · firmware · online', 'Battery · firmware · online')}</th></tr>
    ${APE.tubes.map((t) => { const pt = (p.tubes || []).find((x) => x.id === t.id) || {}; return `<tr data-id="${t.id}"><td><input class="ape-tname" value="${escHtml(t.name)}"></td><td><select class="ape-tfloor"><option value="1" ${t.floor === 1 ? 'selected' : ''}>1</option><option value="2" ${t.floor === 2 ? 'selected' : ''}>2</option></select></td><td><input type="number" class="vec-num ape-torder" min="1" max="6" value="${t.order ?? t.id}"></td><td><input type="checkbox" class="ape-tflip" ${t.flip ? 'checked' : ''}></td><td>${APE.chMode}</td><td>${pt.address ? pt.address + '–' + pt.end : '—'}</td><td>1 / ${t.floor}</td><td class="muted small">${T('ukendt – se CONNECT-app', 'unknown – see CONNECT app')}</td></tr>`; }).join('')}</table>
    <div class="ape-row"><label>${T('Wolfmix DMX-udgang der går i CONNECT', 'Wolfmix DMX output into CONNECT')} <select id="apeWolfOut">${['A', 'B', 'C', 'D'].map((o) => `<option ${o === (APE.wolfOut || 'B') ? 'selected' : ''}>${o}</option>`).join('')}</select></label><span class="muted small">${T('Rørene skal patches på samme udgang i Wolfmix.', 'Patch the tubes on the same output in Wolfmix.')}</span></div>
    <div class="ape-row ape-exports"><button class="ghost small" data-x="show">${T('CONNECT-trin: SHOW', 'CONNECT steps: SHOW')}</button><button class="ghost small" data-x="lounge">${T('CONNECT-trin: LOUNGE', 'CONNECT steps: LOUNGE')}</button><button class="ghost small" data-x="wolf">${T('Wolfmix-patchliste', 'Wolfmix patch list')}</button><button class="ghost small" data-x="fb">Fixture Builder ${APE.chMode}</button></div>
    <h4>Art-Net (${T('når du får en node', 'once you have a node')})</h4><div class="ape-row"><label>IP <input id="apeIp" value="${escHtml(APE.artnet.ip)}"></label><label>${T('Univers ud', 'Universe out')} <input type="number" id="apeUni" class="vec-num" min="0" max="32767" value="${APE.artnet.universe}"></label><label>${T('Wolfmix ind (topologi B)', 'Wolfmix in (topology B)')} <input type="number" id="apeUniIn" class="vec-num" min="0" value="${APE.wolfInUniverse ?? 2}"></label></div>
    <p class="hint">${T('Laseren bruger univers 0 – brug et andet univers til rørene. USB-DMX-bokse understøttes ikke endnu (kræver en driver); en Art-Net-node med XLR-udgang virker med det samme.', 'The laser uses universe 0 – use another universe for the tubes. USB-DMX boxes are not supported yet; an Art-Net node with XLR out works right away.')}</p>
    ${APE.topology === 'B' ? `<h4>${T('Ejerskab pr. etage (topologi B)', 'Ownership per floor (topology B)')}</h4><div class="ape-row">${[1, 2].map((f) => `<label>${T('Etage ', 'Floor ')}${f} <select data-own="${f}"><option value="wolfmix">${T('Wolfmix ejer', 'Wolfmix owns')}</option><option value="app">${T('App ejer', 'App owns')}</option><option value="merge">Merge (HTP/LTP)</option></select></label>`).join('')}</div>` : ''}
    <h4>${T('Kan kun gøres i CONNECT-appen', 'Only possible in the CONNECT app')}</h4><p class="hint">${T('Pairing-netværk, service-mode, firmware-opdatering, flicker-free, powersave (2–48 t), tyverialarm, cloud-sync, tænd/sluk på ekstern strøm og radar kræver CONNECT-appen med CONNECT i app-mode. Åbn CONNECT-appen på telefonen/tabletten → More.', 'Pairing network, service mode, firmware, flicker-free, power save, theft alarm, cloud sync, external power on/off and radar need the CONNECT app with CONNECT in app mode.')}</p>`;
  $('#apeChMode').onchange = (e) => { APE.chMode = e.target.value; apeSave(); apeRenderAll(); };
  $('#apeWolfOut').onchange = (e) => { APE.wolfOut = e.target.value; apeSave(); apeTopBar(); };
  el.querySelectorAll('tr[data-id]').forEach((tr) => { const t = APE.tubes.find((x) => x.id === +tr.dataset.id);
    tr.querySelector('.ape-tname').onchange = (e) => { t.name = e.target.value; apeSave(); };
    tr.querySelector('.ape-tfloor').onchange = (e) => { t.floor = +e.target.value; apeSave(); apeRenderPatch(); };
    tr.querySelector('.ape-torder').onchange = (e) => { t.order = +e.target.value; apeSave(); apePlan(); };
    tr.querySelector('.ape-tflip').onchange = (e) => { t.flip = e.target.checked; apeSave(); apePlan(); }; });
  el.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { const x = b.dataset.x, txt = x === 'wolf' ? ApeCore.exportWolfmixPatch(p, APE.wolfOut || 'B') : x === 'fb' ? ApeCore.exportFixtureBuilder(APE.chMode) : ApeCore.exportConnectSteps(p, x);
    apeDialog(b.textContent, `<pre class="ape-pre">${escHtml(txt)}</pre>`, [[T('Kopiér', 'Copy'), () => { try { navigator.clipboard.writeText(txt); toast(T('Kopieret', 'Copied')); } catch (_) {} }], [T('Luk', 'Close'), null]]); }; });
  $('#apeIp').onchange = (e) => { APE.artnet.ip = e.target.value.trim(); apeSave(); apeTopBar(); };
  $('#apeUni').onchange = (e) => { APE.artnet.universe = Math.max(0, +e.target.value | 0); apeSave(); apeTopBar(); };
  $('#apeUniIn').onchange = (e) => { APE.wolfInUniverse = Math.max(0, +e.target.value | 0); apeSave(); };
  el.querySelectorAll('[data-own]').forEach((s) => { s.value = APE.owners[s.dataset.own] || 'merge'; s.onchange = () => { APE.owners[s.dataset.own] = s.value; apeSave(); }; });
}
// ---- MIDI-bro (LOUNGE) + Wolfmix-mål (SHOW A) ----
function apeRenderBridge() {
  const el = $('#apePaneBridge'); if (!el) return; const outs = apeMidiOuts(), b = apeBindings(), acts = ApeCore.bridgeActions(), dups = ApeCore.duplicateBindings(b);
  const opt = (sel) => `<option value="">—</option>` + outs.map((o) => `<option ${o.name === sel ? 'selected' : ''}>${escHtml(o.name)}</option>`).join('');
  el.innerHTML = `<h4>${T('LOUNGE: MIDI til CONNECT-appen', 'LOUNGE: MIDI to the CONNECT app')}</h4>
    <p class="hint">${T('Udgang: Bluetooth-MIDI eller USB-MIDI til den enhed der kører CONNECT-appen (Mac: Lydmidi-opsætning → MIDI-studie → Bluetooth). Kører CONNECT-appen på denne Mac, så brug "IAC-driver" (slå den til i MIDI-studie).', 'Output: Bluetooth or USB MIDI to the device running the CONNECT app. If the CONNECT app runs on this Mac, use the "IAC Driver".')}</p>
    <div class="ape-row"><label>${T('Udgang', 'Output')} <select id="apeBrPort">${opt(APE.bridge.port)}</select></label><button class="primary small" id="apeGuide">${T('Bind-guide…', 'Binding guide…')}</button><button class="ghost small" id="apeBrExp">${T('Eksportér', 'Export')}</button><button class="ghost small" id="apeBrImp">${T('Importér', 'Import')}</button><input type="file" id="apeBrFile" accept=".json" hidden></div>
    ${dups.length ? `<p class="ape-bad small">${T('Dubletter: ', 'Duplicates: ')}${dups.map((d) => d.join(' = ')).join(', ')}</p>` : ''}
    <details><summary>${T('Bindingstabel', 'Binding table')} (${acts.length})</summary><table class="vec-table"><tr><th>${T('Handling i CONNECT', 'Action in CONNECT')}</th><th>${T('Navn hos dig', 'Your name')}</th><th>Type</th><th>${T('Kanal', 'Channel')}</th><th>Nr.</th><th></th></tr>
      ${acts.map((a) => { const x = b[a.id] || { type: 'cc', ch: 16, num: 0 }; return `<tr data-a="${a.id}"><td>${escHtml(a.label)}</td><td>${/^(preset|scene):/.test(a.id) ? `<input class="ape-bname" value="${escHtml(APE.bridge.names[a.id] || '')}" placeholder="${T('fx Lilla fade', 'e.g. Purple fade')}">` : ''}</td><td><select class="ape-btype"><option value="cc" ${x.type === 'cc' ? 'selected' : ''}>CC</option><option value="pc" ${x.type === 'pc' ? 'selected' : ''}>PC</option></select></td><td><input type="number" class="vec-num ape-bch" min="1" max="16" value="${x.ch}"></td><td><input type="number" class="vec-num ape-bnum" min="0" max="127" value="${x.num}"></td><td><button class="ghost small" data-send>▶</button></td></tr>`; }).join('')}</table></details>
    <h4>${T('SHOW topologi A: MIDI til Wolfmix', 'SHOW topology A: MIDI to Wolfmix')}</h4>
    <p class="hint">${T('Kræver et MIDI-kabel ind i Wolfmix (MIDIFLEX Out → MIDIMATE IN). Gruppe A = etage 1, gruppe B = etage 2. Sæt "MIDI In" på Wolfmix\' gruppedimmere og presets til de samme numre.', 'Needs a MIDI cable into the Wolfmix. Group A = floor 1, group B = floor 2.')}</p>
    <div class="ape-row"><label>${T('Udgang', 'Output')} <select id="apeWfPort">${opt(APE.wolf.port)}</select></label>${[1, 2].map((f) => `<label>${T('Gruppe ', 'Group ')}${f === 1 ? 'A' : 'B'} dimmer: ${T('kanal', 'ch')} <input type="number" class="vec-num" data-wd="${f}" data-k="ch" min="1" max="16" value="${APE.wolf.dim[f].ch}"> CC <input type="number" class="vec-num" data-wd="${f}" data-k="cc" min="0" max="127" value="${APE.wolf.dim[f].cc}"></label>`).join('')}</div>
    <div class="ape-wpresets">${APE.wolf.presets.map((p, i) => `<div class="ape-row" data-wp="${i}"><input class="ape-wpn" value="${escHtml(p.name)}"><label>${T('kanal', 'ch')} <input type="number" class="vec-num ape-wpc" min="1" max="16" value="${p.ch}"></label><label>note <input type="number" class="vec-num ape-wpnote" min="0" max="127" value="${p.note}"></label><button class="ghost small" data-a="del">×</button></div>`).join('')}</div>
    <button class="ghost small" id="apeWfAdd">+ ${T('Wolfmix-preset', 'Wolfmix preset')}</button>`;
  $('#apeBrPort').onchange = (e) => { APE.bridge.port = e.target.value; apeSave(); };
  $('#apeWfPort').onchange = (e) => { APE.wolf.port = e.target.value; apeSave(); };
  el.querySelectorAll('tr[data-a]').forEach((tr) => { const id = tr.dataset.a, x = b[id] || (b[id] = { type: 'cc', ch: 16, num: 0 });
    tr.querySelector('.ape-btype').onchange = (e) => { x.type = e.target.value; apeSave(); apeRenderBridge(); };
    tr.querySelector('.ape-bch').onchange = (e) => { x.ch = Math.max(1, Math.min(16, +e.target.value | 0)); apeSave(); };
    tr.querySelector('.ape-bnum').onchange = (e) => { x.num = Math.max(0, Math.min(127, +e.target.value | 0)); apeSave(); apeRenderBridge(); };
    const nm = tr.querySelector('.ape-bname'); if (nm) nm.onchange = (e) => { APE.bridge.names[id] = e.target.value; apeSave(); };
    tr.querySelector('[data-send]').onclick = () => { if (!apeMidiSend(APE.bridge.port, ApeCore.bindingBytes(x, 127))) toast(T('Vælg en udgang først', 'Pick an output first')); }; });
  $('#apeGuide').onclick = apeBindGuide;
  $('#apeBrExp').onclick = () => { const txt = ApeCore.exportBindings(b); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'smartlink-connect-midi.json'; a.click(); };
  $('#apeBrImp').onclick = () => $('#apeBrFile').click();
  $('#apeBrFile').onchange = async (e) => { try { APE.bridge.bindings = ApeCore.importBindings(await e.target.files[0].text()); apeSave(); apeRenderBridge(); toast('✓'); } catch (err) { toast(err.message); } e.target.value = ''; };
  el.querySelectorAll('[data-wd]').forEach((i) => { i.onchange = () => { APE.wolf.dim[i.dataset.wd][i.dataset.k] = +i.value | 0; apeSave(); }; });
  el.querySelectorAll('[data-wp]').forEach((row) => { const p = APE.wolf.presets[+row.dataset.wp];
    row.querySelector('.ape-wpn').onchange = (e) => { p.name = e.target.value; apeSave(); }; row.querySelector('.ape-wpc').onchange = (e) => { p.ch = +e.target.value | 0; apeSave(); }; row.querySelector('.ape-wpnote').onchange = (e) => { p.note = +e.target.value | 0; apeSave(); };
    row.querySelector('[data-a=del]').onclick = () => { APE.wolf.presets.splice(+row.dataset.wp, 1); apeSave(); apeRenderBridge(); }; });
  $('#apeWfAdd').onclick = () => { APE.wolf.presets.push({ name: 'Preset ' + (APE.wolf.presets.length + 1), ch: 1, note: 36 + APE.wolf.presets.length }); apeSave(); apeRenderBridge(); };
}
function apeBindGuide() { // én besked ad gangen, mens brugeren trykker Learn i CONNECT-appen
  const acts = ApeCore.bridgeActions(), b = apeBindings(); let i = AP.guideIdx || 0;
  const show = () => { const a = acts[i], x = b[a.id];
    const ov = apeDialog(T('Bind-guide ', 'Binding guide ') + (i + 1) + '/' + acts.length, `<ol class="ape-guide"><li>${T('I CONNECT-appen: More → External control via MIDI → tilføj en handling', 'In the CONNECT app: More → External control via MIDI → add an action')}: <b>${escHtml(a.label)}</b>${a.valued ? T(' (værdi fra CC)', ' (value from CC)') : ''}.</li><li>${T('Tryk Learn i CONNECT-appen.', 'Press Learn in the CONNECT app.')}</li><li>${T('Tryk "Send" her', 'Press "Send" here')} → ${x.type.toUpperCase()} ${T('kanal', 'ch')} ${x.ch}, nr. ${x.num}.</li></ol><p class="hint">${APE.bridge.port ? T('Udgang: ', 'Output: ') + escHtml(APE.bridge.port) : T('⚠ Vælg en udgang under MIDI-bro først.', '⚠ Pick an output first.')}</p>`,
      [[T('Luk', 'Close'), () => { AP.guideIdx = i; }], ['◀', () => { i = Math.max(0, i - 1); show(); }], [T('Send', 'Send'), () => { apeMidiSend(APE.bridge.port, ApeCore.bindingBytes(x, 127)); show(); }], [T('Næste ▶', 'Next ▶'), () => { i = Math.min(acts.length - 1, i + 1); AP.guideIdx = i; show(); }]]);
    ov.querySelectorAll('.ape-dlg-btns button').forEach((bt) => bt.classList.remove('primary')); ov.querySelectorAll('.ape-dlg-btns button')[2].classList.add('primary'); };
  show();
}
// ---- telefoner ----
async function apeRenderPhones() {
  const el = $('#apePanePhones'); if (!el) return; let links = null; try { links = await window.laser.apeLinks(); } catch (_) {}
  el.innerHTML = `<p class="hint">${T('Hver telefon åbner sit eget link (samme Wi-Fi). Rollen ligger i linket, så "Etage 1"-telefonen kan kun styre etage 1. Sidste kommando vinder; Wolfmix-kommandoer vises som "wolfmix".', 'Each phone opens its own link (same Wi-Fi). The role is in the link.')}</p>
    ${links && links.enabled ? `<div class="ape-links">${[['f1', T('Etage 1', 'Floor 1')], ['f2', T('Etage 2', 'Floor 2')], ['all', T('Alle', 'All')]].map(([r, l]) => `<div class="ape-link"><b>${l}</b>${links.qr && links.qr[r] ? `<img src="${links.qr[r]}" alt="">` : ''}<code>${escHtml(links.urls[r] || '')}</code></div>`).join('')}</div>` : `<p class="ape-bad">${T('Telefon-adgang er slået fra. Slå "Mobil" til øverst (samme knap som laser-fjernbetjeningen).', 'Phone access is off. Turn on "Mobile" at the top.')}</p>`}
    <h4>${T('Lås etage til Wolfmix', 'Lock floor to Wolfmix')}</h4><div class="ape-row">${[1, 2].map((f) => `<label class="chk"><input type="checkbox" data-lock="${f}" ${APE.locks[f] ? 'checked' : ''}> ${T('Etage ', 'Floor ')}${f} ${T('(telefonen bliver read-only)', '(phone becomes read-only)')}</label>`).join('')}</div>`;
  el.querySelectorAll('[data-lock]').forEach((c) => { c.onchange = () => { APE.locks[c.dataset.lock] = c.checked; apeSave(); }; });
}
// ---------- forbindelse: hvad kan måles, og hvad skal bekræftes ved at se på rørene ----------
// CONNECT sender intet tilbage (ingen batteri-, link- eller DMX-status), så kun appens egen side kan måles. Resten testes med lys.
function apeLinkSegments() {
  const lounge = APE.profile === 'lounge', topo = APE.topology, out = APE.wolfOut || 'B', seg = [], now = Date.now(), ck = APE.checks || {};
  const conf = (key, title, detail, howTo) => seg.push({ key, title, detail, howTo, state: ck[key] ? 'confirmed' : 'unknown', at: ck[key] });
  if (lounge) {
    const port = APE.bridge.port, has = apeMidiOuts().some((o) => o.name === port);
    seg.push({ key: 'bridge', title: T('Mac → MIDI-udgang', 'Mac → MIDI output'), state: has ? 'ok' : 'bad', detail: has ? port : port ? T('udgangen findes ikke lige nu: ', 'output missing: ') + port : T('ingen udgang valgt (MIDI-bro)', 'no output selected (MIDI bridge)') });
    conf('app', T('CONNECT-appen ↔ CONNECT (Bluetooth)', 'CONNECT app ↔ CONNECT (Bluetooth)'), T('CONNECT i APP-mode og forbundet i CONNECT-appen', 'CONNECT in app mode and connected in the app'));
    conf('ext', T('"External control via MIDI" + bindinger lært', '"External control via MIDI" + bindings learned'), T('Brug bind-guiden under MIDI-bro', 'Use the binding guide under MIDI bridge'));
  } else if (topo === 'A') {
    const ins = typeof wmiInputs === 'function' ? wmiInputs() : [], ago = typeof WMI !== 'undefined' && WMI.lastAt ? Math.round((now - WMI.lastAt) / 1000) : null;
    seg.push({ key: 'midiIn', title: T('Wolfmix → Mac (MIDI)', 'Wolfmix → Mac (MIDI)'), state: ins.length ? 'ok' : 'bad', detail: ins.length ? ins.map((i) => i.name).join(', ') + (ago != null ? T(' · sidste signal ', ' · last signal ') + ago + T(' sek. siden', ' s ago') : '') : T('ingen MIDI-indgang – kun nødvendig hvis Wolfmix-knapper skal styre appen', 'no MIDI input') });
    const wp = APE.wolf.port, wHas = apeMidiOuts().some((o) => o.name === wp);
    seg.push({ key: 'midiOut', title: T('Mac → Wolfmix (MIDI ud)', 'Mac → Wolfmix (MIDI out)'), state: !wp ? 'na' : wHas ? 'ok' : 'bad', detail: !wp ? T('valgfrit – kun hvis appen skal styre rørene via Wolfmix (MIDI-bro)', 'optional – only if the app should drive the tubes via Wolfmix') : wHas ? wp : T('udgangen findes ikke: ', 'output missing: ') + wp });
    conf('dmx', T(`Wolfmix DMX ${out} → CONNECT DMX IN`, `Wolfmix DMX ${out} → CONNECT DMX IN`), T(`3-pin XLR fra udgang ${out}. Rørene patchet på udgang ${out} i Wolfmix (64ch, adresse 1, 65, 129, 193, 257, 321).`, `3-pin XLR from output ${out}; tubes patched on output ${out}.`));
  } else {
    const nodes = AP.nodes || [];
    seg.push({ key: 'node', title: T('Art-Net-node på netværket', 'Art-Net node on the network'), state: nodes.length ? 'ok' : 'bad', detail: nodes.length ? nodes.map((n) => `${n.name || n.longName || 'node'} (${n.ip})`).join(', ') : T('ingen node svarer – tjek kabel/IP (laseren tæller ikke)', 'no node answers') });
    const sending = APE.out && now - AP.sentAt < 1000;
    seg.push({ key: 'send', title: T('SmartLink sender DMX', 'SmartLink sends DMX'), state: sending ? 'ok' : 'bad', detail: sending ? `${T('univers', 'universe')} ${APE.artnet.universe} → ${APE.artnet.ip} · 40 Hz` : T('"Send DMX" er slået fra', '"Send DMX" is off') });
    if (topo === 'B') seg.push({ key: 'wolfIn', title: T('Wolfmix ind (DMX-IN)', 'Wolfmix in (DMX-IN)'), state: now - AP.wolfInAt < 2000 ? 'ok' : 'bad', detail: now - AP.wolfInAt < 2000 ? T('modtager univers ', 'receiving universe ') + (APE.wolfInUniverse ?? 2) : T('intet fra Wolfmix på univers ', 'nothing from Wolfmix on universe ') + (APE.wolfInUniverse ?? 2) });
  }
  if (!lounge) conf('connect', T('CONNECT som DMX-transmitter, gruppe 1', 'CONNECT as DMX transmitter, group 1'), T('More → DMX transmitter → Gruppe 1 → Enable (eller 6 sek. tryk fra slukket)', 'More → DMX transmitter → Group 1 → Enable'));
  conf('tubes', T('Rørene reagerer', 'The tubes respond'), lounge ? T('Rør 1–3 i gruppe 1, rør 4–6 i gruppe 2', 'Tubes 1–3 in group 1, 4–6 in group 2') : T(`Alle 6 rør i gruppe 1, ${APE.chMode}, adresser fra Rør & patch`, `All 6 tubes in group 1, ${APE.chMode}`));
  return seg;
}
function apeLinkSummary() {
  const seg = apeLinkSegments().filter((x) => x.state !== 'na'), bad = seg.filter((x) => x.state === 'bad').length, okN = seg.filter((x) => x.state === 'ok' || x.state === 'confirmed').length;
  return { cls: bad ? 'bad' : okN === seg.length ? 'ok' : 'warn', txt: (bad ? '● ' : okN === seg.length ? '● ' : '◐ ') + T('Forbindelse ', 'Link ') + okN + '/' + seg.length };
}
const APE_TROUBLE = () => APE.profile === 'lounge' ? [T('Er CONNECT i APP-mode (ikke DMX)? Hold knappen 6 sek. fra slukket for at skifte.', 'Is CONNECT in app mode?'), T('Er CONNECT-appen forbundet og "External control via MIDI" slået til?', 'Is the CONNECT app connected and External control on?'), T('Sender du på den rigtige MIDI-udgang (MIDI-bro)? Brug ▶ ud for en binding og se om CONNECT-appen reagerer.', 'Right MIDI output?'), T('Er bindingerne lært (bind-guiden)?', 'Are the bindings learned?')]
  : [T(`Sidder kablet i Wolfmix' DMX ${APE.wolfOut || 'B'} og i CONNECT DMX IN (ikke OUT)?`, 'Cable in the right ports?'), T('Er CONNECT i DMX-transmitter-mode på gruppe 1? (CONNECT-appen er låst i DMX-mode – det er normalt.)', 'Is CONNECT a DMX transmitter on group 1?'), T('Står alle 6 rør i gruppe 1 med DMX-mode og adresse fra trinlisten? (Sættes i CONNECT-appen FØR der skiftes til DMX.)', 'Are all tubes in group 1 with DMX mode and address?'), T('Er rørene tændt og parret til samme CONNECT-netværk?', 'Are the tubes on and paired to the same network?'), APE.topology === 'A' ? T(`Er rørene patchet på udgang ${APE.wolfOut || 'B'} i Wolfmix, og lyser et preset dem op (master oppe, ingen blackout)?`, 'Are the tubes patched on the right Wolfmix output?') : T('Svarer Art-Net-noden, og står den på samme univers som her?', 'Does the Art-Net node answer on the same universe?')];
function apeRenderLink() {
  const el = $('#apePaneLink'); if (!el) return; const seg = apeLinkSegments(), lounge = APE.profile === 'lounge', topo = APE.topology;
  const icon = { ok: '●', bad: '●', unknown: '○', confirmed: '✓', na: '–' }, word = { ok: T('målt OK', 'measured OK'), bad: T('fejl', 'problem'), unknown: T('kan ikke måles – bekræft', 'cannot be measured – confirm'), confirmed: T('bekræftet', 'confirmed'), na: T('bruges ikke', 'not used') };
  const testTxt = lounge ? T('Appen sender blackout til/fra to gange via CONNECT-appen. Blinker rørene?', 'The app sends blackout on/off twice via the CONNECT app. Do the tubes blink?')
    : topo === 'A' ? T(`Appen kan ikke sende DMX i topologi A (Wolfmix ejer kablet). Tryk et preset på Wolfmix, der bruger rørene (patchet på DMX ${APE.wolfOut || 'B'}). Lyser de?`, `Press a Wolfmix preset that uses the tubes. Do they light?`)
    : T('Appen tænder rør 1 → 6 hvidt ét ad gangen (2 runder). Lyser de – og i den rækkefølge?', 'The app lights tube 1 → 6 one at a time. Do they light in order?');
  el.innerHTML = `<p class="hint">${T('CONNECT sender intet tilbage (ingen link-, batteri- eller DMX-status). Grøn = appen har målt det. Ring = kan ikke måles – kør testen og se på rørene.', 'CONNECT gives no feedback. Green = measured. Ring = cannot be measured – run the test and look at the tubes.')}</p>
    <div class="ape-chain">${seg.map((x, i) => `<div class="ape-link-seg ${x.state}"><span class="ape-ls-i">${icon[x.state]}</span><div><b>${x.title}</b><small>${escHtml(x.detail || '')}</small><em>${word[x.state]}${x.at ? ' · ' + new Date(x.at).toLocaleTimeString().slice(0, 5) : ''}</em></div>${x.state === 'unknown' || x.state === 'confirmed' ? `<label class="chk small"><input type="checkbox" data-ck="${x.key}" ${x.state === 'confirmed' ? 'checked' : ''}> ${T('OK', 'OK')}</label>` : ''}</div>${i < seg.length - 1 ? '<span class="ape-chain-arrow">↓</span>' : ''}`).join('')}</div>
    <section class="ape-card ape-test"><h4>${T('Lys-test', 'Light test')}</h4><p>${testTxt}</p>
      <div class="ape-row">${lounge || topo !== 'A' ? `<button class="primary" id="apeTestRun">${AP.ident ? T('Kører… rør ', 'Running… tube ') + (AP.ident.cur || '') : T('▶ Kør test', '▶ Run test')}</button>` : ''}<button id="apeTestYes">${T('Ja, det virker', 'Yes, it works')}</button><button id="apeTestNo">${T('Nej, intet lys', 'No light')}</button></div>
      <div id="apeTrouble" ${AP.trouble ? '' : 'hidden'}><h4>${T('Tjek i denne rækkefølge', 'Check in this order')}</h4><ol>${APE_TROUBLE().map((x) => `<li>${escHtml(x)}</li>`).join('')}</ol></div>
      ${!lounge && topo !== 'A' && APE.profile === 'show' && !APE.out ? `<p class="ape-bad small">${T('Slå "Send DMX" til i toppen før testen.', 'Turn on "Send DMX" first.')}</p>` : ''}
    </section>
    <div class="ape-row"><button class="ghost small" id="apeUsb">${T('Kan Mac\'en se CONNECT på USB?', 'Can the Mac see CONNECT on USB?')}</button><span class="muted small" id="apeUsbRes">${AP.usbRes || T('CONNECT\'s USB bruges kun til strøm/firmware – DMX går via XLR, og styring via Bluetooth.', 'CONNECT USB is power/firmware only.')}</span></div>`;
  el.querySelectorAll('[data-ck]').forEach((c) => { c.onchange = () => { APE.checks = APE.checks || {}; if (c.checked) APE.checks[c.dataset.ck] = Date.now(); else delete APE.checks[c.dataset.ck]; apeSave(); apeRenderLink(); apeTopBar(); }; });
  const run = $('#apeTestRun'); if (run) run.onclick = () => {
    if (lounge) { apeBridgeSend([1, 2], 'blackout.toggle'); setTimeout(() => apeBridgeSend([1, 2], 'blackout.toggle'), 700); setTimeout(() => apeBridgeSend([1, 2], 'blackout.toggle'), 1400); setTimeout(() => apeBridgeSend([1, 2], 'blackout.toggle'), 2100); return; }
    if (!APE.out) { toast(T('Slå "Send DMX" til først', 'Turn on "Send DMX" first')); return; }
    AP.ident = { t0: performance.now(), cur: 1 }; const tick = setInterval(() => { if (!AP.ident) { clearInterval(tick); apeRenderLink(); return; } const b = $('#apeTestRun'); if (b) b.textContent = T('Kører… rør ', 'Running… tube ') + AP.ident.cur; }, 150);
  };
  $('#apeTestYes').onclick = () => { APE.checks = APE.checks || {}; const t = Date.now(); for (const x of seg) if (x.state === 'unknown') APE.checks[x.key] = t; APE.checks.tubes = t; AP.trouble = false; apeSave(); apeRenderLink(); apeTopBar(); toast(T('✓ Forbindelsen er bekræftet', '✓ Link confirmed')); };
  $('#apeTestNo').onclick = () => { APE.checks = {}; AP.trouble = true; apeSave(); apeRenderLink(); apeTopBar(); };
  $('#apeUsb').onclick = async () => { $('#apeUsbRes').textContent = T('Søger…', 'Searching…'); try { const r = await window.laser.usbFind(); AP.usbRes = !r.ok ? T('Kunne ikke søge: ', 'Search failed: ') + r.error : r.hits.length ? T('Mac\'en ser: ', 'The Mac sees: ') + r.hits.join(' · ') + T(' (USB = strøm/firmware, ikke DMX)', ' (USB = power/firmware, not DMX)') : T('Ingen CONNECT på USB. Det er OK – DMX går via XLR-kablet fra Wolfmix.', 'No CONNECT on USB. That is fine – DMX goes via XLR.'); } catch (e) { AP.usbRes = e.message; } $('#apeUsbRes').textContent = AP.usbRes; };
}
function apeInit() {
  if (!$('#page-ape')) return;
  $$('#apeTabs button').forEach((b) => { b.onclick = () => { APE.tab = b.dataset.t; apeSave(); apeRenderTabs(); if (APE.tab === 'phones') apeRenderPhones(); if (APE.tab === 'bridge') apeRenderBridge(); }; });
  document.querySelector('[data-tab="ape"]').addEventListener('click', () => requestAnimationFrame(apeRenderAll));
  apeRenderAll(); requestAnimationFrame(apeLoop);
  setInterval(() => { if (!$('#page-ape').classList.contains('active')) return; const sum = $('#apeLinkSum'); if (sum) { const x = apeLinkSummary(); sum.textContent = x.txt; sum.className = 'ape-linksum ' + x.cls; } if (APE.tab === 'link' && !$('#apePaneLink').contains(document.activeElement)) apeRenderLink(); }, 1500);
  window.laser.artnetNodes && setInterval(async () => { try { AP.nodes = await window.laser.artnetNodes(); } catch (_) {} }, 3000);
}
apeInit();
