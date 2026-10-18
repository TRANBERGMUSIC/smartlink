/* SmartLink – Designer: tekst, figurer og frihåndstegning → .ild-filer til laserens SD-kort.
 * Alle figurer laves som "strokes": lister af punkter i -1..1 (x til højre, y op). Blank (slukket) mellem strokes.
 */
'use strict';

// ---------- tekst → streger ----------
// Vi tegner teksten med canvas-font i stor opløsning, finder konturerne og vectoriserer dem.
// Det giver en "outline"-skrift som en rigtig laser-tekst. Virker med alle tegn, også æøå.
function textToStrokes(text, { size = 0.7, bold = 2 } = {}) {
  if (!text.trim()) return [];
  const W = 1024, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = 300; g.font = `700 ${px}px "Helvetica Neue", Arial, sans-serif`;
  const tw = g.measureText(text).width;
  if (tw > W * 0.92) { px = (px * W * 0.92) / tw; g.font = `700 ${px}px "Helvetica Neue", Arial, sans-serif`; }
  g.fillText(text, W / 2, H / 2);
  // tynd skrift: lav en "skelet"-agtig outline ved at tegne konturer (marching squares på bitmap)
  const img = g.getImageData(0, 0, W, H).data;
  const step = 4; // samplingsopløsning
  const cols = Math.floor(W / step), rows = Math.floor(H / step);
  const grid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) grid[r * cols + c] = img[((r * step) * W + c * step) * 4] > 128 ? 1 : 0;
  const segs = marchingSquares(grid, cols, rows);
  let strokes = chainSegments(segs).filter((p) => p.length > 6).map((poly) => poly.map(([x, y]) => [((x * step) / W) * 2 - 1, -(((y * step) / H) * 2 - 1)]));
  // skalér til ønsket størrelse (bredden) – bevar højde/bredde-forhold (canvas er 2:1)
  const b = bounds(strokes); const sc = (size * 1.9) / Math.max(b.w, 0.01);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  let sy = 2 * 0.8; // canvas er 2:1 bred → ret højden op igen (lidt mindre end 2 for pænere bogstaver)
  if (b.h * sc * sy > 1.8) sy = 1.8 / (b.h * sc);
  strokes = strokes.map((p) => p.map(([x, y]) => [clampv((x - cx) * sc), clampv((y - cy) * sc * sy)]));
  strokes = strokes.map((p) => simplify(p, 0.008)).map((p) => resample(p, 0.03));
  // "tykkelse": tegn konturen flere gange let forskudt (laseren får mere lys i stregen)
  if (bold > 1) {
    const extra = [];
    for (let k = 1; k < bold; k++) { const d = 0.006 * k; for (const p of strokes) extra.push(p.map(([x, y]) => [clampv(x + d), clampv(y - d)])); }
    strokes = strokes.concat(extra);
  }
  return strokes;
}
const clampv = (v) => Math.max(-1, Math.min(1, v));

