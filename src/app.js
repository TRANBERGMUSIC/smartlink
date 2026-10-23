/* SmartLink – renderer
 * Styrer Laserworld ShowNET (Professional mode, 34 kanaler) via Art-Net.
 * Kanaler (relativt til startadresse):
 *  1 intensitet · 2 mønster (001.ild…) · 3 framerate (128 = 50 fps)
 *  4/5 X grov/fin · 6/7 Y grov/fin · 8/9 rotation grov/fin (128 = 0°)
 *  10/11 størrelse X/Y (0 = størst) · 12 spejlvend · 13 farvetilstand (240–255 = RGB)
 *  14–16 R/G/B · 17 strobe · 18 scanhastighed · 19 sikkerhedszone · 20 zone-lys
 *  21–23 farvebalance · 24/25 tilstand (0/0 = Show) · 26–29 kun setup · 30–34 reserveret
 */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- lagring ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('ls.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('ls.' + k, JSON.stringify(v)); } catch (_) {} },
};

// ---------- tilstand ----------
const DEFAULT_LOOK = {
  pattern: 1, color: { mode: 'orig', rgb: [255, 255, 255] }, colorCycle: false, colorCycleSpeed: 0.3,
  move: 'none', moveAmt: 0.4, moveSpeed: 0.3, size: 0.8, rotSpeed: 0, rotAngle: 0, pulse: 0, strobe: 0, fps: 0.5, posX: 0, posY: 0, freeze: false,
};
const DEFAULT_SETTINGS = { linePattern: 112, testPattern: 112, yFlip: true, autoUniverse: true, startLow: true, dmxMode: 'dj', ip: '2.255.255.255', universe: 0, address: 1, rate: 44, zone: 0, zoneSide: 'bottom', maxInt: 1, invX: false, invY: false, scan: 0, patCount: 128, posFmt: 's', sizeInv: true, sizeRange: 1, posScaled: false, camPattern: 38, wmOn: false, wmUniverse: 1, wmAddress: 1, sizeFlip: false, quadFix: true, zoneLo: 40, zoneHi: 63, lineThin: 0.3, dotPattern: 250, boxPattern: 251, quadPattern: 252 };

const st = Object.assign(structuredClone(DEFAULT_LOOK), store.get('look', {}));
Object.assign(st, { move: 'none', rotSpeed: 0, rotAngle: 0, pulse: 0, strobe: 0, freeze: false }); // appen starter altid stille – bevægelse vælges aktivt
const cfg = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
if (!cfg.mig1810) { cfg.posScaled = false; cfg.mig1810 = true; }
if (!cfg.mig1810b) { cfg.sizeInv = true; cfg.mig1810b = true; }
if (!cfg.mig1810c) { cfg.sizeFlip = false; cfg.mig1810c = true; }
if (!cfg.mig1910c) { cfg.mig1910c = true; cfg._needCenter = true; }
if (!cfg.mig1810g) { cfg.sizeFlip = false; cfg.mig1810g = true; } // 19/10 20:15: fast retning i koden – kontakten nulstilles // målt: størrelses-kanalen vender modsat af hvad jeg antog
// kalibrering af laserens placering ift. LIVE: forskydning, skala og vending pr. akse
cfg.cal = Object.assign({ ox: 0, oy: 0, sx: 1, sy: 1, ix: false, iy: false }, cfg.cal || {});
cfg.calib = Object.assign({ T: 0.9, B: -0.9, L: -0.9, R: 0.9 }, cfg.calib || {});
if (cfg.calibDone === undefined) cfg.calibDone = !!cfg.calPts && JSON.stringify(cfg.calPts) !== JSON.stringify({ TL: { x: -0.9, y: 0.9 }, TR: { x: 0.9, y: 0.9 }, BR: { x: 0.9, y: -0.9 }, BL: { x: -0.9, y: -0.9 } }); // allerede kalibreret i en tidligere version
cfg.calPts = cfg.calPts || { TL: { x: cfg.calib.L, y: cfg.calib.T }, TR: { x: cfg.calib.R, y: cfg.calib.T }, BR: { x: cfg.calib.R, y: cfg.calib.B }, BL: { x: cfg.calib.L, y: cfg.calib.B } };
// v3.5: målt på laseren – Y vender som på skærmen (høj værdi = op). Gamle gemte indstillinger rettes én gang.
if (!cfg.v35) { cfg.yFlip = false; cfg.v35 = true; store.set('settings', cfg); }
// v3.7: målt med zone-stregen – positionen er signeret (0 = midt), fuldt udslag ved ±16384, og plus på Y = nedad
if (!cfg.v37) { cfg.posFmt = 's'; cfg.yFlip = false; cfg.v37 = true; store.set('settings', cfg); }
if (!(cfg.scan >= 0 && cfg.scan <= 3)) cfg.scan = 0;
let master = store.get('master', 0.5);
let blackout = true; // laseren starter altid SLUKKET
let patNames = store.get('patNames', {});   // { "12": "Tunnel" }
let patFlip = new Set(store.get('patFlip', [])); // mønstre der skal vendes 180° (kun laseren – appen viser filen som den er)
let patMirror = store.get('patMirror', {}); if (Array.isArray(patMirror)) patMirror = {};
// laseren spejler mønsteret når positionen skifter fortegn (målt 19/10): kompensation pr. kvadrant.
// Begge akser negative → 180° via rotations-kanalen. Én akse negativ → spejlet kopi af mønsteret på kortet (cfg.mirrorSlots[n] = {x, y}).
let mirrorSlots = store.get('mirrorSlots', {});
function quadrantFix(n, sx, sy) { // → { pat, rot180 } / { pat, rot }
  if (cfg.orient && cfg.orient.on) return orientFix(n, sx, sy);
  if (cfg.flipLearn) { // lært i Opsætning: hvor laseren vender/spejler mønsteret, og hvordan
    let bx = 0, by = 0; const fl = cfg.flipLearn; if (fl.base) { bx ^= fl.base[0]; by ^= fl.base[1]; }
    const o = [sx, sy]; (fl.rules || []).forEach((r) => { if ((o[r.axis] - r.at) * r.side > 0) { bx ^= r.f[0]; by ^= r.f[1]; } });
    const sl = mirrorSlots[n] || {}, has = (k) => sl[k] && patAvail.has(sl[k]);
    if (bx && by) return has('xy') ? { pat: sl.xy, rot180: false } : { pat: n, rot180: true };
    if (bx) return has('x') ? { pat: sl.x, rot180: false } : has('y') ? { pat: sl.y, rot180: true } : { pat: n, rot180: false };
    if (by) return has('y') ? { pat: sl.y, rot180: false } : has('x') ? { pat: sl.x, rot180: true } : { pat: n, rot180: false };
    return { pat: n, rot180: false };
  }
  if (!cfg.quadFix) return { pat: n, rot180: false };
  const negX = sx < -0.002, negY = sy < -0.002; const sl = mirrorSlots[n] || {};
  if (negX && negY) return sl.xy && patAvail.has(sl.xy) ? { pat: sl.xy, rot180: false } : { pat: n, rot180: true };
  if (negX) return sl.x && patAvail.has(sl.x) ? { pat: sl.x, rot180: false } : { pat: n, rot180: false };
  if (negY) return sl.y && patAvail.has(sl.y) ? { pat: sl.y, rot180: false } : { pat: n, rot180: false };
  return { pat: n, rot180: false };
} // {n: {x, y}} – filen på kortet er spejlet; appens visning spejles tilbage, så den ser ud som før
const mirrorOpts = (n) => { const m = patMirror[n]; return m ? { mx: m.x ? -1 : 1, my: m.y ? -1 : 1 } : {}; };
let favs = new Set(store.get('favs', []));
let scenes = store.get('scenes', new Array(16).fill(null));
let activeScene = -1;
let patPage = 0;

const SWATCHES = [
  { k: 'c.orig', mode: 'orig', hue: 0 },
  { k: 'c.red', rgb: [255, 0, 0], hue: 0 }, { k: 'c.orange', rgb: [255, 90, 0], hue: 0.06 }, { k: 'c.yellow', rgb: [255, 220, 0], hue: 0.14 },
  { k: 'c.lime', rgb: [140, 255, 0], hue: 0.25 }, { k: 'c.green', rgb: [0, 255, 0], hue: 0.33 }, { k: 'c.cyan', rgb: [0, 255, 255], hue: 0.5 },
  { k: 'c.blue', rgb: [0, 40, 255], hue: 0.65 }, { k: 'c.purple', rgb: [140, 0, 255], hue: 0.75 }, { k: 'c.pink', rgb: [255, 0, 160], hue: 0.9 },
  { k: 'c.white', rgb: [255, 255, 255], white: true }, { k: 'c.warm', rgb: [255, 170, 90], hue: 0.08 },
];
SWATCHES.forEach((sw) => Object.defineProperty(sw, 'name', { get: () => t(sw.k) }));
const MOVES = ['none', 'circle', 'eight', 'sweep', 'bounce'];
const MOVE_DA = new Proxy({}, { get: (_o, k) => t('move.' + String(k)) });

const saveLook = debounce(() => store.set('look', st), 300);
// ---------- laserprofil (ShowNET) – alt hvad kalibreringen har målt; se src/shownet.js ----------
function prof() { if (!cfg.profile || !cfg.profile._ok) cfg.profile = { ...ShowNET.profileOf(cfg.profile), _ok: true }; cfg.profile.mode = cfg.dmxMode === 'pro' ? 'pro' : 'dj'; return cfg.profile; } // samme objekt hver gang (ændringer bliver i profilen)
const djModel = () => ({ s: 's', t: 'h1', u: 'u', h2: 'h2' }[cfg.posFmt] || 's');
function profFor(mode) { const P = prof(); return mode === 'dj' ? { ...P, posModel: djModel() } : { ...P, posModel: 'pro' }; }
let lastFrame = null, lastMode = 'dj', lastDec = null; // præcis det der sidst gik ud på kablet – LIVE tegner KUN herfra
function captureFrame() { const m = cfg.dmxMode === 'pro' ? 'pro' : 'dj', n = m === 'pro' ? 34 : 19, a = cfg.address - 1; lastFrame = Uint8Array.from(dmx.slice(a, a + n)); lastMode = m; lastDec = null; }
function decodedFrame() { if (!lastFrame) return null; if (!lastDec) lastDec = ShowNET.decode(lastFrame, profFor(lastMode), lastMode); return lastDec; }
const saveCfg = debounce(() => { store.set('settings', cfg); try { if (window.laser.stateDump) window.laser.stateDump(JSON.stringify({ at: new Date().toISOString(), cfg, look: st }, null, 1)); } catch (_) {} }, 300); // kopi til ~/Desktop/SmartLink/smartlink-state.json (til fejlsøgning)
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- effekt-motor ----------
let movePhase = 0, rotAcc = 0, huePhase = 0, pulseEnv = 0, dropEnv = 0, hatKick = 0, lastT = performance.now();
const dmx = new Array(512).fill(0);
let out = { x: 0.5, y: 0.5, ang: 0, size: 1, rgb: null, on: true, intensity: 1 };
const sm = { x: 0, y: 0, size: 0.8 };

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return m.map((x) => Math.round(x * 255));
}
function put16(ch, v01) { const v = Math.round(clamp(v01, 0, 1) * 65535); setCh(ch, v >> 8); setCh(ch + 1, v & 255); }
function setCh(ch, v) { const i = cfg.address - 1 + ch - 1; if (i >= 0 && i < 512) dmx[i] = clamp(Math.round(v), 0, 255); }

// sikkerhedszone: 0–63 bund, 64–127 top, 128–191 venstre, 192–255 højre
// NB: målt på laseren – 0–63 dækker TOPPEN og 64–127 BUNDEN (modsat Laserworlds tabel). Venstre/højre uændret.
function zoneVal() {
  if (raw.on && raw.zone != null) return clamp(Math.round(raw.zone), 0, 255);
  if (limShow && limShow.zone != null) return limShow.zone;
  if (!(cfg.zone > 0) && !(limShow && limShow.zone != null)) return 0;
  // målt på DS-3000 (bund): værdierne under ~104 giver zonen igen fra midten – det brugbare område er zoneLo…zoneHi
  const base = { bottom: 64, top: 0, left: 128, right: 192 }[cfg.zoneSide] || 64;
  if (raw.on && raw.zone != null) return clamp(Math.round(raw.zone), 0, 255);
  const lo = clamp(cfg.zoneLo ?? 40, 1, 63), hi = clamp(cfg.zoneHi ?? 63, lo + 1, 63);
  return base + Math.round(lo + (cfg.zoneFlip ? 1 - cfg.zone : cfg.zone) * (hi - lo));
}
const YF = () => (cfg.yFlip ? -1 : 1); // laserens Y-akse vender modsat skærmens
// ---------- særlige billeder: test-streg og zonegrænse tegnet af laseren ----------
// Et mønster fra SD-kortet klemmes helt fladt (Y-størrelse = min) → en lang streg.
let special = null; // null | 'line' | 'zone'
let selVb = null; // den parameter der er valgt til piletaster (klik på navnet)
// laserens midte (sendt 0,0) i app-koordinater – og flyt den (brugeren trækker markøren i LIVE)
// laserens midte (sendt 0,0) i app-koordinater. LIVE holdes altid centreret på laserens midte (app 0,0 = sendt 0,0);
// "hvor er midten IRL" justeres kun i det der sendes (cfg.ctrX/ctrY), ikke i LIVE.
const hShift = (H, dx, dy) => [H[0], H[1], H[2] - H[0] * dx - H[1] * dy, H[3], H[4], H[5] - H[3] * dx - H[4] * dy, H[6], H[7], H[8] - H[6] * dx - H[7] * dy]; // H'(a) = H(a - d)
function camCenterApp() { // løs camAppToSend(a) = (0,0) numerisk (fuld vej inkl. kamera + rest-korrektion)
  const m = cfg.camMap; let [ax, ay] = hApply(m.Hi, 0, 0); const sz = st.size;
  for (let i = 0; i < 8; i++) {
    const f = camAppToSend(ax, ay, sz), e = 0.01, fx = camAppToSend(ax + e, ay, sz), fy = camAppToSend(ax, ay + e, sz);
    const a = (fx[0] - f[0]) / e, b = (fy[0] - f[0]) / e, c = (fx[1] - f[1]) / e, d = (fy[1] - f[1]) / e, det = a * d - b * c; if (Math.abs(det) < 1e-9) break;
    const dx = (d * f[0] - b * f[1]) / det, dy = (-c * f[0] + a * f[1]) / det; ax -= dx; ay -= dy; if (Math.hypot(dx, dy) < 1e-5) break;
  }
  return [ax, ay];
}
function laserCenterApp() { if (cfg.lim && cfg.lim.on) return sentToApp(cfg.ctrX || 0, cfg.ctrY || 0); return cfg.camMap ? camCenterApp() : rawToApp(0, 0); }
function setLaserCenterApp(ax, ay, quiet) { // flyt omsætningen i app-rummet så (ax,ay) → sendt (0,0)
  if (cfg.camMap) {
    const m = cfg.camMap, [x0, y0] = camCenterApp(), dx = ax - x0, dy = ay - y0; if (Math.hypot(dx, dy) < 1e-6) return;
    const Hn = hShift(m.H, dx, dy), Hi = hInv(Hn); if (!Hi) return; m.H = Hn; m.Hi = Hi; if (m.Hac) m.Hac = hShift(m.Hac, dx, dy);
  } else { cfg.cal.ox = clamp(-ax * cfg.cal.sx, -1, 1); cfg.cal.oy = clamp(-ay * cfg.cal.sy, -1, 1); }
  if (!quiet) { saveCfg(); if (typeof syncCalUI === 'function') syncCalUI(); }
}
function centerLive() { setLaserCenterApp(0, 0, true); } // laserens midte = midten af LIVE
let centerDrag = false;
// ---- Wolfmix / DMX-ind: en DMX-konsol (Wolfmix W1 MK3) sender DMX → Art-Net-node med DMX-indgang → SmartLink lytter
// og oversætter kanaler til funktioner. Kanal-kortet kan ændres og læres (Lær: rør en knap/encoder på konsollen).
const WM_FUNCS = ['none', 'master', 'blackout', 'pattern', 'size', 'posX', 'posY', 'rotAngle', 'rotSpeed', 'color', 'move', 'moveAmt', 'moveSpeed', 'strobe', 'pulse', 'fps', 'zone', 'scene', 'auto', 'tap', 'colorCycle'];
const WM_DEFAULT = ['size', 'posX', 'posY', 'rotAngle', 'blackout', 'pattern', 'color', 'move', 'strobe', 'tap', 'auto', 'colorCycle', 'scene', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'master', 'moveAmt', 'moveSpeed', 'zone']; // encodere 1–4, knapper 5–20, fadere 21–24
const wm = { last: null, seen: 0, learn: null, prevVals: new Int16Array(512).fill(-1), act: {} };
function wmMap() { if (!cfg.wmMap || !cfg.wmMap.length) cfg.wmMap = WM_DEFAULT.slice(); return cfg.wmMap; }
function wmApply(ch, v, prev) { // én kanal ændrede sig
  const fn = wmMap()[ch]; if (!fn || fn === 'none') return; const f = v / 255;
  wm.act[fn] = Date.now();
  switch (fn) {
    case 'master': setMaster(f); break;
    case 'blackout': if (v >= 128 && blackout) requestArm(); else if (v < 128 && !blackout) setBlackout(true); break;
    case 'pattern': { const n = v; if (n !== st.pattern) setPattern(n, true); break; }
    case 'size': setSize(f); break;
    case 'posX': setPos('posX', f * 2 - 1); break;
    case 'posY': setPos('posY', f * 2 - 1); break;
    case 'rotAngle': st.rotAngle = Math.round(f * 360 - 180); saveLook(); syncLookUI(); break;
    case 'rotSpeed': st.rotSpeed = v < 8 ? 0 : (f * 2 - 1); saveLook(); syncLookUI(); break;
    case 'color': { if (v < 8) { setColor({ mode: 'orig' }); break; } const idx = 1 + Math.min(SWATCHES.length - 2, Math.floor((v - 8) / (248 / (SWATCHES.length - 1)))); const sw = SWATCHES[idx]; if (sw && sw.rgb) setColor({ mode: 'rgb', rgb: sw.rgb.slice() }); break; }
    case 'colorCycle': st.colorCycle = v >= 128; $('#colorCycle').checked = st.colorCycle; saveLook(); break;
    case 'move': { const m = MOVES[Math.min(MOVES.length - 1, Math.floor(f * MOVES.length))]; if (m !== st.move) { st.move = m; activeScene = -1; saveLook(); syncLookUI(); } break; }
    case 'moveAmt': st.moveAmt = f; saveLook(); syncLookUI(); break;
    case 'moveSpeed': st.moveSpeed = f; saveLook(); syncLookUI(); break;
    case 'strobe': st.strobe = v < 8 ? 0 : f; saveLook(); syncLookUI(); break;
    case 'pulse': st.pulse = f; saveLook(); syncLookUI(); break;
    case 'fps': st.fps = f; saveLook(); syncLookUI(); break;
    case 'zone': cfg.zone = Math.round(f * 90) / 100; saveCfg(); syncZoneUI(); break;
    case 'scene': { if (v < 8) break; const i = Math.min(8, Math.floor((v - 8) / 28)); if (scenes[i]) recallScene(i); break; }
    case 'auto': { const m = v < 85 ? 'off' : v < 170 ? 'mic' : 'laser'; if (m !== autoMode) setAuto(m); break; }
    case 'tap': if (v >= 128 && prev < 128) tap(); break;
  }
}
function wmOnFrame(d) {
  if (!cfg.wmOn) return; if (d.universe !== (cfg.wmUniverse | 0)) return;
  wm.seen = Date.now(); wm.from = d.from; const base = Math.max(0, (cfg.wmAddress | 0) - 1), map = wmMap();
  for (let i = 0; i < Math.max(map.length, 24); i++) {
    const idx = base + i; if (idx >= d.data.length) break; const v = d.data[idx], prev = wm.prevVals[idx];
    if (v === prev) continue; wm.prevVals[idx] = v; if (prev < 0) continue; // første billede: kun husk, ikke udfør (ellers hopper alt ved opstart)
    wolfTouched(i, v);
    if (wm.learn) { if (Math.abs(v - prev) >= 4) { const m = wmMap(); const old = m.indexOf(wm.learn.fn); if (old >= 0) m[old] = 'none'; while (m.length <= i) m.push('none'); m[i] = wm.learn.fn; cfg.wmMap = m; saveCfg(); toast(t('wm.learned', { ch: i + 1, f: t('wm.f.' + wm.learn.fn) })); wm.learn = null; renderWmMap(); renderWolf(); } continue; }
    if (i < map.length) wmApply(i, v, prev);
  }
}
function wmStatus() { const el = $('#wmStatus'); if (!el) return; const ok = cfg.wmOn && Date.now() - wm.seen < 3000; el.textContent = cfg.wmOn ? (ok ? t('wm.online', { ip: wm.from || '?', u: cfg.wmUniverse | 0 }) : t('wm.waiting', { u: cfg.wmUniverse | 0 })) : t('wm.off'); el.classList.toggle('ok', ok); }
function renderWmMap() {
  const w = $('#wmMap'); if (!w) return; w.innerHTML = ''; const map = wmMap();
  for (let i = 0; i < 24; i++) {
    const row = document.createElement('div'); row.className = 'wm-row' + (wm.learn && wm.learn.fn === map[i] ? ' learn' : '');
    const ch = document.createElement('b'); ch.textContent = String((cfg.wmAddress | 0) + i); const sel = document.createElement('select');
    for (const f of WM_FUNCS) { const o = document.createElement('option'); o.value = f; o.textContent = t('wm.f.' + f); if ((map[i] || 'none') === f) o.selected = true; sel.appendChild(o); }
    sel.onchange = () => { while (map.length <= i) map.push('none'); map[i] = sel.value; cfg.wmMap = map; saveCfg(); };
    const val = document.createElement('span'); val.className = 'wm-val'; const pv = wm.prevVals[Math.max(0, (cfg.wmAddress | 0) - 1) + i]; val.textContent = pv >= 0 ? pv : '–';
    row.append(ch, sel, val); w.appendChild(row);
  }
}
// ---- virtuel Wolfmix (fanen) ----
const wolfUI = { els: [], lastAct: new Int32Array(24), test: null };
function renderWolf() {
  const enc = $('#wolfEnc'), pads = $('#wolfPads'), fad = $('#wolfFaders'); if (!enc) return;
  enc.innerHTML = ''; pads.innerHTML = ''; fad.innerHTML = ''; wolfUI.els = []; const map = wmMap();
  for (let i = 0; i < 24; i++) {
    const kind = i < 4 ? 'enc' : i < 20 ? 'pad' : 'fader';
    const el = document.createElement('div'); el.className = 'wctl'; el.dataset.i = i;
    const ch = document.createElement('span'); ch.className = 'wch'; ch.textContent = String((cfg.wmAddress | 0) + i);
    const vis = document.createElement('div'); vis.className = kind === 'enc' ? 'wknob' : kind === 'pad' ? 'wpad' : 'wfader'; if (kind === 'fader') vis.appendChild(document.createElement('i'));
    const name = document.createElement('div'); name.className = 'wname'; name.textContent = t('wm.f.' + (map[i] || 'none'));
    const val = document.createElement('div'); val.className = 'wval'; val.textContent = '–';
    const sel = document.createElement('select'); for (const f of WM_FUNCS) { const o = document.createElement('option'); o.value = f; o.textContent = t('wm.f.' + f); if ((map[i] || 'none') === f) o.selected = true; sel.appendChild(o); }
    sel.onchange = () => { const m = wmMap(); while (m.length <= i) m.push('none'); m[i] = sel.value; cfg.wmMap = m; saveCfg(); name.textContent = t('wm.f.' + sel.value); renderWmMap(); };
    el.append(ch, vis, name, val, sel); (kind === 'enc' ? enc : kind === 'pad' ? pads : fad).appendChild(el); wolfUI.els[i] = { el, vis, val, kind };
  }
}
function wolfTick() {
  const conn = $('#wolfConn'); if (!conn) return;
  const ok = cfg.wmOn && Date.now() - wm.seen < 3000; conn.textContent = !cfg.wmOn ? t('wolf.off') : ok ? t('wolf.connected', { ip: wm.from || '?' }) : t('wolf.disconnected'); conn.classList.toggle('ok', ok);
  if (!$('#page-wolf').classList.contains('active')) return;
  const base = Math.max(0, (cfg.wmAddress | 0) - 1), now = Date.now();
  for (let i = 0; i < 24; i++) { const u = wolfUI.els[i]; if (!u) continue; const v = wm.prevVals[base + i]; u.val.textContent = v >= 0 ? v : '–'; const f = v >= 0 ? v / 255 : 0;
    if (u.kind === 'enc') u.vis.style.setProperty('--a', (-135 + f * 270) + 'deg'); else if (u.kind === 'fader') u.vis.firstChild.style.height = (f * 100) + '%';
    u.el.classList.toggle('active', now - wolfUI.lastAct[i] < 400 || (u.kind === 'pad' && v >= 128)); }
}
function wolfTouched(i, v) { // kaldes når en kanal ændrer sig
  if (i < 24) wolfUI.lastAct[i] = Date.now(); const fn = wmMap()[i] || 'none'; const log = $('#wolfLog'); if (log) log.textContent = t('wolf.last', { ch: i + 1, v, f: t('wm.f.' + fn) });
  if (wolfUI.test) { clearTimeout(wolfUI.test); wolfUI.test = null; toast(t('wolf.testOk', { ch: i + 1, v })); const c = $('#wolfConn'); if (c) c.textContent = t('wolf.testOk', { ch: i + 1, v }); }
}
(() => {
  renderWolf(); setInterval(wolfTick, 120);
  const tb = $('#wolfTest'); if (tb) tb.onclick = () => { const c = $('#wolfConn'); if (c) c.textContent = t('wolf.testing'); if (wolfUI.test) clearTimeout(wolfUI.test); wolfUI.test = setTimeout(() => { wolfUI.test = null; toast(t('wolf.testFail'), 9000); }, 8000); };
  const sb = $('#wolfSettings'); if (sb) sb.onclick = () => { $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'settings')); $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-settings')); const w = $('.wmpanel'); if (w) w.scrollIntoView({ behavior: 'smooth' }); };
})();
// ---- Rå/Lær-panelet ----
function rawOverrides() { if (!raw.on) return; for (const k in raw.ch) { const v = raw.ch[k]; if (v !== '' && v != null && !isNaN(+v)) setCh(+k, +v); } }
function rawSync() {
  const set = (id, v) => { const el = $('#' + id); if (el && +el.value !== v) el.value = v; const o = el && el.parentElement.querySelector('output'); if (o) o.textContent = String(v); };
  set('rawX', Math.round(raw.x)); set('rawY', Math.round(raw.y)); set('rawSize', Math.round(raw.size)); set('rawZone', raw.zone == null ? 0 : Math.round(raw.zone));
  const n = $('#rawN'); if (n) n.textContent = t('raw.pts', { n: raw.pts.length });
  const d = $('#rawDmx'); if (d) { const base = cfg.address - 1; d.textContent = Array.from({ length: 19 }, (_, i) => `${i + 1}:${dmx[base + i]}`).join('  '); }
}
function rawToggle(on) {
  raw.on = on == null ? !raw.on : on; $('#pvRaw').classList.toggle('on', raw.on); $('#pvRawPanel').hidden = !raw.on;
  if (raw.on) { if (special) setSpecial(special); if (autoMode !== 'off') setAuto('off'); raw.size = sizeCh4(st.size); raw.x = Math.round(out.sendX * 100) || 0; raw.y = Math.round(out.sendY * 100) || 0; raw.zone = null; }
  rawSync(); sendNow();
}
function rawLearn(appX, appY) { // "laseren rammer HER i LIVE" ved de rå værdier der sendes lige nu
  raw.pts = raw.pts.filter((p) => Math.hypot(p[0] - raw.x / 100, p[1] - raw.y / 100) > 0.02); raw.pts.push([raw.x / 100, raw.y / 100, appX, appY]);
  store.set('rawPts', raw.pts); rawFit(); rawSync();
}
function rawCorner(k) { const c = { TL: [-1, 1], TR: [1, 1], BR: [1, -1], BL: [-1, -1] }[k]; const idx = { TL: 1, TR: 2, BR: 3, BL: 4 }[k]; rawLearn(c[0], c[1]); toast(t('raw.cornerSet', { k: t('pv.calP' + idx) })); }
function rawFit() { // app↔sendt-par → samme omsætning som kameraet laver (app-firkanten er "kameraet")
  if (raw.pts.length < 4) { toast(t('raw.needMore', { n: 4 - raw.pts.length })); return false; }
  const pts = raw.pts.map((p) => [p[0], p[1], p[2], p[3]]); // [sentX, sentY, "cam"=appX, appY]
  const map = camBuildMap(pts, [[-1, 1], [1, 1], [1, -1], [-1, -1]], cfg.sizeMap, { manual: true, size: st.size });
  if (map) { map.res = null; cfg.camMap = map; centerLive(); saveCfg(); toast(t('raw.fitted', { n: pts.length, e: (map.err * 100).toFixed(0) })); return true; }
  toast(t('cam.fitFail')); return false;
}
function rawSizeMark(which) { // 'min' = mindste synlige, 'max' = størst uden forvrængning – ved den rå størrelses-værdi der sendes nu
  const v = clamp(Math.round(raw.size), 0, 127); const sm_ = (cfg.sizeMap || []).filter((p) => p.manualKeep); const other = sm_.find((p) => p.which !== which);
  const mine = { ch4: v, ext: which === 'min' ? 10 : 100, manualKeep: true, which };
  cfg.sizeMap = other ? [other, mine, { ch4: Math.round((other.ch4 + v) / 2), ext: 55, manualKeep: true, which: 'mid' }].filter((p, i, a) => a.findIndex((q) => q.ch4 === p.ch4) === i) : [mine];
  cfg.sizeMapExt = Math.max(0.05, Math.max(patExtent(st.pattern).x, patExtent(st.pattern).y)); cfg.sizeMapPattern = st.pattern; saveCfg();
  toast(t(which === 'min' ? 'raw.sizeMin' : 'raw.sizeMax', { v }));
}
function rawZoneMark(which) { const v = clamp(Math.round(raw.zone == null ? 0 : raw.zone), 0, 255); const base = { bottom: 64, top: 0, left: 128, right: 192 }[cfg.zoneSide] || 64; const rel = clamp(v - base, 1, 63); if (which === 'lo') cfg.zoneLo = Math.min(rel, (cfg.zoneHi ?? 63) - 1); else cfg.zoneHi = Math.max(rel, (cfg.zoneLo ?? 40) + 1); saveCfg(); toast(t(which === 'lo' ? 'raw.zoneLo' : 'raw.zoneHi', { v })); }
// ---------- Vending: ret KUN det laseren modtager (LIVE-billederne ændres ikke) ----------
const OR_OPTS = { n: [0, 0, 0], r90: [90, 0, 0], r180: [180, 0, 0], r270: [270, 0, 0], mx: [0, 1, 0], my: [0, 0, 1], mx90: [90, 1, 0], my90: [90, 0, 1], mxy: [0, 1, 1], mxy90: [90, 1, 1] };
const OR_Q = ['pp', 'np', 'nn', 'pn']; // laserens egne kvadranter: X+Y+ (oppe højre), X−Y+, X−Y−, X+Y−
function orientCfg() { const o = (cfg.orient = cfg.orient || {}); o.q = o.q || {}; o.pat = o.pat || {}; return o; }
function orientFix(n, sx, sy) {
  const o = orientCfg(), key = (sx >= -0.002 ? 'p' : 'n') + (sy >= -0.002 ? 'p' : 'n');
  let rot = 0, mx = 0, my = 0; [o.all, o.q[key], o.pat[n]].forEach((k) => { const v = OR_OPTS[k || 'n'] || OR_OPTS.n; rot += v[0]; mx ^= v[1]; my ^= v[2]; });
  if (mx && my) { rot += 180; mx = 0; my = 0; }
  const sl = mirrorSlots[n] || {}, has = (k) => sl[k] && patAvail.has(sl[k]);
  let pat = n, missing = false;
  if (mx) { if (has('x')) pat = sl.x; else if (has('y')) { pat = sl.y; rot += 180; } else missing = true; }
  if (my) { if (has('y')) pat = sl.y; else if (has('x')) { pat = sl.x; rot += 180; } else missing = true; }
  return { pat, rot: ((rot % 360) + 360) % 360, missing, key };
}
function orientText(q) { const r = q.rot != null ? q.rot : q.rot180 ? 180 : 0; const parts = []; if (q.pat !== st.pattern) parts.push(t('fb.oMirror', { n: q.pat })); if (r) parts.push(t('or.rotBy', { r })); if (q.missing) parts.push(t('or.missing')); return parts.length ? t('or.laserGets') + ' ' + parts.join(' + ') : t('fb.oNone'); }
function orientSel(id, val, onch) { const el = document.createElement('select'); el.className = 'dir-sel'; el.id = id; Object.keys(OR_OPTS).forEach((k) => { const op = document.createElement('option'); op.value = k; op.textContent = t('or.o.' + k); el.appendChild(op); }); el.value = val || 'n'; el.onchange = () => onch(el.value); return el; }
function orientRender() {
  const box = $('#orRows'); if (!box) return; box.innerHTML = ''; const o = orientCfg();
  const row = (label, sel, btn) => { const r = document.createElement('div'); r.className = 'or-row'; const l = document.createElement('span'); l.textContent = label; r.append(l, sel); if (btn) r.appendChild(btn); box.appendChild(r); };
  const set = (fn) => (v) => { fn(v); o.on = true; saveCfg(); sendNow(); orientPaint(); };
  row(t('or.all'), orientSel('orAll', o.all, set((v) => (o.all = v))));
  OR_Q.forEach((k) => { const b = document.createElement('button'); b.className = 'ghost small'; b.textContent = t('or.show'); b.onclick = () => { const p = { pp: [0.5, 0.5], np: [-0.5, 0.5], nn: [-0.5, -0.5], pn: [0.5, -0.5] }[k]; con.pos = p; sendNow(); orientPaint(); };
    row(t('or.q.' + k), orientSel('orQ' + k, o.q[k], set((v) => (o.q[k] = v))), b); });
  row(t('or.pat', { n: st.pattern }), orientSel('orPat', o.pat[st.pattern], set((v) => { if (v === 'n') delete o.pat[st.pattern]; else o.pat[st.pattern] = v; })));
  orientPaint();
}
function orientPaint() {
  const el = $('#orState'); if (!el) return; const [oX, oY] = posOut(out.sendX, out.sendY), q = quadrantFix(st.pattern, oX, oY);
  const key = (oX >= -0.002 ? 'p' : 'n') + (oY >= -0.002 ? 'p' : 'n');
  el.innerHTML = `${t('or.now', { q: t('or.q.' + key) })}<br>${orientText(q)}<br><span class="mono">${t('or.copies', { s: mirrorSlots[st.pattern] ? t('wiz.yes') : t('wiz.no') })}</span>`;
}
function orientToggle(on) {
  const p = $('#pvOrPanel'); if (!p) return; const show = on == null ? p.hidden : on; p.hidden = !show; $('#pvOr').classList.toggle('on', show); clearInterval(orientToggle.t);
  if (show) { orientRender(); orientToggle.t = setInterval(() => { orientPaint(); const ps = $('#orPat'); if (ps && ps.dataset.n != st.pattern) { orientRender(); ps.dataset.n = st.pattern; } }, 300); } else { con.pos = null; sendNow(); }
}
{ const b = $('#pvOr'); if (b) b.onclick = () => orientToggle(); const c = $('#orClose'); if (c) c.onclick = () => orientToggle(false);
  const m = $('#orMirror'); if (m) m.onclick = () => makeMirrorCopies(st.pattern).then(() => orientPaint());
  const h = $('#orHome'); if (h) h.onclick = () => { con.pos = null; sendNow(); orientPaint(); };
  const r = $('#orReset'); if (r) r.onclick = () => { cfg.orient = { on: false, q: {}, pat: {} }; saveCfg(); sendNow(); orientRender(); toast(t('or.resetDone')); }; }
// ---------- Kalibrering (ShowNET) – mål laseren og gem en profil. Bruges FØR alt andet tunes. ----------
var calib = { on: false, step: 1, frame: null, axis: 'x' };
const CAL_STEPS = 7;
function calMode() { return cfg.dmxMode === 'pro' ? 'pro' : 'dj'; }
function calMeas() { const P = prof(); P.measurements = P.measurements || {}; const M = P.measurements; M.field = M.field || {}; M.pos = M.pos || []; M.size = M.size || []; M.rot = M.rot || []; return M; }
function calBase() { // trin 1: kanal 1 = 200, valgt mønster, alle effekter 0, fuld størrelse, position i midten (DJ kanal 14 = 0)
  const m = calMode(), f = new Uint8Array(m === 'pro' ? 34 : 19), pat = clamp(cfg.calPattern || cfg.boxPattern || 1, 1, 255);
  if (m === 'pro') { f[0] = 200; f[1] = pat; f[2] = 128; f[3] = 128; f[5] = 128; f[7] = 128; for (let n = 26; n <= 29; n++) f[n - 1] = 128; } // 21–23 = 0 = fuld farvebalance
  else { f[0] = 200; f[1] = pat; f[2] = 0; f[3] = 0; f[4] = 0; f[5] = 96; const c = ShowNET.posEncode(0, djModel()); f[6] = c >> 8; f[7] = c & 255; f[8] = c >> 8; f[9] = c & 255; }
  return f;
}
function calSend(fn) { calib.on = true; calib.frame = calBase(); if (fn) fn(calib.frame); sendNow(); }
function calPosValues() { return calMode() === 'pro' ? [0, 64, 128, 192, 255] : [0, 32, 64, 96, 127, 128, 160, 192, 224, 255]; }
function calSizeValues() { return calMode() === 'pro' ? [0, 32, 64, 96, 128, 160, 192, 224, 240, 248, 252, 255] : [0, 16, 32, 48, 64, 80, 96, 104, 112, 120, 124, 127]; }
function calRotValues() { return calMode() === 'pro' ? [128, 160, 192, 224, 255, 0, 64] : [96, 120, 144, 168, 192, 0, 48]; }
function calRender() {
  const box = $('#calSnBody'); if (!box) return; const m = calMode(), M = calMeas(), P = prof(), st_ = calib.step;
  $('#calSnStep').textContent = t('wiz.stepOf', { n: st_, m: CAL_STEPS });
  const b = (id, txt, cls) => `<button class="ghost small ${cls || ''}" data-k="${id}">${txt}</button>`, num = (id, v, step) => `<input type="number" class="cal-num" data-n="${id}" value="${v ?? ''}" step="${step || 'any'}">`;
  let h = `<h4>${t('csn.t' + st_)}</h4><p class="cal-instr">${t('csn.i' + st_, { mode: m === 'pro' ? 'Professional (34)' : 'DJ (19)' })}</p>`;
  if (st_ === 1) h += `<div class="co-row"><span>${t('csn.pattern')}</span>${num('pat', cfg.calPattern || cfg.boxPattern || 1, 1)}${b('base', t('con.send'))}</div>`;
  if (st_ === 2) h += `<div class="co-row"><span>${t('csn.W')}</span>${num('W', M.field.W)}<span>cm</span></div><div class="co-row"><span>${t('csn.H')}</span>${num('H', M.field.H)}<span>cm</span></div><div class="co-row"><span>${t('csn.D')}</span>${num('D', M.field.D)}<span>cm</span></div><p class="cal-instr mono">${t('csn.angles', { x: P.scanDegX.toFixed(1), y: P.scanDegY.toFixed(1) })}</p>${b('base', t('csn.resend'))}`;
  if (st_ === 3) {
    h += `<div class="cal-r1">${b('ax-x', 'X', calib.axis === 'x' ? 'on' : '')}${b('ax-y', 'Y', calib.axis === 'y' ? 'on' : '')}</div><div class="co-grid">`;
    for (const v of calPosValues()) { const r = M.pos.find((p) => p.axis === calib.axis && p.coarse === v); h += `<div class="co-row"><span>coarse ${v}</span>${num('pos-' + v, r ? Math.round(r.cm * 10) / 10 : '')}${b('sp-' + v, t('con.send'))}</div>`; }
    h += `</div><p class="cal-instr">${t('csn.posHint')}</p>${b('fitpos', t('csn.fit'), 'wiz-hot')}<p class="cal-instr mono" id="calSnRes">${t('csn.posNow', { m: m === 'pro' ? 'pro' : djModel(), sx: P.signX, sy: P.signY, gx: (+P.posGainX).toFixed(3), gy: (+P.posGainY).toFixed(3) })}</p>`;
  }
  if (st_ === 4) {
    h += `<div class="co-grid">`; for (const v of calSizeValues()) { const r = M.size.find((p) => p.mode === m && p.dmx === v); h += `<div class="co-row co-row4"><span>dmx ${v}</span>${num('sz-' + v, r && !r.off ? r.cm : '')}<label class="cal-off"><input type="checkbox" data-off="${v}" ${r && r.off ? 'checked' : ''}>${t('csn.off')}</label>${b('ss-' + v, t('con.send'))}</div>`; }
    const lim = ShowNET.sizeLimits(P, m); h += `</div>${b('fitsize', t('csn.fit'), 'wiz-hot')}<p class="cal-instr mono" id="calSnRes">${t('csn.sizeNow', { min: Math.round(lim.min * 1000) / 10, d: P.dmxMinVisible[m] })}</p>`;
  }
  if (st_ === 5) {
    h += `<div class="co-grid">`; for (const v of calRotValues()) { const r = M.rot.find((p) => p.mode === m && p.v === v); h += `<div class="co-row"><span>${m === 'pro' ? 'ch 8' : 'ch 6'} = ${v}</span>${num('rt-' + v, r ? r.deg : '')}${b('sr-' + v, t('con.send'))}</div>`; }
    h += `</div><p class="cal-instr">${t('csn.rotHint')}</p>${b('fitrot', t('csn.fit'), 'wiz-hot')}<p class="cal-instr mono" id="calSnRes">${t('csn.rotNow', { k: (P.rotDegPerStep * 256).toFixed(3), s: P.rotSign })}</p>`;
  }
  if (st_ === 6) h += `${b('clipsend', t('csn.clipSend'))}<div class="cal-r1">${b('clip-clamp', t('csn.clamp'), P.clipMode === 'clamp' ? 'on' : '')}${b('clip-clip', t('csn.clip'), P.clipMode === 'clip' ? 'on' : '')}</div>`;
  if (st_ === 7) h += `${['l', 'r', 'b', 't'].map((k) => `<div class="co-row"><span>${t('csn.z' + k)}</span>${num('z' + k, P.zone[k], 0.01)}<span></span></div>`).join('')}<div class="co-row"><span>${t('csn.throw')}</span>${num('throw', P.throwM || (M.field.D ? M.field.D / 100 : ''), 0.1)}<span>m</span></div>${b('savefile', t('csn.saveFile'), 'wiz-hot')}<p class="cal-instr" id="calSnRes"></p>`;
  box.innerHTML = h;
  box.querySelectorAll('[data-k]').forEach((el) => (el.onclick = () => calAct(el.dataset.k)));
  box.querySelectorAll('[data-n]').forEach((el) => el.addEventListener('change', () => calInput(el.dataset.n, el.value)));
  box.querySelectorAll('[data-off]').forEach((el) => el.addEventListener('change', () => { const v = +el.dataset.off, Mm = calMeas(); let r = Mm.size.find((p) => p.mode === m && p.dmx === v); if (!r) Mm.size.push((r = { mode: m, dmx: v })); r.off = el.checked; saveCfg(); }));
  $('#calSnBack').disabled = st_ <= 1; $('#calSnNext').textContent = t(st_ >= CAL_STEPS ? 'csn.finish' : 'wiz.next');
}
function calInput(k, val) {
  const M = calMeas(), P = prof(), m = calMode(), v = val === '' ? null : +val;
  if (k === 'pat') { cfg.calPattern = clamp(v | 0, 1, 255); saveCfg(); return; }
  if (k === 'W' || k === 'H' || k === 'D') { M.field[k] = v; const F = M.field; if (F.W && F.D) P.scanDegX = 2 * Math.atan(F.W / (2 * F.D)) * 180 / Math.PI; if (F.H && F.D) P.scanDegY = 2 * Math.atan(F.H / (2 * F.D)) * 180 / Math.PI; saveCfg(); return calRender(); }
  if (k.startsWith('pos-')) { const c = +k.slice(4); M.pos = M.pos.filter((p) => !(p.axis === calib.axis && p.coarse === c && p.mode === m)); if (v != null) { const half = (calib.axis === 'x' ? M.field.W : M.field.H) / 2; M.pos.push({ mode: m, axis: calib.axis, coarse: c, cm: v, u: half ? v / half : v / 100 }); } saveCfg(); return; }
  if (k.startsWith('sz-')) { const d = +k.slice(3); let r = M.size.find((p) => p.mode === m && p.dmx === d); if (!r) M.size.push((r = { mode: m, dmx: d })); r.cm = v; r.off = false; saveCfg(); return; }
  if (k.startsWith('rt-')) { const x = +k.slice(3); M.rot = M.rot.filter((p) => !(p.mode === m && p.v === x)); if (v != null) M.rot.push({ mode: m, v: x, deg: v }); saveCfg(); return; }
  if (/^z[lrbt]$/.test(k)) { P.zone[k[1]] = clamp(v ?? (k[1] === 'l' || k[1] === 'b' ? -1 : 1), -1, 1); saveCfg(); return; }
  if (k === 'throw') { P.throwM = v || 0; saveCfg(); }
}
function calAct(k) {
  const m = calMode(), P = prof(), M = calMeas(), res = (txt) => { const el = $('#calSnRes'); if (el) el.textContent = txt; };
  if (k === 'base') return calSend();
  if (k === 'ax-x' || k === 'ax-y') { calib.axis = k.slice(3); return calRender(); }
  if (k.startsWith('sp-')) { const v = +k.slice(3); return calSend((f) => { if (m === 'pro') { const i = calib.axis === 'x' ? 3 : 5; f[i] = v; f[i + 1] = 0; } else { const i = calib.axis === 'x' ? 6 : 8; f[i] = v; f[i + 1] = 0; } }); }
  if (k.startsWith('ss-')) { const v = +k.slice(3); return calSend((f) => { if (m === 'pro') { f[9] = v; f[10] = v; } else f[3] = v; }); }
  if (k.startsWith('sr-')) { const v = +k.slice(3); return calSend((f) => { if (m === 'pro') { f[7] = v; f[8] = 0; } else f[5] = v; }); }
  if (k === 'clipsend') return calSend((f) => { if (m === 'pro') { f[3] = 192; f[4] = 0; f[9] = 0; f[10] = 0; } else { const c = ShowNET.posEncode(0.5, djModel()); f[6] = c >> 8; f[7] = c & 255; f[3] = 0; } });
  if (k === 'clip-clamp' || k === 'clip-clip') { P.clipMode = k.slice(5); saveCfg(); return calRender(); }
  if (k === 'fitpos') {
    const out_ = []; for (const ax of ['x', 'y']) { const S_ = M.pos.filter((p) => p.mode === m && p.axis === ax); if (S_.length < 3) { out_.push(t('csn.needMore', { a: ax.toUpperCase() })); continue; }
      const fit = ShowNET.fitPosModel(S_, m === 'pro' ? ['pro'] : ['s', 'h1', 'h2', 'u']);
      if (ax === 'x') { P.signX = fit.sign; P.posGainX = fit.gain; } else { P.signY = fit.sign; P.posGainY = fit.gain; }
      if (m === 'dj' && ax === 'x') { P.posModel = fit.model; cfg.posFmt = { s: 's', h1: 't', u: 'u', h2: 'h2' }[fit.model]; }
      out_.push(t('csn.posFit', { a: ax.toUpperCase(), m: fit.model, s: fit.sign, g: fit.gain.toFixed(3), e: Math.sqrt(fit.err).toFixed(3) })); }
    saveCfg(); if (cfg.lim) { cfg.edgesUser = false; setFinalEdges({ L: -P.posGainX, R: P.posGainX, T: P.posGainY, B: -P.posGainY }); } res(out_.join(' · ')); return;
  }
  if (k === 'fitsize') {
    const S_ = M.size.filter((p) => p.mode === m).sort((a, b) => a.dmx - b.dmx), w0 = (S_.find((p) => p.dmx === 0 && !p.off) || {}).cm;
    if (!w0) return res(t('csn.needW0'));
    const vis = S_.filter((p) => !p.off && p.cm > 0), off = S_.filter((p) => p.off); P.sizeCurve[m] = vis.map((p) => [p.dmx, clamp(p.cm / w0, 0.001, 1.5)]); if (P.sizeCurve[m].length < 2) P.sizeCurve[m].push([m === 'pro' ? 255 : 127, P.sizeCurve[m][0][1]]);
    P.dmxMinVisible[m] = off.length ? Math.min(...off.map((p) => p.dmx)) : m === 'pro' ? 256 : 128; for (const p of S_) p.frac = p.off ? null : p.cm / w0;
    saveCfg(); const lim = ShowNET.sizeLimits(P, m); return res(t('csn.sizeNow', { min: Math.round(lim.min * 1000) / 10, d: P.dmxMinVisible[m] }));
  }
  if (k === 'fitrot') {
    const S_ = M.rot.filter((p) => p.mode === m); if (S_.length < 3) return res(t('csn.needMore', { a: '' }));
    if (m === 'pro') { const unwrap = S_.map((p) => ({ x: p.v * 256 - 32768, y: p.deg })); const fit = ShowNET.fitLinear(unwrap.map((p) => p.x), unwrap.map((p) => p.y)); P.rotDegPerStep = Math.abs(fit.k) || 360 / 65536; P.rotSign = fit.k < 0 ? -1 : 1; }
    saveCfg(); return res(t('csn.rotNow', { k: (P.rotDegPerStep * 256).toFixed(3), s: P.rotSign }));
  }
  if (k === 'savefile') { const txt = JSON.stringify({ ...P, mode: m, savedAt: new Date().toISOString() }, null, 1); if (window.laser.profileSave) window.laser.profileSave(txt).then((r) => res(r && r.ok ? t('csn.saved', { p: r.path }) : t('csn.saveFail'))); else res(t('csn.saveFail')); return; }
}
function calToggle(on) {
  const p = $('#pvCalSnPanel'); if (!p) return; const sh = on == null ? p.hidden : on; p.hidden = !sh; $('#pvCalSn').classList.toggle('on', sh);
  if (sh) { if (raw.on) rawToggle(false); if (autoMode !== 'off') setAuto('off'); calib.step = calib.step || 1; calRender(); calSend(); } else { calib.on = false; calib.frame = null; sendNow(); }
}
{ const b = $('#pvCalSn'); if (b) b.onclick = () => calToggle(); const c = $('#calSnClose'); if (c) c.onclick = () => calToggle(false);
  const bk = $('#calSnBack'); if (bk) bk.onclick = () => { calib.step = Math.max(1, calib.step - 1); calRender(); };
  const nx = $('#calSnNext'); if (nx) nx.onclick = () => { if (calib.step >= CAL_STEPS) { toast(t('csn.done')); calToggle(false); return; } calib.step++; calRender(); calSend(); }; }
// ---------- Kommando-konsol: send én kommando ad gangen og se hvad laseren får, og hvad appen tror ----------
var con = { pos: null, ch: {}, sweep: null };
function conOverrides() { for (const k in con.ch) setCh(+k, con.ch[k]); }
const CON_CMDS = [
  ['dot', 'con.d.dot'], ['ud', 'con.d.ud'], ['pos 0 0', 'con.d.pos0'], ['pos 50 0', 'con.d.pos'], ['pos -50 0', 'con.d.pos'], ['pos 0 50', 'con.d.pos'], ['pos 0 -50', 'con.d.pos'], ['pos 100 100', 'con.d.pos'], ['pos -100 -100', 'con.d.pos'],
  ['x 30', 'con.d.x'], ['y -30', 'con.d.y'], ['move 5 0', 'con.d.move'], ['sweep x -100 100', 'con.d.sweep'], ['sweep y -100 100', 'con.d.sweep'],
  ['size 0', 'con.d.size'], ['size 50', 'con.d.size'], ['size 100', 'con.d.size'], ['ch4 40', 'con.d.ch4'],
  ['pattern 1', 'con.d.pattern'], ['color red', 'con.d.color'], ['color green', 'con.d.color'], ['color blue', 'con.d.color'], ['color white', 'con.d.color'], ['color orig', 'con.d.color'],
  ['rot 0', 'con.d.rot'], ['rot 90', 'con.d.rot'], ['rot 180', 'con.d.rot'], ['spin 50', 'con.d.spin'], ['spin -50', 'con.d.spin'], ['spin 0', 'con.d.spin'],
  ['zone 0', 'con.d.zone'], ['zone 50', 'con.d.zone'], ['zone off', 'con.d.zoneOff'], ['strobe 50', 'con.d.strobe'], ['strobe 0', 'con.d.strobe'], ['fps 50', 'con.d.fps'],
  ['light 100', 'con.d.light'], ['light 0', 'con.d.light'], ['fmt A', 'con.d.fmt'], ['fmt B', 'con.d.fmt'], ['fmt C', 'con.d.fmt'],
  ['axis 11 15', 'con.d.axis'], ['sync', 'con.d.sync'], ['animspeed 100', 'con.d.animspeed'], ['kpps 30', 'con.d.kpps'], ['ch 7 200', 'con.d.ch'], ['release', 'con.d.release'], ['help', 'con.d.help'],
];
function conLog(cmd, lines) { const box = $('#conLog'); if (!box) return; const el = document.createElement('div'); el.className = 'con-entry'; el.innerHTML = `<b>› ${cmd.replace(/</g, '&lt;')}</b>` + lines.map((l) => `<div>${l}</div>`).join(''); box.prepend(el); while (box.childElementCount > 60) box.lastChild.remove(); }
function conSnap() { sendNow(); const a = []; for (let c = 1; c <= 19; c++) a.push(dmx[cfg.address - 2 + c] | 0); return a; }
function conBelief() {
  const ax = out.x * 2 - 1, ay = out.y * 2 - 1, pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);
  const [oX, oY] = posOut(out.sendX, out.sendY), q = quadrantFix(st.pattern, oX, oY);
  return t('con.belief', { x: pct(ax), y: pct(ay), sx: pct(out.sendX), sy: pct(out.sendY), p: st.pattern, s: Math.round(st.size * 100), r: Math.round(out.ang || 0), z: Math.round(cfg.zone * 100), o: orientText(q) }) + (out.clamped ? ' · ' + t('con.clamped') : '');
}
const CON_HUE = { red: 0, orange: 0.06, yellow: 0.14, lime: 0.25, green: 0.33, cyan: 0.5, blue: 0.65, purple: 0.75, pink: 0.9, rød: 0, grøn: 0.33, blå: 0.65, gul: 0.14, lilla: 0.75 };
function conRun(text) {
  const raw_ = String(text || '').trim(); if (!raw_) return; const p = raw_.toLowerCase().replace(',', ' ').split(/\s+/), c = p[0], n = (i) => parseFloat(p[i]);
  if (c === 'help' || c === 'hjælp') { conLog(raw_, [t('con.help')]); return; }
  if (c === 'release' || c === 'frigiv' || c === 'stop') { clearInterval(con.sweep); con.pos = null; con.ch = {}; sendNow(); conLog(raw_, [t('con.released')]); conPaint(); return; }
  if (c === 'sweep') { const ax = p[1] === 'y' ? 1 : 0, a = isNaN(n(2)) ? -100 : n(2), b = isNaN(n(3)) ? 100 : n(3); clearInterval(con.sweep); let v = a; const base = con.pos ? con.pos.slice() : [out.sendX, out.sendY]; conLog(raw_, [t('con.sweepStart')]);
    con.sweep = setInterval(() => { v += (b > a ? 1 : -1); if ((b > a && v > b) || (b < a && v < b)) { clearInterval(con.sweep); conLog(raw_, [t('con.sweepDone'), conBelief()]); return; } const pp = base.slice(); pp[ax] = v / 100; con.pos = pp; sendNow(); const ch = ax ? 9 : 7; const st_ = $('#conLive'); if (st_) st_.textContent = `${ax ? 'Y' : 'X'} ${v} % → ${t('dir.ch')} ${ch}/${ch + 1} = ${dmx[cfg.address - 2 + ch]}/${dmx[cfg.address - 1 + ch]}`; }, 120); return; }
  const before = conSnap(); let note = '';
  switch (c) {
    case 'ud': case 'straight': case 'midte': con.pos = [cfg.ctrX || 0, cfg.ctrY || 0]; break;
    case 'dot': case 'prik': setPattern(cfg.testDot || 238); break;
    case 'axis': case 'ligeud': if (!isNaN(n(1)) && !isNaN(n(2))) { cfg.axis = { x: clamp(n(1) / 100, -1, 1), y: clamp(n(2) / 100, -1, 1) }; saveCfg(); } else { conLog(raw_, [t('con.bad')]); return; } break;
    case 'sync': pvFrame = 0; conLog(raw_, [t('con.synced')]); return;
    case 'animspeed': if (!isNaN(n(1))) { cfg.animScale = clamp(n(1) / 100, 0.1, 5); saveCfg(); syncAnimUI(); } break;
    case 'kpps': if (!isNaN(n(1))) { cfg.kpps = clamp(n(1), 0, 100); saveCfg(); syncAnimUI(); } break;
    case 'pos': case 'goto': con.pos = [clamp(n(1) / 100, -1, 1), clamp(n(2) / 100, -1, 1)]; if (p.some((w) => w === 'app')) con.pos = null; break;
    case 'x': con.pos = [clamp(n(1) / 100, -1, 1), con.pos ? con.pos[1] : out.sendY]; break;
    case 'y': con.pos = [con.pos ? con.pos[0] : out.sendX, clamp(n(1) / 100, -1, 1)]; break;
    case 'move': { const b0 = con.pos || [out.sendX, out.sendY]; con.pos = [clamp(b0[0] + (n(1) || 0) / 100, -1, 1), clamp(b0[1] + (n(2) || 0) / 100, -1, 1)]; break; }
    case 'size': case 'størrelse': delete con.ch[4]; setSize(clamp(n(1) / 100, 0, 1)); break;
    case 'ch4': con.ch[4] = clamp(Math.round(n(1)), 0, 127); note = t('con.rawNote'); break;
    case 'pattern': case 'mønster': if (n(1) >= 0) setPattern(Math.round(n(1))); break;
    case 'color': case 'farve': { const w = p[1]; if (w === 'orig' || w === 'original') setColor({ mode: 'orig' }); else if (w === 'white' || w === 'hvid') setColor({ mode: 'rgb', rgb: [255, 255, 255] }); else if (CON_HUE[w] != null) setColor({ mode: 'rgb', rgb: hsv(CON_HUE[w], 1, 1) }); else if (!isNaN(n(1))) { con.ch[11] = clamp(Math.round(n(1)), 0, 255); note = t('con.rawNote'); } break; }
    case 'rot': case 'vinkel': st.rotSpeed = 0; st.rotAngle = ((Math.round(n(1)) + 540) % 360) - 180; saveLook(); syncLookUI(); break;
    case 'spin': st.rotSpeed = clamp(n(1) / 100, -1, 1); saveLook(); syncLookUI(); break;
    case 'zone': if (p[1] === 'off' || p[1] === 'fra') cfg.zone = 0; else cfg.zone = clamp(n(1) / 100, 0, 1); saveCfg(); syncZoneUI(); break;
    case 'strobe': st.strobe = clamp(n(1) / 100, 0, 1); saveLook(); syncLookUI(); break;
    case 'fps': st.fps = clamp(n(1) / 100, 0, 1); saveLook(); syncLookUI(); break;
    case 'light': case 'lys': setMaster(clamp(n(1) / 100, 0, 1)); break;
    case 'blackout': setMaster(0); break;
    case 'fmt': case 'format': { const f = { a: 's', b: 'u', c: 't', s: 's', u: 'u', t: 't' }[p[1]]; if (f) { cfg.posFmt = f; saveCfg(); const el = $('#posFmt'); if (el) el.value = f; } break; }
    case 'ch': case 'kanal': { const k = Math.round(n(1)), v = Math.round(n(2)); if (k >= 1 && k <= 19 && !isNaN(v)) { con.ch[k] = clamp(v, 0, 255); note = t('con.rawNote'); } else { conLog(raw_, [t('con.bad')]); return; } break; }
    default: conLog(raw_, [t('con.unknown')]); return;
  }
  sendNow(); const after = conSnap(); const diff = []; after.forEach((v, i) => { if (v !== before[i]) diff.push(`${i + 1}${DMX_NAMES[i + 1] ? ' ' + DMX_NAMES[i + 1] : ''}: ${before[i]}→${v}`); });
  conLog(raw_, [`<span class="mono">${t('con.sent')} ${diff.length ? diff.join(' · ') : t('dir.noChange')}</span>`, conBelief() + (note ? ' · ' + note : '')]); conPaint();
}
function conPaint() { const el = $('#conState'); if (el) el.textContent = (con.pos || Object.keys(con.ch).length) ? t('con.overriding', { p: con.pos ? `X ${Math.round(con.pos[0] * 100)} Y ${Math.round(con.pos[1] * 100)}` : '–', c: Object.keys(con.ch).map((k) => k + '=' + con.ch[k]).join(' ') || '–' }) : t('con.appCtl'); }
function conToggle(on) {
  const p = $('#pvConPanel'); if (!p) return; const show = on == null ? p.hidden : on; p.hidden = !show; $('#pvCon').classList.toggle('on', show);
  if (show) { const sel = $('#conSel'); if (sel && !sel.childElementCount) { const o0 = document.createElement('option'); o0.value = ''; o0.textContent = t('con.pick'); sel.appendChild(o0); CON_CMDS.forEach(([cmd, d]) => { const o = document.createElement('option'); o.value = cmd; o.textContent = `${cmd}  —  ${t(d)}`; sel.appendChild(o); }); sel.onchange = () => { if (sel.value) { $('#conIn').value = sel.value; conRun(sel.value); } sel.value = ''; }; } conPaint(); setTimeout(() => $('#conIn') && $('#conIn').focus(), 30); }
  else { clearInterval(con.sweep); con.pos = null; con.ch = {}; sendNow(); }
}
{ const b = $('#pvCon'); if (b) b.onclick = () => conToggle(); const c = $('#conClose'); if (c) c.onclick = () => conToggle(false);
  const go = $('#conGo'), inp = $('#conIn'); if (go && inp) { go.onclick = () => conRun(inp.value); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { conRun(inp.value); inp.select(); } e.stopPropagation(); }); }
  const r = $('#conRelease'); if (r) r.onclick = () => conRun('release'); }
// ---------- LIVE i ægte skala ----------
var pvAspect = 2;
{ const z = document.getElementById('viewZoom'); if (z) { const o = document.getElementById('viewZoomOut'); const sync = () => { const v = Math.round(100 / (cfg.viewZoom || 1)); z.value = v; if (o) o.textContent = v + ' %'; }; setTimeout(sync, 0); z.addEventListener('input', () => { cfg.viewZoom = 100 / +z.value; saveCfg(); if (o) o.textContent = z.value + ' %'; }); } }
function patK() { return cfg.patK ?? 1.2; } // mønster-koordinat 1 ved 100 % = så mange sendte enheder (målt: 85 %-mønster folder ved X 61)
function patHalfSent(size) { // mønster-koordinat 1 → felt-enheder ved fader-størrelsen (fra størrelseskurven i profilen)
  if (cfg.dmxMode === 'pro') { const l = ShowNET.sizeLimits(profFor('pro'), 'pro'); return l.min + clamp(size, 0, 1) * (l.max - l.min); }
  return ShowNET.sizeFromDmx(sizeCh4(size), profFor('dj'), 'dj');
}
function viewGeom() { return { l: 1, r: 1, b: 1, t: 1 }; } // LIVE = hele laserens scanfelt (laserens "POV"): hele det sorte område, uanset zoom
function viewHalf() { const v = viewGeom(); return [(v.l + v.r) / 2, (v.b + v.t) / 2]; }
function appToSent(ax, ay) { return [clamp(ax, -1, 1) - (cfg.ctrX || 0), clamp(ay, -1, 1) - (cfg.ctrY || 0)]; } // LIVE-punkt = feltpunkt (før midten lægges til)
function sentToApp(sx, sy) { return [sx, sy]; } // feltkoordinat (−1…1) = LIVE-koordinat
// ---------- Ret mens du rykker: appen siger hvad den tror – du retter den direkte i LIVE ----------
var fb = { click: false, timer: null };
function fbEnsureLim() { if (!cfg.lim || !cfg.lim.on) { limEnsure(); cfg.lim.on = true; ['top', 'bottom', 'left', 'right'].forEach((k) => (cfg.lim.set[k] = true)); saveCfg(); } }
function fbAxis(a, c, keyPos, keyNeg, ctrKey) { // a = hvor appen tror (LIVE), c = hvor den faktisk står (LIVE)
  if (Math.abs(c - a) < 0.01) return null; const G = (cfg.viewGain = cfg.viewGain || {}), [Hx, Hy] = viewHalf(), H = ctrKey === 'ctrX' ? Hx : Hy;
  if (Math.abs(a) < 0.08 || Math.sign(a) !== Math.sign(c)) { const d = c - a, g = (d > 0 ? G[keyPos] : G[keyNeg]) || 1; cfg[ctrKey] = clamp((cfg[ctrKey] || 0) - d * H / g, -1, 1); return 'ctr'; }
  const k = a > 0 ? keyPos : keyNeg; G[k] = clamp((G[k] || 1) * c / a, 0.2, 5); return k;
}
function fbCorrect(cx, cy) { // mønstret står IRL dér hvor du klikkede i LIVE
  fbEnsureLim(); const ax = st.posX, ay = st.posY;
  const kx = fbAxis(ax, cx, 'right', 'left', 'ctrX'), ky = fbAxis(ay, cy, 'top', 'bottom', 'ctrY');
  saveCfg(); if (typeof syncCtrUI === 'function') syncCtrUI(); sendNow();
  const parts = [kx, ky].filter(Boolean).map((k) => t('fb.k.' + k)); fbSay(parts.length ? t('fb.fixedPos', { p: [...new Set(parts)].join(' + ') }) : t('dir.res.ok'));
}
function fbDominant() { const ax = st.posX, ay = st.posY; return Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'up' : 'down'); }
function fbFix(v) {
  if (!v) return; const ax = st.posX, ay = st.posY, n = 0.05;
  if (v === 'ok') return fbSay(t('dir.res.ok'));
  if (v === 'edge') { // her begynder den at warpe/vende → dette er kanten i den retning (LIVE-kanten flyttes hertil)
    fbEnsureLim(); const d = fbDominant(), a = Math.abs(d === 'up' || d === 'down' ? st.posY : st.posX); if (a < 0.03) return fbSay(t('fb.edgeTooClose'));
    const k = { up: 'top', down: 'bottom', left: 'left', right: 'right' }[d], v = Math.abs((d === 'up' || d === 'down') ? out.sendY : out.sendX); cfg.fold = cfg.fold || {}; cfg.fold[k] = clamp((1 - v) / clamp(out.size, 0.05, 1), 0, 1.5); saveCfg(); sendNow(); return fbSay(t('fb.edgeSet', { d: t('wiz.d.' + d) }));
  }
  if (v === 'zone0') { const side = cfg.zoneSide || 'bottom', zs = (cfg.zoneSent = cfg.zoneSent || {}); zs[side + '0'] = side === 'bottom' || side === 'top' ? out.sendY : out.sendX; saveCfg(); return fbSay(t('fb.zone0Set')); }
  if (v === 'bigger' || v === 'smaller') { cfg.patHalf100 = clamp((cfg.patHalf100 ?? 0.5) * (v === 'bigger' ? 1.1 : 1 / 1.1), 0.05, 3); saveCfg(); return fbSay(t('fb.patScale', { v: Math.round(cfg.patHalf100 * 100) })); }
  if (v === 'reverse') { fbToggle(false); wiz.step = 1; wizToggle(true); setTimeout(() => { const d = document.querySelector('.wiz-fmt'); if (d) d.open = true; }, 50); return toast(t('fb.reverseHint')); }
  if (v === 'higher') return fbCorrect(ax, ay + n); if (v === 'lower') return fbCorrect(ax, ay - n);
  if (v === 'lefter') return fbCorrect(ax - n, ay); if (v === 'righter') return fbCorrect(ax + n, ay);
  if (v === 'rot' || v === 'lr' || v === 'ud') { // vender/spejler her → regel halvvejs mellem midten og her (præcist punkt: Opsætning trin 3)
    const o = posOut(out.sendX, out.sendY), axis = Math.abs(o[0]) >= Math.abs(o[1]) ? 0 : 1; if (Math.abs(o[axis]) < 0.04) { cfg.flipLearn = cfg.flipLearn || { base: [0, 0], rules: [] }; const f = { rot: [1, 1], lr: [1, 0], ud: [0, 1] }[v]; cfg.flipLearn.base = [cfg.flipLearn.base[0] ^ f[0], cfg.flipLearn.base[1] ^ f[1]]; saveCfg(); sendNow(); return fbSay(t('wiz.baseFixed')); }
    cfg.flipLearn = cfg.flipLearn || { base: [0, 0], rules: [] }; const side = Math.sign(o[axis]); cfg.flipLearn.rules.push({ axis, side, at: o[axis] / 2, f: { rot: [1, 1], lr: [1, 0], ud: [0, 1] }[v], dir: fbDominant() }); saveCfg(); sendNow(); return fbSay(t('fb.flipAdded'));
  }
  if (v === 'bent') { const d = fbDominant(), a = Math.abs(d === 'up' || d === 'down' ? st.posY : st.posX); cfg.bend = cfg.bend || {}; const arr = (cfg.bend[d] || []).filter((p) => Math.abs(p.s - st.size) > 0.08); arr.push({ s: st.size, at: Math.max(0.05, a - 0.03) }); arr.sort((x, y) => x.s - y.s); cfg.bend[d] = arr; cfg.bendStop = true; fbEnsureLim(); saveCfg(); sendNow(); return fbSay(t('wiz.bendSaved', { d: t('wiz.d.' + d), a: Math.round(a * 100) })); }
}
function fbSay(msg) { const el = $('#fbLast'); if (el) el.textContent = msg; toast(msg); fbPaint(); }
function fbPaint() {
  const el = $('#fbThink'); if (!el || $('#pvFbPanel').hidden) return;
  const ax = out.x * 2 - 1, ay = out.y * 2 - 1, pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %';
  const where = `${t('fb.x')} ${pct(ax)} ${Math.abs(ax) < 0.03 ? t('fb.mid') : ax > 0 ? t('fb.right') : t('fb.left')} · ${t('fb.y')} ${pct(ay)} ${Math.abs(ay) < 0.03 ? t('fb.mid') : ay > 0 ? t('fb.up') : t('fb.down')}`;
  const [oX, oY] = posOut(out.sendX, out.sendY), q = quadrantFix(st.pattern, oX, oY);
  const orient = orientText(q);
  const d = fbDominant(), lim = cfg.lim && cfg.lim.on && cfg.bendStop ? Math.round(bendAt(d, out.size) * 100) : 100;
  const ch = (c) => dmx[cfg.address - 2 + c] | 0;
  el.innerHTML = `<b>${t('dir.think')}</b> ${where}<br>${t('fb.size', { s: Math.round(st.size * 100), c: ch(4) })} · ${orient}${out.clamped ? ' · <span class="fb-warn">' + t('fb.clamped', { d: t('wiz.d.' + d), a: lim }) + '</span>' : ''}<br><span class="mono">${t('fb.sends', { x: Math.round(oX * 100), y: Math.round(oY * 100), a: ch(7), b: ch(8), c: ch(9), d: ch(10) })}</span>`;
}
function fbToggle(on) {
  const p = $('#pvFbPanel'); if (!p) return; const show = on == null ? p.hidden : on; p.hidden = !show; $('#pvFb').classList.toggle('on', show);
  clearInterval(fb.timer); fb.click = false;
  if (show) {
    const sel = $('#fbSel'); if (sel && !sel.childElementCount) { [['', 'fb.q'], ['ok', 'fb.o.ok'], ['higher', 'fb.o.higher'], ['lower', 'fb.o.lower'], ['lefter', 'fb.o.lefter'], ['righter', 'fb.o.righter'], ['rot', 'fb.o.rot'], ['lr', 'fb.o.lr'], ['ud', 'fb.o.ud'], ['bent', 'fb.o.bent'], ['reverse', 'fb.o.reverse'], ['edge', 'fb.o.edge'], ['zone0', 'fb.o.zone0'], ['bigger', 'fb.o.patBig'], ['smaller', 'fb.o.patSmall']].forEach(([v, k]) => { const o = document.createElement('option'); o.value = v; o.textContent = t(k); sel.appendChild(o); }); sel.onchange = () => { const v = sel.value; sel.value = ''; fbFix(v); }; }
    fb.timer = setInterval(fbPaint, 200); fbPaint();
  }
}
{ const b = $('#pvFb'); if (b) b.onclick = () => fbToggle(); const c = $('#fbClose'); if (c) c.onclick = () => fbToggle(false);
  const k = $('#fbClick'); if (k) k.onclick = () => { fb.click = !fb.click; k.classList.toggle('on', fb.click); if (fb.click) toast(t('fb.clickHint')); }; }
// værktøjs-menu i LIVE + paneler som flytbare vinduer uden for LIVE
{ // LIVE helt frit: titel + værktøjer i en linje OVER billedet, info/størrelse/zone i en linje UNDER
  const pp = $('#previewPanel'), cv = $('#preview');
  if (pp && cv) {
    const head = document.createElement('div'); head.className = 'pv-head'; const foot = document.createElement('div'); foot.className = 'pv-foot';
    [pp.querySelector('.pv-label'), pp.querySelector('.pv-tools')].forEach((el) => el && head.appendChild(el));
    [$('#pvInfo'), $('#pvSizeBar'), document.querySelector('.pv-zoom'), document.querySelector('.pv-zone')].forEach((el) => el && foot.appendChild(el));
    pp.insertBefore(head, cv); cv.after(foot);
  }
}
{ const mb = $('#pvMenuBtn'), m = $('#pvMenu'); if (mb && m) { mb.onclick = (e) => { e.stopPropagation(); m.hidden = !m.hidden; mb.classList.toggle('on', !m.hidden); }; m.addEventListener('click', () => { m.hidden = true; mb.classList.remove('on'); }); document.addEventListener('click', (e) => { if (!m.hidden && !m.contains(e.target) && e.target !== mb) { m.hidden = true; mb.classList.remove('on'); } }); }
  const posStore = store.get('panelPos', {}) || {};
  $$('.pv-cal, .pv-ms').forEach((p) => { document.body.appendChild(p); p.classList.add('pv-float'); const sp = posStore[p.id]; if (sp) { p.style.left = sp[0] + 'px'; p.style.top = sp[1] + 'px'; p.style.right = 'auto'; }
    const h = p.querySelector('h3'); if (!h) return; h.classList.add('pv-drag'); let d = null;
    h.addEventListener('pointerdown', (e) => { const r = p.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; h.setPointerCapture(e.pointerId); });
    h.addEventListener('pointermove', (e) => { if (!d) return; const x = clamp(e.clientX - d.dx, 0, innerWidth - 120), y = clamp(e.clientY - d.dy, 0, innerHeight - 40); p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.right = 'auto'; });
    h.addEventListener('pointerup', () => { if (!d) return; d = null; const r = p.getBoundingClientRect(); posStore[p.id] = [Math.round(r.left), Math.round(r.top)]; store.set('panelPos', posStore); }); });
}
// ---------- Opsætning (guide): 1 midte + retning · 2 retning i midten · 3 vendepunkter · 4 bøjning ved kanten · 5 størrelse ----------
var wiz = { on: false, step: 1, noBend: false, sweep: null, keep: null };
function bendAt(k, size) { // hvor langt (app 0..1) mønstret kan gå mod kanten k ved størrelse 'size' før det bøjer
  const pts = (cfg.bend && cfg.bend[k]) || []; if (!pts.length) return 1;
  if (pts.length === 1) { const p = pts[0]; return clamp(1 - (1 - p.at) * size / Math.max(0.05, p.s), 0.05, 1); }
  const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(b.s - a.s) < 0.02) return clamp((a.at + b.at) / 2, 0.05, 1);
  return clamp(a.at + (size - a.s) * (b.at - a.at) / (b.s - a.s), 0.05, 1);
}
function finalEdges() { const L = cfg.lim || {}, cx = cfg.ctrX || 0, cy = cfg.ctrY || 0; return { L: cx + (L.left ?? -1 - cx), R: cx + (L.right ?? 1 - cx), T: cy + (L.top ?? 1 - cy), B: cy + (L.bottom ?? -1 - cy) }; }
function setFinalEdges(f) { limEnsure(); const cx = cfg.ctrX || 0, cy = cfg.ctrY || 0; Object.assign(cfg.lim, { left: f.L - cx, right: f.R - cx, top: f.T - cy, bottom: f.B - cy, on: true }); ['top', 'bottom', 'left', 'right'].forEach((k) => (cfg.lim.set[k] = true)); saveCfg(); }
function coordRender(host) { // overblik: de tal appen bruger til at forstå hvor mønstret er (det laseren modtager, i % af signalet)
  if (!host) return; const E = finalEdges(), pc = (v) => Math.round(v * 1000) / 10;
  const rows = [['mx', t('co.midX'), cfg.ctrX || 0], ['my', t('co.midY'), cfg.ctrY || 0], ['L', t('co.left'), E.L], ['R', t('co.right'), E.R], ['T', t('co.top'), E.T], ['B', t('co.bottom'), E.B]];
  const corners = [['↖', E.L, E.T], ['↗', E.R, E.T], ['↘', E.R, E.B], ['↙', E.L, E.B]];
  host.innerHTML = `<div class="co-grid">${rows.map(([k, l, v]) => `<label class="co-row"><span>${l}</span><input type="number" step="0.5" min="-100" max="100" data-co="${k}" value="${pc(v)}"><button class="ghost small" data-cs="${k}">${t('or.show')}</button></label>`).join('')}</div>
    <p class="cal-instr">${t('co.corners')}</p><div class="co-corners">${corners.map(([a, x, y]) => `<button class="ghost small" data-cc="${x},${y}">${a} X ${pc(x)} · Y ${pc(y)}</button>`).join('')}</div>
    <p class="cal-instr mono">${(() => { const P = prof(), m = cfg.dmxMode === 'pro' ? 'pro' : 'dj', l = ShowNET.sizeLimits(P, m); return t('co.info', { mode: m === 'pro' ? 'Professional' : 'DJ', min: Math.round(l.min * 1000) / 10, gx: (+P.posGainX).toFixed(2), gy: (+P.posGainY).toFixed(2), ax: P.scanDegX.toFixed(0), ay: P.scanDegY.toFixed(0) }); })()}</p>
    <div class="cal-r1"><button class="ghost small" data-cf="full">${t('co.full')}</button><button class="ghost small" data-cf="home">${t('or.home')}</button></div>`;
  host.querySelectorAll('[data-co]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.co, v = clamp(+el.value / 100, -1, 1); if (isNaN(+el.value)) return;
    if (k === 'K') { cfg.patK = clamp(+el.value, 0.1, 5); saveCfg(); sendNow(); return; }
    const E2 = finalEdges(); if (k === 'mx' || k === 'my') { if (k === 'mx') cfg.ctrX = v; else cfg.ctrY = v; cfg.axis = { x: cfg.ctrX, y: cfg.ctrY }; syncCtrUI(); setFinalEdges(E2); }
    else { E2[k] = v; setFinalEdges(E2); cfg.edgesUser = true; }
    saveCfg(); sendNow(); coordRender(host);
  }));
  const show = (x, y) => { con.pos = [clamp(x, -1, 1), clamp(y, -1, 1)]; sendNow(); };
  host.querySelectorAll('[data-cs]').forEach((el) => (el.onclick = () => { const k = el.dataset.cs, E2 = finalEdges(), cx = cfg.ctrX || 0, cy = cfg.ctrY || 0; show({ mx: cx, my: cx, L: E2.L, R: E2.R, T: cx, B: cx }[k], { mx: cy, my: cy, L: cy, R: cy, T: E2.T, B: E2.B }[k]); }));
  host.querySelectorAll('[data-cc]').forEach((el) => (el.onclick = () => { const [x, y] = el.dataset.cc.split(',').map(Number); show(x, y); }));
  host.querySelectorAll('[data-cf]').forEach((el) => (el.onclick = () => { if (el.dataset.cf === 'full') { const P = prof(); cfg.edgesUser = false; setFinalEdges({ L: -P.posGainX, R: P.posGainX, T: P.posGainY, B: -P.posGainY }); sendNow(); coordRender(host); } else { con.pos = null; sendNow(); } }));
}
function coordToggle(on) { const p = $('#pvCoPanel'); if (!p) return; const sh = on == null ? p.hidden : on; p.hidden = !sh; $('#pvCo').classList.toggle('on', sh); if (sh) coordRender($('#coBody')); else { con.pos = null; sendNow(); } }
{ const b = $('#pvCo'); if (b) b.onclick = () => coordToggle(); const c = $('#coClose'); if (c) c.onclick = () => coordToggle(false); }
function wizLimFull() { limEnsure(); const cx = cfg.ctrX || 0, cy = cfg.ctrY || 0; Object.assign(cfg.lim, { top: 1 - cy, bottom: -1 - cy, right: 1 - cx, left: -1 - cx, on: true }); ['top', 'bottom', 'left', 'right'].forEach((k) => (cfg.lim.set[k] = true)); saveCfg(); }
function wizPlace(ax, ay) { st.move = 'none'; st.posX = ax; st.posY = ay; sm.x = ax; sm.y = ay; sendNow(); }
function wizStopSweep() { if (wiz.sweep && wiz.sweep.timer) clearInterval(wiz.sweep.timer); if (wiz.sweep) wiz.sweep.timer = null; }
const WIZ_DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
function wizSweep(dir, speed) {
  wizStopSweep(); const v = WIZ_DIRS[dir]; wiz.sweep = { dir, a: 0, timer: null };
  wiz.sweep.timer = setInterval(() => { const sw = wiz.sweep; if (!sw) return; sw.a = Math.min(1, sw.a + (speed || 0.02)); wizPlace(v[0] * sw.a, v[1] * sw.a); wizInfo(); if (sw.a >= 1) wizStopSweep(); }, 220);
}
function wizNudge(d) { const sw = wiz.sweep; if (!sw) return; wizStopSweep(); sw.a = clamp(sw.a + d, 0, 1); const v = WIZ_DIRS[sw.dir]; wizPlace(v[0] * sw.a, v[1] * sw.a); wizInfo(); }
function wizInfo() { const el = $('#wizPos'); if (!el) return; const sw = wiz.sweep; const [oX, oY] = posOut(out.sendX, out.sendY); el.textContent = (sw ? t('wiz.at', { d: t('wiz.d.' + sw.dir), a: Math.round(sw.a * 100) }) + ' · ' : '') + t('wiz.sent', { x: Math.round(oX * 100), y: Math.round(oY * 100) }); }
function wizFlipMark(kind) { // mønsteret vendte/spejlede sig LIGE HER i retning sw.dir
  const sw = wiz.sweep; if (!sw) return; wizStopSweep();
  const f = { rot: [1, 1], lr: [1, 0], ud: [0, 1] }[kind]; if (!f) return;
  const P = posMat(), col = WIZ_DIRS[sw.dir][0] !== 0 ? 0 : 1, sgn = WIZ_DIRS[sw.dir][col]; const axis = P[0][col] !== 0 ? 0 : 1, side = Math.sign(P[axis][col] * sgn) || 1;
  const o = posOut(out.sendX, out.sendY); cfg.flipLearn = cfg.flipLearn || { base: [0, 0], rules: [] };
  cfg.flipLearn.rules = cfg.flipLearn.rules.filter((r) => !(r.axis === axis && r.side === side && Math.abs(r.at - o[axis]) < 0.06));
  cfg.flipLearn.rules.push({ axis, side, at: o[axis] - side * 0.01, f, dir: sw.dir }); saveCfg(); sendNow(); toast(t('wiz.flipSaved')); wizRender();
}
function wizBendMark() { const sw = wiz.sweep; if (!sw) return; wizStopSweep(); const k = sw.dir; cfg.bend = cfg.bend || {}; const arr = (cfg.bend[k] || []).filter((p) => Math.abs(p.s - st.size) > 0.08); arr.push({ s: st.size, at: Math.max(0.05, sw.a - 0.02) }); arr.sort((a, b) => a.s - b.s); cfg.bend[k] = arr; cfg.bendStop = true; saveCfg(); toast(t('wiz.bendSaved', { d: t('wiz.d.' + k), a: Math.round(sw.a * 100) })); wizRender(); }
function wizSetStep(n) {
  wizStopSweep(); wiz.sweep = null; wiz.step = clamp(n, 1, 2); limShow = null; wiz.noBend = wiz.step === 3 || wiz.step === 4;
  if (wiz.step === 1) { const p = cfg.setupPattern ?? 108; if (patAvail.has(p) || !patAvail.size) setPattern(p, true); st.size = cfg.setupSize ?? 0.13; sm.size = st.size; wizPlace(0, 0); }
  if (wiz.step === 2) { con.pos = null; wizPlace(0, 0); }
  if (wiz.step === 3) { st.size = 0.3; sm.size = 0.3; wizPlace(0, 0); }
  if (wiz.step === 4) { st.size = 0.85; sm.size = 0.85; wizPlace(0, 0); }
  if (wiz.step === 5) { wizPlace(0, 0); }
  wizRender();
}
function wizRender() {
  const box = $('#wizBody'); if (!box) return; $('#wizStepNo').textContent = t('wiz.stepOf', { n: wiz.step, m: 2 });
  const b = (id, txt, cls) => `<button class="ghost small ${cls || ''}" data-w="${id}">${txt}</button>`;
  const sel = (id, opts) => `<select class="dir-sel" data-ws="${id}"><option value="">${t('dir.what')}</option>${opts.map((o) => `<option value="${o}">${t('dir.o.' + o)}</option>`).join('')}</select>`;
  const L = lmap(); let h = `<h4>${t('wiz.t' + wiz.step)}</h4><p class="cal-instr">${t('wiz.i' + wiz.step)}</p>`;
  if (wiz.step === 1) h += `<div class="wiz-pad">${b('cu', '⬆')}<div>${b('cl', '⬅')}${b('cr', '➡')}</div>${b('cd', '⬇')}</div><div class="cal-r1">${b('fine', t(wiz.fine ? 'wiz.fineOn' : 'wiz.fineOff'))}</div><p class="cal-instr mono" id="wizPos"></p>`;
  if (wiz.step === 2) h += `<div id="wizCo"></div>`;
  if (wiz.step === 3 || wiz.step === 4) {
    h += `<div class="cal-r1">${['up', 'down', 'left', 'right'].map((d) => b('sw-' + d, t('wiz.go.' + d), wiz.sweep && wiz.sweep.dir === d ? 'on' : '')).join('')}</div>`;
    h += `<div class="cal-r1">${b('n-', '◀ −2')}${b('pause', '⏸')}${b('n+', '+2 ▶')}${b('home', t('wiz.home'))}</div><p class="cal-instr mono" id="wizPos"></p>`;
    if (wiz.step === 3) h += `<div class="cal-r1">${b('fl-rot', t('wiz.nowRot'), 'wiz-hot')}${b('fl-lr', t('wiz.nowLr'), 'wiz-hot')}${b('fl-ud', t('wiz.nowUd'), 'wiz-hot')}</div><p class="cal-instr">${t('wiz.rules', { n: (cfg.flipLearn && cfg.flipLearn.rules.length) || 0 })}</p>${b('flClear', t('wiz.flClear'))}`;
    else h += `<div class="cal-r1">${b('bend', t('wiz.nowBend'), 'wiz-hot')}</div><p class="cal-instr">${['up', 'down', 'left', 'right'].map((d) => t('wiz.d.' + d) + ': ' + Math.round(bendAt(d, st.size) * 100) + ' %').join(' · ')}</p><div class="cal-r1">${b('sz-', t('wiz.sizeLess'))}${b('sz+', t('wiz.sizeMore'))}${b('bendClear', t('wiz.bendClear'))}${b('bendStop', t(cfg.bendStop ? 'wiz.bendStopOn' : 'wiz.bendStopOff'), cfg.bendStop ? 'on' : '')}</div><p class="cal-instr">${t('wiz.sizeNow', { s: Math.round(st.size * 100) })}</p>`;
  }
  if (wiz.step === 5) h += `<div id="wizLimRows"></div>`;
  if (wiz.step === 6) h += `<p class="cal-instr">${t('wiz.summary', { x: Math.round((cfg.ctrX || 0) * 100), y: Math.round((cfg.ctrY || 0) * 100), lx: t('dir.a.' + L.x), ly: t('dir.a.' + L.y), f: (cfg.flipLearn && cfg.flipLearn.rules.length) || 0, b: Object.values(cfg.bend || {}).reduce((a, v) => a + v.length, 0) })}</p>`;
  box.innerHTML = h;
  if (wiz.step === 2) coordRender($('#wizCo'));
  if (wiz.step === 5) { const host = $('#wizLimRows'); LIM_ROWS.filter((r) => r.kind === 'size').forEach((r) => { const el = document.createElement('div'); el.className = 'lim-row'; el.dataset.k = r.k; el.innerHTML = `<div class="lim-name"><b>${t('lim.' + r.k)}</b><span class="lim-who"></span></div><div class="lim-v mono"></div>`; const mk = (txt, fn) => { const x = document.createElement('button'); x.className = 'ghost small'; x.textContent = txt; x.onclick = () => { fn(); limPaint(); }; return x; }; el.append(mk('👁', () => limShowRow(r)), mk('−−', () => limStep(r, -4)), mk('−', () => limStep(r, -1)), mk('+', () => limStep(r, 1)), mk('++', () => limStep(r, 4))); host.appendChild(el); }); limEnsure(); limPaint(); }
  box.querySelectorAll('[data-w]').forEach((el) => (el.onclick = () => wizAct(el.dataset.w)));
  box.querySelectorAll('[data-ws]').forEach((el) => (el.onchange = () => wizSel(el.dataset.ws, el.value)));
  $('#wizBack').disabled = wiz.step <= 1; $('#wizNext').textContent = t(wiz.step >= 2 ? 'wiz.finish' : 'wiz.centerOk');
  wizInfo();
}
function wizCenterHere() { // dér hvor mønstret står nu (trukket i LIVE / pile) = laserens midte
  sendNow(); const E = finalEdges(); cfg.ctrX = clamp(out.sendX, -1, 1); cfg.ctrY = clamp(out.sendY, -1, 1); cfg.axis = { x: cfg.ctrX, y: cfg.ctrY }; saveCfg(); syncCtrUI(); if (cfg.edgesUser) setFinalEdges(E); else wizLimFull(); sendNow();
}
function wizFmtSweep(fmt) { // kør langsomt helt fra venstre til højre – det rigtige format bevæger sig jævnt hele vejen uden at hoppe eller vende om
  clearInterval(wiz.fmtT); let v = -1; wiz.fmtT = setInterval(() => { v += 0.02; if (v > 1.0001) { clearInterval(wiz.fmtT); wiz.fmtT = null; return; } wizFmtTest(fmt, v); const el = $('#wizFmtOut'); if (el) el.textContent = t('wiz.fmtSweepAt', { f: { s: 'A', u: 'B', t: 'C' }[fmt], v: Math.round(v * 100) }) + ' · ' + el.textContent; }, 110);
}
function wizFmtTest(fmt, side) { limShow = { pos: [side, 0], fmt, k: 'fmt' }; sendNow(); const ch = (c) => dmx[cfg.address - 2 + c] | 0; const el = $('#wizFmtOut'); if (el) el.textContent = t('wiz.fmtSent', { f: { s: 'A', u: 'B', t: 'C' }[fmt], a: ch(7), b: ch(8), c: ch(9), d: ch(10) }); }
function arrowDir(dx, dy) { // hvad pilene gør i appen (kan vendes/byttes i Indstillinger og Opsætning)
  if (cfg.arrowSwap) [dx, dy] = [dy, dx]; if (cfg.arrowFlipX) dx = -dx; if (cfg.arrowFlipY) dy = -dy; return [dx, dy];
}
function wizCtr(dx, dy) { // pilene i trin 1 rykker MØNSTRET i LIVE (som at trække det); "Midten er sat" gør stedet til midten
  [dx, dy] = arrowDir(dx, dy); const st_ = wiz.fine ? 0.0025 : 0.01, v = viewGeom(); // trin i det laseren modtager: 1 % (fin 0,25 %)
  st.posX = clamp(st.posX + dx * st_ / v.r, -1, 1); st.posY = clamp(st.posY + dy * st_ / v.t, -1, 1); sm.x = st.posX; sm.y = st.posY; saveLook(); syncSizeUI(); sendNow(); wizRender();
}
function wizCtrOld(dx, dy) { const st_ = wiz.fine ? 0.005 : 0.02; cfg.ctrX = clamp((cfg.ctrX || 0) + dx * st_, -1, 1); cfg.ctrY = clamp((cfg.ctrY || 0) + dy * st_, -1, 1); saveCfg(); syncCtrUI(); sendNow(); wizRender(); }
function wizAct(a) {
  if (a === 'cu') return wizCtr(0, 1); if (a === 'cd') return wizCtr(0, -1); if (a === 'cl') return wizCtr(-1, 0); if (a === 'cr') return wizCtr(1, 0);
  if (a === 'afx' || a === 'afy' || a === 'asw') { const k = { afx: 'arrowFlipX', afy: 'arrowFlipY', asw: 'arrowSwap' }[a]; cfg[k] = !cfg[k]; saveCfg(); syncArrowUI(); return wizRender(); }
  if (a === 'dot') { setPattern(cfg.testDot || 238); return wizRender(); }
  if (a === 'axisMid') { const ax = cfg.axis || { x: 0, y: 0 }; cfg.ctrX = ax.x; cfg.ctrY = ax.y; st.posX = 0; st.posY = 0; sm.x = 0; sm.y = 0; saveCfg(); syncCtrUI(); wizLimFull(); sendNow(); return wizRender(); }
  if (a === 'fine') { wiz.fine = !wiz.fine; return wizRender(); }
  if (a === 'c0') { cfg.ctrX = 0; cfg.ctrY = 0; saveCfg(); syncCtrUI(); wizPlace(0, 0); return wizRender(); }
  if (a.startsWith('fs-')) return wizFmtSweep(a.slice(3));
  if (a.startsWith('ft-')) { clearInterval(wiz.fmtT); if (a === 'ft-stop') { limShow = null; sendNow(); return; } const [, f, sd] = a.split('-'); return wizFmtTest(f, sd === 'r' ? 1 : -1); }
  if (a.startsWith('fu-')) { cfg.posFmt = a.slice(3); limShow = null; saveCfg(); const el = $('#posFmt'); if (el) el.value = cfg.posFmt; sendNow(); toast(t('wiz.fmtSet', { f: t('wiz.fmt.' + cfg.posFmt) })); return wizRender(); }
  if (a === 'mirror') { makeMirrorCopies(st.pattern).then(() => wizRender()); return; }
  if (a.startsWith('sw-')) { wizSweep(a.slice(3)); return wizRender(); }
  if (a === 'pause') { if (wiz.sweep && wiz.sweep.timer) wizStopSweep(); else if (wiz.sweep) wizSweep(wiz.sweep.dir); return; }
  if (a === 'n-') return wizNudge(-0.02); if (a === 'n+') return wizNudge(0.02);
  if (a === 'home') { wizStopSweep(); wiz.sweep = null; wizPlace(0, 0); return wizRender(); }
  if (a.startsWith('fl-')) return wizFlipMark(a.slice(3));
  if (a === 'flClear') { cfg.flipLearn = { base: (cfg.flipLearn && cfg.flipLearn.base) || [0, 0], rules: [] }; saveCfg(); sendNow(); return wizRender(); }
  if (a === 'bend') return wizBendMark();
  if (a === 'bendClear') { cfg.bend = {}; cfg.bendStop = false; saveCfg(); return wizRender(); }
  if (a === 'bendStop') { cfg.bendStop = !cfg.bendStop; saveCfg(); sendNow(); return wizRender(); }
  if (a === 'sz-' || a === 'sz+') { st.size = clamp(st.size + (a === 'sz+' ? 0.1 : -0.1), 0.05, 1); sm.size = st.size; sendNow(); return wizRender(); }
}
function wizSel(k, v) {
  if (!v) return;
  if (k === 'qu') { if (v !== 'u') lmapObserve(arrowDir(0, 1), v); toast(t(v === 'u' ? 'dir.res.ok' : 'wiz.dirFixed')); wizPlace(0, 0); return wizRender(); }
  if (k === 'qr') { if (v !== 'r') lmapObserve(arrowDir(1, 0), v); toast(t(v === 'r' ? 'dir.res.ok' : 'wiz.dirFixed')); wizPlace(0, 0); return wizRender(); }
  if (k === 'base') { cfg.flipLearn = cfg.flipLearn || { base: [0, 0], rules: [] }; const f = { ok: [0, 0], rot: [1, 1], lr: [1, 0], ud: [0, 1] }[v]; const b0 = cfg.flipLearn.base; cfg.flipLearn.base = [b0[0] ^ f[0], b0[1] ^ f[1]]; saveCfg(); sendNow(); toast(t(v === 'ok' ? 'dir.res.ok' : 'wiz.baseFixed')); return wizRender(); }
}
function wizToggle(on) {
  const p = $('#pvWizPanel'); if (!p) return; const show = on == null ? p.hidden : on; p.hidden = !show; $('#pvWiz').classList.toggle('on', show);
  if (show) {
    wiz.on = true; wiz.keep = { posX: st.posX, posY: st.posY, size: st.size, move: st.move, rotSpeed: st.rotSpeed, pattern: st.pattern };
    if (raw.on) rawToggle(false); if (special) setSpecial(special); if (autoMode !== 'off') setAuto('off'); st.rotSpeed = 0;
    if (!cfg.flipLearn) cfg.flipLearn = { base: [0, 0], rules: [] };
    if (!cfg.edgesUser) wizLimFull(); else limEnsure(); cfg.lim.on = true; wiz.step = 1; wizSetStep(1); clearInterval(wiz.it); wiz.it = setInterval(wizInfo, 200);
  } else {
    clearInterval(wiz.it); clearInterval(wiz.fmtT); wizStopSweep(); wiz.sweep = null; wiz.on = false; wiz.noBend = false; limShow = null;
    con.pos = null; if (wiz.keep) { const kp = wiz.keep.pattern; Object.assign(st, wiz.keep); if (kp != null && kp !== st.pattern) setPattern(kp, true); else st.pattern = kp; sm.x = st.posX; sm.y = st.posY; sm.size = st.size; } saveLook(); syncLookUI(); syncSizeUI(); sendNow();
  }
}
{ const b = $('#pvWiz'); if (b) b.onclick = () => wizToggle();
  const c = $('#wizClose'); if (c) c.onclick = () => wizToggle(false);
  const bk = $('#wizBack'); if (bk) bk.onclick = () => wizSetStep(wiz.step - 1);
  const nx = $('#wizNext'); if (nx) nx.onclick = () => { if (wiz.step === 1) wizCenterHere(); if (wiz.step >= 2) { cfg.calibDone = true; cfg.setupDone = true; saveCfg(); toast(t('wiz.done')); wizToggle(false); return; } wizSetStep(wiz.step + 1); };
  document.addEventListener('keydown', (e) => { if (!wiz.on || $('#pvWizPanel').hidden) return; if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
    const m = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]; if (!m) return; e.preventDefault(); e.stopPropagation();
    if (wiz.step === 1) wizCtr(m[0], m[1]); else if (wiz.sweep) wizNudge((m[0] + m[1]) * 0.01 * (WIZ_DIRS[wiz.sweep.dir][0] + WIZ_DIRS[wiz.sweep.dir][1])); }, true);
}
// ---------- Grænser: se og ret de værdier appen TROR er laserens yderpunkter (top/bund/venstre/højre, mindste/største, zone) ----------
var limShow = null; // { pos:[x,y] } | { ch4 } | { zone } – sendes præcis mens du ser på den
const LIM_ROWS = [
  { k: 'top', kind: 'pos', axis: 1, sign: 1 }, { k: 'bottom', kind: 'pos', axis: 1, sign: -1 },
  { k: 'left', kind: 'pos', axis: 0, sign: -1 }, { k: 'right', kind: 'pos', axis: 0, sign: 1 },
  { k: 'small', kind: 'size' }, { k: 'big', kind: 'size' },
  { k: 'zoneLo', kind: 'zone' }, { k: 'zoneHi', kind: 'zone' },
];
function limBelief() { // kør appens egen omregning og aflæs hvad den sender i yderpunkterne
  const keep = { x: st.posX, y: st.posY, s: st.size, mv: st.move, sx: sm.x, sy: sm.y, ss: sm.size }, was = cfg.lim && cfg.lim.on; if (cfg.lim) cfg.lim.on = false;
  const at = (px, py) => { st.posX = px; st.posY = py; sm.x = px; sm.y = py; st.move = 'none'; computeFrame(performance.now()); return [out.sendX, out.sendY]; };
  const b = { top: at(0, 1)[1], bottom: at(0, -1)[1], left: at(-1, 0)[0], right: at(1, 0)[0] };
  if (cfg.lim) cfg.lim.on = was; Object.assign(st, { posX: keep.x, posY: keep.y, size: keep.s, move: keep.mv }); Object.assign(sm, { x: keep.sx, y: keep.sy, size: keep.ss });
  b.small = sizeCh4(0); b.big = sizeCh4(1);
  for (const k in b) if (typeof b[k] === 'number') b[k] = Math.round(b[k] * (['small', 'big'].includes(k) ? 1 : 100)) / (['small', 'big'].includes(k) ? 1 : 100);
  return b;
}
function limEnsure() { if (!cfg.lim || cfg.lim.top == null) { const b = limBelief(); cfg.lim = { on: false, ...b, set: {} }; saveCfg(); } if (!cfg.lim.set) cfg.lim.set = {}; }
const zoneBase = () => ({ bottom: 64, top: 0, left: 128, right: 192 }[cfg.zoneSide] || 64);
function limVal(r) { if (r.kind === 'zone') return zoneBase() + (r.k === 'zoneLo' ? (cfg.zoneLo ?? 40) : (cfg.zoneHi ?? 63)); return cfg.lim[r.k]; }
function limShowRow(r) {
  if (r.kind === 'pos') { const p = [0, 0]; p[r.axis] = cfg.lim[r.k]; limShow = { pos: p, k: r.k }; }
  else if (r.kind === 'size') limShow = { ch4: cfg.lim[r.k], k: r.k };
  else limShow = { zone: limVal(r), k: r.k };
  if (raw.on) rawToggle(false); sendNow(); limPaint();
}
function limStep(r, d) {
  limEnsure();
  if (r.kind === 'pos') { const out_ = Math.sign(cfg.lim[r.k]) || r.sign; const v = clamp(Math.round((cfg.lim[r.k] + out_ * d / 100) * 100) / 100, -1, 1); cfg.lim[r.k] = v; }
  else if (r.kind === 'size') cfg.lim[r.k] = clamp(cfg.lim[r.k] + d, 0, 127);
  else { if (r.k === 'zoneLo') cfg.zoneLo = clamp((cfg.zoneLo ?? 40) + d, 1, (cfg.zoneHi ?? 63) - 1); else cfg.zoneHi = clamp((cfg.zoneHi ?? 63) + d, (cfg.zoneLo ?? 40) + 1, 63); }
  cfg.lim.set[r.k] = true; if (r.kind !== 'zone') cfg.lim.on = true; saveCfg(); limShowRow(r);
}
function limDmxText(r) {
  const v = limVal(r);
  if (r.kind === 'pos') { const [oX, oY] = posOut(r.axis === 0 ? v : 0, r.axis === 1 ? v : 0); const keep = [dmx[cfg.address + 5], dmx[cfg.address + 6], dmx[cfg.address + 7], dmx[cfg.address + 8]]; pos16(7, oX, true); pos16(9, oY, true); const ch = r.axis === 0 ? 7 : 9; const a = dmx[cfg.address - 2 + ch], b = dmx[cfg.address - 1 + ch]; [7, 8, 9, 10].forEach((c, i) => (dmx[cfg.address - 2 + c] = keep[i])); return `${(v > 0 ? '+' : '') + Math.round(v * 100)} %  →  ${t('dir.ch')} ${ch}: ${a} / ${ch + 1}: ${b}${Math.abs(v) >= 1 ? '  ' + t('lim.max') : ''}`; }
  if (r.kind === 'size') return `${t('dir.ch')} 4 = ${v}`;
  return `${t('dir.ch')} 16 = ${v}`;
}
function limPaint() {
  $$('.lim-row').forEach((el) => { const r = LIM_ROWS.find((q) => q.k === el.dataset.k); el.querySelector('.lim-v').textContent = limDmxText(r); el.querySelector('.lim-who').textContent = t(cfg.lim.set && cfg.lim.set[r.k] ? 'lim.yours' : 'lim.app'); el.classList.toggle('showing', !!(limShow && limShow.k === r.k)); el.classList.toggle('mine', !!(cfg.lim.set && cfg.lim.set[r.k])); });
  const o = $('#limOn'); if (o) o.checked = !!cfg.lim.on;
}
function limBuild() {
  const box = $('#limRows'); if (!box || box.childElementCount) return;
  LIM_ROWS.forEach((r) => {
    const el = document.createElement('div'); el.className = 'lim-row'; el.dataset.k = r.k;
    const nm = document.createElement('div'); nm.className = 'lim-name'; nm.innerHTML = `<b>${t('lim.' + r.k)}</b><span class="lim-who"></span>`;
    const v = document.createElement('div'); v.className = 'lim-v mono';
    const mk = (txt, fn, cls) => { const b = document.createElement('button'); b.className = 'ghost small ' + (cls || ''); b.textContent = txt; b.onclick = fn; return b; };
    const big = r.kind === 'pos' ? 5 : 4;
    el.append(nm, v, mk('👁', () => limShowRow(r), 'lim-show'), mk('−−', () => limStep(r, -big)), mk('−', () => limStep(r, -1)), mk('+', () => limStep(r, 1)), mk('++', () => limStep(r, big)));
    if (r.kind === 'pos') { // hurtig-menu: hvordan passer kanten i virkeligheden?
      const sel = document.createElement('select'); sel.className = 'lim-sel';
      [['', 'lim.q'], ['more10', 'lim.more10'], ['more3', 'lim.more3'], ['ok', 'lim.ok'], ['less3', 'lim.less3'], ['less10', 'lim.less10'], ['max', 'lim.toMax']].forEach(([v_, k_]) => { const o = document.createElement('option'); o.value = v_; o.textContent = t(k_); sel.appendChild(o); });
      sel.onchange = () => { const a = sel.value; sel.value = ''; if (!a) return; if (a === 'ok') { limEnsure(); cfg.lim.set[r.k] = true; cfg.lim.on = true; saveCfg(); limPaint(); toast(t('lim.okDone')); return; }
        if (a === 'max') { limEnsure(); cfg.lim[r.k] = r.sign; cfg.lim.set[r.k] = true; cfg.lim.on = true; saveCfg(); limShowRow(r); return; }
        const n = { more10: 10, more3: 3, less3: -3, less10: -10 }[a]; limStep(r, n); };
      el.appendChild(sel);
    }
    box.appendChild(el);
  });
}
function limToggle(on) {
  const p = $('#pvLimPanel'); if (!p) return; const show = on == null ? p.hidden : on; p.hidden = !show; $('#pvLim').classList.toggle('on', show);
  if (show) { limEnsure(); limBuild(); limPaint(); } else { limShow = null; sendNow(); }
}
{ const b = $('#pvLim'); if (b) b.onclick = () => limToggle();
  const c = $('#limClose'); if (c) c.onclick = () => limToggle(false);
  const st_ = $('#limStop'); if (st_) st_.onclick = () => { limShow = null; sendNow(); limPaint(); };
  const o = $('#limOn'); if (o) o.onchange = () => { limEnsure(); cfg.lim.on = o.checked; saveCfg(); sendNow(); };
  const fm = $('#limFull'); if (fm) fm.onclick = () => { limEnsure(); ['top', 'bottom', 'left', 'right'].forEach((k) => { cfg.lim[k] = LIM_ROWS.find((q) => q.k === k).sign; cfg.lim.set[k] = true; }); cfg.lim.on = true; saveCfg(); sendNow(); limPaint(); toast(t('lim.fullDone')); };
  const re = $('#limReread'); if (re) re.onclick = () => { const was = cfg.lim && cfg.lim.on; if (cfg.lim) cfg.lim.on = false; const b = limBelief(); cfg.lim = { on: false, ...b, set: {} }; saveCfg(); limPaint(); toast(t('lim.reread')); if (was) {} };
}
// ---------- Retnings-test: appen sender en kommando, du vælger i en menu hvad der FAKTISK skete – appen retter sin fortolkning ----------
// Laserens akser: L = hvor laserens sendte +X og +Y ender i virkeligheden ('r','l','u','d'). Udgangen P = L⁻¹, så app-retning = virkelighed.
const DV = { r: [1, 0], l: [-1, 0], u: [0, 1], d: [0, -1] };
const vKey = (v) => (v[0] > 0 ? 'r' : v[0] < 0 ? 'l' : v[1] > 0 ? 'u' : 'd');
const vNeg = (k) => ({ r: 'l', l: 'r', u: 'd', d: 'u' }[k]);
function lmap() { const L = cfg.lmap || {}; let x = L.x || (cfg.dirX ? 'l' : 'r'), y = L.y || (cfg.dirY ? 'd' : 'u'); return { x, y }; }
function posMat() { // P = L^T (signed permutation)
  const L = lmap(), cx = DV[L.x], cy = DV[L.y]; // kolonner i L
  return [[cx[0], cx[1]], [cy[0], cy[1]]]; // rækker = kolonner af L
}
function posOut(x, y) { const P = posMat(); return [P[0][0] * x + P[0][1] * y, P[1][0] * x + P[1][1] * y]; }
function lmapObserve(intended, seen) { // app ville 'intended' (vektor) – laseren gik 'seen' (nøgle)
  const oc = posOut(cfg.ctrX || 0, cfg.ctrY || 0); // midten skal blive stående fysisk
  const P = posMat(), u = [P[0][0] * intended[0] + P[0][1] * intended[1], P[1][0] * intended[0] + P[1][1] * intended[1]]; // sendt laser-akse
  const L = lmap(); const axis = u[0] !== 0 ? 'x' : 'y', w = (u[0] + u[1]) > 0 ? seen : vNeg(seen); L[axis] = w;
  const other = axis === 'x' ? 'y' : 'x'; const hz = (k) => k === 'r' || k === 'l';
  if (hz(L[axis]) === hz(L[other])) L[other] = hz(L[axis]) ? (L[other] === 'l' ? 'd' : 'u') : (L[other] === 'd' ? 'l' : 'r'); // akserne kan ikke pege samme vej
  cfg.lmap = L; cfg.dirX = false; cfg.dirY = false;
  const Pn = posMat(); cfg.ctrX = Pn[0][0] * oc[0] + Pn[1][0] * oc[1]; cfg.ctrY = Pn[0][1] * oc[0] + Pn[1][1] * oc[1]; if (typeof syncCtrUI === 'function') syncCtrUI();
  saveCfg();
}
const DIR_CMDS = [
  { k: 'up', run: () => setPos('posY', st.posY + 0.1), kind: 'pos', v: [0, 1] },
  { k: 'down', run: () => setPos('posY', st.posY - 0.1), kind: 'pos', v: [0, -1] },
  { k: 'left', run: () => setPos('posX', st.posX - 0.1), kind: 'pos', v: [-1, 0] },
  { k: 'right', run: () => setPos('posX', st.posX + 0.1), kind: 'pos', v: [1, 0] },
  { k: 'bigger', run: () => setSize(clamp(st.size + 0.1, 0, 1)), kind: 'size', want: 'bigger' },
  { k: 'smaller', run: () => setSize(clamp(st.size - 0.1, 0, 1)), kind: 'size', want: 'smaller' },
  { k: 'cw', run: () => { st.rotSpeed = 0; st.rotAngle = ((st.rotAngle + 15 + 180) % 360) - 180; saveLook(); syncLookUI(); }, kind: 'rot', want: 'cw' },
  { k: 'ccw', run: () => { st.rotSpeed = 0; st.rotAngle = ((st.rotAngle - 15 + 540) % 360) - 180; saveLook(); syncLookUI(); }, kind: 'rot', want: 'ccw' },
  { k: 'zoneUp', run: () => { cfg.zone = clamp(Math.round((cfg.zone + 0.1) * 100) / 100, 0, 0.9); saveCfg(); if (typeof syncZoneUI === 'function') syncZoneUI(); }, kind: 'zone', want: 'more' },
  { k: 'zoneDown', run: () => { cfg.zone = clamp(Math.round((cfg.zone - 0.1) * 100) / 100, 0, 0.9); saveCfg(); if (typeof syncZoneUI === 'function') syncZoneUI(); }, kind: 'zone', want: 'less' },
  { k: 'center', run: () => { setPos('posX', 0); setPos('posY', 0); }, kind: 'center' },
];
const DIR_OPTS = { pos: ['u', 'd', 'l', 'r', 'none'], size: ['bigger', 'smaller', 'none'], rot: ['cw', 'ccw', 'none'], zone: ['more', 'less', 'none'], center: ['yes', 'no'] };
const dirRes = {}; // k → tekst om hvad der blev rettet
const DMX_NAMES = { 1: 'lys', 2: 'mønster', 3: 'fps', 4: 'størrelse', 6: 'rotation', 7: 'X', 8: 'X fin', 9: 'Y', 10: 'Y fin', 11: 'farve', 13: 'strobe', 16: 'zone', 17: 'zone til' };
function dirSnap() { sendNow(); const a = []; for (let c = 1; c <= 19; c++) a.push(dmx[cfg.address - 2 + c] | 0); return a; }
function dirRun(cmd) {
  if (raw.on) rawToggle(false); if (special) setSpecial(special); limShow = null;
  st.move = 'none'; const before = dirSnap();
  cmd.run(); sm.x = st.posX; sm.y = st.posY; sm.size = st.size; const after = dirSnap();
  const diff = []; after.forEach((v, i) => { if (v !== before[i]) diff.push(`${t('dir.ch')} ${i + 1}${DMX_NAMES[i + 1] ? ' (' + DMX_NAMES[i + 1] + ')' : ''}: ${before[i]} → ${v}`); });
  const row = document.querySelector(`.dir-row[data-k="${cmd.k}"]`); if (!row) return;
  row.querySelector('.dir-sent').textContent = diff.length ? diff.join(' · ') : t('dir.noChange');
  row.classList.add('ran'); delete dirRes[cmd.k]; dirPaint();
}
function dirAnswer(cmd, ans) {
  if (!ans) return;
  if (ans === 'none') { dirRes[cmd.k] = t('dir.res.none'); dirPaint(); return; }
  if (cmd.kind === 'center') { dirRes[cmd.k] = ans === 'yes' ? t('dir.res.ok') : t('dir.centerFix'); dirPaint(); return; }
  if (cmd.kind === 'pos') {
    if (ans === vKey(cmd.v)) dirRes[cmd.k] = t('dir.res.ok');
    else { lmapObserve(cmd.v, ans); dirRes[cmd.k] = t('dir.res.fixed', { a: t('dir.cmd.' + cmd.k), b: t('dir.o.' + ans) }); }
  } else {
    const flag = { size: 'sizeFlip', rot: 'rotDir', zone: 'zoneFlip' }[cmd.kind];
    if (ans === cmd.want) dirRes[cmd.k] = t('dir.res.ok');
    else { cfg[flag] = !cfg[flag]; saveCfg(); if (flag === 'sizeFlip') { const el = $('#sizeFlip'); if (el) el.checked = !!cfg.sizeFlip; } dirRes[cmd.k] = t('dir.res.fixed', { a: t('dir.cmd.' + cmd.k), b: t('dir.o.' + ans) }); }
  }
  sendNow(); dirPaint(); toast(dirRes[cmd.k]);
}
function dirPaint() {
  $$('.dir-row').forEach((r) => { const k = r.dataset.k, res = r.querySelector('.dir-res'); if (res) res.textContent = dirRes[k] || ''; r.classList.toggle('fixed', !!dirRes[k]); const sel = r.querySelector('select'); if (sel) sel.value = ''; });
  const L = lmap(), st_ = $('#dirState');
  if (st_) st_.textContent = t('dir.state2', { x: t('dir.a.' + L.x), y: t('dir.a.' + L.y), s: t(cfg.sizeFlip ? 'dir.flipped' : 'dir.normal'), r: t(cfg.rotDir ? 'dir.flipped' : 'dir.normal'), z: t(cfg.zoneFlip ? 'dir.flipped' : 'dir.normal') });
}
function dirBuild() {
  const box = $('#dirRows'); if (!box || box.childElementCount) return;
  DIR_CMDS.forEach((cmd) => {
    const r = document.createElement('div'); r.className = 'dir-row'; r.dataset.k = cmd.k;
    const go = document.createElement('button'); go.className = 'ghost small dir-go'; go.textContent = t('dir.cmd.' + cmd.k); go.onclick = () => dirRun(cmd);
    const info = document.createElement('div'); info.className = 'dir-info';
    const th = document.createElement('div'); th.className = 'dir-think'; th.textContent = t('dir.think') + ' ' + t('dir.exp.' + cmd.k);
    const se = document.createElement('div'); se.className = 'dir-sent mono'; se.textContent = '–';
    const res = document.createElement('div'); res.className = 'dir-res'; info.append(th, se, res);
    const sel = document.createElement('select'); sel.className = 'dir-sel';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = t('dir.what'); sel.appendChild(o0);
    DIR_OPTS[cmd.kind].forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = t('dir.o.' + k); sel.appendChild(o); });
    sel.onchange = () => dirAnswer(cmd, sel.value);
    r.append(go, info, sel); box.appendChild(r);
  });
  dirPaint();
}
function dirToggle(on) { const p = $('#pvDirPanel'); if (!p) return; const show = on == null ? p.hidden : on; p.hidden = !show; $('#pvDir').classList.toggle('on', show); if (show) { dirBuild(); dirPaint(); } }
{ const b = $('#pvDir'); if (b) b.onclick = () => dirToggle(); const c = $('#dirClose'); if (c) c.onclick = () => dirToggle(false);
  const r = $('#dirReset'); if (r) r.onclick = () => { ['dirX', 'dirY', 'rotDir', 'zoneFlip', 'sizeFlip'].forEach((k) => (cfg[k] = false)); cfg.lmap = null; saveCfg(); for (const k in dirRes) delete dirRes[k]; sendNow(); dirPaint(); toast(t('dir.resetDone')); }; }
(() => {
  const b = $('#pvRaw'); if (!b) return; b.onclick = () => rawToggle();
  const bind = (id, k) => { const el = $('#' + id); if (!el) return; el.addEventListener('input', () => { raw[k] = +el.value; rawSync(); sendNow(); }); };
  bind('rawX', 'x'); bind('rawY', 'y'); bind('rawSize', 'size'); bind('rawZone', 'zone');
  $('#rawZoneOff').onclick = () => { raw.zone = null; rawSync(); sendNow(); };
  $$('#pvRawPanel [data-corner]').forEach((x) => (x.onclick = () => rawCorner(x.dataset.corner)));
  $('#rawLearnBtn').onclick = () => { raw.learnClick = true; toast(t('raw.clickHint')); };
  $('#rawFit').onclick = () => rawFit();
  $('#rawClear').onclick = () => { raw.pts = []; store.set('rawPts', []); rawSync(); toast(t('raw.cleared')); };
  $('#rawSizeMin').onclick = () => rawSizeMark('min'); $('#rawSizeMax').onclick = () => rawSizeMark('max');
  $('#rawZoneLo').onclick = () => rawZoneMark('lo'); $('#rawZoneHi').onclick = () => rawZoneMark('hi');
  $('#rawCenter').onclick = () => { cfg.ctrX = clamp(raw.x / 100, -1, 1); cfg.ctrY = clamp(raw.y / 100, -1, 1); saveCfg(); syncCtrUI(); toast(t('raw.centerSet', { x: Math.round(raw.x), y: Math.round(raw.y) })); };
  $('#rawRotZero').onclick = () => { const v = raw.ch[6]; cfg.rotZero = v === '' || v == null ? 96 : clamp(+v, 0, 192); saveCfg(); toast(t('raw.rotSet', { v: cfg.rotZero })); };
  // kanal-felter: tomt = appen styrer, tal = sendes præcis sådan mens panelet er åbent
  const grid = $('#rawCh'); if (grid) { for (let k = 1; k <= 19; k++) { const w = document.createElement('label'); w.className = 'rawch'; const sp = document.createElement('span'); sp.textContent = k; const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.max = 255; inp.placeholder = '–'; inp.addEventListener('input', () => { raw.ch[k] = inp.value; sendNow(); }); w.append(sp, inp); grid.appendChild(w); } }
  $('#rawChClear').onclick = () => { raw.ch = {}; $$('#rawCh input').forEach((i) => (i.value = '')); sendNow(); };
  setInterval(() => { if (raw.on) rawSync(); }, 300);
})();
function wmLearn(fn) { wm.learn = fn ? { fn } : null; renderWmMap(); toast(fn ? t('wm.learnHint', { f: t('wm.f.' + fn) }) : t('wm.learnOff')); }
(() => {
  if (window.laser.onDmxIn) window.laser.onDmxIn(wmOnFrame);
  setInterval(() => { wmStatus(); const w = $('#wmMap'); if (w && w.offsetParent) [...w.querySelectorAll('.wm-val')].forEach((el, i) => { const v = wm.prevVals[Math.max(0, (cfg.wmAddress | 0) - 1) + i]; el.textContent = v >= 0 ? v : '–'; }); }, 500);
  const sel = $('#wmLearnSel'); if (sel) { for (const f of WM_FUNCS.filter((x) => x !== 'none')) { const o = document.createElement('option'); o.value = f; o.textContent = t('wm.f.' + f); sel.appendChild(o); } }
  const lb = $('#wmLearnBtn'); if (lb) lb.onclick = () => wmLearn(wm.learn ? null : $('#wmLearnSel').value);
  const rb = $('#wmReset'); if (rb) rb.onclick = () => { cfg.wmMap = WM_DEFAULT.slice(); saveCfg(); renderWmMap(); if (typeof renderWolf === 'function') renderWolf(); };
  renderWmMap();
})();
// ---- USB-diagnose: hvad ser Mac'en når fx Wolfmix sættes i med USB-C? (WebUSB + WebSerial lister enhederne)
(() => {
  const btn = $('#usbScan'); if (!btn) return; const out = $('#usbList');
  const found = { usb: null, serial: null };
  const render = () => {
    const lines = [];
    if (found.usb) lines.push(found.usb.length ? found.usb.map((d) => `USB: ${d.manufacturerName || '?'} – ${d.productName || '?'} (VID ${(d.vendorId || 0).toString(16).padStart(4, '0')} / PID ${(d.productId || 0).toString(16).padStart(4, '0')}) · klasser: ${[...new Set(d.classes || [])].map((c) => ({ 2: 'CDC/seriel', 3: 'HID', 10: 'CDC-data', 8: 'lager', 1: 'lyd', 255: 'vendor' }[c] || c)).join(', ') || '?'}`).join('\n') : t('usb.none'));
    if (found.serial) lines.push(found.serial.length ? found.serial.map((p) => `Seriel: ${p.displayName || p.portName || '?'} (${p.portName || ''}${p.vendorId ? ' VID ' + p.vendorId.toString(16) : ''}${p.productId ? ' PID ' + p.productId.toString(16) : ''})`).join('\n') : t('usb.noSerial'));
    out.textContent = lines.join('\n') || t('usb.scanning');
  };
  if (window.laser.onUsbList) window.laser.onUsbList((d) => { found[d.kind] = d.list; render(); });
  const db = $('#usbDiag'); if (db) db.onclick = async () => { out.textContent = t('usb.diagRun'); try { const r = await window.laser.usbDiag(); const wolf = (r.text.match(/[^\n]*(wolf|nicolaudie|w1)[^\n]*/gi) || []).slice(0, 12).join('\n'); out.textContent = (r.saved ? t('usb.diagSaved', { f: r.saved }) + '\n\n' : '') + (wolf ? t('usb.diagWolf') + '\n' + wolf + '\n\n' : t('usb.diagNoWolf') + '\n\n') + r.text.slice(0, 6000); } catch (e) { out.textContent = t('usb.diagFail') + ' ' + e.message; } };
  btn.onclick = async () => {
    found.usb = null; found.serial = null; out.textContent = t('usb.scanning');
    try { await navigator.usb.requestDevice({ filters: [] }); } catch (_) {}
    try { if (navigator.serial) await navigator.serial.requestPort({ filters: [] }); } catch (_) {}
    setTimeout(render, 400);
  };
})();
// ---- kamera-kalibrering: Mac-kamera (eller iPhone via Continuity Camera) ser væggen, laseren viser mønsteret
// på et gitter af kendte sendte værdier, appen finder lyspletten i billedet og regner en homografi sendt→kamera.
// Brugeren markerer derefter det ønskede område i kamerabilledet → homografi app→sendt (cfg.camMap).
const camCal = { active: false, send: null, ch4: null, stream: null, dark: null, pts: [], state: 'idle', corners: null, drag: -1, frame: null };
const CAM_GRID = [[0, 0], [-0.5, 0], [0.5, 0], [0, 0.5], [0, -0.5], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]; // midten først, så ±0,5 (passer i et kamera der ikke kan zoome ud)
function solveLinear(A, b) { // Gauss med pivot, n×n
  const n = b.length; A = A.map((r) => r.slice()); b = b.slice();
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; if (Math.abs(A[i][i]) < 1e-12) return null; for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let j = i; j < n; j++) A[r][j] -= f * A[i][j]; b[r] -= f * b[i]; } }
  return b.map((v, i) => v / A[i][i]);
}
function hFit(pairs) { // mindste kvadraters homografi [x,y]→[u,v] (h33 = 1), pairs = [[x,y,u,v],…], ≥4
  if (pairs.length < 4) return null;
  // normalisér u,v for stabilitet
  let cu = 0, cv = 0; for (const p of pairs) { cu += p[2]; cv += p[3]; } cu /= pairs.length; cv /= pairs.length;
  let sc = 0; for (const p of pairs) sc += Math.hypot(p[2] - cu, p[3] - cv); sc = sc / pairs.length || 1;
  const A = Array.from({ length: 8 }, () => new Array(8).fill(0)), B = new Array(8).fill(0);
  for (const [x, y, U, V] of pairs) {
    const u = (U - cu) / sc, v = (V - cv) / sc;
    const rows = [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
    for (const r of rows) for (let i = 0; i < 8; i++) { B[i] += r[i] * r[8]; for (let j = 0; j < 8; j++) A[i][j] += r[i] * r[j]; }
  }
  const h = solveLinear(A, B); if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // de-normalisér: T⁻¹·Hn, T⁻¹ = [[sc,0,cu],[0,sc,cv],[0,0,1]]
  const H = [sc * Hn[0] + cu * Hn[6], sc * Hn[1] + cu * Hn[7], sc * Hn[2] + cu * Hn[8], sc * Hn[3] + cv * Hn[6], sc * Hn[4] + cv * Hn[7], sc * Hn[5] + cv * Hn[8], Hn[6], Hn[7], Hn[8]];
  let err = 0; for (const p of pairs) { const [u, v] = hApply(H, p[0], p[1]); err += Math.hypot(u - p[2], v - p[3]); }
  return { H, err: err / pairs.length };
}
function hApply(H, x, y) { const w = H[6] * x + H[7] * y + H[8] || 1e-9; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
function hInv(H) {
  const [a, b, c, d, e, f, g, h, i] = H; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
async function camOpen() {
  $('#camModal').hidden = false; camCal.state = 'idle'; camStatus(t('cam.intro'));
  try {
    if (window.laser.camAccess) { const ok = await window.laser.camAccess(); if (ok === false) { camStatus(t('cam.denied')); return; } }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#camSel'); sel.innerHTML = ''; { const o = document.createElement('option'); o.value = 'phone'; o.textContent = t('cam.phone'); sel.appendChild(o); } devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || t('cam.dev', { n: i + 1 }); sel.appendChild(o); });
    if (!cfg.camId && devs.length) sel.value = devs[0].deviceId;
    if (cfg.camId && devs.some((d) => d.deviceId === cfg.camId)) sel.value = cfg.camId;
    if (!devs.length) { camStatus(t('cam.none')); }
    await camStart();
    if (!$('#camStatus').textContent || $('#camStatus').textContent === t('cam.opening')) camStatus(t('cam.intro'));
  } catch (e) { camStatus(t('cam.noCam') + ' ' + (e.name || '') + ' ' + e.message + ' – ' + t('cam.hintPhone')); }
}
async function camStart() {
  if (camCal.stream) camCal.stream.getTracks().forEach((tr) => tr.stop());
  const id = $('#camSel').value; cfg.camId = id; saveCfg();
  if (id === 'phone') { camCal.stream = { phone: true, getTracks: () => [] }; $('#camVideo').srcObject = null; $('#camZoom').textContent = ''; camStatus(t('cam.phoneHint')); camDrawLoop(); return; }
  camStatus(t('cam.opening'));
  try { camCal.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
  catch (e) { // iPhone væk / gammelt id → prøv et hvilket som helst kamera
    camCal.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const tr = camCal.stream.getVideoTracks()[0]; const sid = tr.getSettings && tr.getSettings().deviceId; if (sid) { $('#camSel').value = sid; cfg.camId = sid; saveCfg(); }
    camStatus(t('cam.fallback', { e: e.name || e.message }));
  }
  const v = $('#camVideo'); v.srcObject = camCal.stream; await v.play();
  camCal.zoomInfo = '';
  try { const tr = camCal.stream.getVideoTracks()[0]; const caps = tr.getCapabilities ? tr.getCapabilities() : null; const set = tr.getSettings ? tr.getSettings() : {};
    if (caps && caps.zoom && typeof caps.zoom.min === 'number') { await tr.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }); camCal.zoomed = caps.zoom.min; camCal.zoomInfo = t('cam.zoomSet', { z: caps.zoom.min }); }
    else camCal.zoomInfo = t('cam.zoomNo');
    camCal.zoomInfo += ` · ${set.width || '?'}×${set.height || '?'}`;
  } catch (_) {}
  $('#camZoom').textContent = camCal.zoomInfo;
  // labels bliver først tilgængelige efter tilladelse – opdatér listen
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); const sel = $('#camSel'); [...sel.options].forEach((o) => { const d = devs.find((x) => x.deviceId === o.value); if (d && d.label) o.textContent = d.label; });
  camDrawLoop();
}
function camClose() { camCal.state = 'idle'; camConfirmDone(false); $('#camAuto').hidden = false; $('#camRun').hidden = false; $('#camSize').hidden = false; if (camCal.follow) { clearInterval(camCal.follow); camCal.follow = null; camCal.track = null; $('#camFollow').classList.remove('on'); $('#camFix').hidden = true; } if (camCal.stream) camCal.stream.getTracks().forEach((tr) => tr.stop()); camCal.stream = null; camCal.active = false; camCal.send = null; camCal.ch4 = null; camCal.state = 'idle'; $('#camModal').hidden = true; sendNow(); }
function camStatus(msg) { $('#camStatus').textContent = msg; }
const CAM_W = 320, CAM_H = 180;
const phoneCam = { frame: null, at: 0, n: 0 }; // billeder fra telefonen (mobil-siden → /camframe)
if (window.laser.onCamFrame) window.laser.onCamFrame((d) => { if (d && d.data && d.data.length >= CAM_W * CAM_H) { phoneCam.frame = d.data; phoneCam.at = Date.now(); phoneCam.n++; } });
const usingPhoneCam = () => $('#camSel') && $('#camSel').value === 'phone';
function camGrab() { // nedskaleret gråtone-lignende (max-kanal) billede
  if (usingPhoneCam()) { const out = new Float32Array(CAM_W * CAM_H); if (phoneCam.frame) for (let i = 0; i < out.length; i++) out[i] = phoneCam.frame[i]; return out; }
  const v = $('#camVideo'); const c = camCal.work || (camCal.work = document.createElement('canvas')); c.width = CAM_W; c.height = CAM_H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(v, 0, 0, CAM_W, CAM_H);
  const d = g.getImageData(0, 0, CAM_W, CAM_H).data, out = new Float32Array(CAM_W * CAM_H);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  return out;
}
function camComponent(img, dark) { // den sammenhængende lysplet omkring det kraftigste pixel (ikke rødt skær i resten af rummet)
  let mx = 0, mi = -1; const diff = new Float32Array(img.length); for (let i = 0; i < img.length; i++) { diff[i] = Math.max(0, img[i] - dark[i]); if (diff[i] > mx) { mx = diff[i]; mi = i; } }
  if (mx < 40 || mi < 0) return null;
  const th = Math.max(35, mx * 0.35), seen = new Uint8Array(img.length), q = [mi]; seen[mi] = 1;
  let sx = 0, sy = 0, sw = 0, n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, edge = false;
  while (q.length) {
    const i = q.pop(); const x = i % CAM_W, y = (i - x) / CAM_W, w = diff[i];
    sx += x * w; sy += y * w; sw += w; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (x === 0 || y === 0 || x === CAM_W - 1 || y === CAM_H - 1) edge = true;
    const nb = [i - 1, i + 1, i - CAM_W, i + CAM_W, i - CAM_W - 1, i - CAM_W + 1, i + CAM_W - 1, i + CAM_W + 1];
    for (const j of nb) { if (j < 0 || j >= img.length || seen[j]) continue; const jx = j % CAM_W; if (Math.abs(jx - x) > 1) continue; if (diff[j] >= th) { seen[j] = 1; q.push(j); } }
    if (n > 20000) break;
  }
  if (n < 3) return null;
  return { x: sx / sw, y: sy / sw, n, mx, w: x1 - x0 + 1, h: y1 - y0 + 1, ext: Math.max(x1 - x0 + 1, y1 - y0 + 1), edge };
}
const camBlob = (img, dark) => { const c = camComponent(img, dark); return c && !c.edge ? c : null; };
const camExtent = (img, dark) => { const c = camComponent(img, dark); return c && !c.edge ? c : null; };
const CAM_SIZE_STEPS = [0, 16, 32, 48, 64, 80, 96, 108];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function camWaitConfirm() { return new Promise((res) => { camCal.confirm = res; $('#camOk').hidden = false; $('#camSkip').hidden = false; }); }
function camConfirmDone(v) { const f = camCal.confirm; camCal.confirm = null; $('#camOk').hidden = true; $('#camSkip').hidden = true; if (f) f(v); }
async function camMeasure() {
  if (!camCal.stream) return;
  if (blackout) { camStatus(t('cam.needOn')); return; }
  if (special) setSpecial(special); if (autoMode !== 'off') setAuto('off');
  const pat = cfg.camPattern || 38; if (patAvail.has(cfg.dotPattern) && !cfg.camPatternUser) setPattern(cfg.dotPattern, true); else if (!patAvail.size || patAvail.has(pat)) setPattern(pat, true);
  if (!st.pattern) setPattern(cfg.testPattern || 5, true);
  camCal.active = true; camCal.pts = []; camCal.state = 'measuring'; camCal.size = st.size; camCal.cur = null; camCal.dropped = 0;
  $('#camRun').hidden = true;
  // mørkt referencebillede: laser slukket
  const was = blackout; blackout = true; sendNow(); camStatus(t('cam.dark')); await sleep(500);
  const d1 = camGrab(); await sleep(120); const d2 = camGrab(); camCal.dark = d1.map((v, i) => (v + d2[i]) / 2);
  blackout = was;
  // mindste mønster-størrelse (lille plet = præcist midtpunkt)
  camCal.send = [0, 0]; let best = null;
  for (const c4 of [127, 108, 80, 40, 0]) { if (camCal.state !== 'measuring') break; camCal.ch4 = c4; sendNow(); camStatus(t('cam.pre')); await sleep(600); const e = camExtent(camGrab(), camCal.dark); if (e && (!best || e.ext < best.ext)) best = { ch4: c4, ext: e.ext }; }
  camCal.gridCh4 = best ? best.ch4 : 127; camCal.smallExt = best ? best.ext : null;
  for (let i = 0; i < CAM_GRID.length; i++) {
    if (camCal.state !== 'measuring') break;
    camCal.ch4 = camCal.gridCh4; camCal.send = CAM_GRID[i]; sendNow(); await sleep(650);
    const b1 = camBlob(camGrab(), camCal.dark); await sleep(100); const b2 = camBlob(camGrab(), camCal.dark);
    const b = b1 && b2 ? { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 } : b1 || b2;
    // forslag: fundet plet – ellers forudsagt ud fra de punkter vi har (≥4), ellers midten af billedet
    let guess = b ? [b.x, b.y] : null;
    if (!guess && camCal.pts.length >= 4) { const f = hFit(camCal.pts); if (f) guess = hApply(f.H, CAM_GRID[i][0], CAM_GRID[i][1]); }
    if (!guess) guess = camCal.pts.length ? [camCal.pts[0][2], camCal.pts[0][3]] : [CAM_W / 2, CAM_H / 2];
    camCal.cur = { i, x: clamp(guess[0], 0, CAM_W), y: clamp(guess[1], 0, CAM_H), found: !!b };
    camStatus(t(b ? 'cam.confirm' : 'cam.confirmNone', { i: i + 1, n: CAM_GRID.length }));
    const ok = await camWaitConfirm();
    if (camCal.state !== 'measuring') break;
    if (ok) camCal.pts.push([CAM_GRID[i][0], CAM_GRID[i][1], camCal.cur.x, camCal.cur.y]); else camCal.dropped++;
    camCal.cur = null;
  }
  camCal.ch4 = null;
  // størrelses-trappe i midten (automatisk)
  camCal.sizes = [];
  if (camCal.state === 'measuring') {
    camCal.send = [0, 0];
    for (let k = 0; k < CAM_SIZE_STEPS.length; k++) {
      if (camCal.state !== 'measuring') break;
      camCal.ch4 = CAM_SIZE_STEPS[k]; sendNow(); camStatus(t('cam.sizeStep', { i: k + 1, n: CAM_SIZE_STEPS.length }));
      await sleep(650);
      const e1 = camExtent(camGrab(), camCal.dark); await sleep(100); const e2 = camExtent(camGrab(), camCal.dark);
      const e = e1 && e2 ? Math.min(e1.ext, e2.ext) : (e1 || e2 || {}).ext;
      if (e) camCal.sizes.push({ ch4: CAM_SIZE_STEPS[k], ext: e });
    }
    camCal.ch4 = null;
  }
  camCal.send = null; camCal.active = false; sendNow(); $('#camRun').hidden = false;
  if (camCal.state !== 'measuring') return;
  if (camCal.pts.length < 5) { camCal.state = 'idle'; camStatus(t('cam.tooFew', { n: camCal.pts.length, d: camCal.dropped })); return; }
  const fit = hFit(camCal.pts); if (!fit) { camCal.state = 'idle'; camStatus(t('cam.fitFail')); return; }
  camCal.H = fit.H; camCal.Hi = hInv(fit.H); camCal.err = fit.err;
  camCal.corners = [[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]].map(([x, y]) => hApply(fit.H, x, y));
  camCal.frame = camGrab(); camCal.state = 'corners'; camStatus(t('cam.corners', { n: camCal.pts.length, e: fit.err.toFixed(1), d: camCal.dropped }));
  $('#camSave').hidden = false;
}
// rest-korrektion: homografien fanger det store billede; de små, lokale afvigelser (ulinearitet i scannerne) lægges i et
// gitter over kamerabilledet: for hvert felt gennemsnittet af (faktisk sendt − Hcs(kamera)) for målingerne i feltet.
const RES_N = 8;
function resBuild(pts, Hcs) {
  const sum = Array.from({ length: RES_N * RES_N }, () => [0, 0, 0]);
  for (const [sx, sy, u, v] of pts) { const [ex, ey] = hApply(Hcs, u, v); const ix = clamp(Math.floor(u / CAM_W * RES_N), 0, RES_N - 1), iy = clamp(Math.floor(v / CAM_H * RES_N), 0, RES_N - 1); const c = sum[iy * RES_N + ix]; c[0] += sx - ex; c[1] += sy - ey; c[2]++; }
  return { n: RES_N, cells: sum.map((c) => (c[2] >= 2 ? [c[0] / c[2], c[1] / c[2]] : null)) };
}
function resLookup(res, u, v) { // bilineær mellem felt-midtpunkter; tomme felter = 0
  if (!res) return [0, 0]; const n = res.n, gx = clamp(u / CAM_W * n - 0.5, 0, n - 1), gy = clamp(v / CAM_H * n - 0.5, 0, n - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), tx = gx - x0, ty = gy - y0;
  const g = (x, y) => res.cells[y * n + x] || [0, 0];
  const a = g(x0, y0), b = g(x1, y0), c = g(x0, y1), d = g(x1, y1);
  return [a[0] * (1 - tx) * (1 - ty) + b[0] * tx * (1 - ty) + c[0] * (1 - tx) * ty + d[0] * tx * ty, a[1] * (1 - tx) * (1 - ty) + b[1] * tx * (1 - ty) + c[1] * (1 - tx) * ty + d[1] * tx * ty];
}
function camPatHalfSent(size) { // mønsterets halve udstrækning i sendte enheder (fra størrelses-kurven + kameraets skala)
  const m = cfg.camMap, sm_ = cfg.sizeMap; if (!m || !m.Hcs || m.manual || !sm_ || sm_.length < 3) return null;
  // LIVE-størrelsen følger FADEREN direkte: 0 % = mindste målte figur, 100 % = største målte – så LIVE og fader er altid enige
  const r = sizeRange(sm_); if (!r) return null;
  const extPx = r.minExt + clamp(size, 0, 1) * (r.maxExt - r.minExt);
  const [u, v] = m.Hac ? hApply(m.Hac, 0, 0) : [CAM_W / 2, CAM_H / 2]; const [s0x, s0y] = hApply(m.Hcs, u, v), [s1x, s1y] = hApply(m.Hcs, u + 1, v), [s2x, s2y] = hApply(m.Hcs, u, v + 1);
  const scale = (Math.hypot(s1x - s0x, s1y - s0y) + Math.hypot(s2x - s0x, s2y - s0y)) / 2; // sendte enheder pr. kamera-pixel
  // kurven blev målt med ét bestemt mønster – skalér til det aktuelle mønsters egen udstrækning i filen
  const pe = patExtent(st.pattern), rel = cfg.sizeMapExt ? Math.max(0.05, Math.max(pe.x, pe.y)) / cfg.sizeMapExt : 1;
  return clamp(extPx / 2 * scale * rel, 0, 0.6); // højst 0,6 så midten altid kan komme mindst 40 % ud – hellere lidt klip i hjørnet end en låst figur
}
function camAppToSend(ax, ay, size) { // app (-1..1, y op) → sendt: via kamerabilledet + rest-korrektion
  const m = cfg.camMap; if (!m || !m.Hac) return hApply(m.H, ax, ay);
  const [u, v] = hApply(m.Hac, ax, ay); const [sx, sy] = hApply(m.Hcs, u, v); const [rx, ry] = resLookup(m.res, u, v);
  let out_ = [sx + rx, sy + ry];
  // laseren flytter mønsteret forskelligt alt efter størrelse (målt): omsætning målt ved lille OG stor figur → interpolér
  if (m.big && m.big.Hcs && size != null) {
    const r = sizeRange(cfg.sizeMap); if (r && m.big.ext > m.smallExt + 1) {
      const extCur = r.minExt + clamp(size, 0, 1) * (r.maxExt - r.minExt); const tt = clamp((extCur - m.smallExt) / (m.big.ext - m.smallExt), 0, 1.3);
      const [bx, by] = hApply(m.big.Hcs, u, v); out_ = [out_[0] + (bx - out_[0]) * tt, out_[1] + (by - out_[1]) * tt];
    }
  }
  return out_;
}
function camLearn(pts, sample) { // gem en ny observation (erstatter en gammel tæt på) – max 400
  const out = pts.filter((p) => Math.hypot(p[0] - sample[0], p[1] - sample[1]) > 0.012); out.push(sample); return out.length > 900 ? out.slice(out.length - 900) : out;
}
function camBuildMap(pts, corners, sizes, meta) { // sendt→kamera-punkter + valgte hjørner (kamera) → app→sendt homografi
  const rf = hFit(pts); if (!rf) return null; const Hsc = rf.H, Hcs = hInv(Hsc); if (!Hcs) return null;
  const sent = corners.map(([u, v]) => hApply(Hcs, u, v));
  const sq = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
  const fit = hFit(sq.map((p, i) => [p[0], p[1], sent[i][0], sent[i][1]])); if (!fit) return null;
  const Hi = hInv(fit.H); if (!Hi) return null;
  const c = corners, wTop = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), wBot = Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1]), hL = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]), hR = Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1]);
  const Hac = hFit(sq.map((p, i) => [p[0], p[1], corners[i][0], corners[i][1]])); // app-firkant → kamera (eksakt 4-punkt)
  const map = { H: fit.H, Hi, Hsc, Hcs, Hac: Hac ? Hac.H : null, res: resBuild(pts, Hcs), pts: pts.map((p) => p.slice()), corners: corners.map((p) => p.slice()), aspect: clamp(((wTop + wBot) / 2) / Math.max(1, (hL + hR) / 2), 0.3, 4), err: rf.err, at: Date.now(), ...(meta || {}) };
  cfg.camMap = map;
  cfg.calPts = { TL: { x: sent[0][0], y: sent[0][1] }, TR: { x: sent[1][0], y: sent[1][1] }, BR: { x: sent[2][0], y: sent[2][1] }, BL: { x: sent[3][0], y: sent[3][1] } };
  if (sizes && sizes.length >= 3) { cfg.sizeMap = sizes; const pe = patExtent(meta && meta.pattern || st.pattern); cfg.sizeMapExt = Math.max(0.05, Math.max(pe.x, pe.y)); cfg.sizeMapPattern = meta && meta.pattern || st.pattern; }
  cfg.cal.ix = false; cfg.cal.iy = false; calApply(); cfg.calibDone = true; cfg.posMap = null; centerLive(); saveCfg(); if (typeof syncCalUI === 'function') syncCalUI();
  return map;
}
// ---- helt automatisk: appen flytter selv mønsteret rundt, kameraet finder det, og omsætningen udvides trin for trin
// til hele det område kameraet kan se. Til sidst kontrol-punkter: passer kamera og forventning? Ellers rettes der til.
async function camAuto() {
  if (!camCal.stream) return;
  if (blackout) { camStatus(t('cam.needOn')); return; }
  if (special) setSpecial(special); if (autoMode !== 'off') setAuto('off');
  // det valgte mønster bruges (ikke et særligt) – det er jo det der skal passe bagefter
  if (!st.pattern) { const pat = cfg.camPattern || 38; if (!patAvail.size || patAvail.has(pat)) setPattern(pat, true); }
  camCal.active = true; camCal.pts = []; camCal.state = 'measuring'; camCal.size = st.size; camCal.cur = null; camCal.dropped = 0; camCal.auto = true; camCal.pattern = st.pattern;
  $('#camRun').hidden = true; $('#camAuto').hidden = true;
  const was = blackout; blackout = true; sendNow(); camStatus(t('cam.dark')); await sleep(500);
  const d1 = camGrab(); await sleep(120); const d2 = camGrab(); camCal.dark = d1.map((v, i) => (v + d2[i]) / 2); blackout = was;
  // 0) størrelses-gennemløb i midten, trin for trin (0→127), mens kameraet filmer: hvornår kan mønsteret ses,
  //    hvor stort er det ved hver værdi, og hvilken værdi giver den mindste figur der stadig kan ses?
  camCal.send = [0, 0]; camCal.sizes = []; let best = null;
  for (let c4 = 0; c4 <= 127 && camCal.state === 'measuring'; c4 += 4) {
    camCal.ch4 = Math.min(127, c4); sendNow(); await sleep(c4 === 0 ? 600 : 330);
    const e1 = camExtent(camGrab(), camCal.dark); await sleep(80); const e2 = camExtent(camGrab(), camCal.dark);
    const e = e1 && e2 && Math.abs(e1.ext - e2.ext) <= Math.max(3, e1.ext * 0.25) ? Math.min(e1.ext, e2.ext) : null;
    camCal.sizes.push({ ch4: camCal.ch4, ext: e, n: e1 ? e1.n : 0 });
    if (e && e >= 3 && (!best || e < best.ext)) best = { ch4: camCal.ch4, ext: e };
    camStatus(t('cam.sizeScan', { v: camCal.ch4, e: e ? e + ' px' : '–', ok: camCal.sizes.filter((x) => x.ext).length }));
  }
  camCal.gridCh4 = best ? best.ch4 : 64;
  camCal.sizeVisible = camCal.sizes.filter((x) => x.ext); // kun de værdier hvor mønsteret faktisk var synligt
  const look = async (sx, sy, ch4) => { // vis mønsteret ved (sx,sy) og find det i kameraet (to billeder, begge skal være enige)
    camCal.ch4 = ch4 != null ? ch4 : camCal.gridCh4; camCal.send = [sx, sy]; sendNow(); await sleep(600);
    const b1 = camBlob(camGrab(), camCal.dark); await sleep(90); const b2 = camBlob(camGrab(), camCal.dark);
    if (!b1 || !b2 || Math.hypot(b1.x - b2.x, b1.y - b2.y) > 6) return null; return [(b1.x + b2.x) / 2, (b1.y + b2.y) / 2];
  };
  const tol = Math.hypot(CAM_W, CAM_H) * 0.12; let fit = null;
  const tryPoint = async (sx, sy) => {
    if (camCal.state !== 'measuring') return false;
    const b = await look(sx, sy); if (!b) { camCal.dropped++; return false; }
    if (fit) { const [u, v] = hApply(fit.H, sx, sy); if (Math.hypot(u - b[0], v - b[1]) > tol) { camCal.dropped++; return false; } } // passer ikke med resten → fejlfund
    camCal.pts.push([sx, sy, b[0], b[1]]); if (camCal.pts.length >= 5) { const f = hFit(camCal.pts); if (f) { fit = f; camCal.H = f.H; } }
    camStatus(t('cam.autoStep', { n: camCal.pts.length, d: camCal.dropped, r: Math.round(ring * 100) })); return true;
  };
  // 1) kerne ±0,5 → 2) udvid i ringe til ±1,0 så længe kameraet kan se punkterne
  let ring = 0.5;
  for (const [x, y] of CAM_GRID) await tryPoint(x, y);
  for (ring of [0.75, 1.0]) {
    if (camCal.state !== 'measuring') break; let hits = 0;
    for (const [x, y] of [[-ring, ring], [0, ring], [ring, ring], [ring, 0], [ring, -ring], [0, -ring], [-ring, -ring], [-ring, 0]]) if (await tryPoint(x, y)) hits++;
    if (!hits) break;
  }
  // 2b) løbende optagelse: mønsteret kører i små trin (2 %) i baner over hele området mens kameraet filmer –
  //     hvert billede giver et målepunkt, så de små lokale afvigelser også bliver lært
  if (camCal.state === 'measuring' && fit) {
    const R = Math.max(0.5, ...camCal.pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
    const rows = 7, step = 0.02; let got = 0, miss = 0;
    for (let r = 0; r < rows && camCal.state === 'measuring'; r++) {
      const sy = -R + (2 * R * r) / (rows - 1); const dir = r % 2 ? -1 : 1;
      for (let sx = -R * dir; dir > 0 ? sx <= R : sx >= -R; sx += step * dir) {
        if (camCal.state !== 'measuring') break;
        camCal.ch4 = camCal.gridCh4; camCal.send = [sx, sy]; sendNow(); await sleep(110);
        const b = camBlob(camGrab(), camCal.dark); if (!b) { miss++; continue; }
        const [u, v] = hApply(fit.H, sx, sy); if (Math.hypot(u - b.x, v - b.y) > tol) { miss++; continue; }
        camCal.pts = camLearn(camCal.pts, [sx, sy, b.x, b.y]); got++;
        if (got % 10 === 0) { const f = hFit(camCal.pts); if (f) { fit = f; camCal.H = f.H; } camStatus(t('cam.sweep', { n: camCal.pts.length, r: r + 1, rows })); }
      }
    }
  }
  // 3) kontrol: tilfældige punkter inden for det målte – stor afvigelse → lær af den og regn om (op til 3 runder)
  if (camCal.state === 'measuring' && fit) {
    const R = Math.max(0.5, ...camCal.pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
    for (let round = 0; round < 3 && camCal.state === 'measuring'; round++) {
      let errSum = 0, n = 0, added = 0;
      for (let k = 0; k < 5; k++) {
        const sx = (Math.random() * 2 - 1) * R * 0.9, sy = (Math.random() * 2 - 1) * R * 0.9;
        const b = await look(sx, sy); if (!b) continue; const [u, v] = hApply(fit.H, sx, sy); const e = Math.hypot(u - b[0], v - b[1]); errSum += e; n++;
        if (e > 2 && e < tol) { camCal.pts = camLearn(camCal.pts, [sx, sy, b[0], b[1]]); added++; }
        camStatus(t('cam.verify', { r: round + 1, e: n ? (errSum / n).toFixed(1) : '–' }));
      }
      if (added) { const f = hFit(camCal.pts); if (f) { fit = f; camCal.H = f.H; } }
      if (n && errSum / n < 2.5) break;
    }
  }
  // 2c) stor figur: laseren flytter ikke nødvendigvis en stor figur som en lille – mål 9 punkter igen ved stor størrelse
  camCal.big = null;
  if (camCal.state === 'measuring' && fit && camCal.sizeVisible && camCal.sizeVisible.length >= 3) {
    const r = sizeRange(camCal.sizeVisible); if (r) {
      const target = r.maxExt; // den største brugbare figur (lige før klipning) – så hele fader-området er dækket
      const pts = camCal.sizeVisible.filter((p) => p.ch4 >= r.lo && p.ch4 <= r.hi).sort((a, b) => Math.abs(a.ext - target) - Math.abs(b.ext - target));
      const bigCh4 = pts.length ? pts[0].ch4 : null; const bigExt = pts.length ? pts[0].ext : null; const bigPts = [];
      if (bigCh4 != null) {
        for (const [x, y] of CAM_GRID) { if (camCal.state !== 'measuring') break; const b = await look(x, y, bigCh4); if (b) bigPts.push([x, y, b[0], b[1]]); camStatus(t('cam.bigStep', { n: bigPts.length })); }
        const f2 = bigPts.length >= 5 ? hFit(bigPts) : null; if (f2) camCal.big = { ch4: bigCh4, ext: bigExt, Hsc: f2.H, Hcs: hInv(f2.H), pts: bigPts, err: f2.err };
      }
      camCal.ch4 = camCal.gridCh4; camCal.smallExt = (camCal.sizeVisible.find((p) => p.ch4 === camCal.gridCh4) || {}).ext;
    }
  }
  // 3b) sikkerhedszone: zone-stregen vises ved forskellige %, kameraet finder stregen → hvor sidder kanten reelt?
  if (camCal.state === 'measuring' && fit) {
    const zoneWas = cfg.zone, specialWas = special; const zm = []; camCal.send = null; camCal.ch4 = null; camCal.active = false; // specialFrame styrer selv
    special = 'zone';
    for (let z = 0.05; z <= 0.96 && camCal.state === 'measuring'; z += 0.1) {
      cfg.zone = Math.round(z * 100) / 100; sendNow(); await sleep(550);
      const c1 = camComponent(camGrab(), camCal.dark); await sleep(80); const c2 = camComponent(camGrab(), camCal.dark);
      if (!c1 || !c2) continue; const u = (c1.x + c2.x) / 2, v = (c1.y + c2.y) / 2;
      const [sx, sy] = hApply(hInv(fit.H), u, v); zm.push({ z: cfg.zone, sent: [sx, sy], cam: [u, v] });
      camStatus(t('cam.zoneScan', { z: Math.round(cfg.zone * 100), n: zm.length }));
    }
    special = specialWas; cfg.zone = zoneWas; camCal.active = true; camCal.zoneRaw = zm;
  }
  // 4) størrelses-kurven er allerede målt i trin 0 – brug kun de synlige trin
  camCal.sizes = camCal.sizeVisible || [];
  camCal.ch4 = null; camCal.send = null; camCal.active = false; sendNow(); $('#camRun').hidden = false; $('#camAuto').hidden = false;
  if (camCal.state !== 'measuring') return;
  if (!fit || camCal.pts.length < 6) { camCal.state = 'idle'; camStatus(t('cam.tooFew', { n: camCal.pts.length, d: camCal.dropped })); return; }
  camCal.H = fit.H; camCal.Hi = hInv(fit.H); camCal.err = fit.err;
  // 5) område = hele det målte (største |sendt| der blev set) – gemmes med det samme; hjørnerne kan stadig trækkes
  // LIVE-feltet = laserens FULDE rækkevidde (sendt ±1), også uden for kamerabilledet – ikke kun det kameraet nåede at se.
  // Ellers bliver LIVE for lille, og mønsteret kan ikke komme helt ud til højre/toppen selv om laseren kan.
  const R = 1.0;
  camCal.corners = [[-R, R], [R, R], [R, -R], [-R, -R]].map(([x, y]) => hApply(fit.H, x, y));
  camCal.state = 'corners'; $('#camSave').hidden = false;
  const map = camBuildMap(camCal.pts, camCal.corners, camCal.sizes, { size: camCal.size, pattern: camCal.pattern, smallCh4: camCal.gridCh4, smallExt: camCal.smallExt || null, big: camCal.big || null });
  if (map && camCal.zoneRaw && camCal.zoneRaw.length >= 2) {
    // kanten i app-koordinater (y op) → andel fra bunden af LIVE-feltet; kun monotont stigende målinger beholdes
    const side = cfg.zoneSide || 'bottom'; const arr = [];
    for (const m of camCal.zoneRaw) { const [ax, ay] = hApply(map.Hi, m.sent[0], m.sent[1]); const f = side === 'bottom' ? (ay + 1) / 2 : side === 'top' ? (1 - ay) / 2 : side === 'left' ? (ax + 1) / 2 : (1 - ax) / 2; arr.push({ z: m.z, f: clamp(f, 0, 1) }); }
    arr.sort((a, b) => a.z - b.z); const mono = []; for (const q of arr) if (!mono.length || q.f > mono[mono.length - 1].f) mono.push(q);
    cfg.zoneMap = mono.length >= 2 ? mono : null; saveCfg();
  }
  camStatus(map ? t('cam.autoDone', { n: map.pts.length, e: map.err.toFixed(1), r: 100 }) : t('cam.fitFail'));
}
// ---- størrelses-test: laseren kører selv faderen igennem, kameraet måler, og retningen rettes automatisk ----
async function camSizeTest() {
  if (!camCal.stream) return; if (blackout) { camStatus(t('cam.needOn')); return; }
  if (special) setSpecial(special); if (autoMode !== 'off') setAuto('off'); if (!st.pattern) { camStatus(t('pat.noData')); return; }
  camCal.state = 'sizing'; $('#camRun').hidden = true; $('#camAuto').hidden = true; $('#camSize').hidden = true;
  const was = blackout; blackout = true; sendNow(); camStatus(t('cam.dark')); await sleep(500);
  const d1 = camGrab(); await sleep(120); const d2 = camGrab(); camCal.dark = d1.map((v, i) => (v + d2[i]) / 2); blackout = was;
  const posWas = [st.posX, st.posY], sizeWas = st.size; st.posX = 0; st.posY = 0; sm.x = 0; sm.y = 0; // midten – hele figuren i billedet
  const measure = async () => { sendNow(); await sleep(600); const e1 = camExtent(camGrab(), camCal.dark); await sleep(80); const e2 = camExtent(camGrab(), camCal.dark); return e1 && e2 && Math.abs(e1.ext - e2.ext) <= Math.max(3, e1.ext * 0.25) ? Math.min(e1.ext, e2.ext) : null; };
  // A) rå kurve: laser-værdi 0→127 – hvornår kan mønsteret ses, og hvor stort er det
  camCal.active = true; camCal.send = [0, 0]; const sizes = [];
  for (let c4 = 0; c4 <= 127 && camCal.state === 'sizing'; c4 += 4) { camCal.ch4 = Math.min(127, c4); const e = await measure(); sizes.push({ ch4: camCal.ch4, ext: e }); camStatus(t('cam.sizeScan', { v: camCal.ch4, e: e ? e + ' px' : '–', ok: sizes.filter((x) => x.ext).length })); }
  camCal.ch4 = null; camCal.send = null; camCal.active = false;
  const vis = sizes.filter((x) => x.ext);
  if (camCal.state !== 'sizing') { st.posX = posWas[0]; st.posY = posWas[1]; st.size = sizeWas; return; }
  if (vis.length >= 3) { cfg.sizeMap = vis; const pe = patExtent(st.pattern); cfg.sizeMapExt = Math.max(0.05, Math.max(pe.x, pe.y)); cfg.sizeMapPattern = st.pattern; }
  // B) gennem faderen: 0 → 100 % – bliver figuren større? Ellers vendes faderen, og der måles igen
  const viaFader = async () => { const out_ = []; for (const pct of [0, 0.25, 0.5, 0.75, 1]) { if (camCal.state !== 'sizing') break; st.size = pct; sm.size = pct; const e = await measure(); out_.push({ pct, ext: e }); camStatus(t('cam.faderScan', { p: Math.round(pct * 100), e: e ? e + ' px' : '–' })); } return out_; };
  let run = await viaFader(); const ok = (r) => r.filter((x) => x.ext);
  const trend = (r) => { const v = ok(r); return v.length >= 2 ? v[v.length - 1].ext - v[0].ext : 0; };
  let flipped = false;
  if (trend(run) < 0) { cfg.sizeFlip = !cfg.sizeFlip; saveCfg(); flipped = true; run = await viaFader(); }
  st.posX = posWas[0]; st.posY = posWas[1]; st.size = sizeWas; sm.size = sizeWas; saveCfg(); sendNow(); if (typeof syncLookUI === 'function') syncLookUI();
  $('#camRun').hidden = false; $('#camAuto').hidden = false; $('#camSize').hidden = false; camCal.state = 'idle';
  const v = ok(run); const txt = v.map((x) => `${Math.round(x.pct * 100)} % → ${x.ext} px`).join(' · ');
  camStatus(t(trend(run) > 0 ? 'cam.sizeDone' : 'cam.sizeBad', { n: vis.length, f: flipped ? t('cam.sizeFlipped') : '', r: txt }));
  const inp = $('#sizeFlip'); if (inp) inp.checked = !!cfg.sizeFlip;
}
function camSave() {
  if (camCal.state !== 'corners') return;
  const map = camBuildMap(camCal.pts, camCal.corners, camCal.sizes, { size: camCal.size });
  if (!map) { camStatus(t('cam.fitFail')); return; }
  toast(t('cam.saved', { n: map.pts.length, e: map.err.toFixed(1) })); camClose();
}
// ---- følg med kameraet: se om mønsteret lander hvor appen tror, og tilret omsætningen med ét klik ----
async function camFollowToggle() {
  if (camCal.follow) { clearInterval(camCal.follow); camCal.follow = null; camCal.track = null; $('#camFollow').classList.remove('on'); $('#camFix').hidden = true; camStatus(t('cam.intro')); return; }
  if (!camCal.stream || !cfg.camMap || !cfg.camMap.Hsc) { camStatus(t('cam.needMap')); return; }
  if (blackout) { camStatus(t('cam.needOn')); return; }
  const was = blackout; blackout = true; sendNow(); camStatus(t('cam.dark')); await sleep(450);
  const d1 = camGrab(); await sleep(120); const d2 = camGrab(); camCal.dark = d1.map((v, i) => (v + d2[i]) / 2); blackout = was; sendNow();
  $('#camFollow').classList.add('on'); $('#camFix').hidden = false;
  camCal.follow = setInterval(() => {
    if (!cfg.camMap || !out.on || !st.pattern) { camCal.track = null; return; }
    const b = camBlob(camGrab(), camCal.dark); const exp = hApply(cfg.camMap.Hsc, out.sendX, out.sendY);
    camCal.track = { found: b ? [b.x, b.y] : null, exp, send: [out.sendX, out.sendY] };
    const dev = b ? Math.hypot(b.x - exp[0], b.y - exp[1]) : null;
    // lærer selv: står mønsteret stille (samme sendte værdi to gange i træk) og kameraet ser det et lidt andet sted → gem det
    if (b && dev > 2 && dev < Math.hypot(CAM_W, CAM_H) * 0.12 && camCal.lastSend && Math.hypot(camCal.lastSend[0] - out.sendX, camCal.lastSend[1] - out.sendY) < 0.002 && Date.now() - (camCal.lastLearn || 0) > 1000) {
      camCal.lastLearn = Date.now(); camCal.pending = camLearn(camCal.pending || cfg.camMap.pts, [out.sendX, out.sendY, b.x, b.y]); camCal.pendN = (camCal.pendN || 0) + 1;
      if (camCal.pendN >= 3) { camBuildMap(camCal.pending, cfg.camMap.corners, cfg.sizeMap, { size: cfg.camMap.size }); camCal.pending = null; camCal.pendN = 0; camCal.learned = (camCal.learned || 0) + 3; }
    }
    camCal.lastSend = [out.sendX, out.sendY];
    camStatus(b ? t('cam.followDev', { d: dev.toFixed(0), l: camCal.learned || 0 }) : t('cam.followNone'));
  }, 300);
}
function camFix() { // tilføj den aktuelle observation og regn omsætningen om
  const tr = camCal.track; if (!tr || !tr.found || !cfg.camMap) return;
  const pts = camLearn(camCal.pending || cfg.camMap.pts, [tr.send[0], tr.send[1], tr.found[0], tr.found[1]]); camCal.pending = null; camCal.pendN = 0;
  const map = camBuildMap(pts, cfg.camMap.corners, cfg.sizeMap, { size: cfg.camMap.size }); if (map) toast(t('cam.fixed', { n: map.pts.length, e: map.err.toFixed(1) }));
}
function camDrawLoop() {
  const cv = $('#camCanvas'); if (!cv || $('#camModal').hidden) return;
  const v = $('#camVideo'); const W = cv.clientWidth, H = cv.clientHeight; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
  if (usingPhoneCam()) {
    if (phoneCam.frame) { const im = camCal.imgC || (camCal.imgC = document.createElement('canvas')); im.width = CAM_W; im.height = CAM_H; const ig = im.getContext('2d'); const id = ig.createImageData(CAM_W, CAM_H); for (let i = 0; i < CAM_W * CAM_H; i++) { const p = phoneCam.frame[i]; id.data[i * 4] = p; id.data[i * 4 + 1] = p; id.data[i * 4 + 2] = p; id.data[i * 4 + 3] = 255; } ig.putImageData(id, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(im, 0, 0, W, H); }
    const fresh = Date.now() - phoneCam.at < 1500; g.fillStyle = fresh ? 'rgba(49,243,172,.9)' : 'rgba(255,59,92,.9)'; g.font = '600 11px -apple-system'; g.textAlign = 'left'; g.fillText(fresh ? t('cam.phoneLive', { n: phoneCam.n }) : t('cam.phoneNo'), 10, 16);
  } else if (v.videoWidth) g.drawImage(v, 0, 0, W, H);
  const fx = W / CAM_W, fy = H / CAM_H;
  // målte pletter
  for (const p of camCal.pts) { g.fillStyle = 'rgba(49,243,172,.9)'; g.beginPath(); g.arc(p[2] * fx, p[3] * fy, camCal.state === 'corners' ? 6 : 4, 0, Math.PI * 2); g.fill(); if (camCal.state === 'corners') { g.fillStyle = '#031'; g.font = '700 8px -apple-system'; g.textAlign = 'center'; g.fillText(String(CAM_GRID.findIndex((q) => q[0] === p[0] && q[1] === p[1]) + 1), p[2] * fx, p[3] * fy + 3); } }
  if (camCal.state === 'corners' && camCal.H) { // hvor omsætningen forventer hvert målepunkt
    g.save(); g.strokeStyle = 'rgba(49,243,172,.4)'; g.lineWidth = 1; for (const q of CAM_GRID) { const [u, v] = hApply(camCal.H, q[0], q[1]); g.beginPath(); g.arc(u * fx, v * fy, 10, 0, Math.PI * 2); g.stroke(); } g.restore();
  }
  if (camCal.track) { const tr = camCal.track; g.save(); g.lineWidth = 2; g.strokeStyle = '#ff3b5c'; g.beginPath(); g.arc(tr.exp[0] * fx, tr.exp[1] * fy, 14, 0, Math.PI * 2); g.stroke(); if (tr.found) { g.fillStyle = '#31f3ac'; g.beginPath(); g.arc(tr.found[0] * fx, tr.found[1] * fy, 6, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(tr.exp[0] * fx, tr.exp[1] * fy); g.lineTo(tr.found[0] * fx, tr.found[1] * fy); g.stroke(); } g.restore(); }
  if (camCal.cur) { const c = camCal.cur; g.save(); g.strokeStyle = c.found ? '#31f3ac' : '#ffaa3c'; g.lineWidth = 3; g.setLineDash([]); g.lineWidth = 2; g.beginPath(); g.arc(c.x * fx, c.y * fy, 7, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(c.x * fx - 14, c.y * fy); g.lineTo(c.x * fx - 9, c.y * fy); g.moveTo(c.x * fx + 9, c.y * fy); g.lineTo(c.x * fx + 14, c.y * fy); g.moveTo(c.x * fx, c.y * fy - 14); g.lineTo(c.x * fx, c.y * fy - 9); g.moveTo(c.x * fx, c.y * fy + 9); g.lineTo(c.x * fx, c.y * fy + 14); g.stroke(); g.fillStyle = g.strokeStyle; g.font = '600 11px -apple-system'; g.textAlign = 'center'; g.fillText(t('cam.dragHere'), c.x * fx, c.y * fy - 18); g.restore(); }
  if (camCal.state === 'corners' && camCal.corners) {
    g.save(); g.strokeStyle = '#ff3b5c'; g.lineWidth = 2; g.beginPath(); camCal.corners.forEach(([x, y], i) => (i ? g.lineTo(x * fx, y * fy) : g.moveTo(x * fx, y * fy))); g.closePath(); g.stroke();
    camCal.corners.forEach(([x, y], i) => { g.fillStyle = '#ff3b5c'; g.beginPath(); g.arc(x * fx, y * fy, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = '700 10px -apple-system'; g.textAlign = 'center'; g.fillText(['↖', '↗', '↘', '↙'][i], x * fx, y * fy + 4); });
    g.restore();
  }
  requestAnimationFrame(camDrawLoop);
}
(() => {
  const cv = $('#camCanvas'); if (!cv) return;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * CAM_W, (e.clientY - r.top) / r.height * CAM_H]; };
  const nearest = (arr, x, y, getXY) => { let best = -1, bd = 1e9; arr.forEach((c, i) => { const [cx, cy] = getXY(c); const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = i; } }); return [best, bd]; };
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (camCal.state !== 'corners') return; const [x, y] = pos(e); const [pi, pd] = nearest(camCal.pts, x, y, (p) => [p[2], p[3]]); if (pi >= 0 && pd < 12) { camCal.pts.splice(pi, 1); camStatus(t('cam.ptRemoved', { n: camCal.pts.length })); } });
  cv.addEventListener('pointerdown', (e) => {
    if (camCal.cur && e.button !== 2) { const [x, y] = pos(e); camCal.cur.x = clamp(x, 0, CAM_W); camCal.cur.y = clamp(y, 0, CAM_H); camCal.drag = 200; cv.setPointerCapture(e.pointerId); return; }
    if (camCal.state !== 'corners' || e.button === 2) return; const [x, y] = pos(e);
    const [ci, cd] = nearest(camCal.corners, x, y, (c) => c); const [pi, pd] = nearest(camCal.pts, x, y, (p) => [p[2], p[3]]);
    if (pi >= 0 && pd < 10 && pd <= cd) { camCal.drag = 100 + pi; cv.setPointerCapture(e.pointerId); }
    else if (cd < 30) { camCal.drag = ci; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => { if (camCal.drag < 0) return; const [x, y] = pos(e); const P = [clamp(x, 0, CAM_W), clamp(y, 0, CAM_H)]; if (camCal.drag === 200) { if (camCal.cur) { camCal.cur.x = P[0]; camCal.cur.y = P[1]; } } else if (camCal.drag >= 100) { const p = camCal.pts[camCal.drag - 100]; if (p) { p[2] = P[0]; p[3] = P[1]; const rf = hFit(camCal.pts); if (rf) { camCal.H = rf.H; camCal.err = rf.err; } } } else camCal.corners[camCal.drag] = [x, y]; });
  const up = () => { camCal.drag = -1; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  $('#camOpen').onclick = camOpen; $('#camClose').onclick = camClose; $('#camRun').onclick = camMeasure; $('#camSave').onclick = camSave;
  $('#camPat').value = cfg.camPattern || 38; $('#camPat').onchange = () => { cfg.camPattern = clamp(+$('#camPat').value || 38, 1, 255); cfg.camPatternUser = true; saveCfg(); };
  $('#camOk').onclick = () => camConfirmDone(true); $('#camSkip').onclick = () => camConfirmDone(false);
  $('#camFollow').onclick = () => camFollowToggle().catch((e) => camStatus(e.message)); $('#camFix').onclick = camFix;
  $('#camAuto').onclick = () => camAuto().catch((e) => camStatus(e.message));
  $('#camSize').onclick = () => camSizeTest().catch((e) => camStatus(e.message));
  $('#camSel').onchange = () => camStart().catch((e) => camStatus(t('cam.noCam') + ' ' + (e.name || '') + ' ' + e.message));
  $('#camRefresh').onclick = () => camOpen();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { if (!$('#camModal').hidden && camCal.state === 'idle') camOpen(); });
  $('#camReset').onclick = () => { cfg.camMap = null; cfg.sizeMap = null; cfg.zoneMap = null; saveCfg(); toast(t('cam.cleared')); camClose(); };
})();
// ---- måling af placering: laseren viser mønsteret på 9 kendte rå værdier, brugeren trykker hvor det ramte ----
const MEASURE_GRID = [[0, 0], [-0.7, 0], [0.7, 0], [0, 0.7], [0, -0.7], [-0.7, 0.7], [0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
let measure = null; // { i, obs: [[sentX, sentY, obsX, obsY], …], size }
// ---- Rå/Lær: brugeren styrer de rå værdier der sendes (X, Y, størrelse, zone) og fortæller appen hvor de rammer ----
const raw = { on: false, x: 0, y: 0, size: 64, zone: null, ch: {}, pts: (store.get('rawPts', []) || []) };
function posMapFor(size) { // nærmeste målte omsætning (evt. interpoleret mellem to størrelser)
  const maps = cfg.posMap || []; if (maps.length === 1) return maps[0];
  const srt = [...maps].sort((a, b) => a.size - b.size);
  if (size <= srt[0].size) return srt[0]; if (size >= srt[srt.length - 1].size) return srt[srt.length - 1];
  for (let i = 1; i < srt.length; i++) if (size <= srt[i].size) { const a = srt[i - 1], b = srt[i], t = (size - a.size) / Math.max(1e-6, b.size - a.size); return { size, M: a.M.map((v, k) => v + (b.M[k] - v) * t), c: a.c.map((v, k) => v + (b.c[k] - v) * t) }; }
  return srt[0];
}
// mindste kvadraters affin tilpasning: obs = M·sent + c  (M = [a b; c d])
function fitPosMap(obs) {
  const n = obs.length; if (n < 3) return null;
  const solve = (col) => { // løs [sx sy 1]·[p q r]ᵀ = obs_col
    let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
    for (const o of obs) { const v = [o[0], o[1], 1]; for (let i = 0; i < 3; i++) { B[i] += v[i] * o[col]; for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j]; } }
    for (let i = 0; i < 3; i++) { let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]]; if (Math.abs(A[i][i]) < 1e-9) return null; for (let r = 0; r < 3; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let j = 0; j < 3; j++) A[r][j] -= f * A[i][j]; B[r] -= f * B[i]; } }
    return [B[0] / A[0][0], B[1] / A[1][1], B[2] / A[2][2]];
  };
  const X = solve(2), Y = solve(3); if (!X || !Y) return null;
  const M = [X[0], X[1], Y[0], Y[1]], c = [X[2], Y[2]];
  let err = 0; for (const o of obs) { const px = M[0] * o[0] + M[1] * o[1] + c[0], py = M[2] * o[0] + M[3] * o[1] + c[1]; err += Math.hypot(px - o[2], py - o[3]); }
  return { M, c, err: err / n };
}
function measureStart() {
  if (special) setSpecial(special); if (autoMode !== 'off') setAuto('off');
  if (!st.pattern) setPattern(cfg.testPattern || 5, true);
  measure = { i: 0, obs: [], size: st.size }; moveMode = false; $('#pvMove').classList.remove('on'); $('#pvSizeBar').classList.remove('show');
  $('#pvMeasure').classList.add('on'); $('#pvMeasurePanel').hidden = false; measureUI(); sendNow();
}
function measureStop(save) {
  if (save && measure && measure.obs.length >= 4) {
    const fit = fitPosMap(measure.obs);
    if (fit) { const maps = (cfg.posMap || []).filter((m) => Math.abs(m.size - measure.size) > 0.1); maps.push({ size: measure.size, M: fit.M, c: fit.c, err: fit.err, at: Date.now() }); cfg.posMap = maps; saveCfg(); toast(t('pv.msDone', { e: Math.round(fit.err * 100) })); }
    else toast(t('pv.msFail'));
  }
  measure = null; $('#pvMeasure').classList.remove('on'); $('#pvMeasurePanel').hidden = true; sendNow();
}
function measureRecord(appX, appY) { // app-koordinater (-1..1) → rå via den almindelige kalibrering = hvor laseren faktisk ramte
  if (!measure) return;
  const g = MEASURE_GRID[measure.i];
  measure.obs.push([g[0], g[1], calAxis(appX, 'x'), calAxis(appY * YF(), 'y')]);
  measureNext();
}
function measureNext() { if (!measure) return; measure.i++; if (measure.i >= MEASURE_GRID.length) { measureStop(true); return; } measureUI(); sendNow(); }
function measureUI() {
  if (!measure) return;
  $('#msStep').textContent = t('pv.msStep', { i: measure.i + 1, n: MEASURE_GRID.length });
  $('#msInfo').textContent = t('pv.msInfo');
}

function specialGeom() {
  if (special === 'line') return { vertical: false, off: 0, rgb: [255, 255, 255] };
  if (special === 'cal' || special === 'center') { const p = special === 'cal' ? calPt() : { x: 0, y: 0 }; const vertical = maxEdge() % 2 === 1; return { rgb: special === 'cal' ? [255, 0, 0] : [255, 255, 255], raw: true, vertical, x: p.x, y: p.y, len: 1, dot: patAvail.has(cfg.dotPattern) ? cfg.dotPattern : 0 }; }
  if (special === 'calbox') {
    // hele firkanten på én gang: det præcise firkant-mønster (#252, gemt fra kalibreringen) hvis det findes,
    // ellers det generelle firkant-mønster (#251) skaleret ind i området – og ellers kant for kant
    if (patAvail.has(cfg.quadPattern) && cfg.quadSaved) return { rgb: [255, 0, 0], raw: true, quad: cfg.quadPattern, x: 0, y: 0, size: 1 };
    if (patAvail.has(cfg.boxPattern)) { const c = calBounds(); return { rgb: [255, 0, 0], raw: true, quad: cfg.boxPattern, x: (c.L + c.R) / 2, y: (c.T + c.B) / 2, size: clamp(Math.min(c.R - c.L, c.T - c.B) / 2, 0.05, 1) }; }
    return Object.assign({ rgb: [255, 0, 0], raw: true }, calGeomFor([1, 2, 4, 3][maxEdge()]));
  }
  if (special === 'max') { const e = [[false, 0.97], [false, -0.97], [true, -0.97], [true, 0.97]][maxEdge()]; return { vertical: e[0], off: e[1], offLaser: e[0] ? e[1] : e[1] * YF(), rgb: [255, 0, 0] }; }
  const z = zoneEff(), side = cfg.zoneSide || 'bottom';
  const edge = (s) => (s === 'bottom' || s === 'left' ? -1 + 2 * z + 0.03 : 1 - 2 * z - 0.03);
  const vertical = side === 'left' || side === 'right';
  return { vertical, off: edge(side), offLaser: vertical ? edge(side) : edge(side) * YF(), rgb: [255, 0, 0] };
}
function s16(off) { const v = Math.round(clamp(off, -1, 1) * 32767) & 0xffff; return [v >> 8, v & 255]; }
// position (16 bit): standard = 0 venstre/top … 32768 midt … 65535 højre/bund. 'Signeret' = 0 midt (ældre firmware).
const rawToApp = (rx, ry) => [(rx - cfg.cal.ox) / cfg.cal.sx, (ry - cfg.cal.oy) / cfg.cal.sy];  // rå laser → app
function calAxis(v, axis) { const c = cfg.cal; const inv = axis === 'x' ? c.ix : c.iy, sc = axis === 'x' ? c.sx : c.sy, off = axis === 'x' ? c.ox : c.oy; return clamp((inv ? -v : v) * sc + off, -1, 1); }
function pos16(ch, v, raw = false) {
  const axis = ch === 7 || ch === 4 ? 'x' : 'y';
  if (!raw) v = calAxis(v, axis);
  const fmt = (limShow && limShow.fmt) || cfg.posFmt;
  if (fmt === 'h2') { const p = ShowNET.posEncode(v, 'h2'); setCh(ch, p >> 8); setCh(ch + 1, p & 255); return; }
  if (fmt === 's') {
    // målt på DS-3000: fortegn + størrelse. Grov byte: bit 7 = retning (1 = op/højre), bit 0–6 = udslag 0–127. Fin byte = finjustering.
    v = clamp(v, -1, 1); const mag = Math.abs(v) * 127, coarse = Math.floor(mag), fine = Math.round((mag - coarse) * 255);
    setCh(ch, (v >= 0 ? 128 : 0) | coarse); setCh(ch + 1, fine);
  } else if (fmt === 't') {
    // 16-bit two's complement: 0 = midt, 0x7FFF = max, 0x8000 = min (prøves hvis mønsteret 'flipper' når det krydser midten)
    const val = Math.round(clamp(v, -1, 1) * 32767) & 0xffff; setCh(ch, val >> 8); setCh(ch + 1, val & 255);
  } else put16(ch, 0.5 + clamp(v, -1, 1) / 2);
}
// størrelse (DJ kanal 4, 0–127): 0 = størst. Kan vendes og begrænses under Indstillinger hvis laseren opfører sig anderledes.
// animations-fart: 0.5 = 50 fps; under 0.5 går kurven kvadratisk ned, så langsom animation kan finjusteres (0.1 ≈ 2 fps)
function fpsFrac(f) { return clamp(f, 0.02, 1); } // lineært: 0 % = næsten frosset, 50 % = 50 fps, 100 % = 100 fps
// brugbart størrelses-område ud fra kamera-kurven: fra mindste synlige til dér hvor figuren holder op med at vokse
// (plateau = scannerne kan ikke mere → kanten klemmes/forvrænges, som på væggen). Returnerer laser-værdier lo..hi + mål.
function sizeRange(sm_) {
  const pts = (sm_ || []).filter((p) => p.ext).sort((a, b) => a.ch4 - b.ch4); if (pts.length < 3) return null;
  const mx = Math.max(...pts.map((p) => p.ext)); const bigAtLow = pts[0].ext > pts[pts.length - 1].ext; // hvilken ende er stor?
  const walk = bigAtLow ? [...pts].reverse() : pts; // gå fra den lille ende mod den store
  let stop = walk[walk.length - 1]; for (const p of walk) { if (p.ext >= mx * 0.96) { stop = p; break; } }
  const small = walk[0];
  return { lo: Math.min(small.ch4, stop.ch4), hi: Math.max(small.ch4, stop.ch4), minExt: small.ext, maxExt: stop.ext, bigAtLow };
}
function sizeCh4(size) {
  if (camCal.active && camCal.ch4 != null) return camCal.ch4;
  if (raw.on) return clamp(Math.round(raw.size), 0, 127);
  if (limShow && limShow.ch4 != null) return limShow.ch4;
  if (cfg.lim && (cfg.lim.on || cfg.lim.sizeOn) && cfg.lim.small != null && cfg.lim.big != null) return Math.round(clamp(cfg.lim.small + clamp(size, 0, 1) * (cfg.lim.big - cfg.lim.small), 0, 127));
  // målt med kameraet: faderen går lineært gennem de laser-værdier hvor mønsteret var synligt (15 % = den ene ende,
  // 100 % = den anden). Retningen tages fra målingen (vokser figuren med værdien?) – og kan vendes med 'Vend størrelses-faderen'.
  const sm_ = cfg.sizeMap; if (sm_ && sm_.filter((p) => p.ext).length >= 3) {
    const r = sizeRange(sm_); if (!r) return 64;
    // 0 % = mindste synlige, 100 % = største UDEN forvrængning. 'Vend størrelses-faderen' bytter om.
    // DS-3000 (set på væggen 19/10): LAV værdi = STORT mønster. 0 % skal være lille → høj værdi; 100 % → lav værdi.
    // Ingen automatik – kun én kontakt ('Vend størrelses-faderen') hvis en anden laser gør det modsat.
    let f = clamp(size, 0, 1); if (!cfg.sizeFlip) f = 1 - f;
    return Math.round(r.lo + f * (r.hi - r.lo));
  }
  { let f = clamp(size, 0, 1); if (cfg.sizeFlip) f = 1 - f; return Math.round(clamp(118 - f * 100, 0, 127)); } } // uden kamera-kurve: 0 % → 118 (lille), 100 % → 18 (stort); lav værdi = stort på DS-3000 // aldrig helt lukket – så mønsteret ikke forsvinder (målt 18/10: på DS-3000 er høj værdi = stort)
// 'max'-visning: laseren tegner én kant ad gangen (top, bund, venstre, højre) – 450 ms pr. kant, så scanneren når at flytte sig
const maxEdge = () => Math.floor(performance.now() / 450) % 4;
function specialFrame(on) {
  const g = specialGeom();
  const inten = on ? Math.max(master, 0.4) * cfg.maxInt * 255 : 0;
  const pat = clamp((special !== 'line' ? cfg.linePattern : cfg.testPattern) | 0, 1, 255);
  if (cfg.dmxMode === 'pro') {
    setCh(1, inten); setCh(2, on ? pat : 0); setCh(3, 128);
    const ol = g.offLaser ?? 0; put16(4, g.vertical ? 0.5 + ol / 2 : 0.5); put16(6, g.vertical ? 0.5 : 0.5 + ol / 2); put16(8, 0.5);
    setCh(10, g.vertical ? 255 : 0); setCh(11, g.vertical ? 0 : 255);
    setCh(13, 248); setCh(14, g.rgb[0]); setCh(15, g.rgb[1]); setCh(16, g.rgb[2]);
    setCh(19, 0); setCh(20, 0);
    setCh(21, 0); setCh(22, 0); setCh(23, 0); // farvebalance 0 = fuld
    for (let c = 26; c <= 29; c++) setCh(c, 128);
  } else {
    setCh(1, inten); setCh(2, on ? pat : 0); setCh(3, 0);
    // Laseren skalerer positionen med størrelsen: et fladtrykt mønster kan derfor ikke flyttes.
    // Zone/max bruger derfor streg-mønsteret i fuld størrelse og drejer det 90° til lodrette kanter.
    if (special === 'line') { setCh(6, 96); setCh(4, 255); pos16(7, 0); pos16(9, 0); }
    else if (g.dot) { // punkt: punkt-mønsteret i fuld størrelse flyttes hen på stedet
      setCh(2, on ? g.dot : 0); setCh(6, 96); setCh(4, 0); pos16(7, g.x, true); pos16(9, g.y, true);
    }
    else if (g.quad) { // hel firkant på én gang
      setCh(2, on ? g.quad : 0); setCh(6, 96); setCh(4, sizeCh4(g.size)); pos16(7, g.x / g.size, true); pos16(9, g.y / g.size, true);
    }
    else if (g.raw) {
      // kalibreringsstreg: rå laser-koordinater. Laseren drejer FØR den skalerer, så længden sættes med den akse
      // stregen ligger langs (vandret = X-størrelse 128–191, lodret = Y-størrelse 192–255), og positionen langs
      // samme akse skaleres tilsvarende op – den anden akse har fuld rækkevidde.
      const len = clamp(g.len, 0.05, 1);
      setCh(6, g.vertical ? 144 : 96); setCh(4, (g.vertical ? 192 : 128) + Math.round((1 - len) * 63));
      pos16(7, g.vertical ? g.x : g.x / len, true); pos16(9, g.vertical ? g.y / len : g.y, true);
    }
    else {
      // tynd streg: kun Y-størrelsen mindskes (192–255). Laseren skalerer positionen med – så vi sender tilsvarende længere ud.
      // tynd streg: aksen på tværs af stregen mindskes (vandret streg = Y, lodret = X); positionen på tværs skaleres op igen
      const thin = clamp(cfg.lineThin || 0, 0, 0.5), comp = 1 / (1 - thin);
      setCh(6, g.vertical ? 144 : 96); setCh(4, thin > 0 ? (g.vertical ? 128 : 192) + Math.round(thin * 126) : 0);
      pos16(7, g.vertical ? g.offLaser * comp : 0); pos16(9, g.vertical ? 0 : g.offLaser * comp);
    }
    setCh(11, special === 'line' || special === 'center' ? 8 : 16); // ensfarvet rød / original
    setCh(15, [0, 80, 150, 220][cfg.scan] || 0);
    setCh(16, special !== 'line' ? 0 : zoneVal()); setCh(17, special !== 'line' ? 0 : cfg.zone > 0 ? 255 : 0);
  }
}
function setSpecial(v) {
  special = special === v ? null : v;
  if (special) { if (autoMode !== 'off') setAuto('off'); }
  $('#pvZoneLine').classList.toggle('on', special === 'zone');
  $('#pvMax').classList.toggle('on', special === 'max');
  if (typeof syncCalUI === 'function' && $('#calBox')) syncCalUI();
  $('#testBtn').textContent = t(special === 'line' ? 'set.testStop' : 'set.test');
}

// DJ-tilstand (19 kanaler) – laserens standard
function djFrame(on, size, ang, mode, rgb, bright = 1, strobe = st.strobe) {
  const show = on && st.pattern > 0 && (cfg.calibDone || camCal.active); // intet mønster = helt slukket (nogle kort har en 000.ild); ingen mønstre før området er kalibreret
  let [oX, oY] = posOut(out.sendX, out.sendY); // Retnings-test: rettet fortolkning af X/Y-signalet (vendt/byttet)
  const qf = quadrantFix(st.pattern, oX, oY);
  setCh(1, show ? master * cfg.maxInt * bright * 255 : 0);
  setCh(2, show ? qf.pat : 0);
  // 3: 0–15 = 50 fps standard, 16–255 = 0…100 fps (16 ≈ 0 fps = frosset billede)
  setCh(3, st.freeze ? 16 : 16 + fpsFrac(st.fps) * 239); // 16–255 = 0–100 fps; kurven giver fin kontrol i den langsomme ende
  // 4: størrelse 0–127 (0 = størst)
  setCh(4, sizeCh4(size));
  setCh(5, 0);
  // 6: rotation – 0–192 manuel vinkel (-180…+180°, 96 = 0°), 193–224 auto mod uret, 225–255 auto med uret
  const flip180 = (patFlip.has(st.pattern) ? 180 : 0) + (qf.rot != null ? qf.rot : qf.rot180 ? 180 : 0);
  const rs = cfg.rotDir ? -st.rotSpeed : st.rotSpeed; if (cfg.rotDir) ang = -ang;
  if (rs > 0.02 && !flip180) setCh(6, 225 + rs * 30);
  else if (rs < -0.02 && !flip180) setCh(6, 193 + -rs * 31);
  else { let a = (ang + flip180) % 360; if (a > 180) a -= 360; if (a < -180) a += 360; setCh(6, (((a + 180) / 360 * 192 + ((cfg.rotZero ?? 96) - 96)) % 193 + 193) % 193); }
  // 7–10 position: appen styrer selv bevægelsen (rigtig cirkel, ottetal …) + hvor mønsteret peger hen
  // laseren lægger positionen til FØR den skalerer størrelsen → kompensér, så 'Flyt' passer med LIVE
  if (cfg.patCenterFix !== false && !con.pos && !raw.on && !measure && !camCal.active && !special) { // mønstrets midte (ikke dets 0,0) skal stå på positionen
    const sl = mirrorSlots[st.pattern] || {}; let c = patCenter(st.pattern); c = { x: qf.pat === sl.x || qf.pat === sl.xy ? -c.x : c.x, y: qf.pat === sl.y || qf.pat === sl.xy ? -c.y : c.y };
    const [rx, ry] = rotV(c.x, c.y, (Math.abs(rs) > 0.02 ? 0 : ang) + flip180), k = patHalfSent(out.size); oX = clamp(oX - rx * k, -1, 1); oY = clamp(oY - ry * k, -1, 1); out.patOff = [rx * k, ry * k];
  } else out.patOff = [0, 0];
  const psc = cfg.posScaled ? 1 / Math.max(size, 0.08) : 1;
  { const P = prof(); pos16(7, oX * P.signX / P.posGainX * psc, true); pos16(9, oY * P.signY / P.posGainY * psc, true); }
  // 11: farve – 0–15 original, 16–79 ensfarvet, 144–255 automatisk farveskift
  if (st.colorCycle) setCh(11, 144 + st.colorCycleSpeed * 111);
  else if (mode === 'orig') setCh(11, 8);
  else {
    const sw = SWATCHES.find((w) => w.rgb && w.rgb.join() === rgb.join());
    const hue = sw ? (sw.white ? 1 : sw.hue) : rgbHue(rgb);
    setCh(11, 16 + Math.min(1, hue / 0.95) * 63);
  }
  setCh(12, 0);
  setCh(13, strobe > 0 ? 16 + strobe * 239 : 0);
  // 14: driftstilstand – 0 = DMX, 20–83 auto X+Y, 84–147 auto X, 148–211 auto Y (aldrig demo/lyd)
  setCh(14, autoMode === 'laser' ? 245 : 0); // 245 = laserens egen sound-to-light, ellers ren DMX-styring
  setCh(15, [0, 80, 150, 220][cfg.scan] || 0);
  setCh(16, zoneVal());
  setCh(17, (raw.on && raw.zone != null) || (limShow && limShow.zone != null) || cfg.zone > 0 ? 255 : 0);
  setCh(18, 0); setCh(19, 0);
}
function rgbHue([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 1;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h / 6) + 1) % 1;
}

function computeFrame(now) {
  if (calib.on && calib.frame) { const a = cfg.address - 1; dmx.fill(0, a, a + 34); for (let i = 0; i < calib.frame.length; i++) dmx[a + i] = calib.frame[i]; return; } // kalibrering: præcis disse kanaler
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const hz = 0.05 + st.moveSpeed * st.moveSpeed * 1.6;
  movePhase += dt * hz * Math.PI * 2;
  rotAcc = (rotAcc + dt * st.rotSpeed * 360) % 360;
  huePhase = (huePhase + dt * (0.02 + st.colorCycleSpeed * 0.5)) % 1;
  pulseEnv *= Math.exp(-dt * 7);
  dropEnv *= Math.exp(-dt * 2.5); hatKick *= Math.exp(-dt * 18);
  // musik-reaktion (kun når Computer-mik er valgt): bas → puls, diskant → små ryk, pause → roligt
  const live = autoMode === 'mic' && micStream;
  const bassP = live ? music.bass : 0, hatP = live ? music.hi : 0;
  const calm = live && music.breakdown ? 0.55 : 1;
  if (live) rotAcc += hatKick * 6 * (st.rotSpeed >= 0 ? 1 : -1);

  // mønsteret holdes inden for laserens område: jo større mønster, jo mindre kan det flyttes
  // glat overgang når brugeren trækker/skubber (ellers hopper laseren)
  const k = Math.min(1, dt * 14);
  sm.x += (st.posX - sm.x) * k; sm.y += (st.posY - sm.y) * k; sm.size += (st.size - sm.size) * k;
  if (Math.abs(sm.x - st.posX) < 0.002) sm.x = st.posX; if (Math.abs(sm.y - st.posY) < 0.002) sm.y = st.posY; if (Math.abs(sm.size - st.size) < 0.002) sm.size = st.size;
  // position
  const a = st.moveAmt * 0.5;
  let x = 0.5, y = 0.5;
  switch (st.move) {
    case 'circle': x += a * Math.cos(movePhase); y += a * Math.sin(movePhase); break;
    case 'eight': x += a * Math.sin(movePhase); y += a * 0.5 * Math.sin(movePhase * 2); break;
    case 'sweep': x += a * Math.sin(movePhase); break;
    case 'bounce': y += a * (Math.abs(Math.sin(movePhase)) * 2 - 1); break;
  }
  // rotation: 0° = 32768, ±180° over hele 16-bit området
  let ang = (st.rotAngle + rotAcc) % 360; if (ang > 180) ang -= 360; if (ang < -180) ang += 360;
  const rot = 0.5 + ang / 360;
  // størrelse (kanal: 0 = størst)
  const pulseAmt = Math.max(st.pulse * pulseEnv, bassP * 0.55) * 0.6;
  // størrelse i app-enheder (1 = fylder det kalibrerede område) → laserens egen skala
  const calScale = clamp(Math.min(cfg.cal.sx, cfg.cal.sy), 0.05, 1);
  const sizeApp = clamp(sm.size * calm * (1 - pulseAmt) * (1 + dropEnv * 0.25), 0, 1);
  const size = clamp(sizeApp * calScale, 0.02, 1);
  const sizeVal = (1 - size) * 255;
  // farve
  let mode = st.color.mode, rgb = st.color.rgb;
  if (st.colorCycle) { mode = 'rgb'; rgb = hsv(huePhase, 1, 1); }
  if (live && mode === 'rgb' && hatP > 0.5) rgb = rgb.map((v) => Math.min(255, v + (255 - v) * (hatP - 0.5) * 0.9)); // diskant → hvidt flimmer
  const liveStrobe = live && dropEnv > 0.6 ? 0.35 : 0;
  const bright = live ? clamp(0.55 + 0.45 * Math.max(music.energy, bassP), 0.3, 1) : 1;

  const on = !blackout;
  // skærm-koordinater (0..1) inkl. hvor brugeren har flyttet mønsteret hen; laser-koordinater (-1..1, Y vendt)
  x = clamp(x + sm.x / 2, 0, 1); y = clamp(y + sm.y / 2, 0, 1);
  const lx = (x - 0.5) * 2, ly = (y - 0.5) * 2 * YF();
  // rå laser-position (efter kalibrering). Laseren skalerer positionen med størrelsen, og kan højst flytte midten
  // 'size' ud – og mønsteret må ikke stikke ud over scannernes rækkevidde (så bliver det klemt/forvredet).
  // Rækkevidde: laseren ganger positionen med størrelsen (midten kan højst flyttes 'size' ud), og mønsterets
  // faktiske indhold (ext) må ikke stikke ud over ±1. Pr. akse, så brede/flade mønstre ikke begrænses unødigt.
  const ext = patExtent(st.pattern, ang);
  // (målt 18/10: laseren skalerer IKKE positionen med størrelsen – midten kan stå overalt, så længe mønsteret holder sig inden for ±1)
  let limX = Math.max(0, cfg.posScaled ? Math.min(size, 1 - size * ext.x) : 1 - size * ext.x), limY = Math.max(0, cfg.posScaled ? Math.min(size, 1 - size * ext.y) : 1 - size * ext.y);
  // med kamera-kalibrering kender vi mønsterets FAKTISKE halvbredde (målt i kameraet ved den aktuelle størrelses-værdi)
  const half = camPatHalfSent(size); if (half != null) { limX = Math.max(0, 1 - half); limY = Math.max(0, 1 - half); }
  if (cfg.lim && cfg.lim.on) { limX = 1; limY = 1; }
  let wantX = calAxis(lx, 'x'), wantY = calAxis(ly, 'y');
  if (measure) { const g = MEASURE_GRID[measure.i]; wantX = g[0]; wantY = g[1]; } // måling: fast rå værdi, ingen omregning
  if (camCal.active && camCal.send) { wantX = camCal.send[0]; wantY = camCal.send[1]; } // kamera-måling: fast sendt værdi
  if (raw.on) { wantX = raw.x / 100; wantY = raw.y / 100; } // rå styring: præcis det brugeren har sat
  let rawX = clamp(wantX, -limX, limX), rawY = clamp(wantY, -limY, limY);
  let clamped = Math.abs(wantX - rawX) > 0.003 || Math.abs(wantY - rawY) > 0.003;
  let [axc, ayc] = rawToApp(rawX, rawY); // tilbage til app-koordinater, så LIVE viser hvor mønsteret faktisk ender
  // målt omsætning (Mål placering): det laseren skal have sendt for at ramme det ønskede sted
  let sendX = rawX, sendY = rawY;
  const limOn = !measure && !camCal.active && !raw.on && cfg.lim && cfg.lim.on;
  if (limOn) { // LIVE = hele laserens rækkevidde; mønstret kan stå overalt hvor laseren kan sende det hen
    const L = cfg.lim, ax_ = clamp(lx, -1, 1), ay_ = clamp(ly / YF(), -1, 1);
    // laseren folder mønstret tilbage når mønstrets kant rammer scannerens yderste: midten må højst stå 1 − k·størrelse ude (målt)
    const F = cfg.dmxMode === 'pro' ? {} : cfg.fold || {}, fs = clamp(sizeApp, 0.05, 1), cX = cfg.ctrX || 0, cY = cfg.ctrY || 0;
    const lo = (k) => -1 + (F[k] ?? F.all ?? 0) * fs, hi = (k) => 1 - (F[k] ?? F.all ?? 0) * fs;
    const [sx, sy] = appToSent(ax_, ay_), cx = clamp(sx, Math.max(L.left, lo('left') - cX), Math.min(L.right, hi('right') - cX)), cy = clamp(sy, Math.max(L.bottom, lo('bottom') - cY), Math.min(L.top, hi('top') - cY));
    clamped = Math.abs(cx - sx) > 1e-4 || Math.abs(cy - sy) > 1e-4; sendX = cx; sendY = cy; rawX = cx; rawY = cy;
    [axc, ayc] = sentToApp(cx + (cfg.ctrX || 0), cy + (cfg.ctrY || 0));
  } else if (!measure && !camCal.active && !raw.on && cfg.camMap) {
    // kamera-kalibrering: app-koordinater → det laseren skal have sendt (homografi målt med kameraet)
    const [sx, sy] = camAppToSend(lx, ly / YF(), sizeApp);
    sendX = clamp(sx, -limX, limX); sendY = clamp(sy, -limY, limY);
    clamped = Math.abs(sx - sendX) > 0.003 || Math.abs(sy - sendY) > 0.003;
    const [bx, by] = hApply(cfg.camMap.Hi, sendX, sendY); axc = bx; ayc = by; rawX = sendX; rawY = sendY;
  } else if (!measure && !camCal.active && !raw.on && cfg.posMap) { const m = posMapFor(size); const d = m.M[0] * m.M[3] - m.M[1] * m.M[2]; if (Math.abs(d) > 1e-6) { const ox = rawX - m.c[0], oy = rawY - m.c[1]; sendX = clamp((m.M[3] * ox - m.M[1] * oy) / d, -1, 1); sendY = clamp((-m.M[2] * ox + m.M[0] * oy) / d, -1, 1); } }
  if (limShow && limShow.pos) { sendX = limShow.pos[0]; sendY = limShow.pos[1]; }
  // laserens midte IRL: kun det der sendes flyttes (LIVE uændret)
  if (!measure && !camCal.active && !raw.on && (cfg.ctrX || cfg.ctrY)) { sendX = clamp(sendX + (cfg.ctrX || 0), -1, 1); sendY = clamp(sendY + (cfg.ctrY || 0), -1, 1); }
  if (con.pos && !measure && !camCal.active) { // kommando-konsol: præcis denne sendte position
    sendX = clamp(con.pos[0], -1, 1); sendY = clamp(con.pos[1], -1, 1);
    if (cfg.lim && cfg.lim.on) [axc, ayc] = sentToApp(sendX, sendY);
  }
  x = clamp(axc / 2 + 0.5, -1, 2); y = clamp(ayc / 2 + 0.5, -1, 2);
  out = { x, y, lx, ly, rawX, rawY, sendX, sendY, ang, size: sizeApp, laserSize: size, calScale, reach: { x: limX, y: limY }, clamped, rgb: mode === 'orig' ? null : rgb, on, intensity: master * cfg.maxInt * bright, flip: patFlip.has(st.pattern) };
  dmx.fill(0, cfg.address - 1, cfg.address - 1 + 34);
  if (special) { specialFrame(on); rawOverrides(); return; }
  if (cfg.dmxMode !== 'pro') { djFrame(on, size, ang, mode, rgb, bright, Math.max(st.strobe, liveStrobe)); rawOverrides(); conOverrides(); return; }
  proFrame(on, ang, mode, rgb, bright, Math.max(st.strobe, liveStrobe)); rawOverrides(); conOverrides();
}
function orientPro(oX, oY) { // Pro Mode har en inversionskanal – spejling kræver ingen kopier på SD-kortet
  const o = cfg.orient; if (!o || !o.on) return { rot: 0, invX: false, invY: false };
  const key = (oX >= -0.002 ? 'p' : 'n') + (oY >= -0.002 ? 'p' : 'n'); let rot = 0, mx = 0, my = 0;
  [o.all, (o.q || {})[key], (o.pat || {})[st.pattern]].forEach((k) => { const v = OR_OPTS[k || 'n'] || OR_OPTS.n; rot += v[0]; mx ^= v[1]; my ^= v[2]; });
  return { rot, invX: !!mx, invY: !!my };
}
function zoneEff() { return cfg.dmxMode === 'pro' ? clamp(cfg.zone || 0, 0, 1) * (cfg.zoneTop ?? 0.97) : cfg.zone || 0; } // 100 % = det højeste punkt laseren kan ramme (målt 97 %)
function proFrame(on, ang, mode, rgb, bright, strobe) { // Professional Mode: tilstand → ShowNET.encode → DMX (én sandhedskilde)
  const P = profFor('pro'), show = on && st.pattern > 0 && (cfg.calibDone || camCal.active);
  let [oX, oY] = posOut(out.sendX, out.sendY); const o = orientPro(oX, oY);
  const lim = ShowNET.sizeLimits(P, 'pro'), frac = lim.min + clamp(out.size, 0, 1) * (lim.max - lim.min);
  const rotDeg = ang + (patFlip.has(st.pattern) ? 180 : 0) + o.rot, invX = o.invX !== !!cfg.invX, invY = o.invY !== !!cfg.invY;
  let rcx = 0, rcy = 0;
  if (cfg.patCenterFix !== false && !con.pos && !raw.on && !measure && !camCal.active) { const c = patCenter(st.pattern); [rcx, rcy] = rotV(c.x * frac, c.y * frac, rotDeg); }
  const x = (invX ? -oX : oX) - rcx, y = (invY ? -oY : oY) - rcy; out.patOff = [rcx, rcy]; // inversion spejler også positionen (firmwarens rækkefølge)
  const f = ShowNET.encode({ on: show, intensity: master * cfg.maxInt * bright, pattern: st.pattern, fps: fpsFrac(st.fps) * 100, freeze: st.freeze, x, y, sizeX: frac, sizeY: frac, rotDeg, invX, invY,
    color: mode === 'orig' ? { mode: 'orig' } : { mode: 'rgb', rgb }, strobe, zone: zoneEff(), zoneSide: cfg.zoneSide }, P, 'pro');
  const a0 = cfg.address - 1; for (let i = 0; i < f.length; i++) dmx[a0 + i] = f[i];
}

let sendTimer;
function sendNow() { const now = performance.now(); computeFrame(now); captureFrame(); window.laser.sendDmx(cfg.universe, cfg.ip, dmx); }
function startSending() {
  clearInterval(sendTimer);
  sendTimer = setInterval(() => {
    const now = performance.now();
    tickBeatClock(now);
    computeFrame(now); captureFrame(); // samme ur: animation → DMX-frame → LIVE
    window.laser.sendDmx(cfg.universe, cfg.ip, dmx);
  }, 1000 / clamp(cfg.rate, 10, 44));
}

// forbindelses-status
let lastSent = 0;
setInterval(async () => {
  const s = await window.laser.stats();
  const rate = s.sent - lastSent; lastSent = s.sent;
  $('#connTxt').textContent = s.errors && s.lastError && rate === 0 ? t('top.err') : t('top.pps', { n: rate });
  $('#connLed').className = 'led ' + (rate > 0 ? 'ok' : 'bad');
  $('#conn').title = s.lastError ? t('top.lastErr', { e: s.lastError }) : t('top.connTip', { ip: cfg.ip });
}, 1000);

// ---------- ILDA: læs og tegn laserens .ild-filer ----------
const PAGE = 48;
const ILDA_PAL = [[255,0,0],[255,16,0],[255,32,0],[255,48,0],[255,64,0],[255,80,0],[255,96,0],[255,112,0],[255,128,0],[255,144,0],[255,160,0],[255,176,0],[255,192,0],[255,208,0],[255,224,0],[255,240,0],[255,255,0],[224,255,0],[192,255,0],[160,255,0],[128,255,0],[96,255,0],[64,255,0],[32,255,0],[0,255,0],[0,255,36],[0,255,73],[0,255,109],[0,255,146],[0,255,182],[0,255,219],[0,255,255],[0,227,255],[0,198,255],[0,170,255],[0,142,255],[0,113,255],[0,85,255],[0,56,255],[0,28,255],[0,0,255],[32,0,255],[64,0,255],[96,0,255],[128,0,255],[160,0,255],[192,0,255],[224,0,255],[255,0,255],[255,32,255],[255,64,255],[255,96,255],[255,128,255],[255,160,255],[255,192,255],[255,224,255],[255,255,255],[255,224,224],[255,192,192],[255,160,160],[255,128,128],[255,96,96],[255,64,64],[255,32,32]];
function parseIlda(buf) {
  const dv = new DataView(buf), L = buf.byteLength, frames = [];
  let o = 0, pal = ILDA_PAL;
  while (o + 32 <= L) {
    if (dv.getUint32(o) !== 0x494c4441) break; // "ILDA"
    const fmt = dv.getUint8(o + 7), n = dv.getUint16(o + 24); o += 32;
    if (n === 0) break;
    if (fmt === 2) { const p = []; for (let i = 0; i < n && o + 3 <= L; i++, o += 3) p.push([dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2)]); pal = p; continue; }
    const sz = { 0: 8, 1: 6, 4: 10, 5: 8 }[fmt]; if (!sz || o + n * sz > L) break;
    const xy = new Float32Array(n * 2), col = new Uint8Array(n * 3), bl = new Uint8Array(n);
    for (let i = 0; i < n; i++, o += sz) {
      xy[i * 2] = dv.getInt16(o) / 32768; xy[i * 2 + 1] = dv.getInt16(o + 2) / 32768;
      let stt, c;
      if (fmt === 0) { stt = dv.getUint8(o + 6); c = pal[dv.getUint8(o + 7)] || [255, 255, 255]; }
      else if (fmt === 1) { stt = dv.getUint8(o + 4); c = pal[dv.getUint8(o + 5)] || [255, 255, 255]; }
      else if (fmt === 4) { stt = dv.getUint8(o + 6); c = [dv.getUint8(o + 9), dv.getUint8(o + 8), dv.getUint8(o + 7)]; }
      else { stt = dv.getUint8(o + 4); c = [dv.getUint8(o + 7), dv.getUint8(o + 6), dv.getUint8(o + 5)]; }
      bl[i] = (stt & 0x40) || (c[0] + c[1] + c[2] === 0) ? 1 : 0;
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    frames.push({ xy, col, bl, n });
  }
  return frames;
}
const patData = new Map();   // n -> frames
let patAvail = new Set();
async function loadPat(n) {
  extCache.delete(n);
  if (patData.has(n)) return patData.get(n);
  if (!patAvail.has(n)) return null;
  const buf = await window.laser.patRead(n);
  const fr = buf ? parseIlda(buf) : [];
  patData.set(n, fr); return fr;
}
// tegn ét frame: o = { scale, ang (grader), ox, oy (-1..1), rgb|null, alpha, glow }
function physFromRaw(x, y) { const L = lmap(), a = DV[L.x], b = DV[L.y]; return [a[0] * x + b[0] * y, a[1] * x + b[1] * y]; }
function drawField(g, f, d, P, toPx, o = {}) { // tegn en ILDA-frame gennem firmwarens transformationskæde (ShowNET.transformPoint)
  if (!f || f.n < 1) return; const pts = new Array(f.n);
  if (o.uniform) { // mønstret beholder sin form (LIVE er bredere end laserens kvadratiske felt): midten placeres i feltet, selve mønstret tegnes med samme skala begge veje
    const q0 = ShowNET.transformPoint(0, 0, d, P), [cx, cy] = toPx(q0.x, q0.y), k = o.uniform;
    for (let i = 0; i < f.n; i++) { const q = ShowNET.transformPoint(f.xy[i * 2], f.xy[i * 2 + 1], d, P); pts[i] = [cx + (q.x - q0.x) * k, cy - (q.y - q0.y) * k, q.outside]; }
  } else for (let i = 0; i < f.n; i++) { const q = ShowNET.transformPoint(f.xy[i * 2], f.xy[i * 2 + 1], d, P); const [px, py] = toPx(q.x, q.y); pts[i] = [px, py, q.outside]; }
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.globalAlpha = o.alpha ?? 1;
  for (const [lw, al] of o.glow ? [[o.glow * 3, 0.18], [Math.max(1, o.glow), 1]] : [[1.3, 1]]) {
    g.lineWidth = lw;
    for (let i = 1; i < f.n; i++) { if (f.bl[i]) continue; const p = pts[i], q = pts[i - 1]; if (p[2] || q[2]) continue;
      const c = o.rgb || [f.col[i * 3], f.col[i * 3 + 1], f.col[i * 3 + 2]]; g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${al})`;
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 0.5) { g.fillStyle = g.strokeStyle; g.fillRect(p[0] - lw / 2, p[1] - lw / 2, lw, lw); } else { g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(p[0], p[1]); g.stroke(); } }
  }
  g.restore();
}
function drawIlda(g, W, H, f, o = {}) {
  if (!f || f.n < 1) return;
  const R = o.box ? o.box.upl * (o.scale ?? 1) : (Math.min(W, H) / 2) * 0.9 * (o.scale ?? 1);
  let cx, cy;
  if (o.box) { [cx, cy] = boxPt(o.box, o.ox || 0, o.oy || 0); } else { const L = (Math.min(W, H) / 2) * 0.9; cx = W / 2 + (o.ox || 0) * L; cy = H / 2 - (o.oy || 0) * L; }
  const a = ((o.ang || 0) * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const mx = o.mx || 1, my = o.my || 1;
  const P = (i) => { const x = f.xy[i * 2] * mx, y = f.xy[i * 2 + 1] * my; return [cx + (x * cs - y * sn) * R, cy - (x * sn + y * cs) * R]; };
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.globalAlpha = o.alpha ?? 1;
  const passes = o.glow ? [[o.glow * 3, 0.18], [Math.max(1, o.glow), 1]] : [[1.3, 1]];
  for (const [lw, al] of passes) {
    g.lineWidth = lw;
    let prev = P(0);
    for (let i = 1; i < f.n; i++) {
      const p = P(i);
      if (!f.bl[i]) {
        const c = o.rgb || [f.col[i * 3], f.col[i * 3 + 1], f.col[i * 3 + 2]];
        g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${al})`;
        if (Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) < 0.5) { g.fillStyle = g.strokeStyle; g.fillRect(p[0] - lw / 2, p[1] - lw / 2, lw, lw); }
        else { g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(p[0], p[1]); g.stroke(); }
      }
      prev = p;
    }
  }
  g.restore();
}
// mønsterets udstrækning i rammen (0..1 pr. akse) – bruges til at regne ud hvor langt det kan flyttes uden at blive klemt
const extCache = new Map();
function patExtent(n, ang = 0) {
  if (!extCache.has(n)) {
    const fr = patData.get(n); let mx = 0, my = 0;
    if (fr && fr.length) { for (const f of fr) for (let i = 0; i < f.n; i++) { if (f.bl[i]) continue; mx = Math.max(mx, Math.abs(f.xy[i * 2])); my = Math.max(my, Math.abs(f.xy[i * 2 + 1])); } }
    else return { x: 1, y: 1 };
    extCache.set(n, { x: clamp(mx || 1, 0.05, 1), y: clamp(my || 1, 0.05, 1) });
  }
  const e = extCache.get(n);
  if (Math.abs(ang) % 180 < 3) return e;
  const m = Math.max(e.x, e.y); return { x: m, y: m }; // drejet: brug den største
}
const pbCache = new Map();
function patBox(n) { // mønstrets halve bredde/højde omkring dets egen midte (mønster-koordinater)
  if (pbCache.has(n)) return pbCache.get(n); const fr = patData.get(n); if (!fr || !fr.length) return { hx: 0.5, hy: 0.5 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of fr) for (let i = 0; i < f.n; i++) { if (f.bl[i]) continue; const x = f.xy[i * 2], y = f.xy[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const b = x0 === Infinity ? { hx: 0, hy: 0 } : { hx: (x1 - x0) / 2, hy: (y1 - y0) / 2 }; pbCache.set(n, b); return b;
}
const pcCache = new Map();
function patCenter(n) { // mønstrets egen midte (mønstre er ikke altid tegnet om 0,0) – i mønster-koordinater
  if (pcCache.has(n)) return pcCache.get(n); const fr = patData.get(n); if (!fr || !fr.length) return { x: 0, y: 0 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of fr) for (let i = 0; i < f.n; i++) { if (f.bl[i]) continue; const x = f.xy[i * 2], y = f.xy[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const c = x0 === Infinity ? { x: 0, y: 0 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; pcCache.set(n, c); return c;
}
const rotV = (x, y, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s_ = Math.sin(a); return [x * c - y * s_, x * s_ + y * c]; };
function firstVisible(fr) { return fr.find((f) => f.bl.some((b) => !b)) || fr[0]; }
function sizeCanvas(cv) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [g, W, H];
}
async function drawThumb(tile, n, frameIdx = null) {
  const fr = await loadPat(n); if (!fr || !fr.length) return;
  let cv = tile.querySelector('canvas');
  if (!cv) { cv = document.createElement('canvas'); tile.prepend(cv); tile.classList.add('has'); }
  const [g, W, H] = sizeCanvas(cv); g.clearRect(0, 0, W, H);
  drawIlda(g, W, H, frameIdx == null ? firstVisible(fr) : fr[frameIdx % fr.length], { glow: 1.1, ...mirrorOpts(n) });
}
let hoverAnim = null;
function startHover(tile, n) {
  stopHover();
  const fr = patData.get(n); if (!fr || fr.length < 2) return;
  const t0 = performance.now();
  const step = () => { const i = Math.floor(((performance.now() - t0) / 1000) * 50); drawThumb(tile, n, i); hoverAnim.raf = requestAnimationFrame(step); };
  hoverAnim = { tile, n, raf: requestAnimationFrame(step) };
}
function stopHover() { if (!hoverAnim) return; cancelAnimationFrame(hoverAnim.raf); const { tile, n } = hoverAnim; hoverAnim = null; drawThumb(tile, n); }

// ---------- presets: færdige looks der virker på alle mønstre ----------
const C = { red: [255, 0, 0], orange: [255, 90, 0], yellow: [255, 220, 0], green: [0, 255, 0], cyan: [0, 255, 255], blue: [0, 40, 255], purple: [140, 0, 255], pink: [255, 0, 160], white: [255, 255, 255], warm: [255, 170, 90], lime: [140, 255, 0] };
const PRESET_BASE = { move: 'none', moveAmt: 0.4, moveSpeed: 0.3, rotSpeed: 0, rotAngle: 0, strobe: 0, pulse: 0, colorCycle: false, colorCycleSpeed: 0.3, size: 0.8, fps: 0.5 };
// Hvert preset er et komplet look: ET bestemt mønster (nummer på SD-kortet) + farve + effekt.
// De indbyggede bruger mønster 1–28; du kan ændre mønster på hvert preset (højreklik) og lave dine egne.
const BUILTIN_PRESETS = [
  { pat: 1,  l: { color: { mode: 'rgb', rgb: C.white } } },
  { pat: 2,  l: { color: { mode: 'orig', rgb: C.white } } },
  { pat: 3,  l: { rotSpeed: 0.12, color: { mode: 'rgb', rgb: C.cyan } } },
  { pat: 4,  l: { rotSpeed: 0.6, color: { mode: 'rgb', rgb: C.yellow } } },
  { pat: 5,  l: { rotSpeed: -0.3, color: { mode: 'rgb', rgb: C.green } } },
  { pat: 6,  l: { colorCycle: true, colorCycleSpeed: 0.3 } },
  { pat: 7,  l: { colorCycle: true, colorCycleSpeed: 0.85 } },
  { pat: 8,  l: { move: 'circle', moveAmt: 0.5, moveSpeed: 0.35, color: { mode: 'rgb', rgb: C.blue } } },
  { pat: 9,  l: { move: 'eight', moveAmt: 0.6, moveSpeed: 0.3, color: { mode: 'rgb', rgb: C.purple } } },
  { pat: 10, l: { move: 'sweep', moveAmt: 0.7, moveSpeed: 0.4, color: { mode: 'rgb', rgb: C.red } } },
  { pat: 11, l: { move: 'bounce', moveAmt: 0.5, moveSpeed: 0.5, color: { mode: 'rgb', rgb: C.green } } },
  { pat: 12, l: { pulse: 0.8, color: { mode: 'rgb', rgb: C.red } } },
  { pat: 13, l: { pulse: 0.7, colorCycle: true, colorCycleSpeed: 0.5 } },
  { pat: 14, l: { strobe: 0.25, color: { mode: 'rgb', rgb: C.white } } },
  { pat: 15, l: { strobe: 0.7, color: { mode: 'rgb', rgb: C.white } } },
  { pat: 16, l: { size: 0.35, rotSpeed: 0.5, color: { mode: 'rgb', rgb: C.orange } } },
  { pat: 17, l: { size: 1, rotSpeed: 0.08, color: { mode: 'rgb', rgb: C.cyan } } },
  { pat: 18, l: { move: 'sweep', moveAmt: 0.5, moveSpeed: 0.2, color: { mode: 'rgb', rgb: C.cyan } } },
  { pat: 19, l: { rotSpeed: 0.1, size: 0.9, fps: 0.3, color: { mode: 'rgb', rgb: C.purple } } },
  { pat: 20, l: { move: 'circle', moveAmt: 0.2, moveSpeed: 0.1, color: { mode: 'rgb', rgb: C.warm } } },
  { pat: 21, l: { move: 'circle', moveAmt: 0.4, moveSpeed: 0.5, rotSpeed: 0.3, pulse: 0.5, colorCycle: true, colorCycleSpeed: 0.5 } },
  { pat: 22, l: { move: 'eight', moveAmt: 0.8, moveSpeed: 0.8, rotSpeed: -0.7, colorCycle: true, colorCycleSpeed: 0.9, strobe: 0.2 } },
  { pat: 23, l: { fps: 0.15, rotSpeed: 0.05, color: { mode: 'rgb', rgb: C.blue } } },
  { pat: 24, l: { fps: 0.9, color: { mode: 'rgb', rgb: C.lime } } },
  { pat: 25, l: { pulse: 0.6, rotSpeed: 0.2, color: { mode: 'rgb', rgb: C.pink } } },
  { pat: 26, l: { move: 'eight', moveAmt: 0.35, moveSpeed: 0.15, size: 0.6, color: { mode: 'rgb', rgb: C.blue } } },
  { pat: 27, l: { move: 'sweep', moveAmt: 0.9, moveSpeed: 0.75, color: { mode: 'rgb', rgb: C.lime } } },
  { pat: 28, l: { rotSpeed: 0.25, pulse: 0.4, color: { mode: 'rgb', rgb: C.orange } } },
];
// gemte ændringer: { "3": { pat: 42, name: "Mit navn", l: {...} }, "user": [ {pat,name,l}, ... ] }
let presetStore = store.get('presets', { user: [] });
function allPresets() {
  const list = BUILTIN_PRESETS.map((b, i) => Object.assign({ builtin: i }, b, presetStore[i] || {}));
  (presetStore.user || []).forEach((u, k) => list.push(Object.assign({ user: k }, u)));
  return list;
}
let PRESETS = allPresets();
function presetName(p, i) { return p.name || (p.builtin !== undefined ? t('pr.' + p.builtin) : t('pr.user', { n: i + 1 })); }
function savePresets() { store.set('presets', presetStore); PRESETS = allPresets(); }

function applyPreset(i) {
  const p = PRESETS[i]; if (!p) return;
  Object.assign(st, structuredClone(PRESET_BASE), structuredClone(p.l), { pattern: p.pat });
  rotAcc = 0; activeScene = -1; saveLook(); syncLookUI(); renderScenes();
  $$('.preset').forEach((d) => d.classList.toggle('active', +d.dataset.i === i));
  const want = Math.floor((st.pattern - 1) / PAGE);
  recordHook(presetName(p, i));
}
function randomPreset() {
  Object.assign(st, structuredClone(PRESET_BASE));
  const pool = patAvail.size ? [...patAvail] : Array.from({ length: cfg.patCount }, (_, i) => i + 1);
  st.pattern = pool[Math.floor(Math.random() * pool.length)];
  st.color = Math.random() < 0.2 ? { mode: 'orig', rgb: C.white } : { mode: 'rgb', rgb: Object.values(C)[Math.floor(Math.random() * 11)] };
  st.move = MOVES[Math.floor(Math.random() * 5)]; st.moveAmt = 0.2 + Math.random() * 0.5; st.moveSpeed = 0.1 + Math.random() * 0.6;
  st.rotSpeed = Math.random() < 0.5 ? 0 : (Math.random() - 0.5) * 0.8; st.pulse = Math.random() < 0.4 ? 0.5 + Math.random() * 0.4 : 0;
  rotAcc = 0; activeScene = -1; saveLook(); syncLookUI(); renderScenes(); recordHook(t('pr.random'));
}
async function editPreset(i) {
  const p = PRESETS[i];
  const r = await modal(t('pr.edit', { pat: p.pat }), presetName(p, i), p.user !== undefined ? t('pr.delete') : t('pr.setPattern', { n: st.pattern }));
  if (r === null) return;
  if (r === '__extra') {
    if (p.user !== undefined) presetStore.user.splice(p.user, 1);
    else presetStore[p.builtin] = Object.assign({}, presetStore[p.builtin] || {}, { pat: st.pattern });
  } else {
    const name = r.trim();
    if (p.user !== undefined) presetStore.user[p.user].name = name || undefined;
    else presetStore[p.builtin] = Object.assign({}, presetStore[p.builtin] || {}, { name: name || undefined });
  }
  savePresets(); renderPatterns();
}
async function addPresetFromCurrent() {
  const name = await modal(t('pr.saveAs', { pat: st.pattern }), '');
  if (name === null) return;
  const { pattern, ...rest } = structuredClone(st);
  presetStore.user = presetStore.user || [];
  presetStore.user.push({ pat: pattern, name: name.trim() || undefined, l: rest });
  savePresets(); patPage = 'presets'; renderPatPages(); renderPatterns();
  const g = $('#patGrid'); g.scrollTop = g.scrollHeight;
}
// en cirkel bruges som reserve, hvis laserens mønstre ikke er indlæst
const FALLBACK_FRAME = (() => {
  const n = 73, xy = new Float32Array(n * 2), col = new Uint8Array(n * 3).fill(255), bl = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const a = (i / (n - 1)) * Math.PI * 2; xy[i * 2] = Math.cos(a) * 0.7; xy[i * 2 + 1] = Math.sin(a) * 0.7; }
  bl[0] = 1; return [{ xy, col, bl, n }];
})();
// beregn hvordan et look ser ud på tidspunkt t (sekunder) – samme regler som laser-motoren
function lookAt(l, t) {
  const hz = 0.05 + l.moveSpeed * l.moveSpeed * 1.6, ph = t * hz * Math.PI * 2, a = l.moveAmt * 0.42;
  let x = 0, y = 0;
  if (l.move === 'circle') { x = a * Math.cos(ph); y = a * Math.sin(ph); }
  else if (l.move === 'eight') { x = a * Math.sin(ph); y = a * 0.5 * Math.sin(ph * 2); }
  else if (l.move === 'sweep') x = a * Math.sin(ph);
  else if (l.move === 'bounce') y = a * (Math.abs(Math.sin(ph)) * 2 - 1);
  const env = Math.exp(-((t * 2) % 1) * 7); // beat ved 120 BPM
  const rgb = l.colorCycle ? hsv((t * (0.02 + l.colorCycleSpeed * 0.5)) % 1, 1, 1) : l.color.mode === 'orig' ? null : l.color.rgb;
  const fps = fpsFrac(l.fps) * 100;
  const strobeOff = l.strobe > 0 && Math.floor((t * 1000) / (220 - l.strobe * 190)) % 2 === 1;
  return { ox: x * 2, oy: y * 2, ang: l.rotAngle + t * l.rotSpeed * 360, scale: clamp(l.size * (1 - l.pulse * 0.6 * env), 0.05, 1), rgb, fps, strobeOff };
}
function presetLook(p) { return Object.assign(structuredClone(PRESET_BASE), { color: { mode: 'orig', rgb: C.white } }, structuredClone(p.l), { pattern: p.pat }); }
async function drawPresetTile(tile, i, t = 0) {
  const p = PRESETS[i], l = presetLook(p);
  const fr = (await loadPat(l.pattern)) || FALLBACK_FRAME;
  const cv = tile.querySelector('canvas'); if (!cv) return;
  const [g, W, H] = sizeCanvas(cv); g.clearRect(0, 0, W, H);
  const s = lookAt(l, t); if (s.strobeOff) return;
  const f = t === 0 ? firstVisible(fr) : fr[Math.floor(t * s.fps) % fr.length];
  drawIlda(g, W, H, f, { scale: s.scale, ang: s.ang, ox: s.ox * 0.8, oy: s.oy * 0.8, rgb: s.rgb || (fr === FALLBACK_FRAME ? [230, 230, 230] : null), glow: 1.2 });
}
let presetAnim = null;
function stopPresetAnim() { if (!presetAnim) return; cancelAnimationFrame(presetAnim.raf); const { tile, i } = presetAnim; presetAnim = null; drawPresetTile(tile, i); }
function renderPresets(g) {
  g.classList.add('presets');
  PRESETS.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'preset' + (p.user !== undefined ? ' user' : ''); d.dataset.i = i;
    d.innerHTML = `<canvas></canvas><span class="pp"></span><span class="pn"></span>`;
    d.querySelector('.pp').textContent = '#' + p.pat;
    d.querySelector('.pn').textContent = presetName(p, i);
    d.onclick = () => applyPreset(i);
    d.oncontextmenu = (e) => { e.preventDefault(); editPreset(i); };
    d.onmouseenter = () => {
      stopPresetAnim();
      const t0 = performance.now();
      const step = () => { drawPresetTile(d, i, (performance.now() - t0) / 1000); if (presetAnim) presetAnim.raf = requestAnimationFrame(step); };
      presetAnim = { tile: d, i, raf: requestAnimationFrame(step) };
    };
    d.onmouseleave = () => { if (presetAnim && presetAnim.tile === d) stopPresetAnim(); };
    g.appendChild(d);
    requestAnimationFrame(() => drawPresetTile(d, i));
  });
  // tilføj: gem nuværende look som preset · 🎲 tilfældig
  const add = document.createElement('div'); add.className = 'preset addp'; add.innerHTML = `<span class="big">＋</span><span class="pn"></span>`;
  add.querySelector('.pn').textContent = t('pr.add'); add.onclick = addPresetFromCurrent; g.appendChild(add);
  const rnd = document.createElement('div'); rnd.className = 'preset addp'; rnd.innerHTML = `<span class="big">🎲</span><span class="pn"></span>`;
  rnd.querySelector('.pn').textContent = t('pr.random'); rnd.onclick = randomPreset; g.appendChild(rnd);
}

// ---------- mønstre ----------
function renderPatPages() {
  const pages = Math.max(1, Math.ceil(cfg.patCount / PAGE));
  if (typeof patPage === 'number' && patPage !== -1) patPage = clamp(patPage, 0, pages - 1);
  $('#patPages').innerHTML = '';
  for (let p = 0; p < pages; p++) {
    const b = document.createElement('button');
    b.textContent = `${p * PAGE + 1}–${Math.min(cfg.patCount, p * PAGE + PAGE)}`;
    b.className = p === patPage ? 'active' : '';
    b.onclick = () => { patPage = p; renderPatPages(); renderPatterns(); };
    $('#patPages').appendChild(b);
  }
  const pb = document.createElement('button');
  pb.textContent = t('pat.presets'); pb.className = patPage === 'presets' ? 'active' : '';
  pb.onclick = () => { patPage = 'presets'; renderPatPages(); renderPatterns(); };
  $('#patPages').prepend(pb);
  const fb = document.createElement('button');
  fb.textContent = '★'; fb.title = t('pat.favs');
  fb.className = patPage === -1 ? 'active' : '';
  $('#patPages').appendChild(fb);
  fb.onclick = () => { patPage = -1; renderPatPages(); renderPatterns(); };
}
function renderPatterns() {
  stopHover();
  if (presetAnim) stopPresetAnim();
  const g = $('#patGrid'); g.innerHTML = ''; g.scrollTop = 0; g.classList.remove('presets');
  if (patPage === 'presets') { renderPresets(g); return; }
  let list = [];
  if (patPage === -1) list = [...favs].sort((a, b) => a - b);
  else for (let n = patPage * PAGE + 1; n <= Math.min(cfg.patCount, patPage * PAGE + PAGE); n++) list.push(n);
  if (!list.length) { g.innerHTML = `<p class="hint">${t('pat.noFavs')}</p>`; return; }
  for (const n of list) {
    const d = document.createElement('div');
    d.className = 'pat' + (n === st.pattern ? ' active' : '');
    d.dataset.n = n;
    d.innerHTML = `<span class="n">${n}</span><span class="nm"></span>${favs.has(n) ? '<span class="star">★</span>' : ''}`;
    d.querySelector('.nm').textContent = patNames[n] || '';
    d.onclick = () => { if (st.pattern === n) { setPattern(0); recordHook(t('pat.offName')); } else { setPattern(n); recordHook(t('pat.name', { n })); } };
    d.oncontextmenu = (e) => { e.preventDefault(); editPattern(n, d); };
    d.onmouseenter = () => startHover(d, n);
    d.onmouseleave = () => { if (hoverAnim && hoverAnim.tile === d) stopHover(); };
    g.appendChild(d);
    if (patAvail.has(n)) requestAnimationFrame(() => drawThumb(d, n));
  }
}
async function refreshPatList() {
  patAvail = new Set(await window.laser.patList());
  patData.clear();
  if (patAvail.size) { const mx = Math.max(...patAvail); if (mx > cfg.patCount) { cfg.patCount = mx; $('#patCount').value = mx; saveCfg(); } }
  $('#patImport').textContent = patAvail.size ? t('pat.loaded', { n: patAvail.size }) : t('pat.import');
  renderPatPages(); renderPatterns(); renderKeyboard();
}
$('#patImport').onclick = async () => {
  const r = await window.laser.patImport(); if (!r) return;
  if (!r.count) { modal(t('pat.none'), null); return; }
  if (!r.numbered) modal(t('pat.renumbered', { n: r.count }), null);
  await refreshPatList();
};
window.addEventListener('resize', debounce(() => renderPatterns(), 200));

// ---------- sikkerhedszone i forhåndsvisningen ----------
function zoneRect(W, H) {
  if (!(cfg.zone > 0)) return null;
  const b = pvBox(W, H); let z = zoneEff();
  if (cfg.lim && cfg.lim.on) { // zonens linje i laserens egne (sendte) koordinater → LIVE
    const side = cfg.zoneSide || 'bottom', zs = cfg.zoneSent || {}, d0 = { bottom: -1, top: 1, left: -1, right: 1 }[side], s0 = zs[side + '0'] ?? d0, s1 = zs[side + '1'] ?? -d0;
    // 0 % = det målte startpunkt (s0), 100 % = helt ude ved LIVE-kanten i den anden ende
    if (side === 'bottom' || side === 'top') { const y0 = clamp(sentToApp(cfg.ctrX || 0, s0)[1], -1, 1), yEnd = side === 'bottom' ? 1 : -1, ay = y0 + z * (yEnd - y0), py = boxPt(b, 0, ay)[1]; return side === 'bottom' ? [b.x, py, b.w, Math.max(0, b.y + b.h - py)] : [b.x, b.y, b.w, Math.max(0, py - b.y)]; }
    const x0 = clamp(sentToApp(s0, cfg.ctrY || 0)[0], -1, 1), xEnd = side === 'left' ? 1 : -1, ax = x0 + z * (xEnd - x0), px = boxPt(b, ax, 0)[0]; return side === 'left' ? [b.x, b.y, Math.max(0, px - b.x), b.h] : [px, b.y, Math.max(0, b.x + b.w - px), b.h];
  }
  const zm = cfg.zoneMap; // målt med kameraet: zone-% → hvor kanten faktisk sidder (andel af LIVE-feltet)
  if (zm && zm.length >= 2) { const pts = [...zm].sort((a, b2) => a.z - b2.z); if (z <= pts[0].z) z = pts[0].f; else if (z >= pts[pts.length - 1].z) z = pts[pts.length - 1].f; else for (let i = 1; i < pts.length; i++) if (z <= pts[i].z) { const a = pts[i - 1], c = pts[i]; z = a.f + (c.f - a.f) * (z - a.z) / Math.max(1e-6, c.z - a.z); break; } z = clamp(z, 0.005, 0.98); }
  switch (cfg.zoneSide) {
    case 'top': return [b.x, b.y, b.w, b.h * z];
    case 'left': return [b.x, b.y, b.w * z, b.h];
    case 'right': return [b.x + b.w * (1 - z), b.y, b.w * z, b.h];
    default: { const f0 = clamp(((cfg.zoneZeroY ?? -1) + 1) / 2, 0, 0.95), zz = f0 + z * (1 - f0); return [b.x, b.y + b.h * (1 - zz), b.w, b.h * zz]; }
  }
}
function drawZone(g, W, H) {
  const zr = zoneRect(W, H); if (!zr) return;
  const [x, y, w, h] = zr;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.88)'; g.fillRect(x, y, w, h);  // laserlyset slukkes her
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = 'rgba(255,59,92,0.35)'; g.lineWidth = 1;
  for (let i = -H; i < W + H; i += 10) { g.beginPath(); g.moveTo(i, y + h); g.lineTo(i + h, y); g.stroke(); }
  g.restore();
  g.strokeStyle = '#ff3b5c'; g.lineWidth = 1.5; g.setLineDash([6, 4]); g.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5); g.setLineDash([]);
  // grænsen – den kant laseren tegner med rød streg, og som du kan trække i
  const side = cfg.zoneSide || 'bottom';
  const edge = side === 'bottom' ? [x, y, x + w, y] : side === 'top' ? [x, y + h, x + w, y + h] : side === 'left' ? [x + w, y, x + w, y + h] : [x, y, x, y + h];
  g.save(); g.strokeStyle = '#ff3b5c'; g.shadowColor = '#ff3b5c'; g.shadowBlur = zoneDrag || special === 'zone' ? 14 : 6; g.lineWidth = special === 'zone' ? 3 : 2;
  g.beginPath(); g.moveTo(edge[0], edge[1]); g.lineTo(edge[2], edge[3]); g.stroke(); g.restore();
  const hx = (edge[0] + edge[2]) / 2, hy = (edge[1] + edge[3]) / 2;
  g.fillStyle = zoneDrag ? '#fff' : '#ff3b5c'; g.beginPath(); g.roundRect(hx - 18, hy - 5, 36, 10, 5); g.fill();
  g.fillStyle = '#ff3b5c'; g.font = '600 10px -apple-system'; g.textAlign = 'left';
  const ty = cfg.zoneSide === 'top' ? y + 14 : cfg.zoneSide === 'bottom' || !cfg.zoneSide ? y + 14 : y + 32;
  g.fillText(t('pv.zoneLabel'), x + 8, ty);
}
function syncZoneUI() {
  if (!(cfg.zone > 0) && special === 'zone') setSpecial('zone'); // 0 % = ingen zone → stop med at vise den
  const v = Math.round(cfg.zone * 100);
  $('#zoneLive').value = v; $('#zone').value = v;
  const txt = v == 0 ? t('v.off') : v + '%';
  $('#zoneLiveOut').textContent = txt;
  const o = $('#zone').parentElement.querySelector('output'); if (o) o.textContent = txt;
}
$('#zoneLive').addEventListener('input', (e) => { cfg.zone = e.target.value / 100; saveCfg(); syncZoneUI(); });
$('#zone').addEventListener('input', syncZoneUI);

// ---------- træk i LIVE: flyt mønsteret, eller træk zonegrænsen ----------
let zoneDrag = false, moveMode = false, posDrag = null, calDrag = null;
(() => {
  const cv = $('#preview');
  const rel = (e) => { const r = cv.getBoundingClientRect(), b = pvBox(r.width, r.height); return [(e.clientX - r.left - b.x) / b.w, (e.clientY - r.top - b.y) / b.h]; };
  const nearEdge = (u, v) => {
    if (!(cfg.zone > 0)) return false;
    const z = cfg.zone, s = cfg.zoneSide || 'bottom';
    const d = s === 'bottom' ? Math.abs(v - (1 - z)) : s === 'top' ? Math.abs(v - z) : s === 'left' ? Math.abs(u - z) : Math.abs(u - (1 - z));
    return d < 0.05;
  };
  cv.addEventListener('pointerdown', (e) => {
    const [u, v] = rel(e);
    if (measure) { measureRecord(u * 2 - 1, 1 - v * 2); return; }
    if (fb.click) { fb.click = false; $('#fbClick').classList.remove('on'); fbCorrect(u * 2 - 1, 1 - v * 2); return; }
    if (raw.on && raw.learnClick) { raw.learnClick = false; rawLearn(u * 2 - 1, 1 - v * 2); return; }
    { const [cx, cy] = laserCenterApp(); const r = cv.getBoundingClientRect(), b = pvBox(r.width, r.height), [px, py] = boxPt(b, cx, cy); }
    if (special === 'cal') { const p = calPt(); calDrag = { u0: u, v0: v, x0: p.x, y0: p.y, sx: cfg.cal.sx, sy: cfg.cal.sy }; cv.setPointerCapture(e.pointerId); return; }
    if (nearEdge(u, v) || special === 'zone') { zoneDrag = true; cv.setPointerCapture(e.pointerId); applyZoneDrag(u, v); return; }
    if (special !== 'max') { posDrag = { u0: u, v0: v, x0: st.posX, y0: st.posY }; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    const [u, v] = rel(e);
    { const [cx, cy] = laserCenterApp(); const r = cv.getBoundingClientRect(), b = pvBox(r.width, r.height), [px, py] = boxPt(b, cx, cy); cv.style.cursor = zoneDrag || nearEdge(u, v) ? (['left', 'right'].includes(cfg.zoneSide) ? 'ew-resize' : 'ns-resize') : 'move'; }
    if (centerDrag) { return; }
    if (calDrag) { const p = calPt(); p.x = clamp(calDrag.x0 + (u - calDrag.u0) * 2 * calDrag.sx, -1, 1); p.y = clamp(calDrag.y0 - (v - calDrag.v0) * 2 * calDrag.sy, -1, 1); cfg.quadSaved = false; calApply(); syncCalUI(); }
    else if (zoneDrag) applyZoneDrag(u, v);
    else if (posDrag) { st.posX = clamp(posDrag.x0 + (u - posDrag.u0) * 2, -1, 1); st.posY = clamp(posDrag.y0 - (v - posDrag.v0) * 2, -1, 1); saveLook(); syncSizeUI(); }
  });
  const up = () => { zoneDrag = false; posDrag = null; calDrag = null; centerDrag = false; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { if (!moveMode) return; e.preventDefault(); setSize(st.size - Math.sign(e.deltaY) * 0.03); }, { passive: false });
})();
function applyZoneDrag(u, v) {
  const s = cfg.zoneSide || 'bottom';
  const z = s === 'bottom' ? 1 - v : s === 'top' ? v : s === 'left' ? u : 1 - u;
  cfg.zone = clamp(Math.round(z * 100) / 100, 0, 0.9); saveCfg(); syncZoneUI();
}
// begræns ønsket position til det laseren kan nå ved den aktuelle størrelse (kun når mønsteret står stille)
function clampPosToReach() {
  if (st.move !== 'none' || !out.reach) return;
  const r = out.reach;
  const rx = clamp(calAxis(st.posX, 'x'), -r.x, r.x), ry = clamp(calAxis(st.posY * YF(), 'y'), -r.y, r.y);
  const [ax, ay] = rawToApp(rx, ry);
  st.posX = clamp(ax, -1, 1); st.posY = clamp(ay / YF(), -1, 1);
}
function setSize(v) { st.size = clamp(v, 0, 1); saveLook(); syncLookUI(); syncSizeUI(); sendNow(); }
function setPos(k, v) { st[k] = clamp(v, -1, 1); saveLook(); syncSizeUI(); sendNow(); }
function syncSizeUI() {
  const sz = Math.round(st.size * 100), px = Math.round(st.posX * 100), py = Math.round(st.posY * 100);
  if (+$('#sizeLive').value !== sz) $('#sizeLive').value = sz; $('#sizeLiveOut').textContent = sz + '%';
  $('#posXOut').textContent = (px > 0 ? '+' : '') + px; $('#posYOut').textContent = (py > 0 ? '+' : '') + py;
}
$('#sizeLive').addEventListener('input', (e) => setSize(e.target.value / 100));
$('#szMinus').onclick = () => setSize(st.size - 0.05); $('#szPlus').onclick = () => setSize(st.size + 0.05);
$$('#pvSizeBar button[data-k]').forEach((b) => (b.onclick = () => setPos(b.dataset.k, st[b.dataset.k] + 0.05 * +b.dataset.d)));
$('#posReset').onclick = () => { st.posX = cfg.lim && cfg.lim.on ? cfg.ctrX || 0 : 0; st.posY = cfg.lim && cfg.lim.on ? cfg.ctrY || 0 : 0; setSize(0.8); };
$('#pvMax').onclick = () => setSpecial('max');
$('#pvMeasure').onclick = () => (measure ? measureStop(false) : measureStart());
$('#msSkip').onclick = () => measureNext();
$('#msCancel').onclick = () => measureStop(false);
$('#msReset').onclick = () => { cfg.posMap = null; saveCfg(); measureStop(false); toast(t('pv.msCleared')); };
// ---------- kalibrering med 4 punkter: øverst venstre, øverst højre, nederst højre, nederst venstre ----------
// Hvert punkt vises af laseren som et kryds (vandret + lodret streg skiftevis). Krydsets midte er punktet.
let calStep = 1;
const CAL_KEYS = ['TL', 'TR', 'BR', 'BL'];
const CAL_PTS_DEF = { TL: { x: -0.9, y: 0.9 }, TR: { x: 0.9, y: 0.9 }, BR: { x: 0.9, y: -0.9 }, BL: { x: -0.9, y: -0.9 } };
function calPt(step = calStep) { return cfg.calPts[CAL_KEYS[step - 1]]; }
function calBounds() { const p = cfg.calPts; return { T: (p.TL.y + p.TR.y) / 2, B: (p.BL.y + p.BR.y) / 2, L: (p.TL.x + p.BL.x) / 2, R: (p.TR.x + p.BR.x) / 2 }; }
function calApply() { // de fire punkter → forskydning og skala (LIVE-kanten = de kalibrerede punkter)
  const c = calBounds(); cfg.calib = c;
  cfg.cal.ox = (c.L + c.R) / 2; cfg.cal.sx = Math.max(0.05, (c.R - c.L) / 2); cfg.cal.oy = (c.T + c.B) / 2; cfg.cal.sy = Math.max(0.05, (c.T - c.B) / 2); saveCfg();
}
function calGeomFor(step) { // den kant der tegnes i 'calbox' (1 top, 2 bund, 3 højre, 4 venstre) i rå laser-koordinater
  const c = calBounds(), cx = (c.L + c.R) / 2, cy = (c.T + c.B) / 2, w = Math.max(0.05, (c.R - c.L) / 2), h = Math.max(0.05, (c.T - c.B) / 2);
  if (step === 1) return { vertical: false, x: cx, y: c.T, len: w };
  if (step === 2) return { vertical: false, x: cx, y: c.B, len: w };
  if (step === 3) return { vertical: true, x: c.R, y: cy, len: h };
  return { vertical: true, x: c.L, y: cy, len: h };
}
// gem hjælpe-mønstre til SD-kortet: punkt (#250), firkant (#251) og den præcise kalibrerings-firkant (#252)
function dotIld() { // lille cirkel: et helt stillestående punkt slukkes af laserens scan-fail-sikring
  const n = 36, r = 0.028, xy = new Float32Array(n * 2), col = new Uint8Array(n * 3).fill(255), bl = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const a = (i / (n - 1)) * Math.PI * 2; xy[i * 2] = Math.cos(a) * r; xy[i * 2 + 1] = Math.sin(a) * r; }
  return encodeFramesIld([{ n, xy, col, bl }], 'DOT'); }
function polyIld(pts, name) { // lukket polygon med blank-anløb, 16 punkter pr. kant
  const out = []; const add = (x, y, b) => out.push([x, y, b]);
  for (let k = 0; k < 3; k++) add(pts[0][0], pts[0][1], 1);
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; for (let k = 0; k < 6; k++) add(a[0], a[1], 0); /* dvæl i hjørnet → skarpt hjørne */ for (let s = 1; s < 16; s++) { const f = s / 16; add(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 0); } }
  for (let k = 0; k < 6; k++) add(pts[0][0], pts[0][1], 0);
  add(pts[0][0], pts[0][1], 0); add(pts[0][0], pts[0][1], 1);
  const n = out.length, xy = new Float32Array(n * 2), col = new Uint8Array(n * 3).fill(255), bl = new Uint8Array(n);
  out.forEach(([x, y, b], i) => { xy[i * 2] = x; xy[i * 2 + 1] = y; bl[i] = b; });
  return encodeFramesIld([{ n, xy, col, bl }], name);
}
async function saveHelperPatterns(withQuad) {
  const files = [{ num: cfg.dotPattern, bytes: dotIld() }, { num: cfg.boxPattern, bytes: polyIld([[-1, 1], [1, 1], [1, -1], [-1, -1]], 'BOX') }];
  if (withQuad) { const p = cfg.calPts; files.push({ num: cfg.quadPattern, bytes: polyIld([[p.TL.x, p.TL.y], [p.TR.x, p.TR.y], [p.BR.x, p.BR.y], [p.BL.x, p.BL.y]], 'KALIB') }); }
  const r = await window.laser.saveIldBatch(t('pv.calSaveTitle'), files); if (!r) return;
  if (withQuad) { cfg.quadSaved = true; saveCfg(); }
  await refreshPatList(); syncCalUI();
  modal(t('pv.calSaved', { d: r.dir, a: String(cfg.dotPattern).padStart(3, '0'), b: String(cfg.boxPattern).padStart(3, '0'), c: withQuad ? ', ' + String(cfg.quadPattern).padStart(3, '0') + '.ild' : '' }), null);
}
function calSet(k, v) { const p = calPt(); if (k === 'x') p.x = clamp(v, -1, 1); else if (k === 'y') p.y = clamp(v, -1, 1); cfg.quadSaved = false; calApply(); syncCalUI(); }
function calGoto(step) { calStep = clamp(step | 0, 1, 4); if (special !== 'cal') setSpecial('cal'); syncCalUI(); }
function calDone() { calApply(); cfg.calibDone = true; saveCfg(); if (special === 'cal') setSpecial('cal'); syncCalUI(); }
function syncCalUI() {
  const p = calPt();
  $$('#calSteps button').forEach((b) => b.classList.toggle('active', +b.dataset.s === calStep));
  $('#calInstr').textContent = t('pv.calI' + calStep);
  $('#calX').value = Math.round(p.x * 100); $('#calXOut').textContent = Math.round(p.x * 100);
  $('#calY').value = Math.round(p.y * 100); $('#calYOut').textContent = Math.round(p.y * 100);
  $('#calNext').textContent = t(calStep < 4 ? 'pv.calNext' : 'pv.calDone'); $('#calPrev').disabled = calStep === 1;
  $('#calIx').checked = !!cfg.cal.ix; $('#calIy').checked = !!cfg.cal.iy;
  $('#calBox').classList.toggle('on', special === 'calbox'); $('#calRun').classList.toggle('on', special === 'cal'); $('#calCenter').classList.toggle('on', special === 'center');
  $('#pvCal').classList.toggle('pos-tr', calStep === 1 || calStep === 4); $('#pvCal').classList.toggle('pos-bl', calStep === 2 || calStep === 3);
  const hasDot = patAvail.has(cfg.dotPattern), hasBox = patAvail.has(cfg.boxPattern), hasQuad = patAvail.has(cfg.quadPattern) && cfg.quadSaved;
  $('#calStatus').textContent = !hasDot ? t('pv.calNoDot', { n: cfg.dotPattern }) : hasQuad ? t('pv.calHasQuad') : hasBox ? t('pv.calHasBox') : t('pv.calNoBox');
  $('#calStatus').classList.toggle('warn', !hasDot);
  const c = calBounds(); $('#calSummary').textContent = `T ${Math.round(c.T * 100)} · B ${Math.round(c.B * 100)} · V ${Math.round(c.L * 100)} · H ${Math.round(c.R * 100)}`;
}
$('#pvCalBtn').onclick = () => { const on = $('#pvCal').hidden; $('#pvCal').hidden = !on; $('#pvCalBtn').classList.toggle('on', on); if (on) calGoto(1); else { if (special === 'cal' || special === 'calbox' || special === 'center') setSpecial(special); calApply(); } };
$$('#calSteps button').forEach((b) => (b.onclick = () => calGoto(+b.dataset.s)));
$('#calPrev').onclick = () => calGoto(calStep - 1); $('#calNext').onclick = () => { if (calStep < 4) calGoto(calStep + 1); else calDone(); };
$('#calRun').onclick = () => { if (special === 'cal') setSpecial('cal'); else calGoto(calStep); syncCalUI(); };
$('#calBox').onclick = () => { setSpecial('calbox'); syncCalUI(); };
$('#calCenter').onclick = () => { setSpecial('center'); syncCalUI(); };
$('#calSaveHelpers').onclick = () => saveHelperPatterns(false);
$('#calSaveQuad').onclick = () => saveHelperPatterns(true);
$('#calX').addEventListener('input', (e) => calSet('x', e.target.value / 100));
$('#calY').addEventListener('input', (e) => calSet('y', e.target.value / 100));
$('#calIx').onchange = (e) => { cfg.cal.ix = e.target.checked; saveCfg(); }; $('#calIy').onchange = (e) => { cfg.cal.iy = e.target.checked; saveCfg(); };
$('#calReset').onclick = () => { cfg.calPts = JSON.parse(JSON.stringify(CAL_PTS_DEF)); cfg.cal.ix = false; cfg.cal.iy = false; cfg.calibDone = false; calApply(); syncCalUI(); };
// LIVE-boksen = det kalibrerede område (samme sideforhold som i virkeligheden), centreret i lærredet
function pvBox(W, H) {
  // hele det sorte LIVE-felt = hele det område laseren kan nå (målt). Ingen ramme – mønsteret kan flyttes overalt.
  return { x: 0, y: 0, w: W, h: H, upl: W / (2 * cfg.cal.sx) };
}
const boxPt = (b, ax, ay) => [b.x + (ax + 1) / 2 * b.w, b.y + (1 - ay) / 2 * b.h];              // app-koordinater (-1..1) → pixels
$('#pvMove').onclick = () => { moveMode = !moveMode; $('#pvMove').classList.toggle('on', moveMode); $('#pvSizeBar').classList.toggle('show', moveMode); };
st.freeze = false; // frys er slået fra indtil videre

// ---------- live forhåndsvisning ----------
let pvFrame = 0, pvLast = performance.now(), pvPat = -1;
function previewTick(now) {
  const cv = $('#preview');
  if (cv.offsetParent) {
    const [g, W, H] = sizeCanvas(cv); if (H > 10) pvAspect = W / H;
    const B = pvBox(W, H);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    // LIVE-boksen = det kalibrerede område. Gitter inde i boksen, tydelig kant.
    g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 1;
    for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(B.x + (B.w * i) / 8, B.y); g.lineTo(B.x + (B.w * i) / 8, B.y + B.h); g.stroke(); g.beginPath(); g.moveTo(B.x, B.y + (B.h * i) / 8); g.lineTo(B.x + B.w, B.y + (B.h * i) / 8); g.stroke(); }
    // (ingen stiplet ramme – kanten af feltet er kanten af laserens område)
    // laserens egen midte (rå 0,0) – viser hvilken vinkel laseren står i ift. området
    { const [ax, ay] = laserCenterApp(), [px, py] = boxPt(B, ax, ay); if (px > -20 && px < W + 20 && py > -20 && py < H + 20) { g.save(); g.strokeStyle = special === 'center' ? '#fff' : 'rgba(255,255,255,0.35)'; g.lineWidth = special === 'center' ? 2 : 1; g.beginPath(); g.moveTo(px - 10, py); g.lineTo(px + 10, py); g.moveTo(px, py - 10); g.lineTo(px, py + 10); g.stroke(); g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '9px -apple-system'; g.textAlign = 'left'; g.fillText(t('pv.laserCenter'), px + 13, py + 3); g.restore(); } }
    if (!patData.has(st.pattern) && patAvail.has(st.pattern)) loadPat(st.pattern);
    const real = patData.get(st.pattern);
    const fr = real && real.length ? real : FALLBACK_FRAME;
    const isFallback = fr === FALLBACK_FRAME;
    // samme tempo som laseren: valgt fps (justérbar), men aldrig hurtigere end scannerne kan tegne frames med så mange punkter
    if (pvPat !== st.pattern) { pvPat = st.pattern; pvFrame = 0; } // laseren starter animationen forfra ved mønsterskift
    const curF = fr[Math.floor(pvFrame) % fr.length], pts = curF && curF.xy ? curF.xy.length / 2 : 0;
    const dd = decodedFrame(); let fps = (dd ? dd.fps : fpsFrac(st.fps) * 100) * (cfg.animScale || 1); if (pts > 0 && cfg.kpps) fps = Math.min(fps, cfg.kpps * 1000 / pts); // præcis den fps kanal 3 giver
    if (!st.freeze) pvFrame += (Math.min(250, now - pvLast) / 1000) * fps; pvLast = now;
    const rawLine = (vertical, rx, ry, len, col, lw) => { // streg i rå laser-koordinater tegnet ind i boksen
      const [ax, ay] = rawToApp(rx, ry); const [px, py] = boxPt(B, ax, ay); const hl = len * B.upl;
      g.save(); g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 14; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
      if (vertical) { g.moveTo(px, py - hl); g.lineTo(px, py + hl); } else { g.moveTo(px - hl, py); g.lineTo(px + hl, py); }
      g.stroke(); g.restore();
    };
    if (raw.on) {
      for (const p of raw.pts) { const [px, py] = boxPt(B, p[2], p[3]); g.save(); g.fillStyle = '#31f3ac'; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '10px -apple-system'; g.textAlign = 'left'; g.fillText(`${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`, px + 8, py + 3); g.restore(); }
      g.fillStyle = '#ffaa3c'; g.font = '700 13px -apple-system'; g.textAlign = 'center'; g.fillText(t(raw.learnClick ? 'raw.clickHint' : 'raw.live', { x: Math.round(raw.x), y: Math.round(raw.y), s: Math.round(raw.size) }), W / 2, B.y + 22);
    }
    if (measure && out.on) {
      // alle 9 målepunkter: grå = kommer, grøn = målt, rød = nu. Brugeren trykker hvor laseren ramte.
      MEASURE_GRID.forEach((gp, i) => { const [ax, ay] = rawToApp(gp[0], gp[1]), [px, py] = boxPt(B, ax, ay); g.save(); g.strokeStyle = i === measure.i ? '#ff3b5c' : i < measure.i ? 'rgba(49,243,172,.6)' : 'rgba(255,255,255,.18)'; g.lineWidth = i === measure.i ? 2.5 : 1; g.setLineDash(i === measure.i ? [] : [3, 4]); g.beginPath(); g.arc(px, py, i === measure.i ? 14 : 9, 0, Math.PI * 2); g.stroke(); g.fillStyle = g.strokeStyle; g.font = '600 10px -apple-system'; g.textAlign = 'center'; g.fillText(String(i + 1), px, py + 4); g.restore(); });
      measure.obs.forEach((o, i) => { const [ax, ay] = rawToApp(o[2], o[3]), [px, py] = boxPt(B, ax, ay), [bx, by] = rawToApp(o[0], o[1]), [qx, qy] = boxPt(B, bx, by); g.save(); g.strokeStyle = 'rgba(49,243,172,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(qx, qy); g.lineTo(px, py); g.stroke(); g.fillStyle = '#31f3ac'; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); g.restore(); });
      g.fillStyle = '#fff'; g.font = '700 14px -apple-system'; g.textAlign = 'center'; g.fillText(t('pv.msStep', { i: measure.i + 1, n: MEASURE_GRID.length }), W / 2, B.y + 22);
      g.fillStyle = '#ff8a9c'; g.font = '12px -apple-system'; g.fillText(t('pv.msLive'), W / 2, B.y + 40);
      // selve mønsteret tegnes hvor appen *tror* det er (rød ring = dér skulle det ramme)
      const real = patData.get(st.pattern); const fr0 = real && real.length ? real : FALLBACK_FRAME;
      drawIlda(g, W, H, fr0[Math.floor(pvFrame) % fr0.length], { scale: out.size * out.calScale, ang: out.ang, ox: (out.x - 0.5) * 2, oy: (out.y - 0.5) * 2, rgb: [255, 59, 92], alpha: 0.5, glow: 1, box: B });
    } else if ((special === 'cal' || special === 'center') && out.on) {
      const p = special === 'cal' ? calPt() : { x: 0, y: 0 }, col = special === 'cal' ? '#ff3b5c' : '#fff';
      // målet: det hjørne af LIVE-boksen punktet skal svare til
      if (special === 'cal') { const corner = [[B.x, B.y], [B.x + B.w, B.y], [B.x + B.w, B.y + B.h], [B.x, B.y + B.h]][calStep - 1]; g.save(); g.strokeStyle = '#ff3b5c'; g.fillStyle = 'rgba(255,59,92,.25)'; g.lineWidth = 2; g.beginPath(); g.arc(corner[0], corner[1], 14, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore(); }
      // selve krydset (hvor laseren rammer lige nu)
      if (!patAvail.has(cfg.dotPattern)) { rawLine(false, p.x, p.y, 1, col, maxEdge() % 2 === 0 ? 4 : 1.5); rawLine(true, p.x, p.y, 1, col, maxEdge() % 2 === 1 ? 4 : 1.5); }
      const [ax, ay] = rawToApp(p.x, p.y), [px, py] = boxPt(B, ax, ay);
      g.save(); g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 18; g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.restore();
      g.fillStyle = '#fff'; g.font = '700 14px -apple-system'; g.textAlign = 'center'; g.fillText(t(special === 'cal' ? 'pv.calP' + calStep : 'pv.centerTitle'), W / 2, B.y + 22);
      g.fillStyle = '#ff8a9c'; g.font = '12px -apple-system'; g.fillText(t(special === 'cal' ? 'pv.calLive' : 'pv.centerLive'), W / 2, B.y + 40);
    } else if ((special === 'calbox' || special === 'max') && out.on) {
      const edges = special === 'max' ? [[false, 0, 0.97, 1], [false, 0, -0.97, 1], [true, -0.97, 0, 1], [true, 0.97, 0, 1]] : [1, 2, 3, 4].map((k) => { const e = calGeomFor(k); return [e.vertical, e.x, e.y, e.len]; });
      const sgq = special === 'calbox' ? specialGeom() : null;
      if (sgq && sgq.quad) { // hele firkanten på én gang
        const p = cfg.calPts; const q = sgq.quad === cfg.quadPattern ? [p.TL, p.TR, p.BR, p.BL] : [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => ({ x: sgq.x + x * sgq.size, y: sgq.y + y * sgq.size }));
        g.save(); g.strokeStyle = '#ff3b5c'; g.shadowColor = '#ff3b5c'; g.shadowBlur = 14; g.lineWidth = 3; g.beginPath();
        q.forEach((pt, i) => { const [ax, ay] = rawToApp(pt.x, pt.y), [px, py] = boxPt(B, ax, ay); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }); g.closePath(); g.stroke(); g.restore();
      } else {
        edges.forEach((e, k) => rawLine(e[0], e[1], e[2], e[3], 'rgba(255,59,92,.35)', 2));
        const cur = special === 'max' ? maxEdge() : [0, 1, 3, 2][maxEdge()]; const e = edges[cur]; rawLine(e[0], e[1], e[2], e[3], '#ff3b5c', 4);
      }
      if (special === 'calbox') { const p = cfg.calPts; for (const k of CAL_KEYS) { const [ax, ay] = rawToApp(p[k].x, p[k].y), [px, py] = boxPt(B, ax, ay); g.fillStyle = '#ff3b5c'; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); } }
      g.fillStyle = '#ff8a9c'; g.font = '600 12px -apple-system'; g.textAlign = 'center'; g.fillText(t(special === 'max' ? 'pv.maxInfo' : 'pv.calBoxLive'), W / 2, B.y + 22);
    } else if (special && out.on) {
      const sg = specialGeom();
      const tp = patData.get(cfg.testPattern);
      if (!tp && patAvail.has(cfg.testPattern)) loadPat(cfg.testPattern);
      if (tp && tp.length) {
        // tegn det faktiske mønster klemt fladt – så LIVE viser det samme som laseren (inkl. evt. huller)
        const f = firstVisible(tp), n = f.n, xy = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { if (sg.vertical) { xy[i * 2] = 0; xy[i * 2 + 1] = f.xy[i * 2 + 1]; } else { xy[i * 2] = f.xy[i * 2]; xy[i * 2 + 1] = 0; } }
        drawIlda(g, W, H, { xy, col: f.col, bl: f.bl, n }, { scale: 1, rgb: sg.rgb, glow: 1.6, box: B, ox: sg.vertical ? sg.off : 0, oy: sg.vertical ? 0 : sg.off });
      } else {
        const [px, py] = boxPt(B, sg.vertical ? sg.off : 0, sg.vertical ? 0 : sg.off); const hl = B.upl;
        g.save(); g.lineCap = 'round'; const col = `rgb(${sg.rgb})`; g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 12; g.lineWidth = 2.5; g.beginPath();
        if (sg.vertical) { g.moveTo(px, py - hl); g.lineTo(px, py + hl); } else { g.moveTo(px - hl, py); g.lineTo(px + hl, py); }
        g.stroke(); g.restore();
      }
      g.fillStyle = '#9a9a95'; g.font = '11px -apple-system'; g.textAlign = 'center'; g.fillText(t('pv.lineInfo', { n: special === 'line' ? cfg.testPattern : cfg.linePattern }), W / 2, B.y + 20);
    } else if (!out.on) { g.fillStyle = '#ff3b5c'; g.font = '700 13px -apple-system'; g.textAlign = 'center'; g.fillText(t('pv.off'), W / 2, H / 2 + 4); }
    else if (st.pattern === 0) { g.fillStyle = '#5b6375'; g.font = '12px -apple-system'; g.textAlign = 'center'; g.fillText(t('pv.noPat'), W / 2, H / 2 + 4); }
    else {
      const strobeOff = st.strobe > 0 && Math.floor(now / (220 - st.strobe * 190)) % 2;
      let frame = fr[Math.floor(pvFrame) % fr.length], extra = {};
      if (autoMode === 'laser') { const k = Math.floor(now / 500); const alt = [...patAvail]; const n = alt.length ? alt[k % alt.length] : st.pattern; const f2 = patData.get(n); if (f2 && f2.length) frame = f2[Math.floor(pvFrame) % f2.length]; else if (!patData.has(n) && patAvail.has(n)) loadPat(n); }
      // LIVE-størrelse: med kamera-kalibrering tegnes mønsteret så stort som kameraet har målt det ved denne fader-værdi
      let drawScale = out.size * out.calScale;
      { const half = camPatHalfSent(out.laserSize); if (half != null) { const [ax1, ay1] = camAppToSend(0.02, 0, out.size), [ax0, ay0] = camAppToSend(-0.02, 0, out.size), [bx1, by1] = camAppToSend(0, 0.02, out.size), [bx0, by0] = camAppToSend(0, -0.02, out.size); const d = (Math.hypot(ax1 - ax0, ay1 - ay0) + Math.hypot(bx1 - bx0, by1 - by0)) / 2 / 0.04; const e = patExtent(st.pattern, out.ang); if (d > 1e-6) drawScale = (half / 1.08) / d / Math.max(0.05, Math.max(e.x, e.y)) * cfg.cal.sx; } }
      const zr = zoneRect(W, H); // laseren slukker alt på den anden side af zonen – det gør LIVE også
      if (zr) { g.save(); g.beginPath(); g.rect(0, 0, W, H); g.rect(zr[0], zr[1], zr[2], zr[3]); g.clip('evenodd'); }
      const d = decodedFrame();
      if (d && cfg.lim && cfg.lim.on) { // ÉN sandhedskilde: tegn det laseren fik besked på (decode af sidst sendte DMX-frame)
        if (!strobeOff && d.visible) {
          let fr2 = patData.get(d.pattern); if (!fr2 && patAvail.has(d.pattern)) loadPat(d.pattern); if (!fr2 || !fr2.length) fr2 = fr;
          const f2 = fr2[Math.floor(pvFrame) % fr2.length], dd2 = { ...d, rotDeg: Math.abs(d.rotSpeed) > 0.02 ? out.ang || 0 : d.rotDeg };
          const rgbD = d.color && d.color.mode === 'rgb' ? d.color.rgb : d.color && d.color.mode === 'white' ? [255, 255, 255] : out.rgb || (isFallback ? [235, 235, 235] : null);
          drawField(g, f2, dd2, profFor(lastMode), (fx, fy) => { const [px, py] = physFromRaw(fx, fy), [ax, ay] = sentToApp(px, py); return boxPt(B, ax, ay); }, { rgb: rgbD, alpha: Math.max(0.2, d.intensity), glow: 1.4, uniform: B.h / 2 });
        }
        if (d.tooSmall) { g.save(); g.strokeStyle = '#ff3b5c'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4); g.fillStyle = '#ff3b5c'; g.font = '700 12px -apple-system'; g.textAlign = 'center'; g.fillText(t('pv.tooSmall'), W / 2, 22); g.restore(); }
      } else {
        let BB = B, oxD = (out.x - 0.5) * 2, oyD = (out.y - 0.5) * 2;
        if (!strobeOff) drawIlda(g, W, H, frame, { ...mirrorOpts(st.pattern), scale: drawScale, ang: out.ang, ox: oxD, oy: oyD, rgb: out.rgb || (isFallback ? [235, 235, 235] : null), alpha: Math.max(0.2, out.intensity), glow: 1.4, box: BB, ...extra });
      }
      if (zr) g.restore();
      if (con.pos) { const [cx_, cy_] = boxPt(B, (out.x - 0.5) * 2, (out.y - 0.5) * 2); g.save(); g.strokeStyle = '#ffaa3c'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx_ - 14, cy_); g.lineTo(cx_ + 14, cy_); g.moveTo(cx_, cy_ - 14); g.lineTo(cx_, cy_ + 14); g.stroke(); g.restore(); }
      if (moveMode && !(cfg.lim && cfg.lim.on)) { // gamle rammer (kun uden Grænser/opsætning)
        const [cx, cy] = boxPt(B, (out.x - 0.5) * 2, (out.y - 0.5) * 2), R = B.upl * drawScale; g.strokeStyle = 'rgba(49,243,172,.5)'; g.setLineDash([4, 4]); g.lineWidth = 1; g.strokeRect(cx - R, cy - R, R * 2, R * 2); g.setLineDash([]);
        // område hvor mønsterets MIDTE kan stå ved denne størrelse (laseren ganger positionen med størrelsen)
        if (out.reach) {
          const back = (rx, ry) => (cfg.camMap ? hApply(cfg.camMap.Hi, rx, ry) : rawToApp(rx, ry)); const [a1, b1] = back(-out.reach.x, out.reach.y), [a2, b2] = back(out.reach.x, -out.reach.y);
          const [p1x, p1y] = boxPt(B, a1, b1), [p2x, p2y] = boxPt(B, a2, b2);
          g.save(); g.strokeStyle = out.clamped ? 'rgba(255,170,60,.75)' : 'rgba(255,170,60,.35)'; g.setLineDash([6, 5]); g.lineWidth = 1.5; g.strokeRect(p1x, p1y, p2x - p1x, p2y - p1y); g.setLineDash([]);
          g.fillStyle = out.clamped ? 'rgba(255,170,60,.95)' : 'rgba(255,170,60,.6)'; g.font = '600 11px -apple-system'; g.textAlign = 'center';
          g.fillText(t(out.clamped ? 'pv.reachHit' : 'pv.reach'), (p1x + p2x) / 2, Math.max(B.y + 14, Math.min(p1y - 6, B.y + B.h - 6)));
          g.restore();
        }
      }
      if (isFallback) { g.fillStyle = '#5b5b57'; g.font = '11px -apple-system'; g.textAlign = 'center'; g.fillText(t(patAvail.size ? 'pv.missing' : 'pv.load', { n: st.pattern }), W / 2, B.y + 20); }
    }
    drawZone(g, W, H);
    if (autoMode === 'laser') {
      g.font = '600 11px -apple-system'; const txt = t('pv.laserMic'); const tw = g.measureText(txt).width;
      g.fillStyle = 'rgba(49,243,172,0.12)'; g.fillRect((W - tw) / 2 - 10, 40, tw + 20, 22);
      g.fillStyle = '#31f3ac'; g.textAlign = 'left'; g.fillText(txt, (W - tw) / 2, 55);
    }
    if (!cfg.calibDone && out.on && !special) { g.fillStyle = '#ffb02e'; g.font = '600 12px -apple-system'; g.textAlign = 'center'; g.fillText(t('pv.needCal'), W / 2, H - 28); }
    $('#pvInfo').textContent = `${t('pv.power', { n: Math.round(out.intensity * 100) })} · ${st.pattern ? '#' + st.pattern : t('pat.offName')}${patNames[st.pattern] ? ' · ' + patNames[st.pattern] : ''} · ${MOVE_DA[st.move]} · ${Math.round(st.size * 100)}% · ${Math.round(fpsFrac(st.fps) * 100)} fps`;
  }
  requestAnimationFrame(previewTick);
}

function setPattern(n, keepLook = false) {
  st.pattern = n; activeScene = -1;
  if (!keepLook) { Object.assign(st, { move: 'none', rotSpeed: 0, rotAngle: 0, pulse: 0, strobe: 0 }); rotAcc = 0; syncLookUI(); } // nyt mønster = stille – bevægelse vælges aktivt under Bevægelse
  saveLook();
  $$('.pat').forEach((p) => p.classList.toggle('active', +p.dataset.n === n));
  renderScenes();
}
// ---------- mønster-indstillinger (højreklik): navn, favorit, vend, spejl, tast, slet ----------
let ppN = 0;
function openPatPop(n, anchor) {
  ppN = n; const pop = $('#patPop'); pop.hidden = false;
  $('#ppTitle').textContent = t('pat.name', { n }); $('#ppSub').textContent = patAvail.has(n) ? t('pp.onCard') : t('pp.notLoaded');
  $('#ppName').value = patNames[n] || '';
  $('#ppFav').classList.toggle('on', favs.has(n)); $('#ppFlip').classList.toggle('on', patFlip.has(n)); $('#ppMirror').classList.toggle('on', !!(patMirror[n] && patMirror[n].y)); $('#ppMirrorX').classList.toggle('on', !!(patMirror[n] && patMirror[n].x));
  $('#ppMirror').disabled = !patAvail.has(n); $('#ppMirrorX').disabled = !patAvail.has(n); $('#ppDelete').disabled = !patAvail.has(n); $('#ppQuad').disabled = !patAvail.has(n); $('#ppQuad').classList.toggle('on', !!mirrorSlots[n]);
  const key = Object.keys(keymap).find((k) => keymap[k] === n); $('#ppKey').value = key ? key.toUpperCase() : '';
  $('#ppLine').classList.toggle('on', cfg.linePattern === n);
  const cv = $('#ppThumb'); const [g, W, H] = sizeCanvas(cv); g.clearRect(0, 0, W, H); const fr = patData.get(n); if (fr && fr.length) drawIlda(g, W, H, firstVisible(fr), { glow: 1.1, ...mirrorOpts(n) });
  // placér ved siden af flisen, inden for vinduet
  const r = anchor.getBoundingClientRect(); const pw = 300, ph = 330;
  let x = r.right + 10, y = r.top; if (x + pw > innerWidth - 8) x = r.left - pw - 10; if (x < 8) x = 8; if (y + ph > innerHeight - 8) y = innerHeight - ph - 8;
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px';
  setTimeout(() => $('#ppName').focus(), 20);
}
function closePatPop() { $('#patPop').hidden = true; }
$('#ppClose').onclick = closePatPop;
document.addEventListener('pointerdown', (e) => { if (!$('#patPop').hidden && !e.target.closest('#patPop') && !e.target.closest('.pat')) closePatPop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#patPop').hidden) { closePatPop(); e.stopPropagation(); } }, true);
$('#ppName').addEventListener('input', (e) => { const v = e.target.value.trim(); if (v) patNames[ppN] = v; else delete patNames[ppN]; store.set('patNames', patNames); renderPatterns(); });
$('#ppFav').onclick = () => { favs.has(ppN) ? favs.delete(ppN) : favs.add(ppN); store.set('favs', [...favs]); $('#ppFav').classList.toggle('on', favs.has(ppN)); renderPatterns(); };
$('#ppFlip').onclick = () => { patFlip.has(ppN) ? patFlip.delete(ppN) : patFlip.add(ppN); store.set('patFlip', [...patFlip]); $('#ppFlip').classList.toggle('on', patFlip.has(ppN)); renderPatterns(); renderKeyboard(); openPatPop(ppN, $(`.pat[data-n="${ppN}"]`) || document.body); };
$('#ppMirror').onclick = () => mirrorPatternFile(ppN, 'y');
$('#ppMirrorX').onclick = () => mirrorPatternFile(ppN, 'x');
$('#ppQuad').onclick = () => makeMirrorCopies(ppN);
$('#ppKey').addEventListener('input', (e) => { const k = e.target.value.trim().toLowerCase(); for (const kk of Object.keys(keymap)) if (keymap[kk] === ppN) delete keymap[kk]; if (k) keymap[k] = ppN; store.set('keymap', keymap); renderKeyboard(); e.target.value = k.toUpperCase(); });
$('#ppLine').onclick = () => { cfg.linePattern = ppN; $('#linePattern').value = ppN; saveCfg(); $('#ppLine').classList.add('on'); };
$('#ppShow').onclick = () => { setPattern(ppN); closePatPop(); };
$('#ppDelete').onclick = async () => { const ok = await modal(t('pat.deleteConfirm', { n: ppN }), null); if (ok === null) return; await window.laser.patDelete(ppN); patAvail.delete(ppN); patData.delete(ppN); favs.delete(ppN); store.set('favs', [...favs]); closePatPop(); renderPatterns(); renderKeyboard(); };
async function editPattern(n, anchor) { openPatPop(n, anchor || $(`.pat[data-n="${n}"]`) || document.body); }
async function editPatternOld(n) {
  const r = await modal(t('pat.name', { n }), patNames[n] || '', t(favs.has(n) ? 'pat.unfav' : 'pat.fav'), t(patFlip.has(n) ? 'pat.unflip' : 'pat.flip'), patAvail.has(n) ? t('pat.delete') : null, patAvail.has(n) ? t('pat.mirror') : null);
  if (r === null) return;
  if (r === '__extra4') { await mirrorPatternFile(n); return; }
  if (r === '__extra3') {
    const ok = await modal(t('pat.deleteConfirm', { n }), null);
    if (ok === null) return;
    await window.laser.patDelete(n); patAvail.delete(n); patData.delete(n); favs.delete(n); store.set('favs', [...favs]);
    renderPatterns(); renderKeyboard(); return;
  }
  if (r === '__extra2') { patFlip.has(n) ? patFlip.delete(n) : patFlip.add(n); store.set('patFlip', [...patFlip]); renderPatterns(); return; }
  if (r === '__extra') { favs.has(n) ? favs.delete(n) : favs.add(n); store.set('favs', [...favs]); }
  else { if (r.trim()) patNames[n] = r.trim(); else delete patNames[n]; store.set('patNames', patNames); }
  renderPatterns();
}

// ---------- farver ----------
function renderSwatches() {
  const w = $('#swatches'); w.innerHTML = '';
  SWATCHES.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'sw' + (s.mode === 'orig' ? ' orig' : '');
    b.title = s.name;
    if (s.mode === 'orig') b.textContent = s.name;
    else b.style.background = `rgb(${s.rgb.join(',')})`;
    b.onclick = () => { setColor(s.mode === 'orig' ? { mode: 'orig', rgb: st.color.rgb } : { mode: 'rgb', rgb: s.rgb.slice() }); recordHook(s.name); };
    w.appendChild(b);
  });
  markSwatch();
}
function setColor(c) { st.color = c; st.colorCycle = false; $('#colorCycle').checked = false; activeScene = -1; saveLook(); markSwatch(); renderScenes(); }
function markSwatch() {
  $$('#swatches .sw').forEach((b, i) => {
    const s = SWATCHES[i];
    const on = !st.colorCycle && (s.mode === 'orig' ? st.color.mode === 'orig' : st.color.mode === 'rgb' && s.rgb.join() === st.color.rgb.join());
    b.classList.toggle('active', on);
  });
}
$('#customColor').oninput = (e) => {
  const h = e.target.value; setColor({ mode: 'rgb', rgb: [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)) });
};
$('#colorCycle').onchange = (e) => { st.colorCycle = e.target.checked; saveLook(); markSwatch(); recordHook(t('show.colorCycle')); };

// ---------- sliders ----------
const SL = {
  moveAmt: { k: 'moveAmt', f: (v) => v / 100, b: (s) => s * 100, o: (v) => v + '%' },
  moveSpeed: { k: 'moveSpeed', f: (v) => v / 100, b: (s) => s * 100, o: (v) => v + '%' },
  size: { k: 'size', f: (v) => v / 100, b: (s) => s * 100, o: (v) => v + '%' },
  rotSpeed: { k: 'rotSpeed', f: (v) => v / 100, b: (s) => s * 100, o: (v) => (v == 0 ? t('v.stop') : v > 0 ? '↻' + v : '↺' + -v) },
  rotAngle: { k: 'rotAngle', f: (v) => +v, b: (s) => s, o: (v) => v + '°' },
  pulse: { k: 'pulse', f: (v) => v / 100, b: (s) => s * 100, o: (v) => v + '%' },
  strobe: { k: 'strobe', f: (v) => v / 100, b: (s) => s * 100, o: (v) => (v == 0 ? t('v.off') : v + '%') },
  fps: { k: 'fps', f: (v) => v / 100, b: (s) => s * 100, o: (v) => Math.round(v <= 50 ? v : 50 + (v - 50)) + '' },
  colorCycleSpeed: { k: 'colorCycleSpeed', f: (v) => v / 100, b: (s) => s * 100 },
};
for (const id in SL) {
  const el = $('#' + id), d = SL[id];
  const out = el.parentElement.querySelector('output');
  el.addEventListener('input', () => { st[d.k] = d.f(+el.value); if (out && d.o) out.textContent = d.o(+el.value); activeScene = -1; saveLook(); });
  // dobbeltklik nulstiller
  el.addEventListener('dblclick', () => { st[d.k] = DEFAULT_LOOK[d.k]; syncLookUI(); saveLook(); });
}
SL.fps.o = (v) => { const x = v * 2.55; return Math.round(x <= 128 ? (x / 128) * 50 : 50 + ((x - 128) / 127) * 50) + ' fps'; };

$$('#moveSeg button').forEach((b) => b.onclick = () => { st.move = b.dataset.move; activeScene = -1; saveLook(); syncLookUI(); recordHook(MOVE_DA[st.move]); });
// ---------- værdi-bjælker (erstatter de almindelige skydere i Bevægelse) ----------
(() => {
  const bars = $$('.vb');
  window.selectVb = (vb) => { selVb = vb; bars.forEach((b) => b.classList.toggle('sel', b === vb)); };
  const upd = () => { for (const vb of bars) { const inp = vb.querySelector('input'), mn = +inp.min, mx = +inp.max, v = +inp.value, f = (v - mn) / (mx - mn); const fill = vb.querySelector('.vb-fill'), knob = vb.querySelector('.vb-knob'); if (mn < 0) { const z = -mn / (mx - mn); fill.style.left = Math.min(z, f) * 100 + '%'; fill.style.width = Math.abs(f - z) * 100 + '%'; } else { fill.style.left = 0; fill.style.width = f * 100 + '%'; } knob.style.left = f * 100 + '%'; const d = SL[inp.id]; vb.querySelector('.vb-v').textContent = d && d.o ? d.o(v) : v; vb.classList.toggle('zero', v === +vb.dataset.def); } requestAnimationFrame(upd); };
  for (const vb of bars) {
    const inp = vb.querySelector('input'), bar = vb.querySelector('.vb-bar');
    if (!vb.querySelector('.vb-p')) { // trin-knapper + klikbart navn (piletaster)
      const m = document.createElement('button'); m.className = 'vb-m ghost small'; m.textContent = '−'; const pl = document.createElement('button'); pl.className = 'vb-p ghost small'; pl.textContent = '+';
      const stepv = (d) => { const stp = (+inp.max - +inp.min) >= 200 ? 5 : 1; inp.value = clamp(+inp.value + d * stp, +inp.min, +inp.max); inp.dispatchEvent(new Event('input')); selectVb(vb); };
      m.onclick = () => stepv(-1); pl.onclick = () => stepv(1); vb.insertBefore(m, bar); vb.insertBefore(pl, bar);
      vb.querySelector('.vb-l').onclick = () => selectVb(vb === selVb ? null : vb);
    }
    const setFrom = (clientX) => { const r = bar.getBoundingClientRect(); const f = clamp((clientX - r.left) / r.width, 0, 1); inp.value = Math.round(+inp.min + f * (+inp.max - +inp.min)); inp.dispatchEvent(new Event('input')); };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); vb.classList.add('drag'); setFrom(e.clientX); });
    bar.addEventListener('pointermove', (e) => { if (bar.hasPointerCapture(e.pointerId)) setFrom(e.clientX); });
    const end = () => vb.classList.remove('drag'); bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    bar.addEventListener('dblclick', () => { inp.value = vb.dataset.def; inp.dispatchEvent(new Event('input')); });
    vb.addEventListener('wheel', (e) => { e.preventDefault(); const step = (+inp.max - +inp.min) / 50; inp.value = clamp(+inp.value - Math.sign(e.deltaY) * step, +inp.min, +inp.max); inp.dispatchEvent(new Event('input')); }, { passive: false });
  }
  upd();
})();
$$('[data-step]').forEach((b) => (b.onclick = () => { const [k, d] = b.dataset.step.split(':'); const el = $('#' + k); el.value = clamp(+el.value + +d, +el.min, +el.max); el.dispatchEvent(new Event('input')); }));
$$('#moveQuick button').forEach((b) => (b.onclick = () => { const q = b.dataset.q; Object.assign(st, q === 'small' ? { moveAmt: 0.2, moveSpeed: 0.15 } : q === 'mid' ? { moveAmt: 0.45, moveSpeed: 0.35 } : { moveAmt: 0.8, moveSpeed: 0.6 }); if (st.move === 'none') st.move = 'circle'; saveLook(); syncLookUI(); }));
$('#resetLook').onclick = () => {
  Object.assign(st, { move: 'none', moveAmt: DEFAULT_LOOK.moveAmt, moveSpeed: DEFAULT_LOOK.moveSpeed, rotSpeed: 0, rotAngle: 0, pulse: 0, strobe: 0, fps: 0.5, size: DEFAULT_LOOK.size });
  rotAcc = 0; saveLook(); syncLookUI();
};

function syncLookUI() {
  for (const id in SL) {
    const el = $('#' + id), d = SL[id];
    el.value = d.b(st[d.k]);
    const out = el.parentElement.querySelector('output');
    if (out && d.o) out.textContent = d.o(+el.value);
  }
  $$('#moveSeg button').forEach((b) => b.classList.toggle('active', b.dataset.move === st.move));
  $('#colorCycle').checked = st.colorCycle;
  syncSizeUI();
  $$('.pat').forEach((p) => p.classList.toggle('active', +p.dataset.n === st.pattern));
  markSwatch();
}

// ---------- master / blackout ----------
// Lys = hvor kraftig laseren er lige nu. Effekt-loftet (Indstillinger) kan aldrig overskrides.
if (cfg.startLow && master > 0.25) master = 0.25;
function setMaster(v) {
  master = clamp(v, 0, 1); store.set('master', master);
  $('#master').value = Math.round(master * 100);
  updatePowerUI();
}
function dangerColor(d) { // grøn → gul → rød
  const a = [49, 243, 172], b = [255, 176, 46], c = [255, 59, 92];
  const m = d < 0.5 ? a.map((v, i) => v + (b[i] - v) * d * 2) : b.map((v, i) => v + (c[i] - v) * (d - 0.5) * 2);
  return `rgb(${m.map(Math.round)})`;
}
function updatePowerUI() {
  const eff = Math.round(master * cfg.maxInt * 100);
  const capped = cfg.maxInt < 1;
  $('#masterVal').textContent = eff + '%';
  $('#masterVal').title = capped ? t('top.capTip', { n: Math.round(cfg.maxInt * 100) }) : '';
  $('#masterVal').classList.toggle('hot', eff > 60);
  $('#masterVal').classList.toggle('capped', capped);
  // lodret fader
  const pct = master * 100;
  $('#fFill').style.height = pct + '%';
  $('#fKnob').style.bottom = pct + '%';
  // fare for øjnene: fylder gradvist mere rødt jo kraftigere lyset er
  const d = clamp((eff - 20) / 50, 0, 1), col = dangerColor(d);
  $('#fFill').style.background = `linear-gradient(to top, var(--accent2), ${col})`;
  $('#fFill').style.boxShadow = `0 0 ${14 + d * 16}px ${col.replace('rgb', 'rgba').replace(')', `,${0.3 + d * 0.5})`)}`;
  $('#fader').classList.toggle('danger', eff > 35); $('#fader').classList.toggle('danger2', eff > 60);
  $('#faderVal').textContent = eff + '%';
  $('#faderVal').style.color = eff > 35 ? col : '';
  $('#fader').setAttribute('aria-valuenow', Math.round(pct));
  $('#fCap').hidden = !capped;
  const danger = 0.35 / Math.max(cfg.maxInt, 0.05); $('#fDanger').style.height = Math.max(0, (1 - Math.min(danger, 1)) * 100) + '%'; $('#fDanger').hidden = danger >= 1;
  $('#fCap').dataset.label = t('fader.cap', { n: Math.round(cfg.maxInt * 100) });
}
// fader: træk, scroll eller piletaster
(() => {
  const f = $('#fader'), track = f.querySelector('.f-track');
  const fromY = (y) => { const r = track.getBoundingClientRect(); return 1 - (y - r.top) / r.height; };
  f.addEventListener('pointerdown', (e) => { f.setPointerCapture(e.pointerId); f.classList.add('drag'); setMaster(fromY(e.clientY)); f.focus(); });
  f.addEventListener('pointermove', (e) => { if (f.hasPointerCapture(e.pointerId)) setMaster(fromY(e.clientY)); });
  f.addEventListener('pointerup', (e) => { f.releasePointerCapture(e.pointerId); f.classList.remove('drag'); });
  f.addEventListener('wheel', (e) => { e.preventDefault(); setMaster(master - Math.sign(e.deltaY) * 0.02); }, { passive: false });
  f.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setMaster(master + step); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setMaster(master - step); }
  });
})();
$('#master').oninput = (e) => setMaster(e.target.value / 100);
setMaster(master);
function setBlackout(v) { blackout = v; const b = $('#blackout'); b.classList.toggle('on', v); b.classList.toggle('armed', !v); b.textContent = t(v ? 'top.blackoutOn' : 'top.blackout'); }
function requestArm() {
  if (!blackout) { setBlackout(true); return; }   // sluk kræver ingen bekræftelse
  $('#armCheck').checked = false; $('#armGo').disabled = true; $('#armModal').hidden = false;
  // ny opstilling: området skal kalibreres, før der kan skydes andet ud
  const needCal = !cfg.calibDone;
  $('#armCal').hidden = !needCal; $('#armChkRow').hidden = needCal; $('#armGo').hidden = needCal;
}
$('#armCalGo').onclick = () => {
  $('#armModal').hidden = true;
  setPattern(0); setBlackout(false);               // laseren tændes, men viser kun kalibreringspunktet
  $('#pvCal').hidden = false; $('#pvCalBtn').classList.add('on'); calGoto(1);
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === 'live')); $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-live'));
};
$('#armCheck').onchange = (e) => { $('#armGo').disabled = !e.target.checked; };
$('#armGo').onclick = () => { if (!$('#armCheck').checked) return; $('#armModal').hidden = true; setBlackout(false); };
$('#armCancel').onclick = () => { $('#armModal').hidden = true; };
$('#blackout').onclick = requestArm;

// ---------- scener ----------
let storing = false;
$('#storeMode').onclick = () => { storing = !storing; $('#storeMode').classList.toggle('on', storing); $('.scenes').classList.toggle('storing', storing); $('#sceneHint').textContent = t(storing ? 'scene.storeHint' : 'scene.hint'); };
function snapshot() { const s = structuredClone(st); return s; }
function lookColorCss(l) { return l.colorCycle ? 'linear-gradient(90deg,red,yellow,lime,cyan,blue,magenta)' : l.color.mode === 'orig' ? 'linear-gradient(90deg,red,lime,blue)' : `rgb(${l.color.rgb.join(',')})`; }
function renderScenes() {
  const w = $('#scenes'); w.innerHTML = '';
  scenes.forEach((sc, i) => {
    const d = document.createElement('div');
    d.className = 'scene' + (sc ? ' filled' : '') + (i === activeScene ? ' active' : '');
    d.textContent = sc ? sc.name : `${i + 1}`;
    if (sc) { const bar = document.createElement('i'); bar.className = 'bar'; bar.style.background = lookColorCss(sc.look); d.appendChild(bar); }
    d.onclick = async () => {
      if (storing) {
        const name = await modal(t('scene.save'), sc ? sc.name : t('scene.n', { n: i + 1 }));
        if (name === null) return;
        scenes[i] = { name: name.trim() || t('scene.n', { n: i + 1 }), look: snapshot() };
        store.set('scenes', scenes); activeScene = i; $('#storeMode').click(); renderScenes();
      } else if (sc) { recallScene(i); recordHook(sc.name); }
    };
    d.oncontextmenu = async (e) => {
      e.preventDefault(); if (!sc) return;
      const r = await modal(t('scene.rename'), sc.name, t('scene.delete'));
      if (r === null) return;
      if (r === '__extra') scenes[i] = null; else sc.name = r.trim() || sc.name;
      store.set('scenes', scenes); renderScenes();
    };
    w.appendChild(d);
  });
}
function applyLook(l) {
  Object.assign(st, structuredClone(l)); saveLook();
  const want = Math.floor((st.pattern - 1) / PAGE);
  if (typeof patPage === 'number' && patPage !== -1 && want !== patPage && st.pattern <= cfg.patCount) { patPage = want; renderPatPages(); renderPatterns(); }
  syncLookUI();
}
function recallScene(i) { applyLook(scenes[i].look); activeScene = i; renderScenes(); }

// ---------- musik / beat ----------
let autoMode = 'off', bpm = store.get('bpm', 120), nextBeat = 0, beatCount = 0, lastAutoPreset = -1;
const sens = () => +$('#sens').value / 100;
$('#sens').value = store.get('sens', 55);
$('#sens').addEventListener('input', () => { store.set('sens', +$('#sens').value); $('#sens').parentElement.querySelector('output').textContent = $('#sens').value + '%'; });
$('#sens').parentElement.querySelector('output').textContent = $('#sens').value + '%';
$$('#autoSeg button').forEach((b) => b.onclick = () => setAuto(b.dataset.auto));
async function setAuto(m) {
  if (m === 'laser' && cfg.dmxMode === 'pro') {
    const r = await modal(t('auto.laserNeedsDj'), null);
    if (r === null) { m = autoMode; } else { cfg.dmxMode = 'dj'; $('#dmxMode').value = 'dj'; saveCfg(); }
  }
  if (m === 'mic' && !(await startMic())) { m = 'off'; }
  if (m === 'off' && autoMode !== 'off') { setPattern(0); }      // musik fra → laseren viser intet, klar til nyt
  autoMode = m;
  if (m !== 'mic' && !micTesting) stopMic();
  $$('#autoSeg button').forEach((b) => b.classList.toggle('active', b.dataset.auto === m));
  $('#autoSeg').closest('.panel').classList.toggle('laser-mic', m === 'laser');
  $('#autoSeg').closest('.panel').classList.toggle('auto-on', m === 'mic');
  $('#autoMsg').textContent = t(m === 'off' ? 'auto.msgOff' : m === 'mic' ? 'auto.msgMic' : 'auto.msgLaser');
}
function tickBeatClock() {}
function onBeat() { pulseEnv = 1; flashBeat(); }
function pick(arr, not) { const a = arr.filter((x) => x !== not); return a.length ? a[Math.floor(Math.random() * a.length)] : arr[0]; }
// reason: 'kick' (bas-slag), 'snare' (lille variation), 'drop' (stort skift)
function autoChange(reason = 'kick') {
  if (showPlaying && !$('#record').checked) return; // et kørende show bestemmer selv
  const filled = scenes.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const pool = favs.size ? [...favs] : patAvail.size ? [...patAvail] : Array.from({ length: cfg.patCount }, (_, i) => i + 1);
  const parts = [];
  if (reason === 'snare') {
    // lille variation: farve eller rotation, ikke nyt mønster
    if (!st.colorCycle) { music.hue = (music.hue + 0.13 + Math.random() * 0.2) % 1; st.color = { mode: 'rgb', rgb: hsv(music.hue, 1, 1) }; }
    if (Math.random() < 0.5) st.rotSpeed = (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.4);
    saveLook(); syncLookUI(); return;
  }
  // Auto aktiverer færdige ting: dine scener og presets (hele looks), ikke løse indstillinger
  const wild = music.energy > 0.6 || reason === 'drop';
  const presetIdx = PRESETS.map((p, i) => i).filter((i) => { const l = PRESETS[i].l; const w = (l.move && l.move !== 'none') || Math.abs(l.rotSpeed || 0) > 0.3 || l.strobe || l.colorCycle; return wild ? w : !l.strobe; });
  const useScene = filled.length && Math.random() < (filled.length >= 3 ? 0.5 : 0.25);
  if (useScene) { const i = pick(filled, activeScene); recallScene(i); parts.push(scenes[i].name); }
  else {
    const i = pick(presetIdx.length ? presetIdx : PRESETS.map((_, k) => k), lastAutoPreset); lastAutoPreset = i;
    const p = PRESETS[i]; Object.assign(st, structuredClone(PRESET_BASE), structuredClone(p.l));
    // mønster: presettets eget, men byt til en favorit/indlæst hvis presettets ikke findes på kortet
    st.pattern = patAvail.size && !patAvail.has(p.pat) ? pick(pool, st.pattern) : p.pat;
    if (reason === 'drop') { st.strobe = Math.max(st.strobe, 0.3); st.size = 1; st.pulse = Math.max(st.pulse, 0.7); }
    parts.push(presetName(p, i));
    activeScene = -1;
  }
  st.posX = 0; st.posY = 0; st.freeze = false;
  saveLook(); syncLookUI(); renderScenes();
  if (parts.length) recordHook((reason === 'drop' ? '⚡ ' : '') + parts.join(' · '));
}

function tap() { onBeat(); }

// ---------- musik-motor: lytter i tre bånd og reagerer med det samme ----------
// bas (kick) · mellem (snare/vokal) · diskant (hi-hat). Hvert bånd sammenlignes med sit eget gennemsnit,
// så den selv finder slagene uanset lydstyrke. Energi-niveauet bestemmer, hvor "vild" laseren er.
let ac, analyser, micStream, micTimer, levelSmooth = -90, micTesting = false, lastBeatT = 0, intervals = [];
const music = {
  bass: 0, mid: 0, hi: 0,            // øjebliks-energi 0..1 (hurtigt henfald) – bruges af laser-motoren
  energy: 0,                          // langsomt niveau 0..1 (hvor meget sker der)
  silent: true, breakdown: false, lastDrop: 0, lastKick: 0, lastSnare: 0, lastHat: 0,
  kickCount: 0, hue: Math.random(),
};
const AVG_N = 120; // ~0,7 s historik ved 6 ms
const band = (lo, hi) => ({ lo, hi, hist: [], avg: 0, var: 0, last: 0 });
let bands = null;
function bandEnergy(buf, bd, hz) {
  const i0 = Math.max(1, Math.round(bd.lo / hz)), i1 = Math.max(i0 + 1, Math.round(bd.hi / hz));
  let e = 0; for (let i = i0; i <= i1; i++) e += (buf[i] / 255) ** 2; return e / (i1 - i0 + 1);
}
function detect(bd, e) {
  bd.hist.push(e); if (bd.hist.length > AVG_N) bd.hist.shift();
  let m = 0; for (const v of bd.hist) m += v; m /= bd.hist.length;
  let v = 0; for (const x of bd.hist) v += (x - m) ** 2; v /= bd.hist.length;
  bd.avg = m; bd.var = v;
  // klassisk onset: energi klart over gennemsnittet, og stigende (ikke bare et højt plateau)
  const c = -0.0025714 * v * 1e4 + 1.5142857;            // tilpasser sig dynamikken i musikken
  const thr = Math.max(1.15, Math.min(c, 1.9)) * m;
  const rising = e > bd.last * 1.08;
  bd.last = e;
  return e > thr && e > 0.004 && rising;
}
function musicTick(now) {
  const buf = micBuf, hz = ac.sampleRate / analyser.fftSize;
  analyser.getByteFrequencyData(buf);
  const eB = bandEnergy(buf, bands.bass, hz), eM = bandEnergy(buf, bands.mid, hz), eH = bandEnergy(buf, bands.hi, hz);
  const kick = detect(bands.bass, eB), snare = detect(bands.mid, eM), hat = detect(bands.hi, eH);
  const sensF = 0.7 + sens() * 0.6;
  // øjebliks-energi med hurtigt henfald (bruges til puls/rotation/flimmer i laser-motoren)
  music.bass = Math.max(music.bass * 0.86, clamp((eB / (bands.bass.avg + 0.002)) * 0.5 * sensF, 0, 1));
  music.mid = Math.max(music.mid * 0.85, clamp((eM / (bands.mid.avg + 0.002)) * 0.5 * sensF, 0, 1));
  music.hi = Math.max(music.hi * 0.8, clamp((eH / (bands.hi.avg + 0.001)) * 0.5 * sensF, 0, 1));
  // samlet lydniveau
  analyser.getFloatTimeDomainData(micTbuf);
  let rms = 0; for (let i = 0; i < micTbuf.length; i += 2) rms += micTbuf[i] * micTbuf[i]; rms = Math.sqrt(rms / (micTbuf.length / 2));
  const db = 20 * Math.log10(rms + 1e-9);
  levelSmooth = Math.max(db, levelSmooth - 1.5);
  const loud = clamp((db + 55) / 45, 0, 1);
  music.energy = music.energy * 0.97 + loud * 0.03;
  music.silent = levelSmooth < -50;
  // breakdown = der har ikke været bas i >1,5 s, men der er stadig lyd
  const wasBreak = music.breakdown;
  music.breakdown = !music.silent && now - music.lastKick > 1500;
  // UI
  $('#level').style.width = clamp((levelSmooth + 60) / 60, 0, 1) * 100 + '%';
  $('#level').classList.toggle('loud', loud > 0.85);
  $('#levelDb').textContent = levelSmooth < -59 ? '—' : Math.round(levelSmooth) + ' dB';
  $('#bandB').style.height = music.bass * 100 + '%'; $('#bandM').style.height = music.mid * 100 + '%'; $('#bandH').style.height = music.hi * 100 + '%';
  if (!kick && !snare && !hat) return;
  const active = autoMode === 'mic' && !(showPlaying && !$('#record').checked);
  if (kick && now - music.lastKick > 140) {
    const gap = now - music.lastKick; music.lastKick = now; music.kickCount++;
    if (gap > 250 && gap < 1500) { intervals.push(gap); if (intervals.length > 8) intervals.shift(); }
    if (intervals.length >= 3) { const so = [...intervals].sort((a, b) => a - b); bpm = 60000 / so[so.length >> 1]; }
    pulseEnv = 1; flashBeat();
    if (active) {
      sendNow();
      if (wasBreak) onDrop(now);                                  // bassen er tilbage efter en pause → DROP
      else if (music.kickCount % pickEvery() === 0) autoChange('kick');
    }
  }
  if (snare && now - music.lastSnare > 160) { music.lastSnare = now; if (active && !wasBreak && Math.random() < 0.35) autoChange('snare'); }
  if (hat && now - music.lastHat > 90) { music.lastHat = now; hatKick = 1; }
}
// hvor ofte skifter vi mønster på kick? afhænger af energien: vildt = hvert 2. slag, roligt = hvert 8.
function pickEvery() { return music.energy > 0.75 ? 2 : music.energy > 0.45 ? 4 : 8; }
function onDrop(now) {
  if (now - music.lastDrop < 2000) return;
  music.lastDrop = now; dropEnv = 1;
  autoChange('drop');
  flashBeat(true);
}
function flashBeat(big) { const led = $('#beatLed'); led.classList.add(big ? 'drop' : 'hit'); setTimeout(() => led.classList.remove('hit', 'drop'), big ? 300 : 80); }

let micBuf, micTbuf;
async function startMic() {
  if (micStream) return true;
  try {
    await window.laser.micAccess();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } });
  } catch (e) {
    await modal(t('auto.micDenied'), null);
    return false;
  }
  ac = new AudioContext({ latencyHint: 'interactive' });
  analyser = ac.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0; // 512 → ~11 ms vindue
  ac.createMediaStreamSource(micStream).connect(analyser);
  micBuf = new Uint8Array(analyser.frequencyBinCount); micTbuf = new Float32Array(analyser.fftSize);
  bands = { bass: band(40, 130), mid: band(200, 1200), hi: band(5000, 12000) };
  music.lastKick = performance.now();
  micTimer = setInterval(() => musicTick(performance.now()), 6);
  return true;
}
function stopMic() {
  clearInterval(micTimer); micTimer = null;
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null; if (ac) ac.close(); ac = null; $('#level').style.width = '0'; $('#levelDb').textContent = '—';
  music.bass = music.mid = music.hi = 0; music.energy = 0;
  ['#bandB', '#bandM', '#bandH'].forEach((id) => ($(id).style.height = '0'));
}
function updateMicTestBtn() { $('#micTest').textContent = t(micTesting ? 'auto.micTestOn' : 'auto.micTest'); $('#micTest').classList.toggle('on', micTesting); }
$('#micTest').onclick = async () => {
  if (micTesting) { micTesting = false; if (autoMode !== 'mic') stopMic(); }
  else if (await startMic()) micTesting = true;
  updateMicTestBtn();
};

// ---------- SHOW ----------
let show = { name: t('show.defaultName'), audioPath: null, cues: [] };
const audio = new Audio();
let showPlaying = false, appliedIdx = -1, peaks = null, audioUrl = null, decoded = null;

async function loadAudio(p) {
  const buf = await window.laser.readAudio(p);
  if (!buf) { $('#audioName').textContent = t('show.notFound'); return false; }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(new Blob([buf]));
  audio.src = audioUrl;
  show.audioPath = p;
  $('#audioName').textContent = p.split('/').pop();
  peaks = null;
  try {
    const ctx = new AudioContext();
    const ab = await ctx.decodeAudioData(buf.slice(0)); decoded = ab;
    const ch = ab.getChannelData(0), N = 1600, step = Math.floor(ch.length / N) || 1;
    peaks = new Float32Array(N);
    for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step && j < ch.length; j += 4) m = Math.max(m, Math.abs(ch[j])); peaks[i] = m; }
    ctx.close();
  } catch (_) {}
  return true;
}
$('#pickAudio').onclick = async () => { const p = await window.laser.pickAudio(); if (p) loadAudio(p); };
$('#play').onclick = () => {
  if (!audio.src) { $('#pickAudio').click(); return; }
  if (audio.paused) { appliedIdx = -1; audio.play(); } else audio.pause();
};
$('#stop').onclick = () => { audio.pause(); audio.currentTime = 0; appliedIdx = -1; };
audio.onplay = () => { showPlaying = true; $('#play').textContent = t('show.pause'); };
audio.onpause = () => { showPlaying = false; $('#play').textContent = t('show.play'); };
audio.onended = () => { showPlaying = false; $('#play').textContent = t('show.play'); };

function addCue(label, t = audio.currentTime || 0) {
  show.cues = show.cues.filter((c) => Math.abs(c.t - t) > 0.12);
  show.cues.push({ t: Math.round(t * 100) / 100, label: label || `Cue`, look: snapshot() });
  show.cues.sort((a, b) => a.t - b.t);
  renderCues();
}
function recordHook(label) { if ($('#record').checked && showPlaying) addCue(label); }
$('#addCue').onclick = () => addCue(t('pat.name', { n: st.pattern }));

function fmt(t) { if (!isFinite(t)) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; }
function renderCues() {
  const tb = $('#cueBody'); tb.innerHTML = '';
  $('#cueCount').textContent = t('show.cueCount', { n: show.cues.length });
  show.cues.forEach((c, i) => {
    const tr = document.createElement('tr'); if (i === appliedIdx) tr.className = 'current';
    tr.innerHTML = `<td><input type="number" step="0.1" min="0"></td><td><input class="lbl"></td><td><span class="chip"><i></i><span></span></span></td><td><button class="ghost small go">▶</button> <button class="ghost small del">✕</button></td>`;
    const [tIn, lIn] = tr.querySelectorAll('input');
    tIn.value = c.t; lIn.value = c.label;
    tIn.onchange = () => { c.t = Math.max(0, +tIn.value || 0); show.cues.sort((a, b) => a.t - b.t); renderCues(); };
    lIn.onchange = () => { c.label = lIn.value; };
    tr.querySelector('.chip i').style.background = lookColorCss(c.look);
    tr.querySelector('.chip span').textContent = `#${c.look.pattern} · ${MOVE_DA[c.look.move] || ''}`;
    tr.querySelector('.go').onclick = () => { audio.currentTime = c.t; applyLook(c.look); appliedIdx = i; renderCues(); };
    tr.querySelector('.del').onclick = () => { show.cues.splice(i, 1); appliedIdx = -1; renderCues(); };
    tb.appendChild(tr);
  });
}

function showTick() {
  const t = audio.currentTime || 0, dur = audio.duration || 0;
  $('#time').textContent = `${fmt(t)} / ${fmt(dur).replace(/\.\d$/, '')}`;
  if (showPlaying && !$('#record').checked && show.cues.length) {
    let idx = -1; for (let i = 0; i < show.cues.length; i++) if (show.cues[i].t <= t) idx = i; else break;
    if (idx !== appliedIdx) { appliedIdx = idx; if (idx >= 0) { applyLook(show.cues[idx].look); activeScene = -1; } renderCues(); }
  }
  drawTimeline(t, dur);
  requestAnimationFrame(showTick);
}
function drawTimeline(tNow, dur) {
  const cv = $('#timeline'); if (!cv.offsetParent) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const mid = H / 2;
  if (peaks) {
    g.fillStyle = '#2a3242';
    for (let x = 0; x < W; x++) { const p = peaks[Math.floor((x / W) * peaks.length)] || 0; g.fillRect(x, mid - p * mid * 0.9, 1, Math.max(1, p * mid * 1.8)); }
  } else { g.fillStyle = '#5b6375'; g.font = '13px -apple-system'; g.fillText(t(audio.src ? 'show.loading' : 'show.empty'), 14, mid + 4); }
  if (dur) {
    show.cues.forEach((c, i) => {
      const x = (c.t / dur) * W;
      g.fillStyle = lookColorCss(c.look).startsWith('rgb') ? lookColorCss(c.look) : '#31f3ac';
      g.fillRect(x, 0, 2, H); g.fillRect(x, 0, 8, 8);
    });
    const px = (tNow / dur) * W; g.fillStyle = '#fff'; g.fillRect(px - 1, 0, 2, H);
  }
}
$('#timeline').onclick = (e) => {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; appliedIdx = -1;
  if (!showPlaying) { let idx = -1; show.cues.forEach((c, i) => { if (c.t <= audio.currentTime) idx = i; }); if (idx >= 0) applyLook(show.cues[idx].look); }
};

$('#showName').onchange = (e) => { show.name = e.target.value; };
$('#newShow').onclick = async () => {
  if (show.cues.length && (await modal(t('show.newQ'), null)) === null) return;
  audio.pause(); show = { name: t('show.defaultName'), audioPath: null, cues: [] }; audio.removeAttribute('src'); peaks = null;
  $('#showName').value = show.name; $('#audioName').textContent = t('show.noSong'); renderCues();
};
$('#saveShow').onclick = async () => {
  show.name = $('#showName').value;
  const p = await window.laser.saveShow(show.name, JSON.stringify({ app: 'SmartLink', version: 1, ...show }, null, 1));
  if (p) flash('#saveShow', t('show.saved'));
};
$('#openShow').onclick = async () => {
  const r = await window.laser.openShow(); if (!r) return;
  try {
    const d = JSON.parse(r.json);
    audio.pause();
    show = { name: d.name || 'Show', audioPath: d.audioPath || null, cues: Array.isArray(d.cues) ? d.cues : [] };
    $('#showName').value = show.name; appliedIdx = -1; renderCues();
    if (show.audioPath) await loadAudio(show.audioPath); else $('#audioName').textContent = t('show.noSong');
  } catch (e) { modal(t('show.bad'), null); }
};
function toast(msg, ms = 4000) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms); }
function flash(sel, txt) { const b = $(sel), o = b.textContent; b.textContent = txt; setTimeout(() => (b.textContent = o), 1200); }

// ---------- automatisk show-designer ----------
$('#genShow').onclick = () => { if (!decoded) { modal(t('gen.noSong'), null); return; } $('#genProg').hidden = true; $('#genModal').hidden = false; };
$('#genCancel').onclick = () => { $('#genModal').hidden = true; };
$('#genDensity').addEventListener('input', (e) => { e.target.parentElement.querySelector('output').textContent = e.target.value + '%'; });
$('#genDensity').parentElement.querySelector('output').textContent = '50%';
function genStatus(frac, txt) { $('#genProg').hidden = false; $('#genBar').style.width = Math.round(frac * 100) + '%'; $('#genStatus').textContent = txt; }
$('#genGo').onclick = async () => {
  if (!decoded) return;
  if (show.cues.length && (await modal(t('gen.replaceQ'), null)) === null) return;
  $('#genGo').disabled = true;
  try {
    genStatus(0, t('gen.analyzing'));
    const an = await analyzeSong(decoded, (p) => genStatus(p * 0.5, t('gen.analyzing')));
    // mønster-pulje
    const poolSel = $('#genPool').value;
    let pool = poolSel === 'presets' ? Array.from({ length: 28 }, (_, i) => i + 1) : poolSel === 'all' ? [...patAvail] : favs.size ? [...favs] : [...patAvail];
    if (!pool.length) pool = Array.from({ length: Math.min(28, cfg.patCount) }, (_, i) => i + 1);
    // ord
    let wordCues = [], wordInfo = '';
    if ($('#genWords').checked) {
      try {
        const words = await transcribeWords(decoded, { lang: $('#genLang').value, quality: $('#genQuality').value, onProgress: (p, f) => genStatus(0.5 + p * 0.3, f === 'transcribe' ? t('gen.transcribe') : t('gen.model', { f: f || '' })) });
        const key = pickKeyWords(words, 12);
        if (key.length) {
          genStatus(0.85, t('gen.words_found', { n: key.length }));
          let num = Math.max(200, (Math.max(0, ...patAvail) + 1));
          const files = key.map((w) => { const strokes = textToStrokes(w.text.toUpperCase(), { size: 0.85, bold: 2 }); return { num: num++, bytes: encodeIld([strokes], [255, 255, 255], w.text.toUpperCase().slice(0, 8)), word: w }; });
          const saved = await window.laser.saveIldBatch(t('gen.pickDir'), files.map((f) => ({ num: f.num, bytes: f.bytes })));
          if (saved) { wordCues = files.map((f) => ({ t: f.word.t, text: f.word.text, pattern: f.num })); wordInfo = t('gen.doneWords', { n: files.length, a: files[0].num, b: files[files.length - 1].num }); await refreshPatList(); }
        }
      } catch (e) { await modal(t('gen.wordsErr', { e: (e && e.message) || e }), null); }
    }
    genStatus(0.95, t('gen.building'));
    show.cues = buildShow(an, { patterns: pool, palette: $('#genPalette').value, density: $('#genDensity').value / 100, words: wordCues });
    appliedIdx = -1; renderCues();
    $('#genModal').hidden = true;
    await modal(t('gen.done', { c: show.cues.length, d: an.drops.length, b: Math.round(an.bpm), w: wordInfo }), null);
  } finally { $('#genGo').disabled = false; }
};

// ---------- indstillinger ----------
function bindSetting(id, key, conv = (v) => v, outFmt) {
  const el = $('#' + id);
  const out = el.parentElement.querySelector('output');
  if (el.type === 'checkbox') el.checked = !!cfg[key];
  else if (el.type === 'range') el.value = (key === 'zoneLo' || key === 'zoneHi') ? cfg[key] : cfg[key] * 100;
  else el.value = cfg[key];
  if (out && outFmt) out.textContent = outFmt(el.value);
  el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    cfg[key] = el.type === 'checkbox' ? el.checked : conv(el.value);
    if (out && outFmt) out.textContent = outFmt(el.value);
    saveCfg();
    if (key === 'rate') startSending();
    if (key === 'patCount') { renderPatPages(); renderPatterns(); }
    if (key === 'address') dmx.fill(0);
    if (key === 'wmAddress' || key === 'wmOn') { if (typeof renderWmMap === 'function') renderWmMap(); if (typeof wmStatus === 'function') wmStatus(); if (typeof renderWolf === 'function') renderWolf(); }
  });
}
bindSetting('ip', 'ip', (v) => v.trim() || '2.255.255.255');
$('#ip').addEventListener('change', () => setTimeout(netCheck, 100));
bindSetting('universe', 'universe', (v) => clamp(+v | 0, 0, 32767));
bindSetting('address', 'address', (v) => clamp(+v | 0, 1, 479));
bindSetting('rate', 'rate', (v) => clamp(+v | 0, 10, 44));
bindSetting('zone', 'zone', (v) => v / 100, (v) => (v == 0 ? t('v.off') : v + '%'));
bindSetting('zoneSide', 'zoneSide');
bindSetting('autoUniverse', 'autoUniverse');
bindSetting('dmxMode', 'dmxMode');
bindSetting('maxInt', 'maxInt', (v) => v / 100, (v) => v + '%');
$('#maxInt').addEventListener('input', () => updatePowerUI());
bindSetting('startLow', 'startLow');
bindSetting('invX', 'invX'); bindSetting('invY', 'invY');
bindSetting('posFmt', 'posFmt'); bindSetting('posScaled', 'posScaled');
function syncCtrUI() { ['ctrX', 'ctrY'].forEach((k) => { const el = $('#' + k); if (!el) return; el.value = Math.round((cfg[k] || 0) * 100); const o = el.parentElement.querySelector('output'); if (o) o.textContent = (cfg[k] > 0 ? '+' : '') + Math.round((cfg[k] || 0) * 100); }); }
['ctrX', 'ctrY'].forEach((k) => { const el = $('#' + k); if (!el) return; el.addEventListener('input', () => { cfg[k] = +el.value / 100; saveCfg(); syncCtrUI(); }); });
{ const b = $('#ctrReset'); if (b) b.onclick = () => { cfg.ctrX = 0; cfg.ctrY = 0; saveCfg(); syncCtrUI(); }; }
syncCtrUI();
if (!cfg.mig2310fix) { cfg.invX = !cfg.invX; cfg.kpps = 20; // hele billedet spejles vandret (kanal 12) – så både position og mønster vender rigtigt
  cfg.mig2310fix = true; saveCfg(); } // højre gik til venstre IRL; Admin Tool: SD card scan speed 20 kpps
if (!cfg.mig2310pov) { cfg.viewZoom = 1; cfg.mig2310pov = true; saveCfg(); }
if (!cfg.mig2310pro) { // 23/10: Professional Mode + ShowNET-mapping. DJ-tidens rettelser (midte, kanter, vending, fold) passer ikke længere → nulstil
  cfg.dmxMode = 'pro'; cfg.profile = ShowNET.profileOf(cfg.profile); cfg.ctrX = 0; cfg.ctrY = 0; cfg.axis = { x: 0, y: 0 }; cfg.edgesUser = false;
  cfg.orient = { on: false, q: {}, pat: {} }; cfg.flipLearn = null; cfg.lmap = null; cfg.dirX = false; cfg.dirY = false; cfg.fold = {}; cfg.zoneSent = {}; cfg.kpps = 20; cfg.animScale = 1; cfg.viewGain = {};
  cfg.lim = { on: true, top: 1, bottom: -1, left: -1, right: 1, small: cfg.lim && cfg.lim.small, big: cfg.lim && cfg.lim.big, sizeOn: cfg.lim && cfg.lim.sizeOn, set: {} };
  cfg.mig2310pro = true; cfg._proNotice = true; cfg.mig2110rot = true; saveCfg();
}
if (!cfg.mig2110rot) { // 21/10 00:15: vend ALLE mønstre 180° i det laseren modtager (LIVE uændret) – oven i det der sendes nu
  const o = (cfg.orient = cfg.orient || {}); o.q = o.q || {}; o.pat = o.pat || {};
  if (!o.on) { const b = (cfg.flipLearn && cfg.flipLearn.base) || [0, 0]; o.all = b[0] && b[1] ? 'r180' : b[0] ? 'mx' : b[1] ? 'my' : 'n'; o.on = true; }
  const flip = { n: 'r180', r180: 'n', r90: 'r270', r270: 'r90', mx: 'my', my: 'mx', mxy: 'n', mx90: 'my90', my90: 'mx90', mxy90: 'r270' };
  o.all = flip[o.all || 'n'] || 'r180'; cfg.mig2110rot = true; saveCfg();
}
if (!cfg.mig2110anim) { if (cfg.kpps == null) cfg.kpps = 30; if (cfg.animScale == null) cfg.animScale = 1; cfg.mig2110anim = true; saveCfg(); }
if (!cfg.mig2110axis) { cfg.axis = cfg.axis || { x: 0.11, y: 0.15 }; cfg.testDot = cfg.testDot || 238; cfg.mig2110axis = true; saveCfg(); } // 21/10: pos 11 15 = laseren skyder lige ud; mønster 238 = prik
if (!cfg.mig2010fold) { // 20/10 23:18: i format A vender laseren om ved Y −88 (sendt) med mønster 5 på 100 % → mønstrets kant rammer scannerens yderste
  cfg.fold = cfg.fold || { all: 0.12 }; cfg.mig2010fold = true; saveCfg();
}
if (!cfg.mig2010fmtA) { // 20/10 22:53: dine målinger i format B (vender om under signal 0, spejler ved 0) passer præcis med at laseren taler format A
  if (cfg.posFmt === 'u') { cfg.posFmt = 's'; if (cfg.flipLearn) cfg.flipLearn = { base: cfg.flipLearn.base || [0, 0], rules: [] }; }
  cfg.mig2010fmtA = true; saveCfg();
}
if (!cfg.mig2010view) { // 20/10 22:41: kanterne skal IKKE beskæres – LIVE viser hele laserens rækkevidde i ægte skala. Zonen beholdes hvor den passede.
  try { if (cfg.lim && cfg.mig2010edge && Math.abs(cfg.lim.bottom + 0.1489) < 0.003 && Math.abs(cfg.lim.left + 0.1815) < 0.003) { const top = cfg.lim.top, cy = cfg.ctrY || 0; cfg.zoneSent = { bottom0: cy + cfg.lim.bottom, bottom1: cy + top }; cfg.lim.bottom = cfg.lim.bottom / 0.09; cfg.lim.left = cfg.lim.left / 0.11; } else if (cfg.lim && cfg.posFmt === 'u' && Math.abs((cfg.ctrY || 0) - 0.655) < 0.02 && !cfg.zoneSent) cfg.zoneSent = { bottom0: 0.506, bottom1: 1 }; } catch (e) {}
  cfg.viewGain = cfg.viewGain || {}; cfg.mig2010view = true; cfg.mig2010edge = true; saveCfg();
}
if (!cfg.mig2010edge) { // målt 20/10 22:19 (format B, midte 65/65): nedad vender den ved Y -9, venstre warper fra X -11 → det er kanterne
  try { if (cfg.lim && cfg.lim.on && cfg.posFmt === 'u' && Math.abs((cfg.ctrY || 0) - 0.655) < 0.02 && cfg.lim.bottom < -1.5) { cfg.lim.bottom = cfg.lim.bottom * 0.09; cfg.lim.left = cfg.lim.left * 0.11; cfg.zoneZeroY = -1; cfg.zoneMap = null; } } catch (e) {}
  cfg.mig2010edge = true; saveCfg();
}
if (!cfg.mig2010bend) { cfg.bend = {}; cfg.bendStop = false; cfg.mig2010bend = true; saveCfg(); } // 20/10: gamle bøje-punkter låste mønstret til ~30 % af LIVE
if (!cfg.mig2010size) { try { const lo = sizeCh4(0.16), hi = sizeCh4(1); limEnsure(); cfg.lim.small = lo; cfg.lim.big = hi; cfg.lim.sizeOn = true; cfg.lim.set.small = true; cfg.lim.set.big = true; } catch (e) {} cfg.mig2010size = true; saveCfg(); }
if (cfg._proNotice) { delete cfg._proNotice; saveCfg(); setTimeout(() => modal(t('csn.proNotice'), null), 800); }
if (cfg._needCenter) { delete cfg._needCenter; try { centerLive(); } catch (e) {} saveCfg(); }
function syncArrowUI() { ['arrowFlipX', 'arrowFlipY', 'arrowSwap'].forEach((k) => { const el = $('#' + k); if (el) el.checked = !!cfg[k]; }); }
['arrowFlipX', 'arrowFlipY', 'arrowSwap'].forEach((k) => { const el = $('#' + k); if (el) el.addEventListener('change', () => { cfg[k] = el.checked; saveCfg(); }); }); syncArrowUI();
function syncAnimUI() { const a = $('#animScale'), k = $('#kpps'); if (a) { a.value = Math.round((cfg.animScale || 1) * 100); a.parentElement.querySelector('output').textContent = a.value + ' %'; } if (k) { k.value = cfg.kpps || 0; k.parentElement.querySelector('output').textContent = cfg.kpps ? cfg.kpps + 'k' : t('set.off'); } }
{ const a = $('#animScale'), k = $('#kpps'); if (a) a.addEventListener('input', () => { cfg.animScale = +a.value / 100; saveCfg(); syncAnimUI(); }); if (k) k.addEventListener('input', () => { cfg.kpps = +k.value; saveCfg(); syncAnimUI(); }); const sb = $('#animSync'); if (sb) sb.onclick = () => { pvFrame = 0; toast(t('con.synced')); }; syncAnimUI(); }
bindSetting('zoneLo', 'zoneLo', (v) => +v, (v) => String(v)); bindSetting('zoneHi', 'zoneHi', (v) => +v, (v) => String(v));
bindSetting('lineThin', 'lineThin', (v) => v / 100, (v) => (v == 0 ? t('v.off') : v + '%')); bindSetting('sizeInv', 'sizeInv'); bindSetting('sizeFlip', 'sizeFlip'); bindSetting('quadFix', 'quadFix');
bindSetting('wmOn', 'wmOn'); bindSetting('wmUniverse', 'wmUniverse', (v) => clamp(v | 0, 0, 32767)); bindSetting('wmAddress', 'wmAddress', (v) => clamp(v | 0, 1, 512)); bindSetting('sizeRange', 'sizeRange', (v) => v / 100, (v) => v + '%');
bindSetting('scan', 'scan', (v) => +v);
bindSetting('patCount', 'patCount', (v) => clamp(+v | 0, 1, 255));
$('#testBtn').onclick = () => setSpecial('line');
$('#pvZoneLine').onclick = () => { if (!(cfg.zone > 0)) { modal(t('pv.zoneFirst'), null); return; } setSpecial('zone'); };
bindSetting('testPattern', 'testPattern', (v) => clamp(+v | 0, 1, 255));
bindSetting('linePattern', 'linePattern', (v) => clamp(+v | 0, 1, 255));
// Vurder hvor "ren" en streg et mønster giver, når det klemmes fladt: ét sammenhængende stykke uden huller er bedst.
function lineScore(fr) {
  const f = firstVisible(fr); if (!f) return -1;
  const xs = []; let gaps = 0, lastX = null, lit = 0;
  for (let i = 0; i < f.n; i++) { if (f.bl[i]) { if (lastX !== null) gaps++; lastX = null; continue; } lit++; xs.push(f.xy[i * 2]); if (lastX !== null && Math.abs(f.xy[i * 2] - lastX) > 0.25) gaps++; lastX = f.xy[i * 2]; }
  if (!xs.length) return -1;
  const span = Math.max(...xs) - Math.min(...xs);
  return span * 100 - gaps * 25 + Math.min(lit, 60) * 0.2;  // bred, uden huller, nok punkter
}
async function findBestLinePattern() {
  const cands = patAvail.size ? [...patAvail] : [];
  if (!cands.length) { modal(t('set.lineNeedPats'), null); return; }
  let best = null, bestS = -Infinity;
  for (const n of cands) { const fr = await loadPat(n); if (!fr || !fr.length) continue; const sc = lineScore(fr); if (sc > bestS) { bestS = sc; best = n; } }
  if (best) setTestPattern(best);
}
function setTestPattern(n) {
  cfg.testPattern = clamp(n | 0, 1, Math.max(1, cfg.patCount)); $('#testPattern').value = cfg.testPattern; $('#lineNow').textContent = cfg.testPattern; saveCfg();
  if (special !== 'line') setSpecial('line');
}
$('#lineAuto').onclick = findBestLinePattern;
$('#linePrev').onclick = () => setTestPattern(cfg.testPattern <= 1 ? cfg.patCount : cfg.testPattern - 1);
$('#lineNext').onclick = () => setTestPattern(cfg.testPattern >= cfg.patCount ? 1 : cfg.testPattern + 1);
$('#lineNow').textContent = cfg.testPattern;
$('#testPattern').addEventListener('change', () => { $('#lineNow').textContent = cfg.testPattern; });

// ---------- faner, taster, modal ----------
$$('.tab').forEach((t) => t.onclick = () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + t.dataset.tab));
});
// ---------- tastatur-styring: hver tast kan skyde et mønster ----------
const KEY_ROWS = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'å'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'æ', 'ø'], ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-']];
let keymap = store.get('keymap', {});
function renderKeyboard() {
  const kb = $('#keyboard'); if (!kb) return; kb.innerHTML = '';
  for (const row of KEY_ROWS) {
    const r = document.createElement('div'); r.className = 'krow';
    for (const k of row) {
      const n = keymap[k], d = document.createElement('div');
      d.className = 'key' + (n ? ' set' : '') + (n && n === st.pattern ? ' active' : ''); d.dataset.key = k;
      d.innerHTML = `<b>${k.toUpperCase()}</b><span class="kn">${n ? '#' + n + (patNames[n] ? ' ' + patNames[n] : '') : ''}</span>`;
      d.onclick = () => editKey(k);
      d.oncontextmenu = (e) => { e.preventDefault(); if (n) { setPattern(n); flashKey(k); } };
      r.appendChild(d);
      if (n && patAvail.has(n)) requestAnimationFrame(() => drawThumb(d, n));
    }
    kb.appendChild(r);
  }
}
function flashKey(k) { const d = $(`.key[data-key="${CSS.escape(k)}"]`); if (!d) return; d.classList.add('hit'); setTimeout(() => d.classList.remove('hit'), 180); $$('.key').forEach((x) => x.classList.toggle('active', keymap[x.dataset.key] === st.pattern)); }
async function editKey(k) {
  const r = await modal(t('keys.edit', { k: k.toUpperCase() }), keymap[k] ? String(keymap[k]) : '', t('keys.useCurrent', { n: st.pattern }), keymap[k] ? t('keys.remove') : null);
  if (r === null) return;
  if (r === '__extra') keymap[k] = st.pattern;
  else if (r === '__extra2' || !r.trim()) delete keymap[k];
  else { const n = parseInt(r, 10); if (n >= 1 && n <= 255) keymap[k] = n; }
  store.set('keymap', keymap); renderKeyboard();
}
$('#keysClear').onclick = async () => { if ((await modal(t('keys.clearConfirm'), null)) === null) return; keymap = {}; store.set('keymap', keymap); renderKeyboard(); };
renderKeyboard();
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input:not([type=range]):not([type=checkbox]), select') || !$('#modal').hidden) return;
  const kk = (e.key || '').toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); tap(); }
  else if (!e.metaKey && !e.ctrlKey && !e.altKey && keymap[kk] && !e.repeat) { if (st.pattern === keymap[kk]) { setPattern(0); recordHook(t('pat.offName')); } else { setPattern(keymap[kk]); recordHook(t('pat.name', { n: keymap[kk] })); } flashKey(kk); }
  else if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault(); const d = e.shiftKey ? 0.05 : 0.01;
    const zoneFocus = document.activeElement === $('#zoneLive') || special === 'zone' || zoneDrag;
    if (selVb && selVb.offsetParent) { // valgt parameter (klik på navnet): ↑/→ op, ↓/← ned – 1 trin, ⇧ = 5
      const inp = selVb.querySelector('input'); const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1; const stp = ((+inp.max - +inp.min) >= 200 ? 5 : 1) * (e.shiftKey ? 5 : 1);
      inp.value = clamp(+inp.value + dir * stp, +inp.min, +inp.max); inp.dispatchEvent(new Event('input'));
    } else if (zoneFocus) { // sikkerhedszone: op/ned (eller venstre/højre) = 1 % ad gangen
      const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1; cfg.zone = clamp(Math.round((cfg.zone + dir * d) * 100) / 100, 0, 0.9); saveCfg(); syncZoneUI(); sendNow();
    } else { const m0 = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]; if (m0) { const [ax, ay] = arrowDir(m0[0], m0[1]); if (ax) setPos('posX', st.posX + ax * d); if (ay) setPos('posY', st.posY + ay * d); } }
  }
  else if (e.key === 'b' || e.key === 'B') requestArm();
  else if (e.key === 'Escape') { if (selVb) selectVb(null); else setBlackout(true); }
  else if (/^[1-9]$/.test(e.key) && scenes[+e.key - 1]) { recallScene(+e.key - 1); recordHook(scenes[+e.key - 1].name); }
});

let modalResolve;
// spejl et mønster lodret og gem en rettet .ild (til SD-kortet) – til mønstre der står på hovedet
// spejlede kopier (X, Y, XY) til kvadrant-kompensation – lægges i ledige numre og kopieres til SD-kortet
async function makeMirrorCopies(n) {
  const fr = await loadPat(n); if (!fr || !fr.length) { toast(t('pat.noData')); return; }
  const used = new Set([...patAvail, ...Object.values(mirrorSlots).flatMap((o) => Object.values(o))]);
  const free = []; for (let k = 249; k >= 100 && free.length < 3; k--) if (!used.has(k)) free.push(k);
  if (free.length < 3) { toast(t('pat.noSlots')); return; }
  const mk = (fx, fy) => fr.map((f) => ({ n: f.n, xy: f.xy.map((v, i) => (i % 2 === 0 ? v * fx : v * fy)), col: f.col, bl: f.bl }));
  const files = [{ num: free[0], bytes: encodeFramesIld(mk(-1, 1), 'MX' + n) }, { num: free[1], bytes: encodeFramesIld(mk(1, -1), 'MY' + n) }, { num: free[2], bytes: encodeFramesIld(mk(-1, -1), 'MXY' + n) }];
  const r = await window.laser.saveIldBatch(t('pat.mirrorDirTitle', { n }), files); if (!r) return;
  mirrorSlots[n] = { x: free[0], y: free[1], xy: free[2] }; store.set('mirrorSlots', mirrorSlots);
  patNames[free[0]] = patNames[free[0]] || `#${n} ↔`; patNames[free[1]] = patNames[free[1]] || `#${n} ↕`; patNames[free[2]] = patNames[free[2]] || `#${n} ⟲`; store.set('patNames', patNames);
  if (r.list) { for (const k of r.list) patAvail.add(+k); } renderPatterns();
  modal(t('pat.mirrorCopies', { n, a: free[0], b: free[1], c: free[2], d: r.dir }), null);
}
async function mirrorPatternFile(n, axis = 'y') {
  const fr = await loadPat(n); if (!fr || !fr.length) return;
  const frames = fr.map((f) => ({ n: f.n, xy: f.xy.map((v, i) => ((i % 2 === 1) === (axis === 'y') ? -v : v)), col: f.col, bl: f.bl }));
  const bytes = encodeFramesIld(frames, 'FLIP' + n);
  const r = await window.laser.saveIld(String(n).padStart(3, '0'), bytes, true);
  if (!r) return;
  patMirror[n] = Object.assign({}, patMirror[n]); patMirror[n][axis] = !patMirror[n][axis]; store.set('patMirror', patMirror);
  patData.delete(n); extCache.delete(n); renderPatterns(); renderKeyboard();
  modal(t('pat.mirrored', { n, p: (r.path || '').split('/').pop() }), null);
}
function encodeFramesIld(frames, name = 'LIGHTLNK') {
  const parts = [];
  const header = (cnt, fi, total) => { const b = new Uint8Array(32), dv = new DataView(b.buffer); b.set([0x49, 0x4c, 0x44, 0x41], 0); b[7] = 5; const nm = (name + '        ').slice(0, 8), co = 'SmartLnk'; for (let i = 0; i < 8; i++) { b[8 + i] = nm.charCodeAt(i); b[16 + i] = co.charCodeAt(i); } dv.setUint16(24, cnt); dv.setUint16(26, fi); dv.setUint16(28, total); return b; };
  frames.forEach((f, fi) => {
    const cnt = Math.min(f.n, 65535), body = new Uint8Array(cnt * 8), dv = new DataView(body.buffer);
    for (let i = 0; i < cnt; i++) { const o = i * 8; dv.setInt16(o, Math.round(clamp(f.xy[i * 2], -1, 1) * 32000)); dv.setInt16(o + 2, Math.round(clamp(f.xy[i * 2 + 1], -1, 1) * 32000)); body[o + 4] = (f.bl[i] ? 0x40 : 0) | (i === cnt - 1 ? 0x80 : 0); body[o + 5] = f.col[i * 3 + 2]; body[o + 6] = f.col[i * 3 + 1]; body[o + 7] = f.col[i * 3]; }
    parts.push(header(cnt, fi, frames.length), body);
  });
  parts.push(header(0, 0, 0));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function modal(title, value, extra, extra2, extra3, extra4) {
  $('#modalTitle').textContent = title;
  const inp = $('#modalInput');
  inp.hidden = value === null; inp.value = value || '';
  $('#modalExtra').hidden = !extra; $('#modalExtra').textContent = extra || '';
  $('#modalExtra2').hidden = !extra2; $('#modalExtra2').textContent = extra2 || '';
  $('#modalExtra3').hidden = !extra3; $('#modalExtra3').textContent = extra3 || '';
  $('#modalExtra4').hidden = !extra4; $('#modalExtra4').textContent = extra4 || '';
  $('#modal').hidden = false; if (value !== null) setTimeout(() => { inp.focus(); inp.select(); }, 20);
  return new Promise((res) => (modalResolve = res));
}
function closeModal(v) { $('#modal').hidden = true; if (modalResolve) modalResolve(v); modalResolve = null; }
$('#modalOk').onclick = () => closeModal($('#modalInput').hidden ? '' : $('#modalInput').value);
$('#modalCancel').onclick = () => closeModal(null);
$('#modalExtra').onclick = () => closeModal('__extra');
$('#modalExtra2').onclick = () => closeModal('__extra2');
$('#modalExtra3').onclick = () => closeModal('__extra3');
$('#modalExtra4').onclick = () => closeModal('__extra4');
$('#modalInput').onkeydown = (e) => { if (e.key === 'Enter') $('#modalOk').click(); if (e.key === 'Escape') closeModal(null); };

// ---------- netværk / laser-forbindelse ----------
let netBusy = false;
async function netCheck() {
  let n; try { window.laser.pollTarget(cfg.ip); n = await window.laser.netStatus(cfg.ip); } catch (_) { return; }
  const bar = $('#netbar'), msg = $('#netMsg'), btn = $('#netSetup');
  const ll = String(cfg.ip).startsWith('169.254.');
  bar.hidden = false; document.body.classList.add('hasbar');
  bar.className = 'netbar'; btn.hidden = true;
  const node = n.found[0];
  if (node && cfg.autoUniverse && node.universe !== undefined && node.universe !== cfg.universe) { cfg.universe = node.universe; $('#universe').value = node.universe; saveCfg(); }
  { const sm_ = cfg.sizeMap; const el = $('#sizeDiag'); if (el) el.textContent = sm_ ? t('set.sizeDiag', { n: sm_.filter((p) => p.ext).length, p: cfg.sizeMapPattern || '?', lo: Math.min(...sm_.filter((p) => p.ext).map((p) => p.ch4)), hi: Math.max(...sm_.filter((p) => p.ext).map((p) => p.ch4)), cur: sizeCh4(st.size), pct: Math.round(st.size * 100) }) : ''; }
  $('#diagInfo').textContent = node ? t('diag.info', { ip: node.ip, name: node.longName || node.name, u: node.universe, rep: node.report || '—' }) : t('diag.noNode');
  if (n.found.length) {
    bar.className = 'netbar ok';
    msg.textContent = t('net.found', { ips: n.found.map((f) => f.ip).join(', ') });
  } else if (n.ready && n.addrs.length) {
    bar.className = 'netbar ok';
    msg.textContent = t('net.ready', { ip: n.addrs[0].address });
  } else if (n.configured && !ll) {
    msg.textContent = t('net.plug');
  } else if (ll) {
    msg.textContent = t('net.needLL', { ip: cfg.ip });
    btn.hidden = false;
  } else {
    msg.textContent = t('net.notSetup');
    btn.hidden = false;
  }
  $('#netInfo').textContent = n.addrs.length ? t('net.addr', { a: n.addrs.map((a) => `${a.address} (${a.ifname})`).join(', ') }) : t('net.noAddr');
}
async function doNetSetup() {
  if (netBusy) return; netBusy = true;
  $('#netMsg').textContent = t('net.busy');
  const r = await window.laser.netSetup(cfg.ip); netBusy = false;
  if (!r.ok) { $('#netbar').className = 'netbar bad'; $('#netMsg').textContent = r.msg; return; }
  setTimeout(netCheck, 1500);
}
$('#netSetup').onclick = doNetSetup;
async function reconnect() {
  $('#connTxt').textContent = t('set.reconnecting'); $('#connLed').className = 'led';
  $('#reconnectBtn').disabled = true;
  try { await window.laser.reconnect(); dmx.fill(0); } finally { $('#reconnectBtn').disabled = false; }
  setTimeout(netCheck, 600);
}
$('#reconnectBtn').onclick = reconnect;
// ---------- opdateringer ----------
let updInfo = null;
async function checkUpdates(silent) {
  $('#updStatus').textContent = t('upd.checking'); $('#updGo').hidden = true;
  const r = await window.laser.updateCheck(); updInfo = r;
  $('#updVersion').textContent = t('upd.version', { v: r.current });
  if (!r.ok) { $('#updStatus').textContent = t('upd.err', { e: r.error }); return; }
  if (r.newer) {
    $('#updStatus').textContent = t('upd.available', { v: r.latest }) + (r.notes ? ' – ' + r.notes.split('\n')[0].slice(0, 140) : '');
    $('#updGo').hidden = false; $('#updGo').textContent = t('upd.installV', { v: r.latest });
    $('#updMsg').textContent = t('upd.available', { v: r.latest }); $('#updBar').hidden = false; document.body.classList.add('hasupd');
  } else { $('#updStatus').textContent = t('upd.latest', { v: r.current }); if (!silent) { $('#updBar').hidden = true; } }
}
async function installUpdate() {
  if (!updInfo || !updInfo.url) return;
  $('#updInstall').disabled = true; $('#updGo').disabled = true; $('#updMsg').textContent = t('upd.downloading', { p: 0 }); $('#updBar').hidden = false; document.body.classList.add('hasupd');
  window.laser.onUpdateProgress((p) => { $('#updMsg').textContent = t('upd.downloading', { p: Math.round(p * 100) }); $('#updStatus').textContent = t('upd.downloading', { p: Math.round(p * 100) }); });
  setBlackout(true);
  const r = await window.laser.updateInstall(updInfo.url);
  if (!r.ok) { $('#updMsg').textContent = t('upd.err', { e: r.error }); $('#updStatus').textContent = t('upd.err', { e: r.error }); $('#updInstall').disabled = false; $('#updGo').disabled = false; }
  else { $('#updMsg').textContent = t('upd.restarting'); }
}
$('#updCheck').onclick = () => checkUpdates(false);
$('#updGo').onclick = installUpdate; $('#updInstall').onclick = installUpdate;
$('#updLater').onclick = () => { $('#updBar').hidden = true; document.body.classList.remove('hasupd'); };
window.laser.appVersion().then((v) => { $('#updVersion').textContent = t('upd.version', { v }); });
setTimeout(() => checkUpdates(true), 6000); // tjek stille ved start
$('#conn').onclick = reconnect;
$('#netRedo').onclick = doNetSetup;
$('#netRemove').onclick = async () => {
  if ((await modal(t('net.removeQ'), null)) === null) return;
  await window.laser.netRemove(); setTimeout(netCheck, 1000);
};
setInterval(netCheck, 2500); netCheck();

// ---------- fejlfinder: prøv kombinationer til laseren lyser ----------
let diag = null;
async function startDiag() {
  let n = null; try { n = await window.laser.netStatus(cfg.ip); } catch (_) {}
  const det = n && n.found[0] ? n.found[0].universe : null;
  const unis = [...new Set([det, cfg.universe, 0, 1].filter((u) => u !== null && u !== undefined))];
  const modes = [cfg.dmxMode, cfg.dmxMode === 'dj' ? 'pro' : 'dj'];
  const combos = []; for (const m of modes) for (const u of unis) combos.push({ m, u });
  diag = { combos, i: -1, saved: { dmxMode: cfg.dmxMode, universe: cfg.universe, look: structuredClone(st), master, blackout, auto: autoMode }, timer: null };
  setAuto('off');
  Object.assign(st, { pattern: 1, color: { mode: 'orig', rgb: [255, 255, 255] }, colorCycle: false, move: 'none', rotSpeed: 0, rotAngle: 0, strobe: 0, size: 0.8, fps: 0.5, pulse: 0 });
  if (master < 0.4) setMaster(0.4);
  syncLookUI();
  $('#diagFail').hidden = true; $('#diagYes').hidden = false; $('#diagModal').hidden = false;
  diagNext();
}
function diagNext() {
  clearTimeout(diag.timer);
  diag.i++;
  if (diag.i >= diag.combos.length) {   // intet virkede
    Object.assign(cfg, { dmxMode: diag.saved.dmxMode, universe: diag.saved.universe });
    $('#dmxMode').value = cfg.dmxMode; $('#universe').value = cfg.universe;
    $('#diagNow').textContent = t('diag.none'); $('#diagBar').style.width = '100%';
    $('#diagFail').hidden = false; $('#diagYes').hidden = true; return;
  }
  const c = diag.combos[diag.i];
  cfg.dmxMode = c.m; cfg.universe = c.u; dmx.fill(0);
  $('#diagNow').textContent = t('diag.trying', { i: diag.i + 1, n: diag.combos.length, mode: t(c.m === 'dj' ? 'diag.dj' : 'diag.pro'), u: c.u });
  $('#diagBar').style.width = ((diag.i + 1) / diag.combos.length) * 100 + '%';
  diag.timer = setTimeout(diagNext, 4000);
}
$('#findBtn').onclick = startDiag;
$('#diagYes').onclick = () => {   // den lyser!
  clearTimeout(diag.timer);
  const c = diag.combos[diag.i];
  cfg.dmxMode = c.m; cfg.universe = c.u; cfg.autoUniverse = false;
  $('#dmxMode').value = c.m; $('#universe').value = c.u; $('#autoUniverse').checked = false; saveCfg();
  $('#diagModal').hidden = true; diag = null;
  modal(t('diag.saved', { mode: t(c.m === 'dj' ? 'diag.dj' : 'diag.pro'), u: c.u }), null);
};
$('#diagStop').onclick = () => {
  if (diag) {
    clearTimeout(diag.timer);
    Object.assign(cfg, { dmxMode: diag.saved.dmxMode, universe: diag.saved.universe });
    $('#dmxMode').value = cfg.dmxMode; $('#universe').value = cfg.universe;
    applyLook(diag.saved.look); setMaster(diag.saved.master);
    diag = null;
  }
  $('#diagModal').hidden = true;
};

// ---------- sprog ----------
function setLang(l) {
  LANG = l; try { localStorage.setItem('ls.lang', JSON.stringify(l)); } catch (_) {}
  applyI18n();
  $$('#langSeg button').forEach((b) => b.classList.toggle('active', b.dataset.lang === l));
  setBlackout(blackout);
  $('#sceneHint').textContent = t(storing ? 'scene.storeHint' : 'scene.hint');
  $('#play').textContent = t(showPlaying ? 'show.pause' : 'show.play');
  if (!show.audioPath) $('#audioName').textContent = t('show.noSong');
  if (!show.cues.length && ['Mit show', 'My show'].includes($('#showName').value)) { show.name = t('show.defaultName'); $('#showName').value = show.name; }
  renderPatPages(); renderPatterns(); renderSwatches(); renderScenes(); renderCues(); syncLookUI(); syncZoneUI();
  if (typeof DZ !== 'undefined' && $('#dzShapes').childElementCount) { $$('#dzShapes button').forEach((b, i) => (b.textContent = t('sh.' + Object.keys(SHAPES)[i]))); dzSetMode(DZ.mode); }
  $('#patImport').textContent = patAvail.size ? t('pat.loaded', { n: patAvail.size }) : t('pat.import');
  netCheck(); updateMicTestBtn();
}
$$('#langSeg button').forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
$('#showName').value = show.name;

// ---------- mobil-fjernbetjening ----------
async function refreshMobile() {
  const info = await window.laser.remoteInfo();
  $('#mobEnable').checked = info.enabled;
  $('#mobBody').classList.toggle('off', !info.enabled);
  if (info.qr) $('#mobQr').src = info.qr;
  $('#mobUrl').textContent = (info.url || t('mob.noWifi')) + (info.httpsUrl ? '\n' + t('mob.httpsUrl', { u: info.httpsUrl }) : '');
  $('#mobStatus').textContent = info.error ? t('mob.err', { e: info.error }) : t('mob.count', { n: info.clients });
  setMobCount(info.clients);
}
function setMobCount(n) { $('#mobCount').hidden = !n; $('#mobCount').textContent = n; $('#mobStatus').textContent = t('mob.count', { n }); }
$('#mobileBtn').onclick = async () => { $('#mobModal').hidden = false; await refreshMobile(); };
$('#mobClose').onclick = () => { $('#mobModal').hidden = true; };
$('#mobModal').onclick = (e) => { if (e.target.id === 'mobModal') $('#mobModal').hidden = true; };
$('#mobEnable').onchange = async (e) => { await window.laser.remoteEnable(e.target.checked); setTimeout(refreshMobile, 300); };
$('#mobNewKey').onclick = async () => { await window.laser.remoteNewKey(); refreshMobile(); };
window.laser.onRemoteCount(setMobCount);

// tilstand der sendes til telefonen
function remoteSnapshot() {
  return JSON.stringify({
    lang: LANG, pattern: st.pattern, color: st.color, colorCycle: st.colorCycle, move: st.move,
    size: st.size, rotSpeed: st.rotSpeed, strobe: st.strobe, moveSpeed: st.moveSpeed, pulse: st.pulse,
    master, cap: cfg.maxInt, eff: Math.round(master * cfg.maxInt * 100), blackout, auto: autoMode, bpm: Math.round(bpm), arming: !$('#armModal').hidden,
    scenes: scenes.map((s) => (s ? s.name : null)), activeScene, patAvail: [...patAvail], patNames, favs: [...favs], patCount: cfg.patCount,
    zone: cfg.zone, zoneSide: cfg.zoneSide, presets: PRESETS.map((p, i) => ['#' + p.pat, presetName(p, i)]), special, posX: st.posX, posY: st.posY, freeze: false, ang: Math.round(out.ang), cal: cfg.cal, calib: cfg.calib, calPts: cfg.calPts, calStep,
    music: { b: +music.bass.toFixed(2), m: +music.mid.toFixed(2), h: +music.hi.toFixed(2) },
  });
}
setInterval(() => window.laser.remoteState(remoteSnapshot()), 80);

// kommandoer fra telefonen
window.laser.onRemoteCmd((c) => {
  if (!c || typeof c !== 'object') return;
  switch (c.type) {
    case 'pattern': if (c.n >= 1 && c.n <= 255) { if (st.pattern === (c.n | 0)) { setPattern(0); recordHook(t('pat.offName')); } else { setPattern(c.n | 0); recordHook(t('pat.name', { n: c.n })); } } break;
    case 'color': if (c.mode === 'orig') setColor({ mode: 'orig', rgb: st.color.rgb }); else if (Array.isArray(c.rgb)) setColor({ mode: 'rgb', rgb: c.rgb.slice(0, 3).map((v) => clamp(v | 0, 0, 255)) }); break;
    case 'colorCycle': st.colorCycle = !!c.on; saveLook(); syncLookUI(); break;
    case 'move': if (MOVES.includes(c.v)) { st.move = c.v; activeScene = -1; saveLook(); syncLookUI(); recordHook(MOVE_DA[st.move]); } break;
    case 'set': if (['size', 'rotSpeed', 'strobe', 'moveSpeed', 'pulse'].includes(c.key)) { st[c.key] = clamp(+c.value || 0, c.key === 'rotSpeed' ? -1 : 0, 1); if (c.key === 'size') st.size = Math.max(0.05, st.size); saveLook(); syncLookUI(); } break;
    case 'master': setMaster(+c.v || 0); break;
    case 'blackout': if (!c.on) setBlackout(true); break;   // telefonen kan altid slukke
    case 'armConfirmed': setBlackout(false); break;         // tænd: telefonen har vist sin egen bekræftelse
    case 'scene': if (scenes[c.i]) { recallScene(c.i); recordHook(scenes[c.i].name); } break;
    case 'auto': if (['off', 'mic', 'laser'].includes(c.mode)) setAuto(c.mode); break;
    case 'tap': tap(); break;
    case 'reset': $('#resetLook').click(); break;
    case 'preset': applyPreset(c.i | 0); break;
    case 'random': randomPreset(); break;
    case 'pos': st.posX = clamp(+c.x || 0, -1, 1); st.posY = clamp(+c.y || 0, -1, 1); saveLook(); syncSizeUI(); break;
    case 'special': setSpecial(c.v === special ? special : c.v); if (c.v === 'off' && special) setSpecial(special); break;
    case 'calstep': calGoto(c.step); break;
    case 'calset': calSet(c.k, +c.v || 0); break;
    case 'center': if (c.k === 'laser') { setSpecial('center'); syncCalUI(); } else { st.posX = 0; st.posY = 0; saveLook(); syncSizeUI(); } break;
    case 'caldone': calDone(); break;
    case 'calbox': setSpecial('calbox'); syncCalUI(); break;
    case 'cal': if (['ox', 'oy', 'sx', 'sy'].includes(c.k)) cfg.cal[c.k] = clamp(+c.v || 0, c.k[0] === 's' ? 0.3 : -1, c.k[0] === 's' ? 2 : 1); if (['ix', 'iy'].includes(c.k)) cfg.cal[c.k] = !!c.v; if (c.k === 'reset') cfg.cal = { ox: 0, oy: 0, sx: 1, sy: 1, ix: false, iy: false }; saveCfg(); if (!$('#pvCal').hidden) syncCalUI(); break;
    case 'zone': cfg.zone = clamp(+c.v || 0, 0, 0.9); saveCfg(); syncZoneUI(); break;
    case 'testLine': setSpecial('line'); break;
  }
});

// ---------- start ----------
setLang(LANG);
dzInit();
startSending();
requestAnimationFrame(showTick);
requestAnimationFrame(previewTick);
refreshPatList();
