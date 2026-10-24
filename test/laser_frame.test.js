// Kør: node test/laser_frame.test.js
const assert = require('assert');
const L = require('../src/laser_frame.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('tekst giver stier inden for feltet', () => { const p = L.textPaths('HEJ 123 ÆØÅ', { size: 0.15 }); assert.ok(p.length > 10); for (const s of p) for (const [x, y] of s.pts) assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1); });
test('små bogstaver bruger versaler', () => { assert.deepStrictEqual(L.textPaths('abc'), L.textPaths('ABC')); });
test('første og sidste punkt er blanket', () => { const f = L.optimize(L.textPaths('LASER')); assert.ok(f.points[0].blank); assert.ok(f.points[f.points.length - 1].blank); });
test('ingen spring større end maxStep (synlig og blanket)', () => {
  const o = { maxStep: 0.015, blankStep: 0.015 }, f = L.optimize([L.rect(-0.5, -0.5, 0.5, 0.5, [255, 0, 0]), L.circle(0.6, 0.6, 0.2, [0, 255, 0])], { ...o, pps: 1e6 });
  for (let i = 1; i < f.points.length; i++) assert.ok(d(f.points[i], f.points[i - 1]) <= 0.015 + 1e-9, `spring ${i}`);
});
test('blanket punkter har farve 0', () => { const f = L.optimize(L.textPaths('A')); for (const p of f.points) if (p.blank) assert.ok(p.r === 0 && p.g === 0 && p.b === 0); });
test('hjørne-dwell: skarpe hjørner får ekstra punkter', () => {
  const sq = [{ pts: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]], color: [255, 255, 255] }];
  const a = L.optimize(sq, { cornerDwell: 0, pps: 1e6 }).points.length, b = L.optimize(sq, { cornerDwell: 6, pps: 1e6 }).points.length; assert.ok(b > a);
});
test('NN-sortering vælger nærmeste sti og vender den', () => { const o = L.orderPaths([{ pts: [[0.9, 0], [0.8, 0]] }, { pts: [[0.5, 0], [0.1, 0]] }], [0, 0]); assert.deepStrictEqual(o[0].pts[0], [0.1, 0]); assert.deepStrictEqual(o[1].pts[0], [0.8, 0]); });
test('budget: for mange punkter → forenkles og/eller fps sænkes, og det står i stats', () => {
  const f = L.optimize(L.textPaths('MANGE BOGSTAVER HER\nOG EN LINJE TIL', { size: 0.12 }), { pps: 20000, fps: 30 });
  assert.ok(f.stats.budget === Math.floor(f.stats.pps / 30)); if (f.stats.count > f.stats.budget) assert.ok(f.stats.fpsReduced && f.stats.fps < 30); assert.ok(f.stats.simplified >= 1);
});
test('derate: stort billede får lavere pps', () => { assert.ok(L.effectivePps({ pps: 30000, derate: 0.5 }, 1) < L.effectivePps({ pps: 30000, derate: 0.5 }, 0.1)); });
test('sikkerhed: et enkelt punkt er ikke sikkert', () => { const f = L.optimize([{ pts: [[0, 0], [0.001, 0]], color: [255, 255, 255] }]); assert.strictEqual(f.stats.safe, false); assert.ok(L.safeForOutput(f).every((p) => p.blank)); });
test('sikkerhed: for lille billede stoppes', () => { const f = L.optimize([L.circle(0, 0, 0.002, [255, 255, 255], 20)], { minExtent: 0.02 }); assert.strictEqual(f.stats.safe, false); });
test('quantize: −1…1 → int16 og intensitets-master', () => {
  const q = L.quantize([{ x: -1, y: 1, r: 200, g: 100, b: 50, blank: false }, { x: 2, y: -2, r: 255, g: 255, b: 255, blank: true }], 0.5);
  assert.deepStrictEqual([q[0].x, q[0].y, q[0].r, q[0].g, q[0].b], [-32767, 32767, 100, 50, 25]); assert.deepStrictEqual([q[1].x, q[1].y, q[1].r], [32767, -32768, 0]);
});
test('clipZone: under sikkerhedslinjen og uden for zonen blankes', () => {
  const c = L.clipZone([{ x: 0, y: -0.9, r: 9, g: 9, b: 9, blank: false }, { x: 0.95, y: 0.2, r: 9, g: 9, b: 9, blank: false }, { x: 0, y: 0.5, r: 9, g: 9, b: 9, blank: false }], { l: -0.9, r: 0.9, b: -1, t: 1 }, -0.5);
  assert.ok(c[0].blank && c[0].y === -0.5); assert.ok(c[1].blank && c[1].x === 0.9); assert.ok(!c[2].blank && c[2].r === 9);
});
test('bezier og transform', () => { const b = L.bezier([0, 0], [0, 1], [1, 1], [1, 0]); assert.deepStrictEqual(b[0], [0, 0]); assert.deepStrictEqual(b[b.length - 1], [1, 0]); const t = L.transformPaths([{ pts: [[1, 0]] }], { rot: 90, scale: 0.5 }); assert.ok(Math.abs(t[0].pts[0][1] - 0.5) < 1e-9); });

console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ laser_frame: alle ${n} tests bestået`);
process.exit(failed ? 1 : 0);