// marching squares → linjestykker (på celle-kanter)
function marchingSquares(grid, cols, rows) {
  const segs = [];
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : grid[r * cols + c]);
  for (let r = -1; r < rows; r++) for (let c = -1; c < cols; c++) {
    const tl = at(c, r), tr = at(c + 1, r), br = at(c + 1, r + 1), bl = at(c, r + 1);
    const idx = tl * 8 + tr * 4 + br * 2 + bl;
    if (idx === 0 || idx === 15) continue;
    const x = c + 1, y = r + 1; // celle-centrum i grid-koordinater (+1 offset)
    const T = [x, y - 0.5], R = [x + 0.5, y], B = [x, y + 0.5], L = [x - 0.5, y];
    const add = (a, b) => segs.push([a, b]);
    switch (idx) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 5: add(L, T); add(B, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(L, T); break;
      case 10: add(T, R); add(L, B); break;
    }
  }
  return segs;
}
function chainSegments(segs) {
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const map = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!map.has(k)) map.set(k, []); map.get(k).push(i); } });
  const used = new Uint8Array(segs.length), polys = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1;
    const poly = [segs[i][0], segs[i][1]];
    for (let dir = 0; dir < 2; dir++) {
      let guard = 0;
      while (guard++ < 100000) {
        const end = dir === 0 ? poly[poly.length - 1] : poly[0];
        const cands = (map.get(key(end)) || []).filter((j) => !used[j]);
        if (!cands.length) break;
        const j = cands[0]; used[j] = 1;
        const [a, b] = segs[j]; const nxt = key(a) === key(end) ? b : a;
        if (dir === 0) poly.push(nxt); else poly.unshift(nxt);
      }
    }
    polys.push(poly);
  }
  return polys;
}
// Douglas-Peucker forenkling – lukkede kurver deles først ved det fjerneste punkt, ellers kollapser de
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a0, b0] = [pts[0], pts[pts.length - 1]];
  if (Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < eps * 2) {
    let far = 1, dmax = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - a0[0], pts[i][1] - a0[1]); if (d > dmax) { dmax = d; far = i; } }
    const p1 = simplifyOpen(pts.slice(0, far + 1), eps), p2 = simplifyOpen(pts.slice(far), eps);
    return p1.slice(0, -1).concat(p2);
  }
  return simplifyOpen(pts, eps);
}
function simplifyOpen(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax > eps) { const l = simplifyOpen(pts.slice(0, idx + 1), eps), r = simplifyOpen(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [a, b];
}
function perpDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1e-9; return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; }
// jævn punktafstand (laseren tegner pænest med jævne punkter)
function resample(pts, d) {
  if (pts.length < 2) return pts;
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = out[out.length - 1]; const [x1, y1] = pts[i];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (acc + seg >= d) { const tt = (d - acc) / seg; const nx = x0 + (x1 - x0) * tt, ny = y0 + (y1 - y0) * tt; out.push([nx, ny]); x0 = nx; y0 = ny; seg = Math.hypot(x1 - x0, y1 - y0); acc = 0; }
    acc += seg;
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function bounds(strokes) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of strokes) for (const [x, y] of p) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (minX > maxX) return { minX: -1, maxX: 1, minY: -1, maxY: 1, w: 2, h: 2 };
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

// ---------- figurer ----------
const SHAPES = {
  circle: ({ size }) => [ring(size, 96)],
  poly: ({ size, sides }) => [resample(ring(size, sides, true), 0.04)],
  star: ({ size, sides }) => { const p = []; const n = Math.max(3, sides); for (let i = 0; i <= n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? size * 0.45 : size; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return [resample(p, 0.03)]; },
  heart: ({ size }) => { const p = []; for (let i = 0; i <= 120; i++) { const t = (i / 120) * Math.PI * 2; p.push([(16 * Math.sin(t) ** 3) / 17 * size, ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17) * size]); } return [p]; },
  spiral: ({ size, sides }) => { const p = []; const turns = Math.max(2, sides / 2); for (let i = 0; i <= 300; i++) { const t = i / 300; const a = t * turns * Math.PI * 2; p.push([Math.cos(a) * t * size, Math.sin(a) * t * size]); } return [p]; },
  lines: ({ size, sides }) => { const out = []; const n = Math.max(2, Math.min(12, sides)); for (let i = 0; i < n; i++) { const y = -size + (2 * size * i) / (n - 1); out.push(resample([[-size, y], [size, y]], 0.05)); } return out; },
  grid: ({ size, sides }) => { const out = []; const n = Math.max(2, Math.min(8, sides)); for (let i = 0; i < n; i++) { const v = -size + (2 * size * i) / (n - 1); out.push(resample([[-size, v], [size, v]], 0.06)); out.push(resample([[v, -size], [v, size]], 0.06)); } return out; },
  arrow: ({ size }) => [resample([[-size, 0], [size * 0.4, 0]], 0.04), resample([[size * 0.1, size * 0.45], [size, 0], [size * 0.1, -size * 0.45]], 0.04)],
};
function ring(r, n, closed = false) { const p = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return closed ? p : resample(p, 0.03); }

