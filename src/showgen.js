/* SmartLink – automatisk show-designer.
 * Analyserer hele sangen offline (bas/mellem/diskant-energi, slag, tempo, stille passager, drops)
 * og bygger cues på tidslinjen. Ord fra sangen (hvis fundet) lægges ind som tekst-mønstre.
 */
'use strict';

// ---------- lydanalyse ----------
async function analyzeSong(audioBuffer, onProgress) {
  const sr = audioBuffer.sampleRate, ch = audioBuffer.getChannelData(0), N = ch.length;
  const hop = Math.round(sr * 0.0116), win = 2048;             // ~86 analyser pr. sekund
  const frames = Math.floor((N - win) / hop);
  const bass = new Float32Array(frames), mid = new Float32Array(frames), hi = new Float32Array(frames), rms = new Float32Array(frames);
  // simpel båndenergi via tidsdomæne-filtre (hurtigere end FFT pr. frame og rigeligt til dette)
  const lp = onePole(ch, sr, 150, 'low'), hp = onePole(ch, sr, 4000, 'high');
  for (let f = 0; f < frames; f++) {
    const o = f * hop; let eb = 0, eh = 0, ea = 0;
    for (let i = 0; i < win; i += 2) { const a = ch[o + i], b = lp[o + i], h = hp[o + i]; ea += a * a; eb += b * b; eh += h * h; }
    rms[f] = Math.sqrt(ea / (win / 2)); bass[f] = Math.sqrt(eb / (win / 2)); hi[f] = Math.sqrt(eh / (win / 2)); mid[f] = Math.max(0, rms[f] - bass[f] * 0.7 - hi[f] * 0.7);
    if (onProgress && f % 500 === 0) { onProgress(f / frames * 0.7); await new Promise((r) => setTimeout(r, 0)); }
  }
  const fps = sr / hop;
  // onsets i bas (kick) og samlet (snare mm.)
  const kicks = onsets(bass, fps, 0.18), hits = onsets(rms, fps, 0.14);
  // tempo fra kick-intervaller (median, foldet ind i 70–180 BPM)
  const iv = []; for (let i = 1; i < kicks.length; i++) iv.push(kicks[i] - kicks[i - 1]);
  let bpm = 120;
  if (iv.length > 8) { const so = iv.slice().sort((a, b) => a - b); let b = 60 / so[so.length >> 1]; while (b < 70) b *= 2; while (b > 180) b /= 2; bpm = b; }
  // energi-kurve pr. 0,5 s (glattet) → sektioner
  const seg = Math.round(fps * 0.5), nseg = Math.floor(frames / seg);
  const E = new Float32Array(nseg), B = new Float32Array(nseg), Hh = new Float32Array(nseg);
  for (let s = 0; s < nseg; s++) { let e = 0, b = 0, h = 0; for (let f = s * seg; f < (s + 1) * seg; f++) { e += rms[f]; b += bass[f]; h += hi[f]; } E[s] = e / seg; B[s] = b / seg; Hh[s] = h / seg; }
  const maxE = Math.max(...E) || 1, maxB = Math.max(...B) || 1;
  for (let s = 0; s < nseg; s++) { E[s] /= maxE; B[s] /= maxB; }
  const Es = smooth(E, 4), Bs = smooth(B, 4);
  // sektioner: silent / low / mid / high – og drops (bas kommer igen efter lav bas i ≥3 s, med stigende energi)
  const sections = []; let cur = null;
  const level = (s) => (Es[s] < 0.08 ? 'silent' : Es[s] < 0.35 ? 'low' : Es[s] < 0.65 ? 'mid' : 'high');
  for (let s = 0; s < nseg; s++) { const L = level(s); if (!cur || cur.level !== L) { cur = { level: L, start: s * 0.5, end: (s + 1) * 0.5 }; sections.push(cur); } else cur.end = (s + 1) * 0.5; }
  // slå meget korte sektioner sammen med naboen
  const merged = []; for (const sc of sections) { const last = merged[merged.length - 1]; if (last && sc.end - sc.start < 2) last.end = sc.end; else merged.push(sc); }
  const drops = [];
  for (let s = 4; s < nseg; s++) {
    const beforeB = avg(Bs, s - 6, s), afterB = avg(Bs, s, Math.min(nseg, s + 3));
    const beforeE = avg(Es, s - 6, s), afterE = avg(Es, s, Math.min(nseg, s + 3));
    // bassen kommer igen (eller stiger kraftigt) efter en roligere passage – og energien stiger
    const bassReturn = beforeB < 0.35 && afterB > 0.55;
    const surge = afterE > beforeE * 1.6 && afterE > 0.45 && afterB > 0.5;
    if ((bassReturn || surge) && (!drops.length || s * 0.5 - drops[drops.length - 1] > 8)) {
      // snap til nærmeste kick
      const tSec = s * 0.5; let best = tSec, dmin = 1e9; for (const k of kicks) { const d = Math.abs(k - tSec); if (d < dmin) { dmin = d; best = k; } }
      drops.push(dmin < 0.6 ? best : tSec);
    }
  }
  if (onProgress) onProgress(0.85);
  return { duration: N / sr, bpm, kicks, hits, sections: merged, drops, energy: Array.from(Es), bassCurve: Array.from(Bs), hiCurve: Array.from(smooth(Hh, 4)) };
}
function onePole(x, sr, fc, type) {
  const out = new Float32Array(x.length); const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0;
  for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; out[i] = type === 'low' ? y : x[i] - y; }
  return out;
}
function onsets(sig, fps, minGapSec) {
  const n = sig.length, out = []; const w = Math.round(fps * 1.0); let last = -1e9;
  for (let i = 2; i < n; i++) {
    let m = 0, c = 0; for (let j = Math.max(0, i - w); j < i; j++) { m += sig[j]; c++; } m /= c || 1;
    if (sig[i] > m * 1.5 && sig[i] > sig[i - 1] && sig[i] > sig[i - 2] * 1.1 && sig[i] > 0.01 && i / fps - last > minGapSec) { out.push(i / fps); last = i / fps; }
  }
  return out;
}
function smooth(a, r) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; c++; } o[i] = s / c; } return o; }
function avg(a, i0, i1) { let s = 0, c = 0; for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { s += a[i]; c++; } return c ? s / c : 0; }

