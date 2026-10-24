/* SmartLink – Vektor-fanen: tekst/tegning → optimerede laserpunkter → output-backend.
 * Preview tegner PRÆCIS den punktliste der sendes/eksporteres (efter optimering og int16-kvantisering).
 * Bruger: LaserFrame (laser_frame.js), IldaIO (ilda_io.js), ShowNET, textToStrokes (designer.js) og app.js' cfg/store/prof/zoneEff/setPattern.
 */
'use strict';
const VEC_DEF = { pps: 30000, fps: 30, stepPct: 1.5, anchor: 3, cornerDwell: 4, deratePct: 50, minPct: 2, intensity: 100, route: 'sd', backend: 'etherdream', slot: 150, name: 'TEKST', flipX: false, flipY: false, showBlank: false };
const VEC = Object.assign({}, VEC_DEF, store.get('vecCfg', {}));
const vecNewDoc = () => ({ frames: [{ layers: [{ name: 'Lag 1', color: '#00ff66', visible: true, items: [{ type: 'text', text: 'LASER', size: 0.25, font: 'stroke', x: 0, y: 0 }] }] }] });
let vdoc = store.get('vecDoc', null) || vecNewDoc();
let vecPkg = store.get('vecPkg', []);
const vs = { tool: 'text', frame: 0, layer: 0, drag: null, compiled: null, dirty: true, play: 0, lastAdv: 0, live: false, liveTimer: null, devices: [], status: '' };
const vecSave = () => { store.set('vecDoc', vdoc); store.set('vecCfg', VEC); vs.dirty = true; };
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const curFrame = () => vdoc.frames[clamp(vs.frame, 0, vdoc.frames.length - 1)];
const curLayer = () => { const f = curFrame(); vs.layer = clamp(vs.layer, 0, f.layers.length - 1); return f.layers[vs.layer]; };

// ---------- design → stier ----------
function outlineText(it, color) {
  if (typeof textToStrokes !== 'function') return [];
  const lines = String(it.text || '').split('\n'), out = [];
  lines.forEach((ln, li) => {
    const st = textToStrokes(ln, { size: 1, bold: 1 }); if (!st.length) return;
    let y0 = Infinity, y1 = -Infinity; for (const p of st) for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const k = it.size / Math.max(0.01, y1 - y0), dy = it.y + ((lines.length - 1) / 2 - li) * it.size * 1.6;
    for (const p of st) out.push({ pts: p.map(([x, y]) => [it.x + x * k, dy + (y - (y0 + y1) / 2) * k]), color, closed: false });
  });
  return out;
}
function itemPaths(it, color) {
  switch (it.type) {
    case 'text': return it.font === 'outline' ? outlineText(it, color) : LaserFrame.textPaths(it.text, { size: it.size, x: it.x, y: it.y, color });
    case 'line': return [{ pts: [it.a, it.b], color }];
    case 'rect': return [LaserFrame.rect(Math.min(it.a[0], it.b[0]), Math.min(it.a[1], it.b[1]), Math.max(it.a[0], it.b[0]), Math.max(it.a[1], it.b[1]), color)];
    case 'circle': return [LaserFrame.circle(it.a[0], it.a[1], Math.max(0.005, Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1])), color)];
    case 'free': return it.pts.length > 1 ? [{ pts: it.pts, color }] : [];
    default: return [];
  }
}
function framePaths(fr) { const out = []; for (const L of fr.layers) if (L.visible) { const c = hexRgb(L.color); for (const it of L.items) out.push(...itemPaths(it, c)); } return out; }
function vecOpts() {
  const sd = VEC.route === 'sd';
  return { pps: sd ? (cfg.kpps || 20) * 1000 : VEC.pps, fps: VEC.fps, maxStep: VEC.stepPct / 50, blankStep: VEC.stepPct / 50, anchor: VEC.anchor, cornerDwell: VEC.cornerDwell, derate: VEC.deratePct / 100, minExtent: VEC.minPct / 50 };
}
function safetyLine() { return cfg.dmxMode === 'pro' && zoneEff() > 0 && (cfg.zoneSide || 'bottom') === 'bottom' ? -1 + 2 * zoneEff() : null; }
// én frame klar til output: optimeret → (live: spejl + klip til zone) → sikkerhed → int16
function outFrame(fr, forLive) {
  const f = LaserFrame.optimize(framePaths(fr), vecOpts());
  let pts = LaserFrame.safeForOutput(f);
  if (forLive) { pts = pts.map((p) => ({ ...p, x: VEC.flipX ? -p.x : p.x, y: VEC.flipY ? -p.y : p.y })); pts = LaserFrame.clipZone(pts, prof().zone, safetyLine()); }
  return { q: LaserFrame.quantize(pts, VEC.intensity / 100), stats: f.stats };
}
function vecCompile() {
  if (!vs.dirty && vs.compiled) return vs.compiled;
  const live = VEC.route !== 'sd'; vs.compiled = vdoc.frames.map((fr) => outFrame(fr, live)); vs.dirty = false; return vs.compiled;
}
// fps som laseren faktisk afspiller: SD = kanal 3 kvantiseret (og pps-loft), DAC = stats.fps
function effFps(c) { const s = c.stats.fps; if (VEC.route !== 'sd') return s; return Math.min(s, ShowNET.fpsDecode(ShowNET.fpsEncode(VEC.fps, 'pro'), 'pro')); }