// ---------- animation: strokes → frames ----------
function keepRgb(src, dst) { dst.forEach((p, i) => { if (src[i] && src[i].rgb) p.rgb = src[i].rgb; }); return dst; }
function animateStrokes(strokes, kind, frames = 40) {
  const out = animateStrokesRaw(strokes, kind, frames);
  return out.map((fr) => (fr.length === strokes.length ? keepRgb(strokes, fr) : fr));
}
function animateStrokesRaw(strokes, kind, frames = 40) {
  const out = [];
  const total = strokes.reduce((a, p) => a + p.length, 0);
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    let fr;
    switch (kind) {
      case 'rotate': { const a = t * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); fr = strokes.map((p) => p.map(([x, y]) => [x * c - y * s, x * s + y * c])); break; }
      case 'pulse': { const k = 0.75 + 0.25 * Math.sin(t * Math.PI * 2); fr = strokes.map((p) => p.map(([x, y]) => [x * k, y * k])); break; }
      case 'wave': { fr = strokes.map((p) => p.map(([x, y]) => [x, clampv(y + 0.12 * Math.sin(x * 4 + t * Math.PI * 2))])); break; }
      case 'write': { // tegn teksten frem lidt ad gangen
        const n = Math.max(2, Math.round(total * Math.min(1, t * 1.15))); let left = n; fr = [];
        for (const p of strokes) { if (left <= 0) break; fr.push(p.slice(0, Math.min(p.length, left))); left -= p.length; }
        break; }
      default: fr = strokes;
    }
    out.push(fr);
  }
  return kind === 'none' ? [strokes] : out;
}