// ---------- show-bygger ----------
// opts: { patterns: [n...], textPatterns: [{t, n}], palette: 'auto'|'warm'|'cold'|'rainbow', density: 0..1 }
function buildShow(an, opts) {
  const pool = opts.patterns && opts.patterns.length ? opts.patterns : Array.from({ length: 28 }, (_, i) => i + 1);
  const rnd = mulberry32(Math.round(an.duration * 1000));
  const pick = (arr, not) => { const a = arr.filter((x) => x !== not); return a.length ? a[Math.floor(rnd() * a.length)] : arr[0]; };
  const PAL = {
    warm: [[255, 0, 0], [255, 90, 0], [255, 220, 0], [255, 0, 160], [255, 170, 90]],
    cold: [[0, 40, 255], [0, 255, 255], [140, 0, 255], [0, 255, 0], [255, 255, 255]],
    rainbow: null,
    auto: [[255, 0, 0], [0, 40, 255], [0, 255, 0], [255, 220, 0], [0, 255, 255], [255, 0, 160], [140, 0, 255], [255, 255, 255]],
  };
  const palette = PAL[opts.palette] || PAL.auto;
  const base = { moveAmt: 0.4, moveSpeed: 0.3, rotSpeed: 0, rotAngle: 0, strobe: 0, pulse: 0, colorCycle: false, colorCycleSpeed: 0.3, size: 0.8, fps: 0.5, move: 'none', color: { mode: 'rgb', rgb: [255, 255, 255] } };
  const cues = [];
  let lastPat = null, hue = rnd();
  const color = (lvl) => {
    if (!palette) { hue = (hue + 0.17) % 1; return { mode: 'rgb', rgb: hsv(hue, 1, 1) }; }
    return { mode: 'rgb', rgb: palette[Math.floor(rnd() * palette.length)].slice() };
  };
  const add = (t, label, look) => { cues.push({ t: Math.round(t * 100) / 100, label, look: Object.assign(structuredClone(base), look) }); };
  const beat = 60 / an.bpm;
  const density = opts.density ?? 0.5;
  for (const sec of an.sections) {
    const len = sec.end - sec.start;
    if (sec.level === 'silent') { add(sec.start, '· pause', { size: 0.3, color: { mode: 'rgb', rgb: [0, 40, 255] }, rotSpeed: 0.03 }); continue; }
    // hvor ofte skifter vi i denne sektion (i beats)
    const every = sec.level === 'high' ? (density > 0.6 ? 2 : 4) : sec.level === 'mid' ? 8 : 16;
    const step = beat * every;
    for (let t = sec.start; t < sec.end - 0.5; t += step) {
      // snap til nærmeste kick (<0,15 s), så skiftene rammer slaget
      let tt = t; let dmin = 1e9; for (const k of an.kicks) { const d = Math.abs(k - t); if (d < dmin) { dmin = d; tt = k; } if (k > t + 0.5) break; }
      if (dmin > 0.15) tt = t;
      const pat = pick(pool, lastPat); lastPat = pat;
      let look;
      if (sec.level === 'low') look = { pattern: pat, color: color('low'), size: 0.5 + rnd() * 0.2, rotSpeed: (rnd() - 0.5) * 0.15, move: rnd() < 0.3 ? 'circle' : 'none', moveAmt: 0.15, moveSpeed: 0.1, fps: 0.3 };
      else if (sec.level === 'mid') look = { pattern: pat, color: color('mid'), size: 0.65 + rnd() * 0.25, rotSpeed: (rnd() - 0.5) * 0.5, move: pick(['none', 'circle', 'sweep', 'eight'], null), moveAmt: 0.25 + rnd() * 0.25, moveSpeed: 0.2 + rnd() * 0.2, pulse: 0.3 };
      else look = { pattern: pat, color: rnd() < 0.25 ? { mode: 'rgb', rgb: [255, 255, 255] } : color('high'), colorCycle: rnd() < 0.2, colorCycleSpeed: 0.6, size: 0.8 + rnd() * 0.2, rotSpeed: (rnd() - 0.5) * 1.2, move: pick(['circle', 'eight', 'sweep', 'bounce'], null), moveAmt: 0.4 + rnd() * 0.4, moveSpeed: 0.4 + rnd() * 0.4, pulse: 0.6, fps: 0.6 };
      add(tt, `#${pat}`, look);
    }
  }
  // drops: stort skift + strobe-kick 1 beat før og hvid flash på slaget
  for (const d of an.drops) {
    const pat = pick(pool, lastPat); lastPat = pat;
    add(Math.max(0, d - beat), '⚡ build', { pattern: pat, color: { mode: 'rgb', rgb: [255, 255, 255] }, size: 0.5, strobe: 0.5, rotSpeed: 1 });
    add(d, '⚡ DROP', { pattern: pat, colorCycle: true, colorCycleSpeed: 0.9, size: 1, move: 'eight', moveAmt: 0.7, moveSpeed: 0.7, rotSpeed: 0.8, pulse: 0.8, fps: 0.7 });
  }
  // ord fra sangen → tekst-mønstre (hvis vi har dem)
  for (const w of opts.words || []) {
    add(w.t, `“${w.text}”`, { pattern: w.pattern, color: { mode: 'rgb', rgb: [255, 255, 255] }, size: 0.9, move: 'none', rotSpeed: 0, pulse: 0.3 });
  }
  // outro: tone ned de sidste 3 sek
  if (an.duration > 10) add(an.duration - 3, '· slut', { pattern: pool[0], color: { mode: 'rgb', rgb: [0, 40, 255] }, size: 0.3, rotSpeed: 0.05 });
  cues.sort((a, b) => a.t - b.t);
  // fjern cues der ligger for tæt (<0,12 s) – behold den sidste
  const out = []; for (const c of cues) { const l = out[out.length - 1]; if (l && c.t - l.t < 0.12) out[out.length - 1] = c; else out.push(c); }
  return out;
}
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
