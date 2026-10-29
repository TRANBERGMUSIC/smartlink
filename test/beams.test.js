// Kør: node test/beams.test.js
const assert = require('assert');
const B = require('../src/beams_core.js'), L = require('../src/laser_frame.js'), I = require('../src/ilda_io.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
const paths = (doc, fi) => doc.frames[fi].layers[0].items.map((it) => it.type === 'beam' ? { pts: [it.a, it.a], color: it.c, dwell: it.dwell } : { pts: [it.a, it.b], color: it.c });

test('alle modes giver noget synligt i hver frame', () => { for (const mode of B.MODES) for (let fi = 0; fi < 48; fi += 7) { const f = B.frame({ mode }, fi); assert.ok(f.beams.length + f.lines.length > 0, mode + ' frame ' + fi); } });
test('stråler holder sig i feltet', () => { for (const mode of B.MODES) for (let fi = 0; fi < 48; fi++) for (const b of B.frame({ mode, spread: 1.95, amp: 0.9, height: 0.9 }, fi).beams) assert.ok(Math.abs(b.x) <= 1 && Math.abs(b.y) <= 1, mode); });
test('loop: sidste frame går glat over i første (ingen spring)', () => { for (const mode of ['fan', 'sweep', 'cross', 'wave', 'cone']) { const a = B.frame({ mode }, 0).beams, b = B.frame({ mode }, 48).beams; assert.deepStrictEqual(a, b, mode); } });
test('standardhøjden er over midten (over publikum)', () => { for (const mode of ['fan', 'sweep', 'wave', 'chase']) for (const b of B.frame({ mode }, 3).beams) assert.ok(b.y > 0, mode); });
test('regnbue: forskellige farver pr. stråle; én farve: samme', () => { const r = B.frame({ mode: 'fan', colors: 'rainbow' }, 0).beams; assert.notDeepStrictEqual(r[0].c, r[3].c); const o = B.frame({ mode: 'fan', colors: 'one', c1: [1, 2, 3] }, 0).beams; assert.ok(o.every((b) => b.c.join() === '1,2,3')); });
test('dwell giver flere tændte punkter pr. stråle', () => {
  const p = [{ pts: [[0, 0.5], [0, 0.5]], color: [255, 0, 0] }, { pts: [[0.5, 0.5], [0.5, 0.5]], color: [0, 255, 0] }];
  const a = L.optimize(p).stats.visible, b = L.optimize(p.map((x) => ({ ...x, dwell: 10 }))).stats.visible; assert.strictEqual(b - a, 20);
});
test('effekt → optimeret → ILDA: sikker, inden for punktbudget ved 20 kpps og 25 fps', () => {
  const doc = B.toDoc({ mode: 'cross', beams: 10, frames: 24 }); assert.strictEqual(doc.frames.length, 24);
  const frames = doc.frames.map((_, fi) => { const f = L.optimize(paths(doc, fi), { pps: 20000, fps: 25 }); assert.ok(f.stats.safe, 'frame ' + fi); assert.ok(!f.stats.fpsReduced, 'fps sænket i frame ' + fi + ' (' + f.stats.count + ' punkter)'); return { points: L.quantize(f.points) }; });
  const back = I.read(I.write(frames, { format: 5 }).buffer); assert.strictEqual(back.length, 24);
});
test('egne farver: grøn og rød skiftes pr. stråle', () => { const b = B.frame({ mode: 'fan', colors: 'palette', palette: [[0, 255, 0], [255, 0, 0]] }, 0).beams; assert.deepStrictEqual(b[0].c, [0, 255, 0]); assert.deepStrictEqual(b[1].c, [255, 0, 0]); assert.deepStrictEqual(b[2].c, [0, 255, 0]); });
test('sikkerhed: intet under sikkerhedslinjen eller uden for zonen', () => {
  const zone = { l: -0.8, r: 0.7, b: -1, t: 0.9 }, minY = -0.2;
  for (const mode of B.MODES) for (let fi = 0; fi < 48; fi += 3) { const f = B.frame({ mode, zone, minY, height: -0.6, amp: 0.9, spread: 1.95 }, fi);
    for (const b of f.beams) assert.ok(b.y >= minY && b.x >= zone.l && b.x <= zone.r && b.y <= zone.t, mode); for (const l of f.lines) for (const p of [l.a, l.b]) assert.ok(p[1] >= minY && p[0] >= zone.l && p[0] <= zone.r, mode); }
});
test('kort navn er højst 8 tegn', () => { for (const mode of B.MODES) for (const colors of B.COLORS) assert.ok(B.shortName({ mode, colors }).length <= 8); });

console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ beams: alle ${n} tests bestået`);
process.exit(failed ? 1 : 0);