// ---------- ILDA-eksport (format 5: 2D, ægte farver) ----------
function strokesToIldFrame(strokes, rgb) {
  // mellem strokes: blank-flyt (slukket) + "anker"-punkter så scanneren når frem før lyset tændes
  const pts = [];
  for (const p of strokes) {
    if (!p.length) continue;
    const [sx, sy] = p[0], col = p.rgb || rgb;
    for (let k = 0; k < 3; k++) pts.push([sx, sy, 1, col]);            // blank: scanner flytter + stabiliserer
    for (const [x, y] of p) pts.push([x, y, 0, col]);
    const [ex, ey] = p[p.length - 1]; pts.push([ex, ey, 0, col]); pts.push([ex, ey, 1, col]);
  }
  return pts;
}
function encodeIld(frames, rgb, name = 'LIGHTLNK') {
  rgb = rgb || [255, 255, 255];
  const parts = [];
  const header = (n, fi, total) => {
    const b = new Uint8Array(32); const dv = new DataView(b.buffer);
    b.set([0x49, 0x4c, 0x44, 0x41], 0); b[7] = 5;
    const nm = (name + '        ').slice(0, 8), co = 'SmartLnk';
    for (let i = 0; i < 8; i++) { b[8 + i] = nm.charCodeAt(i); b[16 + i] = co.charCodeAt(i); }
    dv.setUint16(24, n); dv.setUint16(26, fi); dv.setUint16(28, total); b[30] = 0; return b;
  };
  frames.forEach((fr, fi) => {
    const pts = strokesToIldFrame(fr, rgb);
    const n = Math.min(pts.length, 65535);
    const body = new Uint8Array(n * 8); const dv = new DataView(body.buffer);
    for (let i = 0; i < n; i++) {
      const [x, y, blank, pc] = pts[i]; const o = i * 8; const rgb = pc || [255, 255, 255];
      dv.setInt16(o, Math.round(clampv(x) * 32000)); dv.setInt16(o + 2, Math.round(clampv(y) * 32000));
      body[o + 4] = (blank ? 0x40 : 0) | (i === n - 1 ? 0x80 : 0);
      body[o + 5] = blank ? 0 : rgb[2]; body[o + 6] = blank ? 0 : rgb[1]; body[o + 7] = blank ? 0 : rgb[0];
    }
    parts.push(header(n, fi, frames.length), body);
  });
  parts.push(header(0, 0, 0));
  const len = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- UI ----------
const DZ = { mode: 'text', anim: 'none', rgb: [255, 255, 255], draw: [], shape: 'circle', frames: [[]], layers: [], sel: -1 };
function dzRebuild() {
  let strokes = [];
  if (DZ.mode === 'text') strokes = textToStrokes($('#dzText').value, { size: $('#dzSize').value / 100, bold: +$('#dzBold').value });
  else if (DZ.mode === 'shape') strokes = SHAPES[DZ.shape]({ size: $('#dzShapeSize').value / 100, sides: +$('#dzSides').value });
  else if (DZ.mode === 'combo') strokes = comboStrokes();
  else if (DZ.mode === 'image') strokes = imageStrokes();
  else strokes = DZ.draw.map((p) => resample(simplify(p, 0.01), 0.03));
  DZ.frames = animateStrokes(strokes, DZ.anim);
  const n = DZ.frames[0] ? strokesToIldFrame(DZ.frames[0], DZ.rgb).length : 0;
  $('#dzPts').textContent = t('dz.pts', { n, f: DZ.frames.length });
  $('#dzPts').classList.toggle('warn', n > 1500);
}
let dzT0 = performance.now();
function dzTick() {
  const cv = $('#dzCanvas');
  if (cv.offsetParent) {
    const [g, W, H] = sizeCanvas(cv); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    const fr = DZ.frames[Math.floor(((performance.now() - dzT0) / 1000) * 25) % DZ.frames.length] || [];
    const R = Math.min(W, H) / 2 * 0.9;
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [lw, al] of [[6, 0.15], [1.6, 1]]) {
      g.lineWidth = lw; g.strokeStyle = `rgba(${DZ.rgb[0]},${DZ.rgb[1]},${DZ.rgb[2]},${al})`;
      for (const p of fr) { if (p.length < 2) continue; if (p.rgb) g.strokeStyle = `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},${al})`; else g.strokeStyle = `rgba(${DZ.rgb[0]},${DZ.rgb[1]},${DZ.rgb[2]},${al})`; g.beginPath(); g.moveTo(W / 2 + p[0][0] * R, H / 2 - p[0][1] * R); for (let i = 1; i < p.length; i++) g.lineTo(W / 2 + p[i][0] * R, H / 2 - p[i][1] * R); g.stroke(); }
    }
    g.restore();
    if (DZ.mode === 'combo') { DZ.layers.forEach((L, i) => { const cx = W / 2 + L.x * R, cy = H / 2 - L.y * R, r = L.scale * R; g.strokeStyle = i === DZ.sel ? 'rgba(49,243,172,.7)' : 'rgba(255,255,255,.12)'; g.setLineDash([4, 4]); g.lineWidth = 1; g.strokeRect(cx - r, cy - r, r * 2, r * 2); g.setLineDash([]); }); if (!DZ.layers.length) { g.fillStyle = '#5b5b57'; g.font = '13px -apple-system'; g.textAlign = 'center'; g.fillText(t('dz.comboHint'), W / 2, H / 2); } }
    if (DZ.mode === 'image' && !DZ.img) { g.fillStyle = '#5b5b57'; g.font = '13px -apple-system'; g.textAlign = 'center'; g.fillText(t('dz.imgNone'), W / 2, H / 2); }
    if (DZ.mode === 'draw' && !DZ.draw.length) { g.fillStyle = '#5b5b57'; g.font = '13px -apple-system'; g.textAlign = 'center'; g.fillText(t('dz.hintDraw'), W / 2, H / 2); }
  }
  requestAnimationFrame(dzTick);
}
// ---------- kombinér: flere mønstre fra kortet → ét nyt ----------
// et ILDA-frame → strokes (-1..1), delt ved blank-punkter
function frameToStrokes(f) {
  const out = []; let cur = [];
  for (let i = 0; i < f.n; i++) { if (f.bl[i]) { if (cur.length > 1) out.push(cur); cur = []; continue; } if (!cur.length && i > 0 && !f.bl[i - 1]) {} cur.push([f.xy[i * 2], f.xy[i * 2 + 1]]); }
  // første lyspunkt efter et blank-hop er ofte selve 'landingspunktet' – det er fint; men et enkelt lyspunkt helt alene fjernes
  
  if (cur.length > 1) out.push(cur); return out;
}
function comboStrokes() {
  const out = [];
  for (const L of DZ.layers) {
    const fr = patData.get(L.n); if (!fr || !fr.length) continue;
    const a = (L.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    for (const p of frameToStrokes(firstVisible(fr))) out.push(p.map(([x, y]) => [clampv((x * c - y * s) * L.scale + L.x), clampv((x * s + y * c) * L.scale + L.y)]));
  }
  return out;
}
function renderLayers() {
  const w = $('#dzLayers'); w.innerHTML = '';
  DZ.layers.forEach((L, i) => {
    const d = document.createElement('div'); d.className = 'dz-layer' + (i === DZ.sel ? ' sel' : '');
    d.innerHTML = `<span></span><button class="ghost small">✕</button>`;
    d.firstChild.textContent = (patNames[L.n] ? patNames[L.n] + ' · ' : '') + t('dz.layer', { n: L.n });
    d.onclick = () => { DZ.sel = i; renderLayers(); };
    d.querySelector('button').onclick = (e) => { e.stopPropagation(); DZ.layers.splice(i, 1); DZ.sel = Math.min(DZ.sel, DZ.layers.length - 1); renderLayers(); dzRebuild(); };
    w.appendChild(d);
  });
  const L = DZ.layers[DZ.sel]; $('#dzLayerCtl').hidden = !L;
  if (L) { $('#dzLScale').value = Math.round(L.scale * 100); $('#dzLRot').value = L.rot; $('#dzLScale').parentElement.querySelector('output').textContent = Math.round(L.scale * 100) + '%'; $('#dzLRot').parentElement.querySelector('output').textContent = L.rot + '°'; }
}
async function comboAdd(n) {
  const fr = await loadPat(n); if (!fr || !fr.length) { modal(t('pv.missing', { n }), null); return; }
  DZ.layers.push({ n, x: (DZ.layers.length % 3 - 1) * 0.5, y: 0, scale: 0.45, rot: 0 }); DZ.sel = DZ.layers.length - 1;
  renderLayers(); dzRebuild();
}
function layerAt(u, v) { // nærmeste lag-center indenfor dets radius
  let best = -1, bd = 1e9;
  DZ.layers.forEach((L, i) => { const d = Math.hypot(u - L.x, v - L.y); if (d < Math.max(0.15, L.scale) && d < bd) { bd = d; best = i; } });
  return best;
}

function dzSetMode(m) {
  DZ.mode = m;
  $$('#dzMode button').forEach((b) => b.classList.toggle('active', b.dataset.m === m));
  $('#dzTextBox').hidden = m !== 'text'; $('#dzShapeBox').hidden = m !== 'shape'; $('#dzDrawBox').hidden = m !== 'draw'; $('#dzComboBox').hidden = m !== 'combo'; $('#dzImageBox').hidden = m !== 'image';
  $('#dzHint').textContent = t(m === 'text' ? 'dz.hintText' : m === 'draw' ? 'dz.hintDraw' : m === 'combo' ? 'dz.hintCombo' : m === 'image' ? 'dz.hintImage' : 'dz.hintShape');
  $('#dzCanvas').classList.toggle('drawing', m === 'draw' || m === 'combo');
  if (m === 'combo') renderLayers();
  dzRebuild();
}
function dzInit() {
  $$('#dzMode button').forEach((b) => (b.onclick = () => dzSetMode(b.dataset.m)));
  $$('#dzAnim button').forEach((b) => (b.onclick = () => { DZ.anim = b.dataset.a; $$('#dzAnim button').forEach((x) => x.classList.toggle('active', x === b)); dzRebuild(); }));
  $('#dzText').addEventListener('input', dzRebuild);
  ['dzSize', 'dzBold', 'dzShapeSize', 'dzSides'].forEach((id) => $('#' + id).addEventListener('input', () => { const o = $('#' + id).parentElement.querySelector('output'); if (o) o.textContent = $('#' + id).value; dzRebuild(); }));
  ['dzSize', 'dzBold', 'dzShapeSize', 'dzSides'].forEach((id) => { const o = $('#' + id).parentElement.querySelector('output'); if (o) o.textContent = $('#' + id).value; });
  // figurer
  const sg = $('#dzShapes'); sg.innerHTML = '';
  Object.keys(SHAPES).forEach((k) => { const b = document.createElement('button'); b.className = 'small' + (k === DZ.shape ? ' active' : ''); b.textContent = t('sh.' + k); b.onclick = () => { DZ.shape = k; $$('#dzShapes button').forEach((x) => x.classList.toggle('active', x === b)); dzRebuild(); }; sg.appendChild(b); });
  // farver
  const sw = $('#dzSw'); sw.innerHTML = '';
  SWATCHES.filter((s) => s.rgb).forEach((s) => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = `rgb(${s.rgb})`; b.title = s.name; b.onclick = () => { DZ.rgb = s.rgb.slice(); $$('#dzSw .sw').forEach((x) => x.classList.toggle('active', x === b)); if (DZ.mode === 'image') { DZ.imgCache = null; dzRebuild(); } }; if (String(s.rgb) === String(DZ.rgb)) b.classList.add('active'); sw.appendChild(b); });
  // tegning
  const cv = $('#dzCanvas'); let cur = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); const R = Math.min(r.width, r.height) / 2 * 0.9; return [clampv((e.clientX - r.left - r.width / 2) / R), clampv(-(e.clientY - r.top - r.height / 2) / R)]; };
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (DZ.mode === 'combo') { const [u, v] = pos(e); const i = layerAt(u, v); if (i >= 0) { DZ.sel = i; renderLayers(); const L = DZ.layers[i]; drag = { i, du: L.x - u, dv: L.y - v }; cv.setPointerCapture(e.pointerId); } return; }
    if (DZ.mode !== 'draw') return; cv.setPointerCapture(e.pointerId); cur = [pos(e)]; DZ.draw.push(cur);
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag) { const [u, v] = pos(e); const L = DZ.layers[drag.i]; L.x = clampv(u + drag.du); L.y = clampv(v + drag.dv); dzRebuild(); return; }
    if (!cur) return; const p = pos(e); const l = cur[cur.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.01) { cur.push(p); dzRebuild(); }
  });
  const up = () => { cur = null; drag = null; dzRebuild(); }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { if (DZ.mode !== 'combo' || DZ.sel < 0) return; e.preventDefault(); const L = DZ.layers[DZ.sel]; L.scale = clamp(L.scale - Math.sign(e.deltaY) * 0.03, 0.05, 1); renderLayers(); dzRebuild(); }, { passive: false });
  $('#dzComboAdd').onclick = () => comboAdd(clamp(+$('#dzComboNum').value | 0, 1, 255));
  $('#dzLScale').addEventListener('input', (e) => { const L = DZ.layers[DZ.sel]; if (!L) return; L.scale = e.target.value / 100; e.target.parentElement.querySelector('output').textContent = e.target.value + '%'; dzRebuild(); });
  $('#dzLRot').addEventListener('input', (e) => { const L = DZ.layers[DZ.sel]; if (!L) return; L.rot = +e.target.value; e.target.parentElement.querySelector('output').textContent = e.target.value + '°'; dzRebuild(); });
  // billede / logo
  $('#dzImgPick').onclick = () => $('#dzImgFile').click();
  $('#dzImgFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadDzImage(f); e.target.value = ''; });
  const wrap = $('.dz-canvaswrap');
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); });
  wrap.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) { dzSetMode('image'); loadDzImage(f); } });
  ['dzImgSize', 'dzImgColors', 'dzImgDetail', 'dzImgSmooth', 'dzImgMin'].forEach((id) => { const el = $('#' + id), o = el.parentElement.querySelector('output'); const fmt = () => { if (o) o.textContent = id === 'dzImgSize' ? el.value + '%' : el.value; }; fmt(); el.addEventListener('input', () => { fmt(); DZ.imgCache = null; dzRebuild(); }); });
  $$('#dzImgBg button').forEach((b) => (b.onclick = () => { DZ.imgBg = b.dataset.bg; $$('#dzImgBg button').forEach((x) => x.classList.toggle('active', x === b)); DZ.imgCache = null; dzRebuild(); }));
  $('#dzImgOwnColor').addEventListener('change', () => { DZ.imgCache = null; dzRebuild(); });
  $('#dzUndo').onclick = () => { DZ.draw.pop(); dzRebuild(); };
  $('#dzClear').onclick = () => { DZ.draw = []; dzRebuild(); };
  // gem
  $('#dzSave').onclick = async () => {
    if (!DZ.frames[0] || !DZ.frames[0].length) { modal(t('dz.empty'), null); return; }
    const num = clamp(+$('#dzNum').value | 0, 1, 255);
    const bytes = encodeIld(DZ.frames, DZ.mode === 'combo' || DZ.mode === 'image' ? null : DZ.rgb, (DZ.mode === 'text' ? $('#dzText').value : DZ.mode === 'image' ? (DZ.imgName || 'LOGO') : DZ.mode).toUpperCase());
    const r = await window.laser.saveIld(String(num).padStart(3, '0'), bytes, true);
    if (!r) return;
    if (r.num) { if (r.num > cfg.patCount) { cfg.patCount = r.num; $('#patCount').value = r.num; saveCfg(); } await refreshPatList(); }
    modal(t('dz.saved', { p: r.path.split('/').pop() }), null);
  };
  dzSetMode('text');
  requestAnimationFrame(dzTick);
}


