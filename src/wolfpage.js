/* SmartLink – Wolfmix-siden: MIDI fra Wolfmix W1 MK3 (via MIDIMATE eX → MIDIFLEX 4) → navngivne signaler → handlinger (actions.js).
 * Web MIDI (Chromium/CoreMIDI) – ingen ekstra afhængigheder. Hot-plug via onstatechange. Tolkning/datamodel ligger i wolfmidi.js.
 */
'use strict';
const WMI = { access: null, err: '', noteState: {}, log: [], dumpT: null, version: '', ccState: {}, learn: null, rows: {}, lastAt: 0, lastSrc: '', saveT: null, optsT: '', optsC: '' };
let wmiState = WolfMidi.sanitize(store.get('wolfMidi', null));
if (!wmiState.out) wmiState.out = { name: '', channel: 1, note: 0, velocity: 127 }; // SmartLink → Wolfmix (UI kommer senere)
const wmiSave = (now) => { clearTimeout(WMI.saveT); if (now) store.set('wolfMidi', wmiState); else WMI.saveT = setTimeout(() => store.set('wolfMidi', wmiState), 800); };

// ---------- MIDI ind ----------
async function wmiInit() {
  if (!navigator.requestMIDIAccess) { WMI.err = t('wmidi.noWebMidi'); wmiStatus(); return; }
  try { WMI.access = await navigator.requestMIDIAccess({ sysex: false }); } catch (e) { WMI.err = t('wmidi.denied') + ' (' + (e.message || e) + ')'; wmiStatus(); return; }
  const hook = () => { WMI.access.inputs.forEach((inp) => { inp.onmidimessage = (e) => wmiHandle(e.data, inp.name); }); wmiStatus(); };
  hook(); WMI.access.onstatechange = hook; // MIDIFLEX sat i / taget ud – ingen genstart
}
function wmiInputs() { return WMI.access ? [...WMI.access.inputs.values()].filter((i) => i.state !== 'disconnected') : []; }
function wmiHandle(data, source) {
  const raw = WolfMidi.parse(data); if (!raw) { if (data[0] < 0xf8) wmiLog(source, data, null, ''); return; } // clock/active sensing ignoreres helt
  const now = Date.now(), ev = WolfMidi.normalize(raw, WMI.noteState); WMI.lastAt = now; WMI.lastSrc = source;
  if (typeof wcIntercept === 'function' && wcIntercept(ev)) { wmiSave(); wmiRender(); wmiLog(source, data, ev, t('wc.logLinked')); return; } // konsollen lytter: forbind, udfør intet
  // 1) udfør først (lav latens), 2) så UI
  let learned = false, did = '';
  if (WMI.learn) { const slot = WolfMidi.learnSlot(WMI.learn.kind, ev); if (slot) { wmiBindLearned(ev, slot); learned = true; did = t('wmidi.logLearned'); } }
  else if (wmiState.active) { const acts = WolfMidi.dispatch(wmiState, WMI.ccState, ev, now, SL_ACTIONS.isHold); did = acts.map((a) => (SL_ACTIONS.run(a.action, a.value) ? '✓ ' : '✗ ') + SL_ACTIONS.label(SL_ACTIONS.byId[a.action])).join(', '); }
  else did = t('wmidi.logPaused');
  if (!wmiState.active && ev.type === 'cc') WolfMidi.ccEdges(WMI.ccState, ev.id, ev.value, (wmiState.bindings[ev.id] || {}).threshold ?? WolfMidi.DEFAULT_THR, now); // hold CC-knaptilstand korrekt også på pause
  const isNew = WolfMidi.record(wmiState, ev); wmiSave();
  if (isNew || learned) wmiRender(); else wmiUpdateRow(ev.id);
  wmiFlash(ev.id); wmiLog(source, data, ev, did);
  if (typeof wcSignal === 'function') wcSignal(ev);
}
// ---------- MIDI-log: de seneste beskeder på siden + fejlsøgningsfil (~/Desktop/SmartLink/wolfmidi-debug.json) ----------
function wmiLog(source, data, ev, did) {
  const hex = [...data].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  WMI.log.unshift({ at: new Date().toISOString().slice(11, 23), source, hex, id: ev ? ev.id : '?', event: ev ? ev.event + (ev.zeroPress ? '*' : '') : t('wmidi.logUnknown'), value: ev ? ev.value : null, did });
  WMI.log.length = Math.min(WMI.log.length, 40);
  const el = $('#wmidiLog'); if (el) el.innerHTML = WMI.log.slice(0, 6).map((l) => `<div><span class="muted">${l.at}</span> <b>${l.hex}</b> → ${escHtml(l.id)} ${escHtml(l.event)} ${l.value ?? ''} ${l.did ? '· ' + escHtml(l.did) : `· <span class="muted">${t('wmidi.logNone')}</span>`}</div>`).join('');
  wmiDebugDump();
}
function wmiDebugDump() {
  clearTimeout(WMI.dumpT); WMI.dumpT = setTimeout(() => { try { if (window.laser.wolfDebug) window.laser.wolfDebug(JSON.stringify({ at: new Date().toISOString(), version: WMI.version, err: WMI.err, inputs: wmiInputs().map((i) => ({ name: i.name, state: i.state, connection: i.connection })), outputs: WMI.access ? [...WMI.access.outputs.values()].map((o) => o.name) : [], learn: WMI.learn, active: wmiState.active, blackout: typeof blackout !== 'undefined' ? blackout : null, log: WMI.log, signals: wmiState.signals, bindings: wmiState.bindings }, null, 1)); } catch (_) {} }, 500);
}
// ---------- MIDI ud: SmartLink → Wolfmix (kræver kabel fra MIDIFLEX Out 3 til MIDIMATE IN) ----------
function wmiOutput() { if (!WMI.access) return null; const outs = [...WMI.access.outputs.values()]; return outs.find((o) => wmiState.out.name && o.name === wmiState.out.name) || outs.find((o) => /midiflex/i.test(o.name)) || outs[0] || null; }
function sendNote(channel, note, velocity = 127) {
  const o = wmiOutput(); if (!o) return false; const on = WolfMidi.toBytes('note', channel, note, Math.max(1, velocity)), off = WolfMidi.toBytes('note', channel, note, 0);
  o.send(on); o.send(off, performance.now() + 80); return true;
}
function wolfSendPreset() { const c = wmiState.out; if (!sendNote(c.channel, c.note, c.velocity)) toast(t('wmidi.noOut')); }

