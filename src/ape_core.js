// ape_core.js – Ape Labs Neon Tube PIX (6 rør, 2 etager) via ÉN Ape Labs CONNECT. Rene funktioner, ingen DOM. Testes i test/ape.test.js.
// Moduler (sektioner nedenfor): fixture (kanal-generatorer + strobe-tabel), patch (adresseplan + eksport), program/scene, pixel_fx,
// render (state → 512 bytes), merge (Wolfmix + app, HTP/LTP, ejerskab pr. etage), bridge (LOUNGE MIDI-tabel), clients (roller), mode (SHOW/LOUNGE).
// Fakta som designet bygger på: én CONNECT i DMX-transmitter = ét univers til én Ape-gruppe → begge etager i SAMME gruppe, adskilt på adresse.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ApeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const FLOORS = [1, 2];

  // ================= fixture =================
  const MODES = { '4ch': { fp: 4, px: 1, dimmer: false }, '7ch': { fp: 7, px: 1, dimmer: true }, '32ch': { fp: 32, px: 8 }, '64ch': { fp: 64, px: 16 }, '128ch': { fp: 128, px: 32 } };
  // kanal 6 (7ch): DMX-værdi → periode i sekunder (Ape Labs' tabel; ulineær). Interpoleres i log(sekunder).
  const STROBE_TABLE = [[1, 142 * 3600], [10, 8.55 * 60], [37, 10.1], [64, 2.0], [80, 1.0], [100, 0.51], [200, 0.064], [255, 0.031]];
  function strobeSeconds(dmx) {
    const d = clamp(Math.round(dmx), 0, 255); if (d === 0) return Infinity; const T = STROBE_TABLE;
    for (let i = 1; i < T.length; i++) if (d <= T[i][0]) { const [d0, s0] = T[i - 1], [d1, s1] = T[i], f = (d - d0) / (d1 - d0); return Math.exp(lerp(Math.log(s0), Math.log(s1), f)); }
    return T[T.length - 1][1];
  }
  function strobeDmx(seconds) { // invers: periode → nærmeste DMX-værdi 1–255
    if (!(seconds > 0) || !isFinite(seconds)) return 0; let best = 1, bd = Infinity;
    for (let d = 1; d <= 255; d++) { const e = Math.abs(Math.log(strobeSeconds(d)) - Math.log(seconds)); if (e < bd) { bd = e; best = d; } }
    return best;
  }
  const strobeHz = (dmx) => 1 / strobeSeconds(dmx);
  // speed 0–1 → strobe-DMX (bruges både til kanal 6 i 7ch og til software-strobe i pixel-modes): 0 = ~0,5 Hz … 1 = ~30 Hz
  const speedToStrobeDmx = (speed) => Math.round(lerp(64, 255, clamp(speed, 0, 1)));
  // én frames kanaler for ét rør. pixels: [[r,g,b,w] 0–255] (længde = rørets pixels eller 1); f = { dimmer 0–1, strobeDmx, strobeOn (software-port), musicLights }
  function tubeChannels(mode, pixels, f = {}) {
    const M = MODES[mode]; if (!M) throw new Error('ukendt mode ' + mode); const out = new Uint8Array(M.fp), dim = clamp(f.dimmer ?? 1, 0, 1);
    const px = (i) => pixels[Math.min(pixels.length - 1, Math.floor(i * pixels.length / M.px))] || [0, 0, 0, 0];
    if (mode === '7ch') { const p = px(0); out.set(p.map((v) => clamp(Math.round(v), 0, 255)), 0); out[4] = Math.round(dim * 255); out[5] = f.strobeDmx | 0; out[6] = f.musicLights ? 255 : 0; return out; }
    const gate = f.strobeOn === false ? 0 : 1, k = mode === '4ch' ? dim * gate : dim * gate; // 4ch og pixel-modes har ingen dimmer/strobe: appen ganger selv ind
    for (let i = 0; i < M.px; i++) { const p = px(i); for (let c = 0; c < 4; c++) out[i * 4 + c] = clamp(Math.round(p[c] * k), 0, 255); }
    return out;
  }
  // software-strobe i pixel-modes: firkant med 30 % "on" pr. periode
  const strobeGate = (tSec, dmx) => { const T = strobeSeconds(dmx); if (!isFinite(T)) return true; return ((tSec / T) % 1) < 0.3; };

  // ================= patch_planner =================
  const DEFAULT_TUBES = () => [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, name: 'Rør ' + n, floor: n <= 3 ? 1 : 2, flip: false }));
  function plan(mode, tubes = DEFAULT_TUBES(), start = 1) {
    const M = MODES[mode]; if (!M) return { ok: false, error: 'ukendt mode' };
    const ordered = tubes.slice().sort((a, b) => (a.floor - b.floor) || (a.id - b.id)); let a = start; const out = [];
    for (const t of ordered) { out.push({ ...t, mode, address: a, end: a + M.fp - 1 }); a += M.fp; }
    const total = a - start;
    if (a - 1 > 512) return { ok: false, error: 'over512', total, need: a - 1, tubes: out };
    return { ok: true, total, tubes: out };
  }
  function overlaps(planTubes) { const s = planTubes.slice().sort((x, y) => x.address - y.address); for (let i = 1; i < s.length; i++) if (s[i].address <= s[i - 1].end) return [s[i - 1].id, s[i].id]; return null; }
  function exportConnectSteps(p, profile) { // trinliste til CONNECT-appen (Device list → Light settings → Apply), mens CONNECT er i app-mode
    const lines = [profile === 'show' ? 'SHOW-profil (CONNECT som DMX-transmitter, Ape-gruppe 1)' : 'LOUNGE-profil (CONNECT i app-mode, etager = Ape-gruppe 1 og 2)', 'CONNECT skal være i APP-mode mens du gør dette.', ''];
    p.tubes.forEach((t, i) => lines.push(`${i + 1}. ${t.name} (etage ${t.floor}): Device list → ${t.name} → Light settings → Gruppe ${profile === 'show' ? 1 : t.floor}` + (profile === 'show' ? `, DMX-mode ${t.mode}, DMX-adresse ${t.address}` : '') + ' → Apply'));
    lines.push('', profile === 'show' ? 'Til sidst: More → DMX transmitter → Gruppe 1 → Enable (eller hold CONNECT-knappen i 6 s fra slukket).' : 'Til sidst: slå DMX transmitter FRA, så CONNECT bliver i app-mode.');
    return lines.join('\n');
  }
  function exportWolfmixPatch(p, out = 'B') {
    return [`Wolfmix patch på DMX-udgang ${out} (det XLR-stik der går i CONNECT DMX IN)`, 'Fixture: "Ape Labs Neon Tube PIX ' + (p.tubes[0] && p.tubes[0].mode) + '" (egen fra Fixture Builder ved 32/64ch)', '']
      .concat(p.tubes.map((t) => `${t.name}: adresse ${t.address}–${t.end}, Wolfmix-gruppe ${t.floor === 1 ? 'A' : 'B'} (etage ${t.floor})`)).join('\n');
  }
  function exportFixtureBuilder(mode = '64ch') {
    const M = MODES[mode]; if (!M || M.px < 2) return 'Fixture Builder bruges kun til pixel-modes (32/64/128ch).';
    const lines = [`Wolfmix Fixture Builder – Ape Labs Neon Tube PIX ${mode}`, `Kanaler: ${M.fp}, celler (pixels): ${M.px}, type: RGBW pr. celle, ingen dimmer/strobe-kanal`, ''];
    for (let n = 1; n <= M.px; n++) lines.push(`Celle ${n}: kanal ${4 * n - 3} R, ${4 * n - 2} G, ${4 * n - 1} B, ${4 * n} WW`);
    return lines.join('\n');
  }

  // ================= program_engine =================
  // program: { steps: [{ color: [r,g,b,w] | null (= blackout), fade: sek, hold: sek }] } – maks 4 trin; fade = lineær interpolation i RGBWW
  const BLACK = [0, 0, 0, 0];
  const speedFactor = (speed) => Math.pow(2, (clamp(speed ?? 0.5, 0, 1) - 0.5) * 4); // 0,25×…4×, 0,5 = 1×
  function programColor(prog, tSec, speed = 0.5) {
    const steps = (prog && prog.steps || []).slice(0, 4); if (!steps.length) return BLACK;
    const dur = steps.map((s) => Math.max(0, +s.fade || 0) + Math.max(0, +s.hold || 0)), total = dur.reduce((a, b) => a + b, 0);
    if (total <= 0) return (steps[0].color || BLACK).slice();
    let t = ((tSec * speedFactor(speed)) % total + total) % total;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], fade = Math.max(0, +s.fade || 0), cur = s.color || BLACK, prev = steps[(i - 1 + steps.length) % steps.length].color || BLACK;
      if (t < fade) { const f = t / fade; return cur.map((v, c) => lerp(prev[c], v, f)); }
      t -= fade; if (t < Math.max(0, +s.hold || 0)) return cur.slice(); t -= Math.max(0, +s.hold || 0);
    }
    return (steps[steps.length - 1].color || BLACK).slice();
  }

  // ================= scene_engine =================
  const FLOOR_FIELDS = ['look', 'color', 'program', 'brightness', 'speed', 'strobe', 'music', 'fx'];
  function newFloor() { return { look: 'color', color: [255, 0, 120, 0], program: null, brightness: 1, speed: 0.5, blackout: false, blackoutHold: false, strobe: false, strobeHold: false, music: { source: 'off', rest: 0 }, fx: 'none', owner: 'app', lastBy: 'app', lastAt: 0 }; }
  function newState() { return { floors: { 1: newFloor(), 2: newFloor() } }; }
  function snapshotScene(state, floors) { const sc = { floors: {} }; for (const f of floors) { const s = state.floors[f], d = {}; for (const k of FLOOR_FIELDS) d[k] = JSON.parse(JSON.stringify(s[k])); d.look = s.blackout ? 'blackout' : s.look; sc.floors[f] = d; } return sc; }
  function recallScene(state, scene, by = 'app', now = 0) { // rører KUN etager scenen definerer; felt "look: unchanged" lader farve/program være
    for (const f of FLOORS) {
      const d = scene && scene.floors && scene.floors[f]; if (!d) continue; const s = state.floors[f];
      if (d.look === 'blackout') s.blackout = true; else if (d.look && d.look !== 'unchanged') { s.blackout = false; s.look = d.look; if (d.color) s.color = d.color.slice(); if (d.look === 'program') s.program = d.program; }
      for (const k of ['brightness', 'speed', 'strobe', 'fx']) if (d[k] !== undefined) s[k] = d[k];
      if (d.music) s.music = { ...d.music };
      s.lastBy = by; s.lastAt = now;
    }
    return state;
  }

  // ================= pixel_fx =================
  const FX = ['none', 'sparkle', 'sweep', 'cascade', 'wave'];
  const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  const fxRate = (speed) => 0.08 * Math.pow(40, clamp(speed ?? 0.5, 0, 1)); // 0,08–3,2 cyklusser/sek
  // intensitet 0–1 for en pixel på position u (0–1 langs etagens linje af rør), tid t (sek.)
  function fxIntensity(fx, u, t, speed, i = 0) {
    const r = fxRate(speed);
    switch (fx) {
      case 'sparkle': { const slot = Math.floor(t * r * 6), h = hash(i * 7919 + slot); return h < 0.18 ? 1 : 0.06; } // tilfældig rækkefølge
      case 'sweep': { const ph = (t * r) % 2, p = ph < 1 ? ph : 2 - ph, d = Math.abs(u - p); return Math.max(0.03, 1 - d / 0.12); } // ende til ende (Knight Rider)
      case 'cascade': { const p = (t * r) % 1.25, d = p - u; return d >= 0 && d < 0.25 ? 1 - d / 0.25 : 0.03; } // løber én retning med hale
      case 'wave': return 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (u - t * r)));
      default: return 1;
    }
  }

  // ================= render: state → univers (512) =================
  // ctx: { t (sek), beat (0–1 fase siden sidste beat, eller null), programs: {id: program}, mode, tubes (fra plan) }
  function floorBase(s, ctx, u) {
    if (s.look === 'program' && ctx.programs && ctx.programs[s.program]) {
      const lag = s.fx === 'wave' ? u * 2 : 0; // wave: programmet fader i én retning hen over rørene
      return programColor(ctx.programs[s.program], ctx.t - lag, s.speed);
    }
    return s.color || BLACK;
  }
  function floorDimmer(s, ctx) {
    if (s.blackout || s.blackoutHold) return 0;
    let d = clamp(s.brightness ?? 1, 0, 1);
    if (s.music && s.music.source === 'beat' && ctx.beat != null) { const rest = s.music.rest || 0; d *= rest + (1 - rest) * Math.exp(-ctx.beat * 5); } // SmartLinks beat erstatter "CONNECT"-beat
    return d;
  }
  function render(state, plan_, ctx) {
    const uni = new Uint8Array(512), byFloor = {};
    for (const t of plan_.tubes) (byFloor[t.floor] = byFloor[t.floor] || []).push(t);
    for (const f of Object.keys(byFloor)) {
      const s = state.floors[f], list = byFloor[f].slice().sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id)), M = MODES[list[0].mode], n = list.length * M.px;
      const dim = floorDimmer(s, ctx), strobeOn = s.strobe || s.strobeHold, sDmx = strobeOn ? speedToStrobeDmx(s.speed) : 0;
      const gate = strobeOn && M.px > 1 ? strobeGate(ctx.t, sDmx) : true;
      list.forEach((tube, ti) => {
        const px = [];
        for (let p = 0; p < M.px; p++) {
          const li = ti * M.px + (tube.flip ? M.px - 1 - p : p), u = n > 1 ? li / (n - 1) : 0, base = floorBase(s, ctx, u);
          const k = M.px > 1 && s.fx && s.fx !== 'none' && !(s.fx === 'wave' && s.look === 'program') ? fxIntensity(s.fx, u, ctx.t, s.speed, (+f) * 1000 + li) : 1;
          px.push(base.map((v) => v * k));
        }
        const ch = tubeChannels(tube.mode, px, { dimmer: dim, strobeDmx: M.px === 1 ? sDmx : 0, strobeOn: gate, musicLights: s.music && s.music.source === 'lights' && tube.mode === '7ch' });
        uni.set(ch.subarray(0, Math.max(0, Math.min(ch.length, 513 - tube.address))), tube.address - 1);
      });
    }
    return uni;
  }
  // univers → farver pr. rør (til preview og telefonerne)
  function decode(uni, plan_) {
    return plan_.tubes.map((t) => { const M = MODES[t.mode], base = t.address - 1, px = [];
      if (t.mode === '7ch') { const d = uni[base + 4] / 255; px.push([uni[base] * d, uni[base + 1] * d, uni[base + 2] * d, uni[base + 3] * d].map(Math.round)); }
      else for (let i = 0; i < M.px; i++) px.push([0, 1, 2, 3].map((c) => uni[base + i * 4 + c]));
      return { id: t.id, floor: t.floor, px }; });
  }
  const toCss = ([r, g, b, w]) => `rgb(${Math.min(255, Math.round(r + w * 0.9))},${Math.min(255, Math.round(g + w * 0.8))},${Math.min(255, Math.round(b + w * 0.6))})`;

  // ================= merge (topologi B: Wolfmix DMX-IN + app) =================
  // owners: {1: 'wolfmix'|'app'|'merge', 2: …}. I "merge": HTP på farve/dimmer, LTP på strobe/musik (7ch kanal 6–7). ltp: tilstand mellem kald.
  function channelRole(plan_, ch) { // ch 0-baseret → { floor, kind: 'htp'|'ltp' } eller null
    for (const t of plan_.tubes) if (ch >= t.address - 1 && ch <= t.end - 1) { const off = ch - (t.address - 1); return { floor: t.floor, kind: t.mode === '7ch' && off >= 5 ? 'ltp' : 'htp' }; }
    return null;
  }
  function merge(wolf, appU, plan_, owners, ltp = {}) {
    const out = new Uint8Array(512);
    for (let ch = 0; ch < 512; ch++) {
      const role = channelRole(plan_, ch), w = wolf ? wolf[ch] | 0 : 0, a = appU[ch] | 0;
      if (!role) { out[ch] = w; continue; } // kanaler uden for rørene: Wolfmix ejer dem
      const own = owners[role.floor] || 'merge';
      if (own === 'wolfmix') out[ch] = w; else if (own === 'app') out[ch] = a;
      else if (role.kind === 'htp') out[ch] = Math.max(w, a);
      else { const s = ltp[ch] || (ltp[ch] = { w, a, v: Math.max(w, a) }); if (a !== s.a) s.v = a; else if (w !== s.w) s.v = w; s.w = w; s.a = a; out[ch] = s.v; } // seneste ændring vinder
    }
    return out;
  }

  // ================= connect_app_bridge (LOUNGE: MIDI til CONNECT-appen) =================
  // Hver handling får sin EGEN besked (ingen antagelser om værdi-semantik), undtagen brightness/speed der bruger CC-værdien.
  function bridgeActions(nPresets = 12, nScenes = 8, nMacros = 4) {
    const a = [];
    const add = (id, label, valued = false) => a.push({ id, label, valued });
    for (let i = 1; i <= nPresets; i++) add('preset:' + i, 'Specific preset ' + i);
    for (let i = 1; i <= nScenes; i++) add('scene:' + i, 'Specific scene ' + i);
    add('preset.next', 'Next preset'); add('preset.prev', 'Previous preset'); add('scene.next', 'Next scene'); add('scene.prev', 'Previous scene');
    add('strobe.hold', 'Hold strobe'); add('strobe.toggle', 'Toggle strobe'); add('blackout.hold', 'Hold blackout'); add('blackout.toggle', 'Toggle blackout');
    add('brightness', 'Brightness (værdi fra CC)', true); add('speed', 'Speed (værdi fra CC)', true);
    add('group.select:1', 'Select group 1'); add('group.select:2', 'Select group 2'); add('group.toggle:1', 'Toggle group 1'); add('group.toggle:2', 'Toggle group 2'); add('group.all', 'Toggle all groups');
    for (const m of ['off', 'lights', 'connect']) add('music:' + m, 'MusikMode ' + { off: 'Off', lights: 'Lights', connect: 'CONNECT' }[m]);
    add('musicrest:0', 'MusikMode brightness 0 %'); add('musicrest:15', 'MusikMode brightness 15 %');
    for (const fx of ['sparkle', 'sweep', 'cascade', 'wave']) add('pixelfx:' + fx, 'Pixel effect ' + fx[0].toUpperCase() + fx.slice(1));
    add('pairing', 'Pairing network');
    for (let i = 1; i <= nMacros; i++) add('macro:' + i, 'Macro ' + i);
    return a;
  }
  function defaultBindings(actions, channel = 16) { const b = {}; actions.forEach((x, i) => { b[x.id] = { type: 'cc', ch: channel, num: i % 128 }; }); return b; }
  function bindingBytes(bind, value = 127) { const ch = clamp(bind.ch | 0, 1, 16) - 1; return bind.type === 'pc' ? [0xc0 | ch, bind.num & 0x7f] : [0xb0 | ch, bind.num & 0x7f, clamp(Math.round(value), 0, 127)]; }
  function exportBindings(b) { return JSON.stringify({ kind: 'smartlink-ape-bridge', version: 1, bindings: b }, null, 1); }
  function importBindings(txt) {
    const j = typeof txt === 'string' ? JSON.parse(txt) : txt; if (!j || j.kind !== 'smartlink-ape-bridge' || !j.bindings) throw new Error('ikke en SmartLink-bindingstabel');
    const out = {}; for (const [k, v] of Object.entries(j.bindings)) if (v && (v.type === 'cc' || v.type === 'pc')) out[k] = { type: v.type, ch: clamp(v.ch | 0, 1, 16), num: clamp(v.num | 0, 0, 127) };
    return out;
  }
  function duplicateBindings(b) { const seen = {}, dup = []; for (const [k, v] of Object.entries(b)) { const key = `${v.type}:${v.ch}:${v.num}`; if (seen[key]) dup.push([seen[key], k]); else seen[key] = k; } return dup; }
  // en kontrol-handling i LOUNGE → rækken af beskeder: vælg gruppe(r) først, så handlingen
  function loungeMessages(floors, actionId, value) {
    const sel = floors.length === 2 ? ['group.all'] : ['group.select:' + floors[0]];
    return sel.concat([actionId]).map((id) => ({ id, value: id === actionId ? value : undefined }));
  }

  // ================= clients (roller) =================
  const ROLES = { f1: [1], f2: [2], all: [1, 2], admin: [1, 2] };
  function authorize(role, cmd, locks = {}) {
    const allowed = ROLES[role]; if (!allowed) return { ok: false, reason: 'ukendt rolle' };
    const want = (cmd.floors && cmd.floors.length ? cmd.floors : allowed).map(Number);
    if (want.some((f) => !allowed.includes(f))) return { ok: false, reason: 'uden for din etage' };
    if (role !== 'admin' && want.some((f) => locks[f])) return { ok: false, reason: 'etagen er låst til Wolfmix' };
    return { ok: true, floors: want };
  }
  // anvend en kontrol-kommando på state (sidste kommando vinder pr. etage)
  function applyCommand(state, cmd, floors, by, now = 0) {
    for (const f of floors) {
      const s = state.floors[f];
      switch (cmd.op) {
        case 'color': s.look = 'color'; s.color = cmd.color.slice(0, 4).map((v) => clamp(v | 0, 0, 255)); s.blackout = false; break;
        case 'program': s.look = 'program'; s.program = cmd.program; s.blackout = false; break;
        case 'brightness': s.brightness = clamp(+cmd.value, 0, 1); break;
        case 'speed': s.speed = clamp(+cmd.value, 0, 1); break;
        case 'blackout': if (cmd.hold != null) s.blackoutHold = !!cmd.hold; else s.blackout = cmd.value != null ? !!cmd.value : !s.blackout; break;
        case 'strobe': if (cmd.hold != null) s.strobeHold = !!cmd.hold; else s.strobe = cmd.value != null ? !!cmd.value : !s.strobe; break;
        case 'music': s.music = { source: ['off', 'lights', 'beat'].includes(cmd.source) ? cmd.source : 'off', rest: cmd.rest === 0.15 ? 0.15 : 0 }; break;
        case 'fx': s.fx = FX.includes(cmd.fx) ? cmd.fx : 'none'; break;
        default: return false;
      }
      s.lastBy = by; s.lastAt = now;
    }
    return true;
  }

  // ================= mode_manager =================
  const PROFILES = {
    show: { name: 'SHOW', connect: 'DMX-transmitter, gruppe 1', groups: 'alle rør i Ape-gruppe 1', wolfmix: true },
    lounge: { name: 'LOUNGE', connect: 'APP-mode (Bluetooth til CONNECT-appen)', groups: 'rør 1–3 i gruppe 1, rør 4–6 i gruppe 2', wolfmix: false },
  };
  function switchChecklist(to) {
    if (to === 'show') return ['Sæt CONNECT i APP-mode (hvis den ikke er det) og åbn CONNECT-appen.', 'Device list: sæt ALLE 6 rør i gruppe 1, DMX-mode og adresse efter SHOW-trinlisten.', 'More → DMX transmitter → Gruppe 1 → Enable (eller hold CONNECT-knappen i 6 sek. fra slukket).', 'Sæt Wolfmix-kablet (XLR) i CONNECT DMX IN (topologi A) – eller SmartLinks DMX-udgang (topologi B / kun app).', 'Bekræft her: SmartLink sender kun DMX i SHOW.'];
    return ['Slå DMX transmitter FRA på CONNECT (More → DMX transmitter → Disable, eller 6-sek.-tryk) så den er i APP-mode.', 'Device list: rør 1–3 → gruppe 1, rør 4–6 → gruppe 2 (LOUNGE-trinlisten).', 'Forbind CONNECT-appen (én enhed) og slå "External control via MIDI" til.', 'Vælg MIDI-udgangen her (USB/Bluetooth-MIDI til den enhed der kører CONNECT-appen).', 'Wolfmix kan IKKE styre rørene i LOUNGE (ingen DMX-vej).'];
  }
  function canSendDmx(profile) { return profile === 'show'; } // vagthund: CONNECT formodes låst i app-mode i LOUNGE → ingen DMX

  return {
    clamp, FLOORS, MODES, STROBE_TABLE, strobeSeconds, strobeDmx, strobeHz, speedToStrobeDmx, strobeGate, tubeChannels,
    DEFAULT_TUBES, plan, overlaps, exportConnectSteps, exportWolfmixPatch, exportFixtureBuilder,
    programColor, speedFactor, newFloor, newState, snapshotScene, recallScene, FLOOR_FIELDS,
    FX, fxIntensity, fxRate, render, decode, toCss, channelRole, merge,
    bridgeActions, defaultBindings, bindingBytes, exportBindings, importBindings, duplicateBindings, loungeMessages,
    ROLES, authorize, applyCommand, PROFILES, switchChecklist, canSendDmx,
  };
});
