// Kør: node test/wolfmidi.test.js
const assert = require('assert');
const W = require('../src/wolfmidi.js');
let n = 0, failed = 0;
function test(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }

test('Note On med vel > 0 = press', () => { assert.deepStrictEqual(W.parse([0x90, 36, 127]), { id: 'note:1:36', type: 'note', channel: 1, number: 36, event: 'press', value: 127 }); });
test('Note On vel 0 og Note Off = release', () => { assert.strictEqual(W.parse([0x90, 36, 0]).event, 'release'); assert.strictEqual(W.parse([0x8f, 36, 64]).event, 'release'); assert.strictEqual(W.parse([0x8f, 36, 64]).id, 'note:16:36'); });
test('CC = change, PC = press', () => { const c = W.parse([0xb2, 3, 100]); assert.strictEqual(c.id, 'cc:3:3'); assert.strictEqual(c.event, 'change'); assert.strictEqual(c.value, 100); assert.strictEqual(W.parse([0xc0, 5]).id, 'pc:1:5'); });
test('Clock og Active Sensing ignoreres', () => { assert.strictEqual(W.parse([0xf8]), null); assert.strictEqual(W.parse([0xfe]), null); });
test('toBytes ↔ parse', () => { for (const [t, v] of [['note', 90], ['note', 0], ['cc', 33], ['pc', 0]]) { const p = W.parse(W.toBytes(t, 5, 12, v)); assert.strictEqual(p.id, `${t}:5:12`); } });
test('CC som knap: press ved op over tærskel, release ved ned under, ingen gentagelse under fader-bevægelse', () => {
  const s = {}; assert.strictEqual(W.ccEdges(s, 'cc:1:3', 10, 64, 0), null); assert.strictEqual(W.ccEdges(s, 'cc:1:3', 70, 64, 10), 'press'); assert.strictEqual(W.ccEdges(s, 'cc:1:3', 127, 64, 30), null); assert.strictEqual(W.ccEdges(s, 'cc:1:3', 20, 64, 50), 'release');
});
test('CC-knap der kun sender 127 ved hvert tryk tæller hver gang', () => { const s = {}; assert.strictEqual(W.ccEdges(s, 'cc:1:9', 127, 64, 0), 'press'); assert.strictEqual(W.ccEdges(s, 'cc:1:9', 127, 64, 1000), 'press'); assert.strictEqual(W.ccEdges(s, 'cc:1:9', 127, 64, 2000), 'press'); });
test('CC-knap med værdi 0 kan læres (tærskel 0)', () => { const ev = W.parse([0xb0, 9, 0]); assert.strictEqual(W.learnSlot('trigger', ev), 'onPress'); assert.strictEqual(W.learnThreshold(ev), 0); const s = {}; assert.strictEqual(W.ccEdges(s, ev.id, 0, 0, 0), 'press'); });
test('Note On med hastighed 0 ved tryk (MIDI out value 0) tæller som tryk', () => {
  const ns = {}, ev = W.normalize(W.parse([0x90, 36, 0]), ns); assert.strictEqual(ev.event, 'press');
  const a = W.normalize(W.parse([0x90, 36, 100]), ns), b = W.normalize(W.parse([0x80, 36, 0]), ns); assert.strictEqual(a.event, 'press'); assert.strictEqual(b.event, 'release');
});
test('dispatch: tryk/slip/ændring normaliseret til 0–1', () => {
  const st = W.newState(), cc = {}; W.bind(st, 'note:1:36', 'onPress', 'laser.on'); W.bind(st, 'note:1:36', 'onRelease', 'laser.off'); W.bind(st, 'cc:1:3', 'onChange', 'master');
  assert.deepStrictEqual(W.dispatch(st, cc, W.parse([0x90, 36, 127])).map((a) => a.action), ['laser.on']);
  assert.deepStrictEqual(W.dispatch(st, cc, W.parse([0x80, 36, 0])).map((a) => a.action), ['laser.off']);
  const d = W.dispatch(st, cc, W.parse([0xb0, 3, 127])); assert.strictEqual(d[0].action, 'master'); assert.strictEqual(d[0].value, 1);
});
test('record: tæller og bevarer navn', () => { const st = W.newState(); assert.ok(W.record(st, W.parse([0x90, 36, 100]))); st.signals['note:1:36'].name = 'Laser op'; assert.ok(!W.record(st, W.parse([0x90, 36, 50]))); assert.strictEqual(st.signals['note:1:36'].count, 2); assert.strictEqual(st.signals['note:1:36'].name, 'Laser op'); assert.strictEqual(st.signals['note:1:36'].lastValue, 50); });
test('Lær: trigger kræver tryk, continuous tager CC', () => { assert.strictEqual(W.learnSlot('trigger', W.parse([0x90, 1, 9])), 'onPress'); assert.strictEqual(W.learnSlot('trigger', W.parse([0x80, 1, 0])), null); assert.strictEqual(W.learnSlot('trigger', W.parse([0xb0, 1, 5])), 'onPress'); assert.strictEqual(W.learnSlot('continuous', W.parse([0xb0, 1, 3])), 'onChange'); assert.strictEqual(W.learnSlot('continuous', W.parse([0xc0, 1])), null); });
test('import fra Wolfmix Monitor', () => {
  const st = W.newState(); const r = W.importMonitor(st, { 'note:1:36': { label: 'Laser op', extra: 1 }, 'bad id': { label: 'x' } }, { 'note:1:36': { type: 'note', channel: 1, number: 36, last_value: 127, count: 14, last_seen: '2026-10-24T02:25:00' }, 'cc:2:7': { type: 'cc', channel: 2, number: 7 } });
  assert.deepStrictEqual(r, { names: 1, signals: 2 }); assert.strictEqual(st.signals['note:1:36'].name, 'Laser op'); assert.strictEqual(st.signals['note:1:36'].count, 14); assert.strictEqual(st.signals['cc:2:7'].type, 'cc');
});
test('sanitize tåler skrald', () => { assert.deepStrictEqual(W.sanitize(null), W.newState()); assert.strictEqual(W.sanitize({ active: false }).active, false); });

console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ wolfmidi: alle ${n} tests bestået`);
process.exit(failed ? 1 : 0);