// ---------- preview ----------
function vecDraw(now) {
  const cv = $('#vecCanvas'); if (!cv || !cv.offsetParent) return;
  const box = cv.parentElement.getBoundingClientRect(), S = Math.max(100, Math.floor(Math.min(box.width, box.height) - 4)), dpr = devicePixelRatio || 1;
  if (cv.width !== S * dpr) { cv.width = cv.height = S * dpr; cv.style.width = cv.style.height = S + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const X = (x) => (x + 1) / 2 * S, Y = (y) => (1 - y) / 2 * S;
  const comp = vecCompile();
  // animation: samme timing som output
  if (comp.length > 1) { const fps = Math.max(0.5, effFps(comp[vs.play % comp.length])); if (now - vs.lastAdv >= 1000 / fps) { vs.play = (vs.play + 1) % comp.length; vs.lastAdv = now; } } else vs.play = 0;
  const show = comp.length > 1 && !vs.drag ? comp[vs.play] : comp[clamp(vs.frame, 0, comp.length - 1)];
  // sikkerhedszone + gemt projektionszone + 40°-felt
  const line = safetyLine(); if (line != null) { g.fillStyle = 'rgba(255,40,40,.16)'; g.fillRect(0, Y(line), S, S - Y(line)); g.strokeStyle = '#ff3b3b'; g.setLineDash([]); g.beginPath(); g.moveTo(0, Y(line)); g.lineTo(S, Y(line)); g.stroke(); }
  const z = prof().zone || { l: -1, r: 1, b: -1, t: 1 }; g.strokeStyle = 'rgba(120,180,255,.6)'; g.setLineDash([5, 4]); g.strokeRect(X(z.l) + .5, Y(z.t) + .5, X(z.r) - X(z.l) - 1, Y(z.b) - Y(z.t) - 1); g.setLineDash([]);
  g.strokeStyle = '#3a4152'; g.strokeRect(.5, .5, S - 1, S - 1); g.fillStyle = '#5b6375'; g.font = '11px -apple-system, sans-serif'; g.fillText(t('vec.field'), 6, 14);
  g.strokeStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
  // præcis punktliste
  const q = show.q; g.lineWidth = 1.6; g.lineCap = 'round';
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1], b = q[i], ax = X(a.x / 32767), ay = Y(a.y / 32767), bx = X(b.x / 32767), by = Y(b.y / 32767);
    if (b.blank) { if (VEC.showBlank) { g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); } continue; }
    g.strokeStyle = `rgb(${b.r},${b.g},${b.b})`; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx === ax && by === ay ? bx + .01 : bx, by); g.stroke();
  }
  if (VEC.showBlank) { g.fillStyle = 'rgba(255,255,255,.5)'; for (const p of q) g.fillRect(X(p.x / 32767) - 1, Y(p.y / 32767) - 1, 2, 2); }
  if (vs.drag && vs.drag.preview) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.setLineDash([3, 3]); for (const p of vs.drag.preview) { g.beginPath(); p.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); } g.setLineDash([]); }
  // statistik
  const s = show.stats, el = $('#vecStats'); if (el) {
    const warn = !s.safe || s.fpsReduced || s.simplified > 1;
    el.className = 'vec-stats' + (s.safe ? warn ? ' warn' : '' : ' bad');
    el.textContent = t('vec.stats', { n: s.count, v: s.visible, pps: s.pps.toLocaleString(LANG === 'en' ? 'en-GB' : 'da-DK'), fps: (Math.round(effFps(show) * 10) / 10).toLocaleString(LANG === 'en' ? 'en-GB' : 'da-DK'), want: VEC.fps }) + (comp.length > 1 ? ' · ' + t('vec.frameN', { i: (comp.length > 1 && !vs.drag ? vs.play : vs.frame) + 1, n: comp.length }) : '') + (s.simplified > 1 ? ' · ' + t('vec.simpl', { k: s.simplified.toLocaleString(LANG === 'en' ? 'en-GB' : 'da-DK') }) : '') + (s.fpsReduced ? ' · ' + t('vec.fpsLow') : '') + (!s.safe ? ' · ' + t('vec.unsafe.' + s.reason) : '');
  }
}

