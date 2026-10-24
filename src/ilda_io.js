// ilda_io.js – ILDA-filer (.ild): writer (format 4 = 3D RGB, 5 = 2D RGB) og reader (format 0, 1, 2, 4, 5).
// Big-endian. 32-byte header pr. frame; filen slutter med en header med 0 records. Testes i test/ilda_io.test.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IldaIO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // standard ILDA-palette (64 farver) – bruges til de indekserede formater 0/1 når filen ikke har sin egen (format 2)
  const DEFAULT_PALETTE = (() => { const p = []; const hues = [[255, 0, 0], [255, 16, 0], [255, 32, 0], [255, 48, 0], [255, 64, 0], [255, 80, 0], [255, 96, 0], [255, 112, 0], [255, 128, 0], [255, 144, 0], [255, 160, 0], [255, 176, 0], [255, 192, 0], [255, 208, 0], [255, 224, 0], [255, 240, 0], [255, 255, 0], [224, 255, 0], [192, 255, 0], [160, 255, 0], [128, 255, 0], [96, 255, 0], [64, 255, 0], [32, 255, 0], [0, 255, 0], [0, 255, 36], [0, 255, 73], [0, 255, 109], [0, 255, 146], [0, 255, 182], [0, 255, 219], [0, 255, 255], [0, 227, 255], [0, 198, 255], [0, 170, 255], [0, 142, 255], [0, 113, 255], [0, 85, 255], [0, 56, 255], [0, 28, 255], [0, 0, 255], [32, 0, 255], [64, 0, 255], [96, 0, 255], [128, 0, 255], [160, 0, 255], [192, 0, 255], [224, 0, 255], [255, 0, 255], [255, 32, 255], [255, 64, 255], [255, 96, 255], [255, 128, 255], [255, 160, 255], [255, 192, 255], [255, 224, 255], [255, 255, 255], [255, 224, 224], [255, 192, 192], [255, 160, 160], [255, 128, 128], [255, 96, 96], [255, 64, 64], [255, 32, 32]]; for (const h of hues) p.push(h); return p; })();
  const ascii8 = (s) => { const b = new Uint8Array(8).fill(32); const t = String(s || ''); for (let i = 0; i < Math.min(8, t.length); i++) { const c = t.charCodeAt(i); b[i] = c >= 32 && c < 127 ? c : 32; } return b; };

  // frames: [{ name?, points: [{ x, y, z?, r, g, b, blank }] }] med x/y/z som int16
  function write(frames, o = {}) {
    const format = o.format === 4 ? 4 : 5, rec = format === 4 ? 10 : 8, parts = [];
    const header = (code, cnt, fi, total, name) => { const b = new Uint8Array(32), dv = new DataView(b.buffer); b.set([0x49, 0x4c, 0x44, 0x41], 0); b[7] = code; b.set(ascii8(name), 8); b.set(ascii8(o.company || 'SmartLnk'), 16); dv.setUint16(24, cnt); dv.setUint16(26, fi); dv.setUint16(28, total); b[30] = o.projector | 0; return b; };
    frames.forEach((f, fi) => {
      const pts = (f.points || []).slice(0, 65535), body = new Uint8Array(pts.length * rec), dv = new DataView(body.buffer);
      pts.forEach((p, i) => {
        const at = i * rec; dv.setInt16(at, clamp(Math.round(p.x), -32768, 32767)); dv.setInt16(at + 2, clamp(Math.round(p.y), -32768, 32767)); let k = at + 4;
        if (format === 4) { dv.setInt16(k, clamp(Math.round(p.z || 0), -32768, 32767)); k += 2; }
        body[k] = (p.blank ? 0x40 : 0) | (i === pts.length - 1 ? 0x80 : 0); body[k + 1] = clamp(p.b | 0, 0, 255); body[k + 2] = clamp(p.g | 0, 0, 255); body[k + 3] = clamp(p.r | 0, 0, 255); // BGR
      });
      parts.push(header(format, pts.length, fi, frames.length, f.name || o.name || 'SMARTLNK'), body);
    });
    parts.push(header(format, 0, 0, 0, o.name || 'SMARTLNK'));
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let off = 0; for (const p of parts) { out.set(p, off); off += p.length; } return out;
  }

  // → [{ name, company, format, points: [{x, y, z, r, g, b, blank}] }]
  function read(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), frames = [];
    let off = 0, palette = DEFAULT_PALETTE;
    const str = (a, n) => String.fromCharCode(...u.slice(a, a + n)).replace(/[\0 ]+$/, '');
    while (off + 32 <= u.length) {
      if (u[off] !== 0x49 || u[off + 1] !== 0x4c || u[off + 2] !== 0x44 || u[off + 3] !== 0x41) throw new Error('ILDA: forventede "ILDA" ved byte ' + off);
      const code = u[off + 7], cnt = dv.getUint16(off + 24), name = str(off + 8, 8), company = str(off + 16, 8); off += 32;
      if (cnt === 0) break;
      const rec = { 0: 8, 1: 6, 2: 3, 4: 10, 5: 8 }[code]; if (!rec) throw new Error('ILDA: ukendt format ' + code);
      if (off + cnt * rec > u.length) throw new Error('ILDA: filen er afkortet');
      if (code === 2) { const pal = []; for (let i = 0; i < cnt; i++) pal.push([u[off + i * 3], u[off + i * 3 + 1], u[off + i * 3 + 2]]); palette = pal; off += cnt * 3; continue; }
      const pts = [];
      for (let i = 0; i < cnt; i++) {
        const a = off + i * rec, x = dv.getInt16(a), y = dv.getInt16(a + 2); let z = 0, k = a + 4;
        if (code === 0 || code === 4) { z = dv.getInt16(k); k += 2; }
        const st = u[k]; let r, g, b;
        if (code === 4 || code === 5) { b = u[k + 1]; g = u[k + 2]; r = u[k + 3]; } else { const c = palette[u[k + 1]] || [255, 255, 255]; [r, g, b] = c; }
        pts.push({ x, y, z, r, g, b, blank: !!(st & 0x40) });
      }
      off += cnt * rec; frames.push({ name, company, format: code, points: pts });
    }
    return frames;
  }
  // til appens preview-format (felt −1…1)
  function toPreviewFrames(frames) { return frames.map((f) => { const n = f.points.length, xy = new Float32Array(n * 2), bl = new Uint8Array(n), col = new Uint8Array(n * 3); f.points.forEach((p, i) => { xy[i * 2] = p.x / 32767; xy[i * 2 + 1] = p.y / 32767; bl[i] = p.blank ? 1 : 0; col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b; }); return { n, xy, bl, col }; }); }
  return { write, read, toPreviewFrames, DEFAULT_PALETTE };
});
