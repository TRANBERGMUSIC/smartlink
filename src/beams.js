/* SmartLink – fanen "Effekter": stråle-effekter (beam show) → laserens SD-kort.
 * Effekterne laves af BeamFX (beams_core.js) som Vektor-dokumenter, så de går gennem præcis samme optimering og SD-eksport som Vektor
 * (laser_frame.optimize → ILDA format 5 → NNN.ild). Laseren afspiller dem fra SD-kortet; appen vælger dem med kanal 2.
 * Preview "I luften" er en simulering af hvordan punkterne ser ud som stråler i røg – selve punktlisten vises under "Punkter".
 */
'use strict';
const FX = Object.assign({}, BeamFX.DEF, { slot: 150, view: 'air' }, store.get('fxCfg', {}));
const fxs = { fi: 0, last: 0, stats: null, statT: 0, thumbs: [] };
const fxSave = () => store.set('fxCfg', FX);
if (!Array.isArray(FX.palette) || !FX.palette.length) FX.palette = [[0, 255, 0], [255, 0, 0]];
if (FX.colors === 'two' || FX.colors === 'one') FX.colors = 'palette';
// effektens indstillinger + sikkerhed: laserens projektionszone og sikkerhedslinjen (intet under den)
const fxOpts = (extra) => ({ ...FX, zone: typeof prof === 'function' ? prof().zone : null, minY: typeof safetyLine === 'function' ? safetyLine() : null, ...extra });
const FX_PRESETS = [['Grøn + rød', [[0, 255, 0], [255, 0, 0]]], ['Rød + hvid + blå', [[255, 0, 0], [255, 255, 255], [0, 60, 255]]], ['Grøn', [[0, 255, 0]]], ['Cyan + magenta', [[0, 255, 255], [255, 0, 255]]], ['Varm', [[255, 40, 0], [255, 160, 0], [255, 230, 0]]], ['Is', [[0, 120, 255], [0, 255, 255], [255, 255, 255]]]];
const fxHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const FX_SLIDERS = [['beams', 2, 16, 1, (v) => v], ['spread', 20, 195, 100, (v) => Math.round(v * 100) + '%'], ['height', -20, 95, 100, (v) => Math.round(v * 100)], ['amp', 0, 90, 100, (v) => Math.round(v * 100) + '%'],
  ['frames', 12, 120, 1, (v) => v], ['fps', 10, 60, 1, (v) => v], ['dwell', 2, 20, 1, (v) => v]];