// ---------- tegneflade ----------
function vecPt(e) { const r = $('#vecCanvas').getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1), clamp(1 - (e.clientY - r.top) / r.height * 2, -1, 1)]; }
function vecDown(e) {
  const p = vecPt(e), L = curLayer();
  if (vs.tool === 'text') { const txt = $('#vecText').value; if (!txt.trim()) return; L.items.push({ type: 'text', text: txt, size: +$('#vecTextSize').value / 100, font: VEC.font || 'stroke', x: p[0], y: p[1] }); vecSave(); vecRenderLayers(); return; }
  vs.drag = { a: p, b: p, pts: [p] }; $('#vecCanvas').setPointerCapture(e.pointerId);
}
function vecMove(e) {
  if (!vs.drag) return; const p = vecPt(e); vs.drag.b = p; if (vs.tool === 'free') { const l = vs.drag.pts[vs.drag.pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.01) vs.drag.pts.push(p); }
  vs.drag.preview = itemPaths(vecDragItem(), [255, 255, 255]);
}
function vecDragItem() { const d = vs.drag; return vs.tool === 'free' ? { type: 'free', pts: d.pts.slice() } : { type: vs.tool, a: d.a, b: d.b }; }
function vecUp() {
  if (!vs.drag) return; const it = vecDragItem(), d = vs.drag; vs.drag = null;
  if (it.type === 'free' ? it.pts.length > 2 : Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 0.01) { curLayer().items.push(it); vecSave(); vecRenderLayers(); }
}

// ---------- lag og frames ----------
function vecRenderLayers() {
  const box = $('#vecLayers'); if (!box) return; const f = curFrame(); box.innerHTML = '';
  f.layers.forEach((L, i) => {
    const r = document.createElement('div'); r.className = 'vec-layer' + (i === vs.layer ? ' active' : '');
    r.innerHTML = `<input type="checkbox" ${L.visible ? 'checked' : ''} title="${t('vec.visible')}"><input type="color" value="${L.color}"><span class="vl-name"></span><span class="muted small">${L.items.length}</span><button class="ghost small" title="${t('vec.delLayer')}">×</button>`;
    r.querySelector('.vl-name').textContent = L.name;
    r.onclick = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; vs.layer = i; vecRenderLayers(); };
    const [cb, col] = r.querySelectorAll('input'); cb.onchange = () => { L.visible = cb.checked; vecSave(); }; col.oninput = () => { L.color = col.value; vecSave(); };
    r.querySelector('button').onclick = () => { if (f.layers.length > 1) { f.layers.splice(i, 1); vecSave(); vecRenderLayers(); } else { L.items = []; vecSave(); vecRenderLayers(); } };
    box.appendChild(r);
  });
  $('#vecFrameLbl').textContent = t('vec.frameN', { i: vs.frame + 1, n: vdoc.frames.length });
}
function vecRenderPkg() {
  const box = $('#vecPkg'); if (!box) return; box.innerHTML = '';
  if (!vecPkg.length) { box.innerHTML = `<p class="hint">${t('vec.pkgEmpty')}</p>`; return; }
  const tb = document.createElement('table'); tb.className = 'vec-table'; tb.innerHTML = `<tr><th>${t('vec.thCh2')}</th><th>${t('vec.thName')}</th><th>${t('vec.thFrames')}</th><th>${t('vec.thCh3')}</th><th></th></tr>`;
  vecPkg.sort((a, b) => a.slot - b.slot).forEach((p, i) => {
    const tr = document.createElement('tr'); tr.innerHTML = `<td><b>${p.slot}</b></td><td class="vl-name"></td><td>${p.doc.frames.length}</td><td>${ShowNET.fpsEncode(p.fps, 'pro')} <span class="muted small">(${p.fps} fps)</span></td><td class="vec-acts"><button class="ghost small" data-a="play" title="${t('vec.playDmx')}">▶</button><button class="ghost small" data-a="edit" title="${t('vec.edit')}">✎</button><button class="ghost small" data-a="del">×</button></td>`;
    tr.querySelector('.vl-name').textContent = p.name;
    tr.querySelector('[data-a=play]').onclick = () => vecPlayDmx(p.slot);
    tr.querySelector('[data-a=edit]').onclick = () => { vdoc = structuredClone(p.doc); VEC.slot = p.slot; VEC.name = p.name; VEC.fps = p.fps; vs.frame = 0; vs.layer = 0; vecSave(); vecSyncUI(); };
    tr.querySelector('[data-a=del]').onclick = () => { vecPkg.splice(i, 1); store.set('vecPkg', vecPkg); vecRenderPkg(); };
    tb.appendChild(tr);
  });
  box.appendChild(tb);
}

