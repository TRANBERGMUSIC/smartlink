// Kør: node test/shownet.test.js   (eller npm test)
// Tester at decode(encode(s)) == s inden for kvantisering, og at previewet matcher målingerne i laser-profile.json hvis den findes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/shownet.js');

let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≠ ${b} (±${tol})`);
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- position ----------
test('Pro: 128 = midt, 0 = venstre, 255 = højre', () => {
  near(S.posDecode(128 * 256, 'pro'), 0, 1e-9, 'midt'); near(S.posDecode(0, 'pro'), -1, 1e-9, 'venstre'); near(S.posDecode(65535, 'pro'), 1, 1 / 2048, 'højre');
  near(S.posDecode(64 * 256, 'pro'), -0.5, 1e-9, '64'); near(S.posDecode(192 * 256, 'pro'), 0.5, 1e-9, '192');
});
for (const m of ['pro', 's', 'h1', 'u']) test(`position roundtrip (${m})`, () => {
  for (let i = 0; i < 2000; i++) { const u = rnd(-1, 1); near(S.posDecode(S.posEncode(u, m), m), u, 1 / 4096 + 1e-6, `u=${u}`); }
});
test('position roundtrip (h2, kun én retning)', () => { for (let i = 0; i < 500; i++) { const u = rnd(0, 1); near(S.posDecode(S.posEncode(u, 'h2'), 'h2'), u, 1 / 4096, `u=${u}`); } });
test('Pro kvantiseres til 4096 trin', () => { for (let i = 0; i < 500; i++) assert.strictEqual(S.posEncode(rnd(-1, 1), 'pro') % 16 === 0 || S.posEncode(1, 'pro') === 65535, true); });
test('H1: 0 = midt, 65535 lige under midt, 32768 = −1', () => { near(S.posDecode(0, 'h1'), 0, 1e-9, '0'); assert.ok(S.posDecode(65535, 'h1') < 0 && S.posDecode(65535, 'h1') > -0.001); near(S.posDecode(32768, 'h1'), -1, 1e-3, '32768'); });

// ---------- størrelse ----------
test('størrelse: 0 = fuld (begge modes)', () => { near(S.sizeFromDmx(0, null, 'pro'), 1, 1e-9, 'pro'); near(S.sizeFromDmx(0, null, 'dj'), 1, 1e-9, 'dj'); });
test('størrelse: kurven er monotont faldende', () => { for (const m of ['pro', 'dj']) { let prev = 2; for (let d = 0; d <= (m === 'dj' ? 127 : 255); d++) { const v = S.sizeFromDmx(d, null, m); assert.ok(v <= prev + 1e-12, `${m} ${d}`); prev = v; } } });
test('størrelse roundtrip inden for 1/255', () => {
  for (const m of ['pro', 'dj']) { const lim = S.sizeLimits(null, m); for (let i = 0; i < 300; i++) { const f = rnd(lim.min, 1); const d = S.sizeToDmx(f, null, m); near(S.sizeFromDmx(d, null, m), f, (1 - lim.min) / (m === 'dj' ? 127 : 255) + 1e-9, `${m} f=${f}`); } }
});
test('størrelse under minimum klemmes til mindste synlige', () => {
  const prof = { sizeCurve: { pro: [[0, 1], [200, 0.1], [255, 0.02]] }, dmxMinVisible: { pro: 201 } };
  const d = S.sizeToDmx(0.01, prof, 'pro'); assert.ok(d <= 200, 'dmx må ikke ramme det slukkede område'); near(S.sizeFromDmx(d, prof, 'pro'), 0.1, 1e-9, 'klemt');
  assert.strictEqual(S.decode(S.encode({ on: true, pattern: 1, sizeX: 0.01 }, prof, 'pro'), prof, 'pro').visible, true);
});

// ---------- framerate ----------
test('fps Pro: 128 = 50, 0 = 0, 255 = 100', () => { near(S.fpsDecode(128, 'pro'), 50, 1e-9, '128'); near(S.fpsDecode(0, 'pro'), 0, 1e-9, '0'); near(S.fpsDecode(255, 'pro'), 100, 1e-9, '255'); });
test('fps DJ: 0–15 = 50, 16 = 0, 255 = 100', () => { near(S.fpsDecode(10, 'dj'), 50, 1e-9, '10'); near(S.fpsDecode(16, 'dj'), 0, 1e-9, '16'); near(S.fpsDecode(255, 'dj'), 100, 1e-9, '255'); });
test('fps roundtrip', () => { for (const m of ['pro', 'dj']) for (let i = 0; i <= 100; i++) near(S.fpsDecode(S.fpsEncode(i, m), m), i, 0.45, `${m} ${i}`); });

// ---------- hele frames ----------
test('decode(encode(s)) == s (Pro)', () => {
  for (let i = 0; i < 500; i++) {
    const s = { on: true, intensity: rnd(0.1, 1), pattern: 1 + Math.floor(rnd(0, 250)), fps: rnd(0, 100), x: rnd(-1, 1), y: rnd(-1, 1), sizeX: rnd(0.05, 1), sizeY: rnd(0.05, 1), rotDeg: rnd(-180, 180), invX: Math.random() < 0.5, invY: Math.random() < 0.5 };
    const f = S.encode(s, null, 'pro'); assert.strictEqual(f.length, 34); const d = S.decode(f, null, 'pro');
    near(d.x, s.x, 1 / 4096 + 1e-6, 'x'); near(d.y, s.y, 1 / 4096 + 1e-6, 'y'); near(d.sizeX, s.sizeX, 1 / 255 + 1e-6, 'sizeX'); near(d.sizeY, s.sizeY, 1 / 255 + 1e-6, 'sizeY');
    near(d.fps, s.fps, 0.45, 'fps'); near(d.rotDeg, s.rotDeg, 360 / 65536 + 1e-6, 'rot'); assert.strictEqual(d.invX, s.invX); assert.strictEqual(d.invY, s.invY); assert.strictEqual(d.pattern, s.pattern); assert.strictEqual(d.visible, true);
    for (const v of f) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
    for (let k = 30; k <= 34; k++) assert.strictEqual(f[k - 1], 0, 'kanal 30–34 er reserveret');
  }
});
test('decode(encode(s)) == s (DJ, alle positionsmodeller)', () => {
  for (const pm of ['s', 'h1', 'u']) for (let i = 0; i < 200; i++) {
    const s = { on: true, pattern: 5, fps: rnd(0, 100), x: rnd(-1, 1), y: rnd(-1, 1), sizeX: rnd(0.06, 1), rotDeg: rnd(-179, 179) };
    const prof = { posModel: pm }, f = S.encode(s, prof, 'dj'); assert.strictEqual(f.length, 19); const d = S.decode(f, prof, 'dj');
    near(d.x, s.x, 1 / 4096 + 1e-6, `${pm} x`); near(d.y, s.y, 1 / 4096 + 1e-6, `${pm} y`); near(d.sizeX, s.sizeX, 1 / 127 + 1e-6, `${pm} size`); near(d.rotDeg, s.rotDeg, 360 / 192, `${pm} rot`);
    assert.strictEqual(f[13], 0, 'DJ kanal 14 (operation mode) skal være 0');
  }
});
test('slukket = intet synligt', () => { assert.strictEqual(S.decode(S.encode({ on: false, pattern: 3 }, null, 'pro'), null, 'pro').visible, false); assert.strictEqual(S.decode(S.encode({ on: true, pattern: 0 }, null, 'pro'), null, 'pro').visible, false); });
test('transformationskæde: skalér og rotér om ILDA-origo, ikke mønstrets midte', () => {
  const d = { sizeX: 0.5, sizeY: 0.5, rotDeg: 90, x: 0.2, y: 0, invX: false, invY: false };
  const p = S.transformPoint(1, 0, d, null); near(p.x, 0.2, 1e-9, 'x'); near(p.y, 0.5, 1e-9, 'y');
  const q = S.transformPoint(0, 0, { ...d, invX: true }, null); near(q.x, -0.2, 1e-9, 'inversion spejler også positionen');
  const z = S.transformPoint(1, 1, { sizeX: 1, sizeY: 1, rotDeg: 0, x: 0, y: 0 }, { zone: { l: -0.5, r: 0.5, b: -1, t: 0 } }); near(z.x, 0.5, 1e-9, 'zone x'); near(z.y, 0, 1e-9, 'zone y');
});
test('gain: posGain skalerer begge veje', () => { const prof = { posGainX: 0.25 }; const d = S.decode(S.encode({ on: true, pattern: 1, x: 0.2 }, prof, 'pro'), prof, 'pro'); near(d.x, 0.2, 1e-3, 'x'); });
test('positionsmodel findes ud fra målinger', () => {
  const truth = 'h1', sign = -1, samples = [0, 32, 64, 96, 127, 128, 160, 192, 224, 255].map((c) => ({ coarse: c, u: S.posDecode(c * 256, truth) * sign }));
  const fit = S.fitPosModel(samples); assert.strictEqual(fit.model, truth); assert.strictEqual(fit.sign, sign); near(fit.gain, 1, 1e-3, 'gain');
  const small = [0, 32, 64, 96, 127].map((c) => ({ coarse: c, u: S.posDecode(c * 256 + 32768, 's') * 0.1 })); const f2 = S.fitPosModel(small); near(f2.gain, 0.1, 0.01, 'DJ: fuldt signal = 10 % af feltet');
});

// ---------- målinger fra kalibreringen (laser-profile.json, skrevet af appen) ----------
const profPath = [path.join(__dirname, '..', '..', 'laser-profile.json'), path.join(__dirname, 'laser-profile.json')].find((p) => fs.existsSync(p));
if (profPath) {
  const prof = JSON.parse(fs.readFileSync(profPath, 'utf8')), meas = prof.measurements || {};
  for (const p of meas.pos || []) test(`måling: ${p.axis} coarse ${p.coarse} → u ${p.u}`, () => {
    const model = prof.mode === 'dj' ? (prof.posModel === 'pro' ? 's' : prof.posModel) : 'pro', sign = p.axis === 'y' ? prof.signY : prof.signX;
    const gain = p.axis === 'y' ? (prof.posGainY ?? 1) : (prof.posGainX ?? 1); near(S.posDecode(p.coarse * 256, model) * sign * gain, p.u, 0.06, 'preview vs målt');
  });
  for (const s of meas.size || []) if (!s.off) test(`måling: størrelse dmx ${s.dmx} → ${s.frac}`, () => near(S.sizeFromDmx(s.dmx, prof, prof.mode), s.frac, 0.03, 'preview vs målt'));
  for (const s of meas.size || []) if (s.off) test(`måling: dmx ${s.dmx} er slukket`, () => assert.ok(s.dmx >= prof.dmxMinVisible[prof.mode === 'dj' ? 'dj' : 'pro']));
}

console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ alle ${n} tests bestået${profPath ? ' (inkl. målinger fra ' + path.basename(profPath) + ')' : ''}`);
process.exit(failed ? 1 : 0);