// ---------- Lær ----------
function wmiStartLearn(actionId) {
  const a = SL_ACTIONS.byId[actionId]; if (!a) return; WMI.learn = { action: a.id, kind: a.kind };
  const m = $('#wmidiLearnMsg'); m.hidden = false; m.textContent = t('wmidi.learning', { a: SL_ACTIONS.label(a) }); $('#wmidiLearn').textContent = t('wmidi.learnCancel');
}
function wmiStopLearn(msg) { WMI.learn = null; const m = $('#wmidiLearnMsg'); if (msg) { m.textContent = msg; setTimeout(() => { if (!WMI.learn) m.hidden = true; }, 3500); } else m.hidden = true; $('#wmidiLearn').textContent = t('wmidi.learn'); }
function wmiBindLearned(ev, slot) {
  const a = SL_ACTIONS.byId[WMI.learn.action]; WolfMidi.record(wmiState, ev); const bb = WolfMidi.bind(wmiState, ev.id, slot, a.id); if (ev.type === 'cc' && slot === 'onPress') { bb.threshold = WolfMidi.learnThreshold(ev); WolfMidi.ccEdges(WMI.ccState, ev.id, ev.value, bb.threshold); } wmiSave(true);
  const nm = wmiState.signals[ev.id].name || ev.id; wmiStopLearn(t('wmidi.learned', { s: nm, a: SL_ACTIONS.label(a) })); wmiRenderActs();
}