// ---------- SD-kort (virker i dag) ----------
function vecIldBytes(doc, name) { const saved = vdoc, live = VEC.route; vdoc = doc; VEC.route = 'sd'; vs.dirty = true; try { return IldaIO.write(vecCompile().map((c, i) => ({ name: (name || 'SMARTLNK').slice(0, 8), points: c.q })), { format: 5, name }); } finally { vdoc = saved; VEC.route = live; vs.dirty = true; } }
function vecAddToPkg() {
  const slot = clamp(+$('#vecSlot').value | 0, 1, 255), name = ($('#vecName').value || 'DESIGN').toUpperCase();
  vecPkg = vecPkg.filter((p) => p.slot !== slot); vecPkg.push({ slot, name, fps: VEC.fps, doc: structuredClone(vdoc) }); store.set('vecPkg', vecPkg); vecRenderPkg();
  $('#vecSlot').value = VEC.slot = Math.min(255, slot + 1); vecSave();
}
async function vecExportSd() {
  if (!vecPkg.length) vecAddToPkg();
  const files = vecPkg.map((p) => ({ num: p.slot, bytes: Array.from(vecIldBytes(p.doc, p.name)) }));
  const rows = [['Kanal 2 (mønster)', 'Fil', 'Navn', 'Frames', 'Fps', 'Kanal 3 (fps)']].concat(vecPkg.map((p) => [p.slot, String(p.slot).padStart(3, '0') + '.ild', p.name, p.doc.frames.length, p.fps, ShowNET.fpsEncode(p.fps, 'pro')]));
  const r = await window.laser.saveSdPackage(t('vec.sdPick'), files, rows.map((r_) => r_.join(';')).join('\r\n') + '\r\n'); if (!r) return;
  vecMsg(t('vec.sdDone', { n: files.length, dir: r.dir }), 'ok');
  try { if (typeof refreshPatList === 'function') refreshPatList(); } catch (_) {}
}
// DMX-backend: afspil en SD-slot via kanal 2 (bruger den eksisterende ShowNET-mapping i app.js)
function vecPlayDmx(slot) { setPattern(slot); if (typeof sendNow === 'function') sendNow(); vecMsg(t('vec.dmxPlaying', { n: slot }), 'ok'); }

