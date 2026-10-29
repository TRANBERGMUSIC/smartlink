/* SmartLink – stråle-effekter (beam show) til laserens SD-kort. Rene funktioner, ingen DOM (testes i test/beams.test.js).
 * En "stråle" er ét punkt i laserens felt, som holdes tændt et øjeblik (dwell). I røg/hazer ses det som en stråle fra laseren ud i rummet.
 * En "flade" er en linje der scannes hurtigt – i røg bliver den til en lysflade (liquid sky, kegle).
 * Felt: x −1 (venstre) … 1 (højre), y −1 (ned) … 1 (op). Strålerne lægges som standard i den øverste halvdel – over publikum.
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.BeamFX = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MODES = ['fan', 'sweep', 'cross', 'wave', 'cone', 'chase', 'chaos', 'sky', 'net'];
  const COLORS = ['rainbow', 'flow', 'palette', 'paletteFlow', 'white'];
  const DEF = { mode: 'cross', beams: 8, spread: 1.5, height: 0.45, amp: 0.25, frames: 48, fps: 25, dwell: 8, colors: 'rainbow', c1: [255, 0, 60], c2: [0, 120, 255], palette: [[0, 255, 0], [255, 0, 0]], split: 'alt', seed: 7, zone: null, minY: null };

  function hsv(h, s = 1, v = 1) { h = ((h % 1) + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]; }
  // farve til stråle i af n på tidspunkt t (0..1)
  function colorFor(o, i, n, t) {
    switch (o.colors) {
      case 'flow': return hsv(i / Math.max(1, n) + t);
      case 'palette': case 'paletteFlow': { // egne farver i den rækkefølge man har valgt (fx grøn, rød, grøn, rød …); "skiftende" ruller dem hen over strålerne
        const P = o.palette && o.palette.length ? o.palette : [o.c1, o.c2], k = o.colors === 'paletteFlow' ? Math.floor(t * P.length * 2) : 0;
        const j = o.split === 'block' ? Math.min(P.length - 1, Math.floor(i * P.length / Math.max(1, n))) : i; // blokke: halv/halv, tredjedele, kvarte … (i stedet for skiftevis)
        return P[(j + k) % P.length].slice();
      }
      case 'two': return i % 2 ? o.c2.slice() : o.c1.slice();
      case 'one': return o.c1.slice();
      case 'white': return [255, 255, 255];
      default: return hsv(i / Math.max(1, n));
    }
  }
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }
  const spreadX = (i, n, w, c = 0) => c + (n < 2 ? 0 : (i / (n - 1) - 0.5) * w);

  // én frame: { beams: [{x,y,c}], lines: [{a:[x,y], b:[x,y], c}] }
  function frame(opts, fi) {
    const o = { ...DEF, ...opts }, n = clamp(o.beams | 0, 1, 24), F = Math.max(1, o.frames | 0), t = (fi % F) / F, w = clamp(o.spread, 0.05, 1.95), y0 = clamp(o.height, -0.9, 0.95), A = o.amp;
    const beams = [], lines = [], put = (x, y, c) => beams.push({ x: clamp(x, -1, 1), y: clamp(y, -1, 1), c });
    switch (o.mode) {
      case 'fan': { const k = 0.55 + 0.45 * Math.sin(TAU * t); for (let i = 0; i < n; i++) put(spreadX(i, n, w * k), y0, colorFor(o, i, n, t)); break; }
      case 'sweep': { const ww = w * 0.35, c = Math.sin(TAU * t) * (1 - ww / 2 - 0.02); for (let i = 0; i < n; i++) put(spreadX(i, n, ww, c), y0 + A * 0.3 * Math.cos(TAU * t), colorFor(o, i, n, t)); break; }
      case 'cross': { // to vifter der krydser hinanden – "laser-net" i luften
        const h = Math.ceil(n / 2), ww = w * 0.5, s = Math.sin(TAU * t) * (1 - ww / 2) * 0.9;
        for (let i = 0; i < h; i++) put(spreadX(i, h, ww, -s), y0 + A * Math.sin(TAU * (t + i / h)) * 0.5, colorFor(o, i, n, t));
        for (let i = 0; i < n - h; i++) put(spreadX(i, n - h, ww, s), y0 + A * Math.sin(TAU * (t + 0.5 + i / h)) * 0.5, colorFor(o, h + i, n, t));
        break;
      }
      case 'wave': for (let i = 0; i < n; i++) put(spreadX(i, n, w), y0 + A * Math.sin(TAU * (t + i / n)), colorFor(o, i, n, t)); break;
      case 'cone': { const r = w * 0.3, cy = y0; for (let i = 0; i < n; i++) { const a = TAU * (i / n + t); put(Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, colorFor(o, i, n, t)); } break; }
      case 'chase': { const k = Math.floor(t * n * 2) % (n * 2), pos = k < n ? k : 2 * n - 1 - k; for (let j = 0; j < 3; j++) { const i = pos - j; if (i >= 0 && i < n) put(spreadX(i, n, w), y0, colorFor(o, i, n, t)); } break; }
      case 'chaos': { const step = Math.floor(fi / 3), r = rng(o.seed * 7919 + step * 104729 + 1); for (let i = 0; i < n; i++) put((r() * 2 - 1) * w / 2, y0 + (r() * 2 - 1) * A, colorFor(o, i, n, t + r())); break; }
      case 'sky': { // bølgende flade (liquid sky): en linje i højden y0 der bølger
        const seg = 10; let prev = null; for (let k = 0; k <= seg; k++) { const x = spreadX(k, seg + 1, w), y = y0 + A * 0.5 * Math.sin(TAU * (t + k / seg)), p = [x, y]; if (prev) lines.push({ a: prev, b: p, c: colorFor(o, k, seg, t) }); prev = p; } break;
      }
      case 'net': { // to skrå linjer der drejer – krydsende flader
        const a = Math.sin(TAU * t) * 0.6, r = w / 2;
        for (const [s, ci] of [[1, 0], [-1, 1]]) { const ang = s * (0.5 + a); lines.push({ a: [-Math.cos(ang) * r, y0 - Math.sin(ang) * r * 0.5], b: [Math.cos(ang) * r, y0 + Math.sin(ang) * r * 0.5], c: colorFor(o, ci, 2, t) }); }
        break;
      }
    }
    // sikkerhed: alt holdes inden for projektionszonen og over sikkerhedslinjen (aldrig ned mod publikum)
    const z = o.zone || { l: -1, r: 1, b: -1, t: 1 }, lo = Math.max(z.b, o.minY == null ? -1 : o.minY + 0.03) , hi = z.t - 0.01, L = z.l + 0.01, R = z.r - 0.01;
    const cx = (x) => clamp(x, L, R), cy = (y) => clamp(y, Math.min(lo, hi), hi);
    for (const b of beams) { b.x = cx(b.x); b.y = cy(b.y); }
    for (const l of lines) { l.a = [cx(l.a[0]), cy(l.a[1])]; l.b = [cx(l.b[0]), cy(l.b[1])]; }
    return { beams, lines };
  }
  // hele effekten som Vektor-dokument (frames → lag → items). Strålerne bliver items af typen "beam", fladerne "line" med egen farve.
  function toDoc(opts) {
    const o = { ...DEF, ...opts }, F = clamp(o.frames | 0, 1, 240), frames = [];
    for (let fi = 0; fi < F; fi++) {
      const f = frame(o, fi), items = [];
      for (const b of f.beams) items.push({ type: 'beam', a: [b.x, b.y], c: b.c, dwell: o.dwell | 0 });
      for (const l of f.lines) items.push({ type: 'line', a: l.a, b: l.b, c: l.c });
      frames.push({ layers: [{ name: 'Stråler', color: '#ffffff', visible: true, items }] });
    }
    return { frames };
  }
  const NAMES = { fan: 'VIFTE', sweep: 'SWEEP', cross: 'KRYDS', wave: 'BOLGE', cone: 'KEGLE', chase: 'JAGT', chaos: 'KAOS', sky: 'FLADE', net: 'NET' };
  const shortName = (o) => (NAMES[o.mode] || 'BEAM').slice(0, 5) + ({ rainbow: 'RB', flow: 'FL', palette: 'EG', paletteFlow: 'SK', two: '2F', one: '1F', white: 'HV' }[o.colors] || '');
  return { MODES, COLORS, DEF, frame, toDoc, colorFor, hsv, shortName };
});