// ---------- visning ----------
function wmiOptions(kind) {
  const groups = { laser: 'wmidi.gLaser', show: 'wmidi.gShow', look: 'wmidi.gLook', preset: 'wmidi.gPreset', scene: 'wmidi.gScene', wolfmix: 'wmidi.gWolf', cont: 'wmidi.gCont', hold: 'wmidi.gHold', ape: 'wmidi.gApe' };
  let h = `<option value="">${t('wm.f.none')}</option>`, g = null;
  for (const a of SL_ACTIONS.list) if (a.kind === kind || (kind === 'trigger' && a.kind === 'hold')) { if (a.group !== g) { if (g) h += '</optgroup>'; g = a.group; h += `<optgroup label="${t(groups[g] || g)}">`; } h += `<option value="${a.id}">${escHtml(SL_ACTIONS.label(a))}</option>`; }
  return h + (g ? '</optgroup>' : '');
}
function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function wmiSorted() { const o = { note: 0, cc: 1, pc: 2 }; return Object.entries(wmiState.signals).sort(([, a], [, b]) => (o[a.type] - o[b.type]) || (a.channel - b.channel) || (a.number - b.number)); }
function wmiRender() {
  const tb = $('#wmidiTable'); if (!tb) return; WMI.optsT = wmiOptions('trigger'); WMI.optsC = wmiOptions('continuous'); WMI.rows = {};
  tb.innerHTML = `<thead><tr><th>${t('wmidi.thName')}</th><th>${t('wmidi.thId')}</th><th>${t('wmidi.thType')}</th><th>${t('wmidi.ch')}</th><th>${t('wmidi.nr')}</th><th>${t('wmidi.thVal')}</th><th>${t('wmidi.thCount')}</th><th>${t('wmidi.thPress')}</th><th>${t('wmidi.thRelease')}</th><th>${t('wmidi.thChange')}</th><th></th></tr></thead>`;
  const body = document.createElement('tbody');
  for (const [id, s] of wmiSorted()) {
    const b = wmiState.bindings[id] || {}, isCc = s.type === 'cc', tr = document.createElement('tr'); tr.dataset.id = id;
    tr.innerHTML = `<td><input class="wmidi-name" placeholder="${t('wmidi.namePh')}"></td><td class="mono">${id}</td><td>${t(isCc ? 'wmidi.dimmer' : 'wmidi.button')}</td><td>${s.channel}</td><td>${s.number}</td><td class="mono" data-c="v">${s.lastValue}</td><td class="mono" data-c="n">${s.count}</td>
      <td><select data-slot="onPress">${WMI.optsT}</select></td><td><select data-slot="onRelease">${WMI.optsT}</select></td>
      <td>${isCc ? `<select data-slot="onChange">${WMI.optsC}</select> <input type="number" class="wmidi-thr" min="1" max="127" title="${t('wmidi.thr')}">` : '<span class="muted">–</span>'}</td>
      <td class="wmidi-rowacts"><button class="ghost small" data-a="test" title="${t('wmidi.testTip')}">▶</button><button class="ghost small" data-a="del" title="${t('wmidi.del')}">×</button></td>`;
    const nm = tr.querySelector('.wmidi-name'); nm.value = s.name || '';
    const saveName = () => { if ((s.name || '') !== nm.value.trim()) { s.name = nm.value.trim(); wmiSave(true); wmiRenderActs(); } };
    nm.onblur = saveName; nm.onkeydown = (e) => { if (e.key === 'Enter') { saveName(); nm.blur(); } if (e.key === 'Escape') { nm.value = s.name || ''; nm.blur(); e.stopPropagation(); } };
    tr.querySelectorAll('select').forEach((sel) => { sel.value = b[sel.dataset.slot] || ''; sel.onchange = () => { WolfMidi.bind(wmiState, id, sel.dataset.slot, sel.value); wmiSave(true); wmiRenderActs(); }; });
    const thr = tr.querySelector('.wmidi-thr'); if (thr) { thr.value = b.threshold ?? WolfMidi.DEFAULT_THR; thr.onchange = () => { const bb = WolfMidi.bind(wmiState, id, 'onPress', (wmiState.bindings[id] || {}).onPress); bb.threshold = clamp(+thr.value | 0, 0, 127); thr.value = bb.threshold; wmiSave(true); }; }
    tr.querySelector('[data-a=test]').onclick = () => { const bb = wmiState.bindings[id] || {}; let any = false; if (bb.onPress) any = SL_ACTIONS.run(bb.onPress) || any; if (bb.onChange) any = SL_ACTIONS.run(bb.onChange, (s.lastValue | 0) / 127) || any; wmiFlash(id); if (!any) toast(t('wmidi.noBinding')); };
    tr.querySelector('[data-a=del]').onclick = () => { delete wmiState.signals[id]; delete wmiState.bindings[id]; wmiSave(true); wmiRender(); };
    body.appendChild(tr); WMI.rows[id] = { tr, v: tr.querySelector('[data-c=v]'), n: tr.querySelector('[data-c=n]') };
  }
  tb.appendChild(body); wmiStatus(); wmiRenderActs(); if (typeof wcRefresh === 'function' && typeof WC !== 'undefined' && Object.keys(WC.els).length) wcRefresh();
}
function wmiUpdateRow(id) { const r = WMI.rows[id], s = wmiState.signals[id]; if (!r || !s) return; r.v.textContent = s.lastValue; r.n.textContent = s.count; }
function wmiFlash(id) { const r = WMI.rows[id]; if (!r) return; r.tr.classList.remove('flash'); void r.tr.offsetWidth; r.tr.classList.add('flash'); }
function wmiRenderActs() { // alle handlinger: hvilke signaler er knyttet til dem + Lær-knap
  const box = $('#wmidiActList'); if (!box) return; const bound = {};
  for (const [id, b] of Object.entries(wmiState.bindings)) for (const slot of ['onPress', 'onRelease', 'onChange']) if (b[slot]) (bound[b[slot]] = bound[b[slot]] || []).push((wmiState.signals[id] && wmiState.signals[id].name) || id);
  box.innerHTML = '';
  for (const a of SL_ACTIONS.list) {
    const r = document.createElement('div'); r.className = 'wmidi-act'; r.innerHTML = `<span></span><span class="muted small"></span><button class="ghost small">${t('wmidi.learn')}</button>`;
    r.children[0].textContent = SL_ACTIONS.label(a) + (a.kind === 'continuous' ? ' ↕' : ''); r.children[1].textContent = (bound[a.id] || []).join(', ');
    r.children[2].onclick = () => { $('#wmidiLearnAct').value = a.id; wmiStartLearn(a.id); $('#wmidiLearnMsg').scrollIntoView({ block: 'nearest' }); };
    box.appendChild(r);
  }
  const sel = $('#wmidiLearnAct'), cur = sel.value; sel.innerHTML = wmiOptions('trigger').replace(`<option value="">${t('wm.f.none')}</option>`, '') + wmiOptions('continuous').replace(`<option value="">${t('wm.f.none')}</option>`, ''); if (cur) sel.value = cur;
}
function wmiStatus() {
  const c = $('#wmidiConn'); if (!c) return; const ins = wmiInputs(), flex = ins.find((i) => /midiflex/i.test(i.name)), ok = ins.length > 0;
  c.textContent = WMI.err ? WMI.err : ok ? t('wmidi.connected', { name: (flex || ins[0]).name + (ins.length > 1 ? ' +' + (ins.length - 1) : '') }) : t('wmidi.disconnected');
  c.classList.toggle('ok', ok && !WMI.err); c.title = ins.map((i) => i.name).join('\n');
  const hasSig = Object.keys(wmiState.signals).length > 0;
  $('#wmidiNoDev').hidden = ok || hasSig; $('#wmidiErr').textContent = WMI.err; $('#wmidiNoSig').hidden = !ok || hasSig; $('#wmidiTable').hidden = !hasSig;
}
function wmiTick() { const el = $('#wmidiLast'); if (!el || !$('#page-wolf').classList.contains('active')) return; el.textContent = WMI.lastAt ? t('wmidi.last', { s: Math.round((Date.now() - WMI.lastAt) / 1000), src: WMI.lastSrc }) : ''; }

