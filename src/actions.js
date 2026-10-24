/* SmartLink – handlingsregister: ÉT sted hvor appens funktioner er samlet som handlinger, som Wolfmix-MIDI (og senere andet) kan kalde.
 * kind 'trigger' = knap (tryk/slip), 'continuous' = trinløs værdi 0…1 (fader/dimmer).
 * Hver handling kalder de eksisterende funktioner i app.js – ingen logik er kopieret.
 */
'use strict';
const SL_ACTIONS = (() => {
  const list = [];
  const add = (id, labelKey, kind, run, group) => list.push({ id, labelKey, kind, run, group });
  const sortedPats = () => (patAvail.size ? [...patAvail].sort((a, b) => a - b) : Array.from({ length: cfg.patCount || 255 }, (_, i) => i + 1));
  const stepPat = (d) => { const l = sortedPats(); if (!l.length) return; const i = l.indexOf(st.pattern); setPattern(l[i < 0 ? (d > 0 ? 0 : l.length - 1) : (i + d + l.length) % l.length]); };
  const look = () => { saveLook(); syncLookUI(); };

  // ---- knapper (trigger) ----
  add('laser.on', 'act.laserOn', 'trigger', () => { if (blackout) requestArm(); }, 'laser'); // tænd kræver stadig bekræftelse i appen (sikkerhed)
  add('laser.off', 'act.laserOff', 'trigger', () => setBlackout(true), 'laser');
  add('laser.toggle', 'act.laserToggle', 'trigger', () => requestArm(), 'laser');
  add('show.play', 'act.showPlay', 'trigger', () => $('#play').click(), 'show');
  add('show.stop', 'act.showStop', 'trigger', () => $('#stop').click(), 'show');
  add('tap', 'act.tap', 'trigger', () => tap(), 'show');
  add('auto.off', 'act.autoOff', 'trigger', () => setAuto('off'), 'show');
  add('auto.mic', 'act.autoMic', 'trigger', () => setAuto('mic'), 'show');
  add('auto.laser', 'act.autoLaser', 'trigger', () => setAuto('laser'), 'show');
  add('auto.cycle', 'act.autoCycle', 'trigger', () => setAuto({ off: 'mic', mic: 'laser', laser: 'off' }[autoMode] || 'off'), 'show');
  add('pattern.next', 'act.patNext', 'trigger', () => stepPat(1), 'look');
  add('pattern.prev', 'act.patPrev', 'trigger', () => stepPat(-1), 'look');
  add('pattern.off', 'act.patOff', 'trigger', () => setPattern(0), 'look');
  add('preset.random', 'act.random', 'trigger', () => randomPreset(), 'look');
  for (let i = 0; i < 12; i++) add('preset.' + (i + 1), 'act.preset', 'trigger', () => { if (PRESETS[i]) applyPreset(i); }, 'preset');
  for (let i = 0; i < 9; i++) add('scene.' + (i + 1), 'act.scene', 'trigger', () => { if (scenes[i]) recallScene(i); }, 'scene');
  add('color.orig', 'act.colorOrig', 'trigger', () => setColor({ mode: 'orig', rgb: st.color.rgb }), 'look');
  add('color.next', 'act.colorNext', 'trigger', () => { const sw = SWATCHES.filter((s) => s.rgb); const cur = st.color.mode === 'rgb' ? sw.findIndex((s) => s.rgb.join() === st.color.rgb.join()) : -1; const n = sw[(cur + 1) % sw.length]; if (n) setColor({ mode: 'rgb', rgb: n.rgb.slice() }); }, 'look');
  add('color.cycle', 'act.colorCycle', 'trigger', () => { st.colorCycle = !st.colorCycle; $('#colorCycle').checked = st.colorCycle; look(); }, 'look');
  add('move.next', 'act.moveNext', 'trigger', () => { st.move = MOVES[(MOVES.indexOf(st.move) + 1) % MOVES.length]; activeScene = -1; look(); }, 'look');
  add('move.none', 'act.moveNone', 'trigger', () => { st.move = 'none'; activeScene = -1; look(); }, 'look');
  add('strobe.toggle', 'act.strobe', 'trigger', () => { st.strobe = st.strobe > 0 ? 0 : 0.6; look(); }, 'look');
  add('pos.center', 'act.center', 'trigger', () => { setPos('posX', 0); setPos('posY', 0); }, 'look');
  add('look.reset', 'act.reset', 'trigger', () => $('#resetLook').click(), 'look');
  add('wolfmix.preset', 'act.wolfPreset', 'trigger', () => { if (typeof wolfSendPreset === 'function') wolfSendPreset(); }, 'wolfmix');

  // ---- trinløse (continuous, 0…1) – samme funktioner som DMX-ind bruger (wmRun i app.js) ----
  for (const fn of ['master', 'size', 'posX', 'posY', 'rotAngle', 'rotSpeed', 'moveAmt', 'moveSpeed', 'strobe', 'pulse', 'fps', 'zone', 'color', 'move', 'scene', 'auto'])
    add(fn === 'master' ? 'laser.brightness' : 'c.' + fn, 'wm.f.' + fn, 'continuous', (v) => wmRun(fn, Math.round(v * 255), -1), 'cont');
  add('c.pattern', 'wm.f.pattern', 'continuous', (v) => { const n = Math.round(v * 127); if (n !== st.pattern) setPattern(n, true); }, 'cont'); // CC-værdi = mønster-nr. (0–127)

  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  const label = (a) => { if (!a) return ''; const m = /\.(\d+)$/.exec(a.id); if (a.group === 'preset') { const i = +m[1] - 1; return t('act.preset', { n: i + 1 }) + (PRESETS[i] ? ' – ' + presetName(PRESETS[i], i) : ''); } if (a.group === 'scene') { const i = +m[1] - 1; return t('act.scene', { n: i + 1 }) + (scenes[i] ? ' – ' + scenes[i].name : ''); } return t(a.labelKey); };
  // kør en handling; sendNow() sender med det samme, så der ikke ventes på næste DMX-tik (< 20 ms fra tryk til laser)
  function run(id, value) { const a = byId[id]; if (!a) return false; try { a.kind === 'continuous' ? a.run(Math.max(0, Math.min(1, value ?? 1))) : a.run(); if (typeof sendNow === 'function') sendNow(); return true; } catch (e) { console.warn('handling', id, e); return false; } }
  return { list, byId, label, run };
})();