// ---------- live via DAC (open/writeFrame/setShutter/close/discover) ----------
async function vecFind() {
  vecMsg(t('vec.finding')); const list = await window.laser.outDiscover(VEC.backend); vs.devices = list; const sel = $('#vecDev'); sel.innerHTML = '';
  for (const d of list) { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; o.disabled = !!d.error; sel.appendChild(o); }
  const ok = list.filter((d) => !d.error); vecMsg(ok.length ? t('vec.found', { n: ok.length }) : (list[0] && list[0].name) || t('vec.none'), ok.length ? 'ok' : 'bad');
}
async function vecLive() {
  if (vs.live) return; const d = vs.devices.find((x) => x.id === $('#vecDev').value && !x.error);
  if (!d) { vecMsg(t('vec.pickDev'), 'bad'); return; }
  const r = await window.laser.outOpen(VEC.backend, { ...d }); if (!r.ok) { vecMsg(r.error, 'bad'); return; }
  vs.live = true; vs.dirty = true; window.laser.outShutter(true); let k = 0, last = 0;
  const tick = () => { if (!vs.live) return; const c = vecCompile(), f = c[k % c.length]; window.laser.outFrame(f.q, f.stats.pps); const now = performance.now(); if (c.length > 1 && now - last >= 1000 / Math.max(0.5, effFps(f))) { k++; last = now; } vs.liveTimer = setTimeout(tick, Math.max(10, Math.min(100, 1000 / Math.max(1, effFps(f))))); };
  tick(); vecMsg(t('vec.liveOn'), 'ok'); vecSyncLive();
}
async function vecStop(reason) {
  clearTimeout(vs.liveTimer); const was = vs.live; vs.live = false;
  if (was) { window.laser.outShutter(false); for (let i = 0; i < 5; i++) window.laser.outFrame(LaserFrame.quantize(LaserFrame.blankFrame()), VEC.pps); await new Promise((r) => setTimeout(r, 150)); await window.laser.outClose(); }
  if (reason) vecMsg(reason, 'bad'); else if (was) vecMsg(t('vec.liveOff')); vecSyncLive();
}
function vecSyncLive() { const b = $('#vecLiveBtn'); if (b) { b.disabled = vs.live; $('#vecStopBtn').classList.toggle('danger', vs.live); } }
function vecMsg(s, kind) { const el = $('#vecMsg'); if (el) { el.textContent = s || ''; el.className = 'vec-msg ' + (kind || ''); } }

