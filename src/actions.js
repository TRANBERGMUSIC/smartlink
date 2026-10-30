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
  // SPEED-knappen på Wolfmix: musikstyring til/fra (sidste musik-kilde huskes; standard = Mac-mikrofonen)
  let lastMusic = 'mic'; add('auto.toggleMusic', 'act.autoToggle', 'trigger', async () => { if (autoMode && autoMode !== 'off') { lastMusic = autoMode; const p = st.pattern; await setAuto('off'); if (p) setPattern(p, true); /* behold mønstret – kun musikstyringen slås fra */ } else await setAuto(lastMusic || 'mic'); }, 'show');
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
  add('pattern.set', 'act.patSet', 'trigger', (n) => { n = n | 0; if (n >= 1 && n <= 255) setPattern(n); }, 'look'); // mønster-nr. vælges pr. knap (onPressArg)
  // blinder: langsomme, brede stråler i hvidt ved 50 % lysstyrke (mønstret holdes over sikkerhedszonen af laser-motoren) – slip = som før
  let blindPrev = null; const blind = (on) => {
    if (on && !blindPrev) {
      blindPrev = { pattern: st.pattern, color: structuredClone(st.color), cc: st.colorCycle, strobe: st.strobe, master, fps: st.fps, move: st.move, rotSpeed: st.rotSpeed, rotAngle: st.rotAngle, posY: st.posY, size: st.size };
      const fx = typeof fxPool === 'function' ? fxPool() : [], calm = fx.filter((n) => typeof fxTierOf === 'function' && fxTierOf(n) === 'low');
      if (fx.length) st.pattern = (calm.length ? calm : fx)[0];
      rotAcc = 0; Object.assign(st, { colorCycle: false, strobe: 0, fps: 0.15, move: 'none', rotSpeed: 0, rotAngle: 0, size: 1, posY: cfg.zone > 0 && cfg.dmxMode === 'pro' ? -1 : st.posY });
      setColor({ mode: 'rgb', rgb: [255, 255, 255] }); setMaster(0.5);
    } else if (!on && blindPrev) { const b = blindPrev; blindPrev = null; Object.assign(st, { pattern: b.pattern, colorCycle: b.cc, strobe: b.strobe, fps: b.fps, move: b.move, rotSpeed: b.rotSpeed, rotAngle: b.rotAngle, posY: b.posY, size: b.size }); setColor(b.color); setMaster(b.master); }
    look();
  };
  add('blinder.toggle', 'act.blinderToggle', 'trigger', () => blind(!blindPrev), 'look');
  add('strobe.toggle', 'act.strobe', 'trigger', () => { st.strobe = st.strobe > 0 ? 0 : 0.6; look(); }, 'look');
  add('pos.center', 'act.center', 'trigger', () => { setPos('posX', 0); setPos('posY', 0); }, 'look');
  add('look.reset', 'act.reset', 'trigger', () => $('#resetLook').click(), 'look');
  // ---- hold (virker kun mens knappen holdes nede; slip = tilbage som før) ----
  add('hold.blank', 'act.holdBlank', 'hold', (down) => { holdMute = !!down; }, 'hold'); // usynlig, IKKE slukket – ingen ny bekræftelse ved slip
  add('hold.blinder', 'act.holdBlinder', 'hold', (down) => blind(!!down), 'hold'); // fuldt hvidt lys, fuld lysstyrke mens holdt
  // strobe mens knappen holdes: med musikstyring blinker laseren på basslag og hi-hats (i takt), ellers laserens egen strobe
  let strobePrev = null; add('hold.strobe', 'act.holdStrobe', 'hold', (down) => { if (down) { if (strobePrev == null) strobePrev = st.strobe; strobeHold = true; st.strobe = musicLive() ? 0 : 0.85; } else if (strobePrev != null) { strobeHold = false; st.strobe = strobePrev; strobePrev = null; } look(); }, 'hold');
  let sizePrev = null; add('hold.full', 'act.holdFull', 'hold', (down) => { if (down) { if (sizePrev == null) sizePrev = st.size; setSize(1); } else if (sizePrev != null) { setSize(sizePrev); sizePrev = null; } }, 'hold');
  let masterPrev = null; add('hold.bright', 'act.holdBright', 'hold', (down) => { if (down) { if (masterPrev == null) masterPrev = master; setMaster(1); } else if (masterPrev != null) { setMaster(masterPrev); masterPrev = null; } }, 'hold');
  add('hold.smoke', 'act.holdSmoke', 'hold', (down) => { if (typeof wolfSmoke === 'function') wolfSmoke(!!down); }, 'hold'); // røg mens knappen holdes (via Wolfmix)
  add('smoke.toggle', 'act.smokeToggle', 'trigger', () => { if (typeof wolfSmoke === 'function') wolfSmoke(!wolfSmokeOn); }, 'wolfmix');
  add('wolfmix.preset', 'act.wolfPreset', 'trigger', () => { if (typeof wolfSendPreset === 'function') wolfSendPreset(); }, 'wolfmix');

  // ---- trinløse (continuous, 0…1) – samme funktioner som DMX-ind bruger (wmRun i app.js) ----
  for (const fn of ['master', 'size', 'posX', 'posY', 'rotAngle', 'rotSpeed', 'moveAmt', 'moveSpeed', 'strobe', 'pulse', 'fps', 'zone', 'color', 'move', 'scene', 'auto'])
    add(fn === 'master' ? 'laser.brightness' : 'c.' + fn, 'wm.f.' + fn, 'continuous', (v) => wmRun(fn, Math.round(v * 255), -1), 'cont');
  add('c.pattern', 'wm.f.pattern', 'continuous', (v) => { const n = Math.round(v * 127); if (n !== st.pattern) setPattern(n, true); }, 'cont'); // CC-værdi = mønster-nr. (0–127)

  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  const label = (a) => { if (!a) return ''; const m = /\.(\d+)$/.exec(a.id); if (a.group === 'preset') { const i = +m[1] - 1; return t('act.preset', { n: i + 1 }) + (PRESETS[i] ? ' – ' + presetName(PRESETS[i], i) : ''); } if (a.group === 'scene') { const i = +m[1] - 1; return t('act.scene', { n: i + 1 }) + (scenes[i] ? ' – ' + scenes[i].name : ''); } return t(a.labelKey); };
  // kør en handling; sendNow() sender med det samme, så der ikke ventes på næste DMX-tik (< 20 ms fra tryk til laser)
  function run(id, value) { const a = byId[id]; if (!a) return false; try { a.kind === 'continuous' ? a.run(Math.max(0, Math.min(1, value ?? 1))) : a.kind === 'hold' ? a.run((value ?? 1) > 0) : a.run(value); if (typeof sendNow === 'function') sendNow(); return true; } catch (e) { console.warn('handling', id, e); return false; } }
  const isHold = (id) => !!(byId[id] && byId[id].kind === 'hold');
  return { list, byId, label, run, isHold };
})();
