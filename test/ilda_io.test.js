// Kør: node test/ilda_io.test.js
// Læg evt. en fil gemt fra Showeditor i test/fixtures/*.ild – så testes det at den kan læses.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../src/ilda_io.js');
const L = require('../src/laser_frame.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
const pts = (k) => Array.from({ length: k }, (_, i) => ({ x: (i * 997) % 65535 - 32768, y: 32767 - ((i * 431) % 65535), z: i - 50, r: i % 256, g: (i * 3) % 256, b: (i * 7) % 256, blank: i % 5 === 0 }));

test('header: ILDA, nuller, formatkode, antal, frame-nr, total', () => {
  const b = I.write([{ name: 'TEST', points: pts(10) }, { points: pts(3) }], { format: 5 }), dv = new DataView(b.buffer);
  assert.strictEqual(String.fromCharCode(...b.slice(0, 4)), 'ILDA'); assert.deepStrictEqual([b[4], b[5], b[6]], [0, 0, 0]); assert.strictEqual(b[7], 5);
  assert.strictEqual(String.fromCharCode(...b.slice(8, 12)), 'TEST'); assert.strictEqual(dv.getUint16(24), 10); assert.strictEqual(dv.getUint16(26), 0); assert.strictEqual(dv.getUint16(28), 2); assert.strictEqual(b[31], 0);
  assert.strictEqual(b.length, 32 + 80 + 32 + 24 + 32, 'format 5 = 8 bytes pr. punkt + afsluttende header');
  const end = b.length - 32; assert.strictEqual(dv.getUint16(end + 24), 0, 'slut-header har 0 records');
});
test('format 5: big-endian, status-bits og BGR', () => {
  const b = I.write([{ points: [{ x: 258, y: -2, r: 1, g: 2, b: 3, blank: true }, { x: 0, y: 0, r: 9, g: 8, b: 7 }] }]);
  assert.deepStrictEqual([...b.slice(32, 40)], [1, 2, 0xff, 0xfe, 0x40, 3, 2, 1]); assert.strictEqual(b[40 + 4], 0x80, 'sidste punkt har 0x80');
});
for (const fmt of [4, 5]) test(`roundtrip format ${fmt}`, () => {
  const fr = [{ points: pts(500) }, { points: pts(37) }], back = I.read(I.write(fr, { format: fmt }));
  assert.strictEqual(back.length, 2); back.forEach((f, i) => { assert.strictEqual(f.format, fmt); f.points.forEach((p, j) => { const o = fr[i].points[j]; assert.deepStrictEqual([p.x, p.y, p.r, p.g, p.b, p.blank], [o.x, o.y, o.r, o.g, o.b, o.blank]); if (fmt === 4) assert.strictEqual(p.z, o.z); }); });
});
test('reader: indekserede formater 0 og 1 bruger paletten', () => {
  const h = (code, cnt) => { const b = new Uint8Array(32); b.set([73, 76, 68, 65]); b[7] = code; new DataView(b.buffer).setUint16(24, cnt); return b; };
  const f1 = new Uint8Array([...h(1, 1), 0, 10, 0, 20, 0x80, 24, ...h(1, 0)]), r1 = I.read(f1)[0].points[0]; assert.deepStrictEqual([r1.x, r1.y, r1.r, r1.g, r1.b], [10, 20, 0, 255, 0]);
  const f0 = new Uint8Array([...h(2, 1), 1, 2, 3, ...h(0, 1), 0, 1, 0, 2, 0, 3, 0x40, 0, ...h(0, 0)]), r0 = I.read(f0)[0].points[0]; assert.deepStrictEqual([r0.z, r0.r, r0.g, r0.b, r0.blank], [3, 1, 2, 3, true]);
});
test('reader afviser ødelagte filer', () => { assert.throws(() => I.read(new Uint8Array(40))); const b = I.write([{ points: pts(10) }]); assert.throws(() => I.read(b.slice(0, 60))); });
test('pipeline → ILDA → tilbage er identisk', () => { const q = L.quantize(L.optimize(L.textPaths('OK')).points), back = I.read(I.write([{ points: q }]))[0].points; assert.strictEqual(back.length, q.length); back.forEach((p, i) => assert.deepStrictEqual([p.x, p.y, p.blank], [q[i].x, q[i].y, q[i].blank])); });

const fx = path.join(__dirname, 'fixtures'); const files = fs.existsSync(fx) ? fs.readdirSync(fx).filter((f) => /\.ild$/i.test(f)) : [];
for (const f of files) test(`Showeditor-fil kan læses: ${f}`, () => { const fr = I.read(fs.readFileSync(path.join(fx, f))); assert.ok(fr.length > 0 && fr[0].points.length > 0); });
if (!files.length) console.log('  (ingen Showeditor-fil i test/fixtures – den test springes over)');

console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ ilda_io: alle ${n} tests bestået`);
process.exit(failed ? 1 : 0);