// ---------- billede / logo → mønster ----------
// Billedet tegnes i et 512×512 felt, farverne reduceres til få hovedfarver (baggrunden fjernes),
// og hver farveflade får sin kontur (marching squares) i den farve. Resultatet kan bruges som ethvert andet mønster.
function loadDzImage(file) {
  const url = URL.createObjectURL(file); const im = new Image();
  im.onload = () => { DZ.img = im; DZ.imgCache = null; DZ.imgName = file.name.replace(/\.[^.]+$/, ''); $('#dzImgName').textContent = file.name; URL.revokeObjectURL(url); dzRebuild(); };
  im.src = url;
}
function imageStrokes() {
  if (!DZ.img) return [];
  if (DZ.imgCache) return DZ.imgCache;
  const S = 512, cv = document.createElement('canvas'); cv.width = S; cv.height = S; const g = cv.getContext('2d');
  const smooth = +$('#dzImgSmooth').value;
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const sc = Math.min((S * 0.92) / DZ.img.width, (S * 0.92) / DZ.img.height), w = DZ.img.width * sc, h = DZ.img.height * sc;
  if (smooth) g.filter = `blur(${smooth}px)`;
  g.drawImage(DZ.img, (S - w) / 2, (S - h) / 2, w, h); g.filter = 'none';
  const d = g.getImageData(0, 0, S, S).data;
  // baggrund: auto = gennemsnitsfarven langs billedets egen kant
  const bgMode = DZ.imgBg || 'auto';
  const edge = []; const x0 = Math.floor((S - w) / 2) + 1, y0 = Math.floor((S - h) / 2) + 1, x1 = Math.ceil((S + w) / 2) - 2, y1 = Math.ceil((S + h) / 2) - 2;
  for (let x = x0; x <= x1; x += 4) { edge.push((y0 * S + x) * 4, (y1 * S + x) * 4); } for (let y = y0; y <= y1; y += 4) { edge.push((y * S + x0) * 4, (y * S + x1) * 4); }
  const avg = (idx) => { let r = 0, gg = 0, b = 0; for (const i of idx) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = idx.length || 1; return [r / n, gg / n, b / n]; };
  const bg = bgMode === 'dark' ? [0, 0, 0] : bgMode === 'light' ? [255, 255, 255] : avg(edge);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const isFg = (i) => { const p = i >> 2, x = p % S, y = (p / S) | 0; return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dist([d[i], d[i + 1], d[i + 2]], bg) > 80; };
  // reducer farver: histogram i 4 bit pr. kanal → de hyppigste
  const kMax = +$('#dzImgColors').value, own = $('#dzImgOwnColor').checked;
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4) { if (!isFg(i)) continue; const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); hist.set(k, (hist.get(k) || 0) + 1); }
  const total = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
  let pal = [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ rgb: [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17], n }));
  const merged = [];
  for (const p of pal) { const m = merged.find((q) => dist(q.rgb, p.rgb) < 70); if (m) m.n += p.n; else merged.push({ ...p }); }
  pal = merged.filter((p) => p.n / total > 0.015).slice(0, own ? 1 : kMax);
  if (!pal.length) pal = [{ rgb: [255, 255, 255], n: 1 }];
  // masker pr. farve (hver forgrundspixel hører til nærmeste palette-farve)
  const step = 2, cols = S / step, rows = S / step;
  const masks = pal.map(() => new Uint8Array(cols * rows));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = ((r * step) * S + c * step) * 4; if (!isFg(i)) continue;
    const px = [d[i], d[i + 1], d[i + 2]]; let bi = 0, bd = 1e9;
    if (pal.length > 1) pal.forEach((p, k) => { const dd = dist(p.rgb, px); if (dd < bd) { bd = dd; bi = k; } });
    masks[bi][r * cols + c] = 1;
  }
  const detail = +$('#dzImgDetail').value, eps = 0.03 - (detail / 100) * 0.027, minLen = +$('#dzImgMin').value / 100;
  const size = $('#dzImgSize').value / 100;
  let strokes = [];
  masks.forEach((m, k) => {
    const polys = chainSegments(marchingSquares(m, cols, rows)).filter((p) => p.length > 4)
      .map((poly) => poly.map(([x, y]) => [((x * step) / S) * 2 - 1, -(((y * step) / S) * 2 - 1)]));
    for (let p of polys) {
      p = resample(simplify(p, eps), 0.035);
      let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (L < minLen) continue;
      p = p.map(([x, y]) => [clampv(x * size), clampv(y * size)]);
      // laseren viser svage farver dårligt → gør farven mættet og lys
      const c = own ? DZ.rgb.slice() : pal[k].rgb.slice(); const mx = Math.max(...c, 1); p.rgb = c.map((v) => Math.round(Math.min(255, (v / mx) * 255)));
      strokes.push(p);
    }
  });
  // sortér så scanneren springer kortest muligt
  const ordered = []; let cur = [0, 0];
  while (strokes.length) { let bi = 0, bd = 1e9; strokes.forEach((p, i) => { const dd = Math.hypot(p[0][0] - cur[0], p[0][1] - cur[1]); if (dd < bd) { bd = dd; bi = i; } }); const p = strokes.splice(bi, 1)[0]; ordered.push(p); cur = p[p.length - 1]; }
  DZ.imgCache = ordered;
  return ordered;
}