// ---------- tegning ----------
// "I luften": laseren står forrest i midten; hvert punkt bliver en stråle ud mod røgen, hver linje en lysflade
function fxDrawAir(g, W, H, f, small) {
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#20242c'); bg.addColorStop(0.62, '#12141a'); bg.addColorStop(1, '#07080a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const ox = W / 2, oy = H * (small ? 0.94 : 0.9), far = (x, y) => [ox + x * W * 0.62, oy - (0.32 + (y + 1) / 2 * 0.62) * H];
  // publikum: under sikkerhedslinjen kommer der aldrig stråler
  const mY = typeof safetyLine === 'function' ? safetyLine() : null; if (mY != null && !small) { // retninger under sikkerhedslinjen (ned mod publikum) = den røde kile fra laseren
    const ray = (x) => { const [px, py] = far(x, mY); return [ox + (px - ox) * 6, oy + (py - oy) * 6]; }, [lx, ly] = ray(-1), [rx, ry] = ray(1);
    g.fillStyle = 'rgba(255,60,80,.08)'; g.beginPath(); g.moveTo(ox, oy); g.lineTo(lx, ly); g.lineTo(-W, H * 2); g.lineTo(W * 2, H * 2); g.lineTo(rx, ry); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,60,80,.55)'; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(lx, ly); g.lineTo(ox, oy); g.lineTo(rx, ry); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,120,135,.9)'; g.font = '600 11px -apple-system, Inter, sans-serif'; g.fillText(t('fx.zoneLbl'), 12, H - 28); }
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (const l of f.lines) { const [ax, ay] = far(...l.a), [bx, by] = far(...l.b), c = l.c.join(','); g.fillStyle = `rgba(${c},${small ? 0.22 : 0.16})`; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ax, ay); g.lineTo(bx, by); g.closePath(); g.fill(); g.strokeStyle = `rgba(${c},.7)`; g.lineWidth = small ? 1 : 1.5; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
  const k = small ? 1 : 1.9; // strålen fortsætter ud af billedet
  for (const b of f.beams) {
    const [tx, ty] = far(b.x, b.y), ex = ox + (tx - ox) * k, ey = oy + (ty - oy) * k, c = b.c.join(',');
    const gr = g.createLinearGradient(ox, oy, ex, ey); gr.addColorStop(0, `rgba(${c},.95)`); gr.addColorStop(0.55, `rgba(${c},.55)`); gr.addColorStop(1, `rgba(${c},0)`);
    if (!small) { g.strokeStyle = `rgba(${c},.07)`; g.lineWidth = 10; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke(); }
    g.strokeStyle = gr; g.lineWidth = small ? 1.2 : 2.2; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke();
  }
  g.restore();
  // laseren og publikum (silhuet)
  g.fillStyle = '#05060a'; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += small ? 6 : 10) g.lineTo(x, H - (small ? 3 : 14) - Math.abs(Math.sin(x * 0.37) * (small ? 2 : 9))); g.lineTo(W, H); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(ox, oy, small ? 1.5 : 3, 0, Math.PI * 2); g.fill();
}
function fxDrawFlat(g, W, H, f) {
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); const S = Math.min(W, H) - 8, x0 = (W - S) / 2, y0 = (H - S) / 2, X = (x) => x0 + (x + 1) / 2 * S, Y = (y) => y0 + (1 - y) / 2 * S;
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.strokeRect(x0 + 0.5, y0 + 0.5, S - 1, S - 1); g.beginPath(); g.moveTo(X(0), y0); g.lineTo(X(0), y0 + S); g.moveTo(x0, Y(0)); g.lineTo(x0 + S, Y(0)); g.strokeStyle = 'rgba(255,255,255,.05)'; g.stroke();
  const line = typeof safetyLine === 'function' ? safetyLine() : null; if (line != null) { g.fillStyle = 'rgba(255,40,40,.14)'; g.fillRect(x0, Y(line), S, y0 + S - Y(line)); }
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (const l of f.lines) { g.strokeStyle = `rgb(${l.c})`; g.lineWidth = 2; g.beginPath(); g.moveTo(X(l.a[0]), Y(l.a[1])); g.lineTo(X(l.b[0]), Y(l.b[1])); g.stroke(); }
  for (const b of f.beams) { g.fillStyle = `rgba(${b.c},.25)`; g.beginPath(); g.arc(X(b.x), Y(b.y), 8, 0, Math.PI * 2); g.fill(); g.fillStyle = `rgb(${b.c})`; g.beginPath(); g.arc(X(b.x), Y(b.y), 3, 0, Math.PI * 2); g.fill(); }
  g.restore();
}
function fxSize(cv) { const W = cv.clientWidth, H = cv.clientHeight, d = devicePixelRatio || 1; if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); } const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return [g, W, H]; }

// punktlisten for den viste frame (samme vej som SD-eksporten) → statistik
function fxStats() {
  const doc = BeamFX.toDoc(fxOpts({ frames: 1 })), f = LaserFrame.optimize(framePaths(doc.frames[0], 0), { ...vecOpts(), fps: FX.fps });
  return f.stats;
}
function fxLoop(now) {
  requestAnimationFrame(fxLoop);
  const page = $('#page-fx'); if (!page || !page.classList.contains('active')) return;
  if (now - fxs.last >= 1000 / FX.fps) { fxs.fi = (fxs.fi + 1) % Math.max(1, FX.frames); fxs.last = now; }
  const cv = $('#fxCanvas'), [g, W, H] = fxSize(cv), f = BeamFX.frame(fxOpts(), fxs.fi);
  if (FX.view === 'flat') fxDrawFlat(g, W, H, f); else fxDrawAir(g, W, H, f, false);
  if (now - fxs.statT > 400) { fxs.statT = now; const s = fxStats(); const el = $('#fxStats'); el.textContent = s.safe ? t('fx.stats', { n: s.count, v: s.visible, fps: s.fps, f: FX.frames }) : t('fx.unsafe'); el.classList.toggle('bad', !s.safe || s.fpsReduced); }
  // små levende miniaturer på effekt-knapperne
  for (const th of fxs.thumbs) { const [tg, tw, thh] = fxSize(th.cv); fxDrawAir(tg, tw, thh, BeamFX.frame(fxOpts({ mode: th.mode, beams: Math.min(FX.beams, 10) }), Math.floor(now / (1000 / 24)) % 48), true); }
}

