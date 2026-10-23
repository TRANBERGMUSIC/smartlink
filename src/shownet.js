// shownet.js – ren mapping mellem appens tilstand og Laserworld ShowNET DMX (Professional 34 kanaler / DJ 19 kanaler).
// Ingen DOM, ingen globale variabler: encode/decode/transform er rene funktioner og testes i test/shownet.test.js.
// Kilde: Laserworld ShowNET DMX-charts (firmware 2021010602). Alt der ikke er dokumenteret ligger i en laserprofil
// og afgøres af kalibreringen (positionsmodel i DJ Mode, størrelseskurve, rotation pr. trin, klipning, projektionszone).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShowNET = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const STEP = 16; // scanneren er 12-bit: 65536 / 4096 = 16 DMX-trin pr. fysisk trin

  const DEFAULT_PROFILE = {
    model: 'DS-3000RGB MK5', mode: 'pro', address: 1,
    scanDegX: 70, scanDegY: 70, throwM: 0,          // scanvinkel (hele feltet) og kastelængde til meter-visning
    posModel: 'pro',                                  // 'pro' | 's' (fortegn+udslag) | 'h1' (wrap/signed) | 'h2' (ensidig) | 'u' (0–255, 128 = midt)
    signX: 1, signY: 1,                               // retningsfortegn pr. akse (målt)
    posGainX: 1, posGainY: 1,                         // hvor stor en del af feltet fuldt positionssignal flytter (målt; Pro forventes 1)
    sizeCurve: { pro: [[0, 1], [255, 0.02]], dj: [[0, 1], [127, 0.05]] }, // [dmx, størrelse som brøk af fuldt felt], monotont faldende
    dmxMinVisible: { pro: 256, dj: 128 },             // første værdi hvor laseren slukker (256/128 = slukker aldrig)
    rotDegPerStep: 360 / 65536, rotSign: 1,           // Pro: 16-bit rotation, 32768 = 0°
    clipMode: 'clamp',                                // 'clamp' = punkter klemmes til kanten · 'clip' = linjer udenfor tegnes ikke
    zone: { l: -1, r: 1, b: -1, t: 1 },               // gemt projektionszone i mainboardet (brøk af fuldt felt, −1…1)
  };
  const profileOf = (p) => {
    const d = DEFAULT_PROFILE, q = p || {};
    return { ...d, ...q, sizeCurve: { ...d.sizeCurve, ...(q.sizeCurve || {}) }, dmxMinVisible: { ...d.dmxMinVisible, ...(q.dmxMinVisible || {}) }, zone: { ...d.zone, ...(q.zone || {}) } };
  };

  // ---------- position ----------
  function posEncode(u, model) { // u ∈ [−1, 1] → 16-bit værdi
    u = clamp(u, -1, 1);
    switch (model) {
      case 'pro': case 'u': return clamp(Math.round((32768 + u * 32768) / STEP) * STEP, 0, 65535);
      case 's': { const m = Math.round(Math.abs(u) * 32767); return (u >= 0 ? 32768 : 0) | m; } // bit 15 = retning, 15 bit udslag
      case 'h1': { const v = Math.round(u * 32767); return v >= 0 ? v : 65536 + v; }       // 0 = midt, 1…32767 = +, 65535…32768 = −
      case 'h2': return clamp(Math.round(Math.max(0, u) * 65535), 0, 65535);               // kun én retning fra midten
      default: return 32768;
    }
  }
  function posDecode(v, model) { // 16-bit værdi → u
    v = clamp(Math.round(v), 0, 65535);
    switch (model) {
      case 'pro': case 'u': { const q = Math.min(65535, Math.round(v / STEP) * STEP); return clamp((q - 32768) / 32768, -1, 1); }
      case 's': return ((v & 32768) ? 1 : -1) * (v & 32767) / 32767;
      case 'h1': return v < 32768 ? v / 32767 : (v - 65536) / 32767;
      case 'h2': return v / 65535;
      default: return 0;
    }
  }

  // ---------- størrelse (kurve fra kalibreringen) ----------
  function curve(profile, mode) { return [...profileOf(profile).sizeCurve[mode === 'dj' ? 'dj' : 'pro']].sort((a, b) => a[0] - b[0]); }
  function sizeFromDmx(d, profile, mode) { // dmx → brøk af fuldt felt (stykvis lineær)
    const c = curve(profile, mode); if (d <= c[0][0]) return c[0][1]; if (d >= c[c.length - 1][0]) return c[c.length - 1][1];
    for (let i = 1; i < c.length; i++) if (d <= c[i][0]) { const a = c[i - 1], b = c[i]; return a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0]); }
    return c[c.length - 1][1];
  }
  function sizeLimits(profile, mode) { // [mindste synlige brøk, 1] – appens slider må kun gå i det interval
    const P = profileOf(profile), m = mode === 'dj' ? 'dj' : 'pro', maxD = m === 'dj' ? 127 : 255, lastVis = Math.min(maxD, P.dmxMinVisible[m] - 1);
    return { min: sizeFromDmx(lastVis, P, m), max: sizeFromDmx(0, P, m), lastVisibleDmx: lastVis };
  }
  function sizeToDmx(frac, profile, mode) { // brøk → dmx (laveste dmx der giver mindst den størrelse); klemmes til det synlige
    const lim = sizeLimits(profile, mode), f = clamp(frac, lim.min, lim.max);
    let best = 0, bestErr = Infinity; for (let d = 0; d <= lim.lastVisibleDmx; d++) { const e = Math.abs(sizeFromDmx(d, profile, mode) - f); if (e < bestErr - 1e-12) { bestErr = e; best = d; } }
    return best;
  }

  // ---------- framerate ----------
  function fpsEncode(fps, mode) {
    fps = clamp(fps, 0, 100);
    if (mode === 'dj') return clamp(Math.round(16 + fps / 100 * 239), 16, 255);
    if (fps <= 50) return fps >= 49.8 ? 128 : clamp(Math.round(fps / 50 * 127), 0, 127);
    return clamp(Math.round(128 + (fps - 50) / 50 * 127), 129, 255);
  }
  function fpsDecode(v, mode) {
    if (mode === 'dj') return v < 16 ? 50 : (v - 16) / 239 * 100;
    if (v < 128) return v / 127 * 50; if (v === 128) return 50; return 50 + (v - 128) / 127 * 50;
  }

  // ---------- encode: tilstand → DMX-frame (relativt til startadressen, index 0 = kanal 1) ----------
  // state: { on, intensity 0..1, pattern, fps, x, y (u), sizeX, sizeY (brøk af felt), rotDeg, rotSpeed (−1..1), invX, invY,
  //          color: {mode:'orig'|'rgb'|'white', rgb:[r,g,b]}, strobe 0..1, zone 0..1 }
  function encode(state, profile, mode) {
    const P = profileOf(profile), s = state || {}, dj = mode === 'dj';
    const f = new Uint8Array(dj ? 19 : 34), ch = (n, v) => { f[n - 1] = clamp(Math.round(v), 0, 255); };
    const on = !!s.on && (s.pattern | 0) > 0;
    const model = dj ? (P.posModel === 'pro' ? 's' : P.posModel) : 'pro';
    const px = posEncode((s.x || 0) * P.signX / P.posGainX, model), py = posEncode((s.y || 0) * P.signY / P.posGainY, model);
    if (!dj) {
      ch(1, on ? Math.max(1, (s.intensity ?? 1) * 255) : 0); ch(2, on ? s.pattern : 0); ch(3, s.freeze ? 0 : fpsEncode(s.fps ?? 50, 'pro'));
      ch(4, px >> 8); ch(5, px & 255); ch(6, py >> 8); ch(7, py & 255);
      const r = ((Math.round(32768 + ((s.rotDeg || 0) * P.rotSign) / P.rotDegPerStep) % 65536) + 65536) % 65536; ch(8, r >> 8); ch(9, r & 255);
      ch(10, sizeToDmx(s.sizeX ?? 1, P, 'pro')); ch(11, sizeToDmx(s.sizeY ?? s.sizeX ?? 1, P, 'pro'));
      ch(12, (s.invX ? 64 : 0) + (s.invY ? 128 : 0));
      const c = s.color || { mode: 'orig' };
      if (c.mode === 'rgb') { ch(13, 248); ch(14, c.rgb[0]); ch(15, c.rgb[1]); ch(16, c.rgb[2]); } else if (c.mode === 'white') ch(13, 232); else ch(13, 0);
      ch(17, s.strobe > 0 ? 16 + s.strobe * 239 : 0); ch(18, 0);
      ch(19, (s.zone || 0) * 255); ch(20, s.zone > 0 ? 255 : 0);
      ch(21, 255); ch(22, 255); ch(23, 255); ch(24, 0); ch(25, 0); for (let n = 26; n <= 29; n++) ch(n, 128);
      return f;
    }
    ch(1, on ? Math.max(1, (s.intensity ?? 1) * 255) : 0); ch(2, on ? s.pattern : 0); ch(3, s.freeze ? 16 : fpsEncode(s.fps ?? 50, 'dj'));
    ch(4, Math.min(127, sizeToDmx(Math.min(s.sizeX ?? 1, s.sizeY ?? s.sizeX ?? 1), P, 'dj'))); ch(5, 0); // DJ: kun ensartet størrelse
    if (s.rotSpeed > 0.02) ch(6, 225 + s.rotSpeed * 30); else if (s.rotSpeed < -0.02) ch(6, 193 - s.rotSpeed * 31);
    else { let a = (s.rotDeg || 0) % 360; if (a > 180) a -= 360; if (a < -180) a += 360; ch(6, (a + 180) / 360 * 192); }
    ch(7, px >> 8); ch(8, px & 255); ch(9, py >> 8); ch(10, py & 255);
    ch(11, 0); ch(12, 0); ch(13, s.strobe > 0 ? 16 + s.strobe * 239 : 0); ch(14, 0); ch(15, 0);
    ch(16, s.zone > 0 ? 64 + Math.round(20 + s.zone * 42) : 0); ch(17, s.zone > 0 ? 255 : 0); ch(18, 0); ch(19, 0);
    return f;
  }

  // ---------- decode: DMX-frame → hvad laseren faktisk gør ----------
  function decode(frame, profile, mode) {
    const P = profileOf(profile), dj = mode === 'dj', g = (n) => frame[n - 1] | 0;
    const model = dj ? (P.posModel === 'pro' ? 's' : P.posModel) : 'pro';
    const out = { mode: dj ? 'dj' : 'pro', intensity: g(1) / 255, pattern: g(2) };
    if (!dj) {
      out.fps = fpsDecode(g(3), 'pro');
      out.x = posDecode(g(4) * 256 + g(5), model) * P.signX * P.posGainX; out.y = posDecode(g(6) * 256 + g(7), model) * P.signY * P.posGainY;
      out.rotDeg = (((g(8) * 256 + g(9)) - 32768) * P.rotDegPerStep) * P.rotSign; out.rotSpeed = 0;
      out.sizeDmxX = g(10); out.sizeDmxY = g(11); out.sizeX = sizeFromDmx(g(10), P, 'pro'); out.sizeY = sizeFromDmx(g(11), P, 'pro');
      const inv = g(12); out.invX = inv >= 64 && inv < 128 || inv >= 192; out.invY = inv >= 128;
      const c = g(13); out.color = c < 16 ? { mode: 'orig' } : c >= 240 ? { mode: 'rgb', rgb: [g(14), g(15), g(16)] } : c >= 208 ? { mode: 'white' } : { mode: 'fixed', v: c };
      out.strobe = g(17) < 16 ? 0 : (g(17) - 16) / 239; out.zone = g(19) / 255;
      out.tooSmall = g(10) >= P.dmxMinVisible.pro || g(11) >= P.dmxMinVisible.pro;
    } else {
      out.fps = fpsDecode(g(3), 'dj');
      out.x = posDecode(g(7) * 256 + g(8), model) * P.signX * P.posGainX; out.y = posDecode(g(9) * 256 + g(10), model) * P.signY * P.posGainY;
      const r = g(6); out.rotSpeed = r >= 225 ? (r - 225) / 30 : r >= 193 ? -(r - 193) / 31 : 0; out.rotDeg = r <= 192 ? r / 192 * 360 - 180 : 0;
      const sz = g(4); out.sizeDmxX = out.sizeDmxY = sz;
      if (sz <= 127) { out.sizeX = out.sizeY = sizeFromDmx(sz, P, 'dj'); }
      else if (sz <= 191) { out.sizeX = sizeFromDmx((sz - 128) * 2, P, 'dj'); out.sizeY = 1; } // 128–191: kun X mindskes
      else { out.sizeX = 1; out.sizeY = sizeFromDmx((sz - 192) * 2, P, 'dj'); }               // 192–255: kun Y mindskes
      out.invX = false; out.invY = false; out.color = g(11) === 0 ? { mode: 'orig' } : { mode: 'fx', v: g(11) };
      out.strobe = g(13) < 16 ? 0 : (g(13) - 16) / 239; out.zone = g(16) > 64 ? (g(16) - 84) / 42 : 0;
      out.tooSmall = sz <= 127 && sz >= P.dmxMinVisible.dj; out.opMode = g(14);
    }
    out.visible = out.intensity > 0 && out.pattern > 0 && !out.tooSmall;
    return out;
  }

  // ---------- transformationskæden (samme rækkefølge som firmwaren) ----------
  // ILDA-punkt (−1…1) → skalér om origo → rotér om origo → + position → inversion → klem/klip til ±1 → gemt projektionszone
  function transformPoint(px, py, d, profile) {
    const P = profileOf(profile);
    let x = px * d.sizeX, y = py * d.sizeY;
    const a = (d.rotDeg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); [x, y] = [x * c - y * s, x * s + y * c];
    x += d.x; y += d.y;
    if (d.invX) x = -x; if (d.invY) y = -y;
    const outside = Math.abs(x) > 1 || Math.abs(y) > 1; x = clamp(x, -1, 1); y = clamp(y, -1, 1);
    const z = P.zone; x = z.l + (x + 1) / 2 * (z.r - z.l); y = z.b + (y + 1) / 2 * (z.t - z.b);
    return { x, y, outside: outside && P.clipMode === 'clip' };
  }
  function angleOf(u, axis, profile) { const P = profileOf(profile); return u * (axis === 'y' ? P.scanDegY : P.scanDegX) / 2; }
  function metresOf(u, axis, profile) { const P = profileOf(profile); return P.throwM ? P.throwM * Math.tan(angleOf(u, axis, P) * Math.PI / 180) : null; }

  // ---------- kalibrering: hvilken positionsmodel passer bedst på målingerne? ----------
  // samples: [{coarse, u}] målt midtpunkt (u = målt afstand / halv feltbredde, + = højre/op)
  function fitPosModel(samples, models = ['s', 'h1', 'h2', 'u']) { // → { model, sign, gain, err } (gain = hvor stor en del af feltet fuldt signal flytter)
    let best = null;
    for (const m of models) for (const sign of [1, -1]) {
      let sp = 0, pp = 0; for (const p of samples) { const pred = posDecode(p.coarse * 256, m) * sign; sp += pred * p.u; pp += pred * pred; }
      const gain = pp > 1e-9 ? Math.max(0.01, sp / pp) : 1; let err = 0; for (const p of samples) err += (posDecode(p.coarse * 256, m) * sign * gain - p.u) ** 2;
      err /= Math.max(1, samples.length); if (!best || err < best.err - 1e-12) best = { model: m, sign, gain, err };
    }
    return best;
  }
  function fitLinear(xs, ys) { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const k = sxx ? sxy / sxx : 0; return { k, b: my - k * mx }; }

  return { DEFAULT_PROFILE, profileOf, posEncode, posDecode, sizeFromDmx, sizeToDmx, sizeLimits, fpsEncode, fpsDecode, encode, decode, transformPoint, angleOf, metresOf, fitPosModel, fitLinear, STEP };
});
