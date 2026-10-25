// Kør: node test/ape.test.js
const assert = require('assert');
const A = require('../src/ape_core.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''}: ${a} ≠ ${b} (±${tol})`);

// ---------- kanal-generatorer ----------
test('7ch: R,G,B,WW, dimmer, strobe, musik', () => { const c = A.tubeChannels('7ch', [[10, 20, 30, 40]], { dimmer: 0.5, strobeDmx: 80, musicLights: true }); assert.deepStrictEqual([...c], [10, 20, 30, 40, 128, 80, 255]); });
test('4ch: farve ganges med dimmer', () => { assert.deepStrictEqual([...A.tubeChannels('4ch', [[200, 100, 50, 0]], { dimmer: 0.5 })], [100, 50, 25, 0]); });
test('pixel-modes: længde, pixel n = kanal 4n−3..4n, dimmer ganget ind, strobe-port', () => {
  for (const [m, px] of [['32ch', 8], ['64ch', 16], ['128ch', 32]]) {
    const pixels = Array.from({ length: px }, (_, i) => [i, 2 * i, 3 * i, 255]); const c = A.tubeChannels(m, pixels, { dimmer: 1 });
    assert.strictEqual(c.length, px * 4); const k = px - 1; assert.deepStrictEqual([...c.slice(4 * (k + 1) - 4, 4 * (k + 1))], [k, 2 * k, 3 * k, 255]);
  }
  assert.ok(A.tubeChannels('64ch', [[255, 255, 255, 255]], { dimmer: 1, strobeOn: false }).every((v) => v === 0));
  assert.strictEqual(A.tubeChannels('64ch', [[200, 0, 0, 0]], { dimmer: 0.5 })[0], 100);
});
// ---------- strobe-tabel ----------
test('strobe-tabel: rammer kendte punkter', () => { near(A.strobeSeconds(64), 2.0, 1e-9); near(A.strobeSeconds(80), 1.0, 1e-9); near(A.strobeSeconds(255), 0.031, 1e-9); near(A.strobeSeconds(10), 513, 1e-6); assert.strictEqual(A.strobeSeconds(0), Infinity); });
test('strobe-tabel: monoton faldende', () => { let prev = Infinity; for (let d = 1; d <= 255; d++) { const s = A.strobeSeconds(d); assert.ok(s < prev, 'dmx ' + d); prev = s; } });
test('strobe-tabel: round-trip DMX → sek → DMX', () => { for (let d = 1; d <= 255; d++) assert.strictEqual(A.strobeDmx(A.strobeSeconds(d)), d); assert.strictEqual(A.strobeDmx(Infinity), 0); });
// ---------- adresseplan ----------
test('64ch × 6: 1, 65, 129 / 193, 257, 321 – ingen overlap, ≤512', () => { const p = A.plan('64ch'); assert.ok(p.ok); assert.deepStrictEqual(p.tubes.map((t) => t.address), [1, 65, 129, 193, 257, 321]); assert.strictEqual(p.total, 384); assert.strictEqual(A.overlaps(p.tubes), null); assert.ok(p.tubes.every((t) => t.end <= 512)); });
test('7ch × 6: 1, 8, 15 / 22, 29, 36', () => { assert.deepStrictEqual(A.plan('7ch').tubes.map((t) => t.address), [1, 8, 15, 22, 29, 36]); });
test('32ch × 6 = 192 ok', () => { assert.strictEqual(A.plan('32ch').total, 192); });
test('128ch × 6 = 768 afvises', () => { const p = A.plan('128ch'); assert.strictEqual(p.ok, false); assert.strictEqual(p.error, 'over512'); assert.strictEqual(p.need, 768); });
test('overlap opdages', () => { assert.deepStrictEqual(A.overlaps([{ id: 1, address: 1, end: 64 }, { id: 2, address: 60, end: 123 }]), [1, 2]); });
test('eksport: CONNECT-trin SHOW sætter gruppe 1 og adresser, LOUNGE gruppe = etage', () => {
  const p = A.plan('64ch'), s = A.exportConnectSteps(p, 'show'), l = A.exportConnectSteps(p, 'lounge');
  assert.ok(/Rør 4.*Gruppe 1, DMX-mode 64ch, DMX-adresse 193/.test(s)); assert.ok(/Rør 4.*Gruppe 2 → Apply/.test(l)); assert.ok(/gruppe B/i.test(A.exportWolfmixPatch(p).split('\n').find((x) => x.startsWith('Rør 4'))));
  assert.ok(/Celle 16: kanal 61 R, 62 G, 63 B, 64 WW/.test(A.exportFixtureBuilder('64ch')));
});
// ---------- program ----------
test('program: fade er lineær interpolation, hold holder', () => {
  const prog = { steps: [{ color: [255, 0, 0, 0], fade: 0, hold: 1 }, { color: [0, 0, 255, 0], fade: 2, hold: 1 }] };
  assert.deepStrictEqual(A.programColor(prog, 0.5), [255, 0, 0, 0]); assert.deepStrictEqual(A.programColor(prog, 2), [127.5, 0, 127.5, 0]); assert.deepStrictEqual(A.programColor(prog, 3.5), [0, 0, 255, 0]);
  assert.deepStrictEqual(A.programColor(prog, 1, 1), A.programColor(prog, 4, 0.5), 'speed 1 = 4× hurtigere');
});
test('program: blackout-trin og maks 4 trin', () => { const p = { steps: [{ color: null, fade: 0, hold: 1 }, { color: [9, 9, 9, 9], fade: 0, hold: 1 }, {}, {}, { color: [1, 1, 1, 1], hold: 99 }] }; assert.deepStrictEqual(A.programColor(p, 0.5), [0, 0, 0, 0]); });
// ---------- scener ----------
test('scene-recall rører kun definerede etager', () => {
  const st = A.newState(); st.floors[2].color = [1, 2, 3, 4]; st.floors[2].brightness = 0.3;
  A.recallScene(st, { floors: { 1: { look: 'color', color: [9, 9, 9, 9], brightness: 0.7 } } });
  assert.deepStrictEqual(st.floors[1].color, [9, 9, 9, 9]); assert.strictEqual(st.floors[1].brightness, 0.7); assert.deepStrictEqual(st.floors[2].color, [1, 2, 3, 4]); assert.strictEqual(st.floors[2].brightness, 0.3);
});
test('scene: "uændret" bevarer farve, blackout virker', () => { const st = A.newState(); st.floors[1].color = [5, 5, 5, 5]; A.recallScene(st, { floors: { 1: { look: 'unchanged', speed: 0.9 } } }); assert.deepStrictEqual(st.floors[1].color, [5, 5, 5, 5]); assert.strictEqual(st.floors[1].speed, 0.9); A.recallScene(st, { floors: { 1: { look: 'blackout' } } }); assert.ok(st.floors[1].blackout); });
// ---------- pixel_fx ----------
test('pixel-effekter giver 0–1 og bevæger sig', () => { for (const fx of A.FX) for (let i = 0; i < 50; i++) { const v = A.fxIntensity(fx, i / 49, i * 0.1, 0.5, i); assert.ok(v >= 0 && v <= 1, fx); } assert.notStrictEqual(A.fxIntensity('sweep', 0.5, 0, 0.5), A.fxIntensity('sweep', 0.5, 1, 0.5)); });
// ---------- render / golden frame ----------
test('golden frame: 64ch, etage 1 rød fuld, etage 2 blå 50 %', () => {
  const st = A.newState(), p = A.plan('64ch'); st.floors[1].color = [255, 0, 0, 0]; st.floors[2].color = [0, 0, 255, 0]; st.floors[2].brightness = 0.5;
  const u = A.render(st, p, { t: 0 }); assert.strictEqual(u.length, 512);
  for (let ch = 0; ch < 192; ch++) assert.strictEqual(u[ch], ch % 4 === 0 ? 255 : 0, 'etage 1 kanal ' + (ch + 1));
  for (let ch = 192; ch < 384; ch++) assert.strictEqual(u[ch], ch % 4 === 2 ? 128 : 0, 'etage 2 kanal ' + (ch + 1));
  for (let ch = 384; ch < 512; ch++) assert.strictEqual(u[ch], 0);
});
test('golden frame: 7ch med strobe + musik', () => { const st = A.newState(), p = A.plan('7ch'); st.floors[1].color = [1, 2, 3, 4]; st.floors[1].strobe = true; st.floors[1].speed = 0; st.floors[1].music = { source: 'lights', rest: 0 }; st.floors[2].blackout = true; const u = A.render(st, p, { t: 0 }); assert.deepStrictEqual([...u.slice(0, 7)], [1, 2, 3, 4, 255, 64, 255]); assert.strictEqual(u[21 + 4], 0, 'etage 2 dimmer 0'); });
test('render → decode giver farverne tilbage', () => { const st = A.newState(), p = A.plan('64ch'); st.floors[1].color = [10, 20, 30, 40]; const d = A.decode(A.render(st, p, { t: 0 }), p); assert.strictEqual(d.length, 6); assert.deepStrictEqual(d[0].px[0], [10, 20, 30, 40]); assert.strictEqual(d[0].px.length, 16); });
test('flip vender pixelrækkefølgen', () => { const st = A.newState(), tubes = A.DEFAULT_TUBES(); tubes[0].flip = true; const p = A.plan('64ch', tubes); st.floors[1].fx = 'sweep'; const u = A.render(st, p, { t: 0.01 }), d = A.decode(u, p)[0].px; assert.ok(d[15][0] >= d[0][0], 'første fysiske pixel er nu sidst'); });
// ---------- merge ----------
test('merge: ejerskab pr. etage + HTP/LTP', () => {
  const p = A.plan('7ch'), w = new Uint8Array(512), a = new Uint8Array(512); w[0] = 100; a[0] = 50; w[21] = 10; a[21] = 200; w[5] = 30; a[5] = 0; w[400] = 7;
  assert.strictEqual(A.merge(w, a, p, { 1: 'wolfmix', 2: 'app' })[0], 100); assert.strictEqual(A.merge(w, a, p, { 1: 'wolfmix', 2: 'app' })[21], 200);
  const ltp = {}; let m = A.merge(w, a, p, { 1: 'merge', 2: 'merge' }, ltp); assert.strictEqual(m[0], 100, 'HTP'); assert.strictEqual(m[5], 30, 'LTP start');
  a[5] = 90; m = A.merge(w, a, p, { 1: 'merge' }, ltp); assert.strictEqual(m[5], 90, 'app ændrede sidst'); w[5] = 40; m = A.merge(w, a, p, { 1: 'merge' }, ltp); assert.strictEqual(m[5], 40, 'Wolfmix ændrede sidst');
  assert.strictEqual(m[400], 7, 'kanaler uden for rørene = Wolfmix');
});
// ---------- MIDI-bro ----------
test('bindingstabel: round-trip, ingen dubletter, bytes', () => {
  const acts = A.bridgeActions(), b = A.defaultBindings(acts); assert.strictEqual(A.duplicateBindings(b).length, 0);
  assert.deepStrictEqual(A.importBindings(A.exportBindings(b)), b);
  assert.deepStrictEqual(A.bindingBytes({ type: 'cc', ch: 16, num: 5 }, 64), [0xbf, 5, 64]); assert.deepStrictEqual(A.bindingBytes({ type: 'pc', ch: 1, num: 3 }), [0xc0, 3]);
  assert.throws(() => A.importBindings('{"x":1}'));
});
test('LOUNGE: vælg gruppe før handling', () => { assert.deepStrictEqual(A.loungeMessages([2], 'preset:3').map((m) => m.id), ['group.select:2', 'preset:3']); assert.deepStrictEqual(A.loungeMessages([1, 2], 'brightness', 90).map((m) => [m.id, m.value]), [['group.all', undefined], ['brightness', 90]]); });
// ---------- roller ----------
test('klient-rolle kan ikke sende uden for sin etage', () => {
  assert.strictEqual(A.authorize('f1', { floors: [2] }).ok, false); assert.strictEqual(A.authorize('f1', { floors: [1, 2] }).ok, false); assert.deepStrictEqual(A.authorize('f1', {}).floors, [1]);
  assert.deepStrictEqual(A.authorize('all', { floors: [2] }).floors, [2]); assert.strictEqual(A.authorize('f2', { floors: [2] }, { 2: true }).ok, false, 'låst til Wolfmix'); assert.strictEqual(A.authorize('admin', { floors: [2] }, { 2: true }).ok, true); assert.strictEqual(A.authorize('hacker', {}).ok, false);
});
test('applyCommand: sidste kommando vinder pr. etage', () => { const st = A.newState(); A.applyCommand(st, { op: 'color', color: [1, 2, 3, 4] }, [1], 'f1', 5); A.applyCommand(st, { op: 'color', color: [9, 9, 9, 9] }, [1], 'wolfmix', 6); assert.deepStrictEqual(st.floors[1].color, [9, 9, 9, 9]); assert.strictEqual(st.floors[1].lastBy, 'wolfmix'); assert.deepStrictEqual(st.floors[2].color, A.newFloor().color); });
test('vagthund: ingen DMX i LOUNGE', () => { assert.strictEqual(A.canSendDmx('lounge'), false); assert.strictEqual(A.canSendDmx('show'), true); assert.ok(A.switchChecklist('show').length >= 4); });

console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ ape: alle ${n} tests bestået`);
process.exit(failed ? 1 : 0);