// ---------- UI ----------
function vecSyncUI() {
  $$('#vecTool button').forEach((b) => b.classList.toggle('active', b.dataset.tool === vs.tool));
  $('#vecTextBox').hidden = vs.tool !== 'text';
  $$('#vecFont button').forEach((b) => b.classList.toggle('active', b.dataset.font === (VEC.font || 'stroke')));
  $$('#vecRoute button').forEach((b) => b.classList.toggle('active', b.dataset.route === VEC.route));
  $('#vecSdBox').hidden = VEC.route !== 'sd'; $('#vecDacBox').hidden = VEC.route === 'sd';
  for (const [id, k] of [['vecPps', 'pps'], ['vecFps', 'fps'], ['vecStep', 'stepPct'], ['vecAnchor', 'anchor'], ['vecDwell', 'cornerDwell'], ['vecDerate', 'deratePct'], ['vecMin', 'minPct'], ['vecInt', 'intensity'], ['vecSlot', 'slot']]) { const el = $('#' + id); if (el) el.value = VEC[k]; }
  $('#vecName').value = VEC.name; $('#vecBackend').value = VEC.backend; $('#vecFlipX').checked = VEC.flipX; $('#vecFlipY').checked = VEC.flipY; $('#vecShowBlank').checked = VEC.showBlank;
  $('#vecPps').disabled = VEC.route === 'sd'; $('#vecPpsHint').textContent = VEC.route === 'sd' ? t('vec.ppsSd', { k: cfg.kpps || 20 }) : '';
  vecRenderLayers(); vecRenderPkg(); vecSyncLive(); vs.dirty = true;
}
function vecInit() {
  if (!$('#page-vector') || typeof LaserFrame === 'undefined') return;
  const cv = $('#vecCanvas'); cv.addEventListener('pointerdown', vecDown); cv.addEventListener('pointermove', vecMove); cv.addEventListener('pointerup', vecUp); cv.addEventListener('pointercancel', () => { vs.drag = null; });
  $$('#vecTool button').forEach((b) => b.onclick = () => { vs.tool = b.dataset.tool; vecSyncUI(); });
  $$('#vecFont button').forEach((b) => b.onclick = () => { VEC.font = b.dataset.font; vecSave(); vecSyncUI(); });
  $$('#vecRoute button').forEach((b) => b.onclick = () => { if (vs.live) vecStop(); VEC.route = b.dataset.route; vecSave(); vecSyncUI(); });
  $('#vecTextAdd').onclick = () => { const txt = $('#vecText').value; if (!txt.trim()) return; curLayer().items.push({ type: 'text', text: txt, size: +$('#vecTextSize').value / 100, font: VEC.font || 'stroke', x: 0, y: 0 }); vecSave(); vecRenderLayers(); };
  $('#vecUndo').onclick = () => { curLayer().items.pop(); vecSave(); vecRenderLayers(); };
  $('#vecClear').onclick = () => { curLayer().items = []; vecSave(); vecRenderLayers(); };
  $('#vecNewDoc').onclick = () => { vdoc = vecNewDoc(); vdoc.frames[0].layers[0].items = []; vs.frame = vs.layer = 0; vecSave(); vecRenderLayers(); };
  $('#vecAddLayer').onclick = () => { const f = curFrame(); f.layers.push({ name: t('vec.layer') + ' ' + (f.layers.length + 1), color: ['#ff2a2a', '#2a7bff', '#ffd42a', '#ff2af0', '#2affff', '#ffffff'][f.layers.length % 6], visible: true, items: [] }); vs.layer = f.layers.length - 1; vecSave(); vecRenderLayers(); };
  $('#vecPrev').onclick = () => { vs.frame = Math.max(0, vs.frame - 1); vecRenderLayers(); };
  $('#vecNext').onclick = () => { vs.frame = Math.min(vdoc.frames.length - 1, vs.frame + 1); vecRenderLayers(); };
  $('#vecDup').onclick = () => { vdoc.frames.splice(vs.frame + 1, 0, structuredClone(curFrame())); vs.frame++; vecSave(); vecRenderLayers(); };
  $('#vecDelFrame').onclick = () => { if (vdoc.frames.length > 1) { vdoc.frames.splice(vs.frame, 1); vs.frame = Math.max(0, vs.frame - 1); vecSave(); vecRenderLayers(); } };
  const num = (id, k, lo, hi) => { $('#' + id).onchange = (e) => { VEC[k] = clamp(+e.target.value || VEC_DEF[k], lo, hi); e.target.value = VEC[k]; vecSave(); }; };
  num('vecPps', 'pps', 1000, 100000); num('vecFps', 'fps', 1, 100); num('vecStep', 'stepPct', 0.25, 5); num('vecAnchor', 'anchor', 1, 8); num('vecDwell', 'cornerDwell', 0, 10); num('vecDerate', 'deratePct', 0, 90); num('vecMin', 'minPct', 0.5, 20); num('vecInt', 'intensity', 0, 100); num('vecSlot', 'slot', 1, 255);
  $('#vecName').onchange = (e) => { VEC.name = e.target.value.slice(0, 8).toUpperCase(); e.target.value = VEC.name; vecSave(); };
  $('#vecBackend').onchange = (e) => { VEC.backend = e.target.value; vs.devices = []; $('#vecDev').innerHTML = ''; vecSave(); vecMsg(''); };
  for (const [id, k] of [['vecFlipX', 'flipX'], ['vecFlipY', 'flipY'], ['vecShowBlank', 'showBlank']]) $('#' + id).onchange = (e) => { VEC[k] = e.target.checked; vecSave(); };
  $('#vecAddPkg').onclick = vecAddToPkg; $('#vecExport').onclick = vecExportSd;
  $('#vecFind').onclick = vecFind; $('#vecLiveBtn').onclick = vecLive; $('#vecStopBtn').onclick = () => vecStop();
  window.laser.onOutStatus((s) => { if (s.state === 'lost' && vs.live) vecStop(t('vec.lost')); else if (s.state === 'estop') vecMsg(t('vec.estop'), 'bad'); });
  const bo = $('#blackout'); if (bo) bo.addEventListener('click', () => vecStop());
  document.querySelector('[data-tab="vector"]').addEventListener('click', () => { vs.dirty = true; vecSyncUI(); });
  const ts = $('#vecTextSize'), to = ts.parentElement.querySelector('output'); const tsOut = () => { to.textContent = ts.value + '%'; }; ts.addEventListener('input', tsOut); tsOut();
  vecSyncUI();
  const loop = (now) => { vecDraw(now); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
}
vecInit();