// ---------- import fra Wolfmix Monitor ----------
async function wmiImport() {
  let r = null; try { r = await window.laser.wolfMonitorImport(); } catch (_) {}
  if (r && (r.triggers || r.signals)) return wmiApplyImport(r.triggers, r.signals);
  $('#wmidiImportFile').click(); // ikke fundet / ingen adgang → vælg filerne selv
}
function wmiApplyImport(triggers, signals) { const r = WolfMidi.importMonitor(wmiState, triggers, signals); wmiSave(true); wmiRender(); toast(t('wmidi.imported', { n: r.names, s: r.signals })); }

// ---------- start ----------
(() => {
  if (!$('#wmidiTable')) return;
  $('#wmidiLog').dataset.empty = t('wmidi.logEmpty');
  $('#wmidiActive').checked = wmiState.active; $('#wmidiActive').onchange = (e) => { wmiState.active = e.target.checked; wmiSave(true); };
  $('#wmidiLearn').onclick = () => { if (WMI.learn) wmiStopLearn(); else wmiStartLearn($('#wmidiLearnAct').value); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && WMI.learn) { wmiStopLearn(t('wmidi.learnAborted')); e.stopPropagation(); e.preventDefault(); } }, true);
  $('#wmidiImport').onclick = wmiImport;
  $('#wmidiImportFile').onchange = async (e) => {
    let triggers = null, signals = null;
    for (const f of e.target.files) { try { const j = JSON.parse(await f.text()); const first = Object.values(j)[0] || {}; if (/triggers/i.test(f.name) || ('label' in first)) triggers = j; else signals = j; } catch (_) { toast(t('wmidi.badFile', { f: f.name })); } }
    e.target.value = ''; if (triggers || signals) wmiApplyImport(triggers, signals);
  };
  $('#wmidiSimGo').onclick = () => {
    const ty = $('#wmidiSimType').value, ch = +$('#wmidiSimCh').value || 1, nr = +$('#wmidiSimNr').value | 0, v = clamp(+$('#wmidiSimVal').value | 0, 0, 127);
    wmiHandle(WolfMidi.toBytes(ty, ch, nr, v), t('wmidi.simSrc'));
    if (ty === 'note' && v > 0) setTimeout(() => wmiHandle(WolfMidi.toBytes('note', ch, nr, 0), t('wmidi.simSrc')), 150); // knap slippes igen
  };
  wmiRender(); setInterval(() => { wmiTick(); wmiStatus(); }, 1000); wmiInit().then(wmiDebugDump); window.laser.appVersion().then((v) => { WMI.version = v; }).catch(() => {});
})();