// ---------- UI ----------
function fxRender() {
  const modes = $('#fxModes'); modes.innerHTML = ''; fxs.thumbs = [];
  for (const m of BeamFX.MODES) { const b = document.createElement('button'); b.className = 'fx-mode' + (FX.mode === m ? ' active' : ''); b.innerHTML = `<canvas></canvas><span>${t('fx.m.' + m)}</span>`; b.onclick = () => { FX.mode = m; fxSave(); fxRender(); }; modes.appendChild(b); fxs.thumbs.push({ cv: b.querySelector('canvas'), mode: m }); }
  const cs = $('#fxColors'); cs.innerHTML = '';
  for (const c of BeamFX.COLORS) { const b = document.createElement('button'); b.textContent = t('fx.c.' + c); b.classList.toggle('active', FX.colors === c); b.onclick = () => { FX.colors = c; fxSave(); fxRender(); }; cs.appendChild(b); }
  // egne farver: så mange man vil, i rækkefølge (stråle 1 får farve 1, stråle 2 farve 2 …)
  const pal = $('#fxPal'); pal.innerHTML = ''; pal.classList.toggle('dim', !/^palette/.test(FX.colors));
  FX.palette.forEach((c, i) => { const w = document.createElement('span'); w.className = 'fx-sw'; w.innerHTML = `<input type="color" value="${fxHex(c)}" aria-label="${t('fx.c1').replace('1', i + 1)}"><button class="ghost small" aria-label="${t('fx.del')}">×</button>`;
    w.querySelector('input').oninput = (e) => { FX.palette[i] = hexRgb(e.target.value); if (!/^palette/.test(FX.colors)) { FX.colors = 'palette'; } fxSave(); };
    w.querySelector('input').onchange = () => fxRender();
    w.querySelector('button').onclick = () => { if (FX.palette.length > 1) { FX.palette.splice(i, 1); fxSave(); fxRender(); } }; pal.appendChild(w); });
  const add = document.createElement('button'); add.className = 'ghost small'; add.textContent = t('fx.addColor'); add.onclick = () => { if (FX.palette.length < 12) { FX.palette.push([255, 255, 255]); FX.colors = /^palette/.test(FX.colors) ? FX.colors : 'palette'; fxSave(); fxRender(); } }; pal.appendChild(add);
  const pr = $('#fxPresets'); pr.innerHTML = '';
  for (const [name, cols] of FX_PRESETS) { const b = document.createElement('button'); b.className = 'ghost small fx-pre'; b.innerHTML = cols.map((c) => `<i style="background:${fxHex(c)}"></i>`).join('') + `<span>${name}</span>`; b.onclick = () => { FX.palette = cols.map((c) => c.slice()); FX.colors = 'palette'; fxSave(); fxRender(); }; pr.appendChild(b); }
  const sl = $('#fxSliders'); sl.innerHTML = '';
  for (const [k, lo, hi, div, fmt] of FX_SLIDERS) {
    const lab = document.createElement('label'); lab.innerHTML = `<span>${t('fx.p.' + k)}</span><input type="range" min="${lo}" max="${hi}" value="${Math.round(FX[k] * div)}"><output></output>`;
    const r = lab.querySelector('input'), o = lab.querySelector('output'); o.textContent = fmt(FX[k]);
    r.oninput = () => { FX[k] = +r.value / div; o.textContent = fmt(FX[k]); if (k === 'frames') fxs.fi %= FX.frames; fxSave(); };
    sl.appendChild(lab);
  }
  $$('#fxView button').forEach((b) => b.classList.toggle('active', b.dataset.v === FX.view));
  $('#fxSlot').value = FX.slot; $('#fxName').value = BeamFX.shortName(FX);
}
const fxMsg = (s, kind) => { const el = $('#fxMsg'); el.textContent = s || ''; el.className = 'vec-msg ' + (kind || ''); };
const fxOwn = (n) => vecPkg.some((p) => p.slot === n);
const fxTaken = (n) => typeof patAvail !== 'undefined' && patAvail.has(n) && !fxOwn(n);
function fxPush(o, slot, name) { vecPkg = vecPkg.filter((p) => p.slot !== slot); vecPkg.push({ slot, name, fps: o.fps, fx: true, doc: BeamFX.toDoc(fxOpts(o)) }); }
function fxAdd() {
  const slot = clamp(+$('#fxSlot').value | 0, 1, 255); if (fxTaken(slot)) { fxMsg(t('fx.taken', { n: slot }), 'bad'); return; }
  const name = ($('#fxName').value || BeamFX.shortName(FX)).toUpperCase().slice(0, 8);
  fxPush(FX, slot, name); store.set('vecPkg', vecPkg); if (typeof vecRenderPkg === 'function') vecRenderPkg();
  fxMsg(t('fx.added', { n: slot, name }), 'ok'); FX.slot = Math.min(255, slot + 1); fxSave(); $('#fxSlot').value = FX.slot;
}
function fxAll() { // alle effekter i tre farvevarianter, fra slot-nummeret og op (optagne mønster-numre springes over)
  let slot = clamp(+$('#fxSlot').value | 0, 1, 255), a = 0, b = 0, k = 0;
  for (const mode of BeamFX.MODES) for (const colors of ['rainbow', 'flow', 'palette']) {
    while (slot <= 255 && fxTaken(slot)) slot++; if (slot > 255) break;
    const o = { ...FX, mode, colors }; fxPush(o, slot, BeamFX.shortName(o)); if (!a) a = slot; b = slot; k++; slot++;
  }
  store.set('vecPkg', vecPkg); if (typeof vecRenderPkg === 'function') vecRenderPkg();
  FX.slot = Math.min(255, slot); fxSave(); $('#fxSlot').value = FX.slot; fxMsg(t('fx.allDone', { k, a, b }), 'ok');
}
function fxEdit() { vdoc = BeamFX.toDoc(fxOpts()); VEC.name = BeamFX.shortName(FX); VEC.fps = FX.fps; VEC.slot = clamp(+$('#fxSlot').value | 0, 1, 255); vs.frame = 0; vs.layer = 0; vecSave(); const tab = document.querySelector('[data-tab="vector"]'); if (tab) tab.click(); }
function fxInit() {
  if (!$('#page-fx') || typeof BeamFX === 'undefined') return;
  $$('#fxView button').forEach((b) => b.onclick = () => { FX.view = b.dataset.v; fxSave(); fxRender(); });
  $('#fxSlot').onchange = (e) => { FX.slot = clamp(+e.target.value | 0, 1, 255); e.target.value = FX.slot; fxSave(); };
  $('#fxName').onchange = (e) => { e.target.value = e.target.value.toUpperCase().slice(0, 8); };
  $('#fxAdd').onclick = fxAdd; $('#fxAll').onclick = fxAll; $('#fxEdit').onclick = fxEdit;
  $('#fxPlay').onclick = () => { const n = clamp(+$('#fxSlot').value | 0, 1, 255); setPattern(n); if (typeof sendNow === 'function') sendNow(); fxMsg(t('vec.dmxPlaying', { n }), 'ok'); };
  $('#fxExport').onclick = () => vecExportSd().then(() => fxMsg($('#vecMsg') ? $('#vecMsg').textContent : '', 'ok'));
  document.querySelector('[data-tab="fx"]').addEventListener('click', () => requestAnimationFrame(fxRender));
  fxRender(); requestAnimationFrame(fxLoop);
}
fxInit();
