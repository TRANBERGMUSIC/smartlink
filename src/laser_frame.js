// laser_frame.js – vektor → laser: datamodel, single-stroke font, geometri og punktoptimering.
// Rene funktioner (ingen DOM). Internt regnes i feltenheder −1…+1 (X højre, Y op, ±1 = fuldt scanfelt);
// kun quantize() laver int16 (−32768…32767) til output-laget. Testes i test/laser_frame.test.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaserFrame = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // ---------- single-stroke font (laser-venlig, inspireret af Hershey simplex) ----------
  // Hvert tegn: { w: bredde, s: [streg, streg …] } på et gitter hvor versalhøjde = 6, grundlinje = 0.
  const O = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
  const A = [[[0, 0], [2, 6], [4, 0]], [[1, 3], [3, 3]]];
  const P = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
  const G = {
    A, B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
    C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]], D: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
    E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]], F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
    G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]], H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
    I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]], J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
    K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1, 3], [4, 0]]], L: [[[0, 6], [0, 0], [4, 0]]],
    M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]], N: [[[0, 0], [0, 6], [4, 0], [4, 6]]], O: [O],
    P: [P], Q: [O, [[2, 2], [4, 0]]], R: [P, [[2, 3], [4, 0]]],
    S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]], T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
    U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]], V: [[[0, 6], [2, 0], [4, 6]]], W: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]],
    X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]], Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]], Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
    'Æ': [[[0, 0], [1.6, 6], [4, 6]], [[0.8, 3], [3.4, 3]], [[2, 6], [2, 0], [4, 0]]], 'Ø': [O, [[0, 0], [4, 6]]], 'Å': [...A, [[1.5, 7], [2, 7.6], [2.5, 7], [2, 6.4], [1.5, 7]]],
    0: [O, [[1, 1], [3, 5]]], 1: [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]], 2: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
    3: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]], [[1, 3], [3, 3]]], 4: [[[3, 0], [3, 6], [0, 2], [4, 2]]],
    5: [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]], 6: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
    7: [[[0, 6], [4, 6], [1, 0]]], 8: [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
    9: [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]],
    '.': [[[2, 0], [2, 0.4]]], ',': [[[2, 0.6], [1.4, -1]]], '!': [[[2, 6], [2, 2]], [[2, 0], [2, 0.4]]], '?': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [2, 3], [2, 2]], [[2, 0], [2, 0.4]]],
    '-': [[[1, 3], [3, 3]]], '+': [[[0, 3], [4, 3]], [[2, 1], [2, 5]]], ':': [[[2, 1], [2, 1.4]], [[2, 4], [2, 4.4]]], "'": [[[2, 6], [2, 4.5]]], '"': [[[1, 6], [1, 4.5]], [[3, 6], [3, 4.5]]],
    '/': [[[0, 0], [4, 6]]], '(': [[[3, 6], [2, 5], [1.6, 3], [2, 1], [3, 0]]], ')': [[[1, 6], [2, 5], [2.4, 3], [2, 1], [1, 0]]], '=': [[[0, 2], [4, 2]], [[0, 4], [4, 4]]],
    '#': [[[1, 0], [1.5, 6]], [[2.5, 0], [3, 6]], [[0, 2], [4, 2]], [[0, 4], [4, 4]]], '_': [[[0, -0.5], [4, -0.5]]], '*': [[[2, 1], [2, 5]], [[0.4, 2], [3.6, 4]], [[0.4, 4], [3.6, 2]]],
    '%': [[[0, 0], [4, 6]], [[0, 6], [1, 6], [1, 5], [0, 5], [0, 6]], [[3, 1], [4, 1], [4, 0], [3, 0], [3, 1]]], '&': [[[4, 0], [1, 4], [1, 5.2], [2, 6], [3, 5.2], [0, 1.5], [1, 0], [2.5, 0], [4, 2]]],
    '@': [[[3, 2], [3, 4], [1.5, 4], [1.5, 2], [3, 2], [4, 3], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [4, 0]]], '<': [[[4, 5], [0, 3], [4, 1]]], '>': [[[0, 5], [4, 3], [0, 1]]],
  };
  const glyph = (ch) => G[ch] || G[ch.toUpperCase()] || (ch === ' ' ? [] : G['?']);

  // tekst → stier (feltenheder). size = versalhøjde i feltenheder.
  function textPaths(text, o = {}) {
    const size = o.size ?? 0.2, sp = o.spacing ?? 1.5, lh = o.lineHeight ?? 1.6, align = o.align || 'center', k = size / 6, cx = o.x ?? 0, cy = o.y ?? 0, color = o.color || [255, 255, 255];
    const lines = String(text || '').split('\n'), out = [];
    const lineW = (ln) => [...ln].reduce((w, ch, i) => w + 4 + (i ? sp : 0), 0) * k;
    const total = (lines.length - 1) * lh * 6 * k + 6 * k;
    lines.forEach((ln, li) => {
      const w = lineW(ln); let x0 = align === 'left' ? cx : align === 'right' ? cx - w : cx - w / 2; const y0 = cy + total / 2 - 6 * k - li * lh * 6 * k;
      [...ln].forEach((ch) => { for (const st of glyph(ch)) out.push({ pts: st.map(([gx, gy]) => [x0 + gx * k, y0 + gy * k]), color, closed: false }); x0 += (4 + sp) * k; });
    });
    return out;
  }

  // ---------- geometri ----------
  function circle(cx, cy, r, color, seg) { const n = seg || Math.max(16, Math.ceil(r * 120)), pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return { pts, color, closed: false }; }
  function arc(cx, cy, r, a0, a1, color) { const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r * 20)), pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return { pts, color, closed: false }; }
  function rect(x0, y0, x1, y1, color) { return { pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], color, closed: true }; }
  function bezier(p0, p1, p2, p3, maxSeg = 0.02) { // kubisk bézier → polylinje (adaptiv nok til laser)
    const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3), n = Math.max(4, Math.ceil(len / maxSeg)), pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
    return pts;
  }
  function transformPaths(paths, { x = 0, y = 0, scale = 1, rot = 0 } = {}) { const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180); return paths.map((p) => ({ ...p, pts: p.pts.map(([a, b]) => [x + (a * c - b * s) * scale, y + (a * s + b * c) * scale]) })); }

  // ---------- punktoptimering ----------
  const DEFAULTS = { pps: 20000, fps: 30, maxStep: 0.015, blankStep: 0.015, anchor: 3, cornerAngle: 30, cornerDwell: 4, derate: 0.5, minVisible: 4, minExtent: 0.02, maxSimplify: 3 };
  function effectivePps(o, extent) { // scanvinkel-derate: brede billeder kan ikke tegnes med fuld pps
    const e = clamp(extent ?? 1, 0, 1); return Math.max(1000, o.pps * (1 - clamp(o.derate, 0, 0.95) * clamp((e - 0.1) / 0.9, 0, 1)));
  }
  function interp(a, b, step) { const d = dist(a, b), n = Math.max(1, Math.ceil(d / step)), out = []; for (let i = 1; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return out; }
  function orderPaths(paths, start = [0, 0]) { // nearest neighbour; åbne stier må vendes
    const left = paths.map((p) => ({ ...p, pts: p.closed ? [...p.pts, p.pts[0]] : p.pts.slice() })).filter((p) => p.pts.length);
    const out = []; let cur = start;
    while (left.length) {
      let bi = 0, rev = false, bd = Infinity;
      left.forEach((p, i) => { const d0 = dist(cur, p.pts[0]); if (d0 < bd) { bd = d0; bi = i; rev = false; } const d1 = dist(cur, p.pts[p.pts.length - 1]); if (d1 < bd) { bd = d1; bi = i; rev = true; } });
      const p = left.splice(bi, 1)[0]; if (rev) p.pts.reverse(); out.push(p); cur = p.pts[p.pts.length - 1];
    }
    return out;
  }
  function build(paths, o, step) { // stier → punktliste (felt-enheder) med blanking, ankre og hjørne-dwell
    const pts = [], push = (x, y, c, blank) => pts.push({ x: clamp(x, -1, 1), y: clamp(y, -1, 1), r: blank ? 0 : c[0], g: blank ? 0 : c[1], b: blank ? 0 : c[2], blank: !!blank });
    const ordered = orderPaths(paths); if (!ordered.length) return pts;
    let cur = ordered[0].pts[0];
    push(cur[0], cur[1], [0, 0, 0], true); // første punkt blanket
    for (const p of ordered) {
      const s0 = p.pts[0];
      for (const q of interp(cur, s0, o.blankStep)) push(q[0], q[1], [0, 0, 0], true); // blanket rejse (scanneren skal nå frem)
      for (let k = 0; k < o.anchor; k++) push(s0[0], s0[1], [0, 0, 0], true); // vent blanket før tænd
      for (let k = 0; k < o.anchor; k++) push(s0[0], s0[1], p.color, false);
      let prev = s0;
      for (let i = 1; i < p.pts.length; i++) {
        const q = p.pts[i]; for (const r of interp(prev, q, step)) push(r[0], r[1], p.color, false);
        if (i < p.pts.length - 1) { // hjørne: gentag punktet efter hvor skarpt det drejer
          const a = p.pts[i - 1], c = p.pts[i + 1], v1 = [q[0] - a[0], q[1] - a[1]], v2 = [c[0] - q[0], c[1] - q[1]], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
          if (l1 > 1e-9 && l2 > 1e-9) { const turn = Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2), -1, 1)) * 180 / Math.PI; if (turn >= o.cornerAngle) { const n = Math.round(o.cornerDwell * turn / 180); for (let k = 0; k < n; k++) push(q[0], q[1], p.color, false); } }
        }
        prev = q;
      }
      for (let k = 0; k < o.anchor; k++) push(prev[0], prev[1], p.color, false); // ankre slutpunktet tændt
      push(prev[0], prev[1], [0, 0, 0], true); cur = prev;
    }
    const first = ordered[0].pts[0]; for (const q of interp(cur, first, o.blankStep)) push(q[0], q[1], [0, 0, 0], true); // tilbage til start blanket – intet streg ved loop
    pts[pts.length - 1].blank = true;
    return pts;
  }
  function extentOf(pts) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0; for (const p of pts) if (!p.blank) { n++; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } return n ? { w: x1 - x0, h: y1 - y0, n, max: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)) } : { w: 0, h: 0, n: 0, max: 0 }; }

  // frame = stier → optimeret punktliste + statistik. Overskrides punktbudgettet forenkles der (større trin) og ellers sænkes fps – det står i stats, aldrig stiltiende.
  function optimize(paths, opts = {}) {
    const o = { ...DEFAULTS, ...opts }; let step = o.maxStep, pts = build(paths, o, step), simplified = 1;
    const ext = extentOf(pts), pps = effectivePps(o, ext.max); let budget = Math.floor(pps / o.fps);
    while (pts.length > budget && simplified < o.maxSimplify) { simplified = Math.min(o.maxSimplify, simplified * 1.25); pts = build(paths, { ...o, blankStep: o.blankStep * simplified, anchor: Math.max(2, Math.round(o.anchor / simplified)) }, step * simplified); }
    const fps = pts.length > budget ? pps / Math.max(1, pts.length) : o.fps; const ex2 = extentOf(pts);
    let safe = true, reason = '';
    if (ex2.n < o.minVisible) { safe = false; reason = 'too-few-points'; }
    else if (Math.max(ex2.w, ex2.h) < o.minExtent) { safe = false; reason = 'too-small'; }
    return { points: pts, stats: { count: pts.length, visible: ex2.n, pps: Math.round(pps), budget, fps: Math.round(fps * 10) / 10, wantFps: o.fps, fpsReduced: fps < o.fps - 0.01, simplified: Math.round(simplified * 100) / 100, safe, reason, extent: ex2 } };
  }
  function blankFrame(n = 8) { const p = []; for (let i = 0; i < n; i++) p.push({ x: 0, y: 0, r: 0, g: 0, b: 0, blank: true }); return p; }
  function quantize(points, intensity = 1) { // felt → int16 + intensitets-master (output-laget)
    const k = clamp(intensity, 0, 1); return points.map((p) => ({ x: clamp(Math.round(p.x * 32767), -32768, 32767), y: clamp(Math.round(p.y * 32767), -32768, 32767), r: p.blank ? 0 : Math.round(p.r * k), g: p.blank ? 0 : Math.round(p.g * k), b: p.blank ? 0 : Math.round(p.b * k), blank: !!p.blank }));
  }
  // live via DAC: laserens egen sikkerhedszone virker ikke på ILDA-indgangen, så punkter uden for den gemte projektionszone
  // eller under sikkerhedslinjen blankes her (positionen bevares, så scanneren ikke springer). zone = {l,r,b,t}, line = y-grænse (eller null).
  function clipZone(points, zone, line) {
    const z = zone || { l: -1, r: 1, b: -1, t: 1 }, lo = line == null ? z.b : Math.max(z.b, line);
    return points.map((p) => { const x = clamp(p.x, z.l, z.r), y = clamp(p.y, lo, z.t), out = x !== p.x || y !== p.y || p.y < lo; return out && !p.blank ? { ...p, x, y, r: 0, g: 0, b: 0, blank: true } : { ...p, x, y }; });
  }
  function safeForOutput(frame) { return frame && frame.stats && frame.stats.safe ? frame.points : blankFrame(); } // aldrig en statisk stråle

  return { DEFAULTS, GLYPHS: G, textPaths, circle, arc, rect, bezier, transformPaths, orderPaths, optimize, effectivePps, quantize, blankFrame, safeForOutput, clipZone, extentOf };
});
