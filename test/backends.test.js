// Kør: node test/backends.test.js  – Ether Dream mod en falsk DAC på 127.0.0.1:7765 + stubs.
const assert = require('assert');
const net = require('net');
const ED = require('../src/backends/etherdream.js');
const SN = require('../src/backends/shownet_sdk.js');
const IDN = require('../src/backends/idn.js');
let n = 0, failed = 0;
async function test(name, fn) { try { await fn(); n++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (_) {} await wait(20); } return false; }; // robust mod en travl maskine

function fakeDac() {
  const log = { cmds: [], points: [], rate: 0, stopped: false }; let fullness = 0, playing = false;
  const status = () => { const b = Buffer.alloc(20); b[2] = playing ? 2 : 1; b.writeUInt16LE(fullness, 10); b.writeUInt32LE(log.rate, 12); return b; };
  const ack = (c) => Buffer.concat([Buffer.from([0x61, c.charCodeAt(0)]), status()]);
  const srv = net.createServer((s) => {
    srv.socks.add(s); s.write(ack('?')); let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!buf.length) break; const c = String.fromCharCode(buf[0]);
        if (c === 'd') { if (buf.length < 3) break; const k = buf.readUInt16LE(1); if (buf.length < 3 + k * 18) break; for (let i = 0; i < k; i++) { const o = 3 + i * 18; log.points.push({ x: buf.readInt16LE(o + 2), y: buf.readInt16LE(o + 4), r: buf.readUInt16LE(o + 6) }); } fullness = Math.min(1799, fullness + k); buf = buf.slice(3 + k * 18); }
        else if (c === 'b') { if (buf.length < 7) break; log.rate = buf.readUInt32LE(3); playing = true; buf = buf.slice(7); }
        else if (c === 'q') { if (buf.length < 5) break; log.rate = buf.readUInt32LE(1); buf = buf.slice(5); }
        else { buf = buf.slice(1); if (c === 's') log.stopped = true; }
        log.cmds.push(c); if (playing) fullness = Math.max(0, fullness - 300); s.write(ack(c));
      }
    });
    s.on('error', () => {});
  });
  srv.socks = new Set();
  return new Promise((res) => srv.listen(7765, '127.0.0.1', () => res({ srv, log })));
}

(async () => {
  await test('Ether Dream: punkt-format 18 bytes, 8→16 bit farve, blank = 0', () => { const b = ED.packPoints([{ x: -5, y: 7, r: 255, g: 1, b: 0, blank: false }, { x: 0, y: 0, r: 255, g: 255, b: 255, blank: true }]); assert.strictEqual(b.length, 36); assert.strictEqual(b.readInt16LE(2), -5); assert.strictEqual(b.readUInt16LE(6), 65535); assert.strictEqual(b.readUInt16LE(8), 257); assert.strictEqual(b.readUInt16LE(18 + 6), 0); });
  await test('Ether Dream: prepare → data → begin, rate, stop ved close', async () => {
    const { srv, log } = await fakeDac(); const states = []; const dac = ED.create((s) => states.push(s.state));
    await dac.open({ ip: '127.0.0.1', capacity: 1800 }); const frame = [{ x: 1000, y: -1000, r: 255, g: 0, b: 0, blank: false }, { x: 2000, y: 0, r: 255, g: 0, b: 0, blank: false }];
    dac.setShutter(true); dac.writeFrame(frame, 25000); await until(() => log.cmds.includes('b') && log.rate === 25000 && log.points.some((p) => p.x === 1000));
    assert.ok(log.cmds.includes('p'), 'prepare'); assert.ok(log.cmds.includes('b'), 'begin'); assert.strictEqual(log.rate, 25000);
    assert.ok(log.points.some((p) => p.x === 1000 && p.r > 0), 'frame-punkter sendt');
    dac.setShutter(false); await wait(60); log.points.length = 0; await until(() => log.points.length > 0); assert.ok(log.points.length && log.points.every((p) => p.r === 0), 'lukket shutter = blanke punkter');
    dac.close(); await until(() => log.stopped); assert.ok(log.stopped, 'stop sendt'); assert.ok(states.includes('open') && states.includes('closed')); srv.close();
  });
  await test('Ether Dream: watchdog blanker når appen holder op med at sende', async () => {
    const { srv, log } = await fakeDac(); const dac = ED.create(); await dac.open({ ip: '127.0.0.1' }); dac.setShutter(true); dac.writeFrame([{ x: 9, y: 9, r: 200, g: 0, b: 0, blank: false }], 20000);
    await wait(700); log.points.length = 0; await until(() => log.points.length > 0); assert.ok(log.points.length && log.points.every((p) => p.r === 0)); dac.close(); srv.close();
  });
  await test('Ether Dream: mistet forbindelse meldes', async () => {
    const { srv } = await fakeDac(); const states = []; const dac = ED.create((s) => states.push(s.state)); await dac.open({ ip: '127.0.0.1' });
    for (const c of srv.socks) c.destroy(); srv.close(); await until(() => states.includes('lost') && states.includes('closed'));
    assert.ok(states.includes('lost'), 'lost meldt'); assert.ok(states.includes('closed'), 'lukket af sig selv');
  });
  await test('ShowNET-SDK-stub forklarer hvad der mangler og sender intet', async () => { const b = SN.create(); const l = await b.discover(); assert.ok(l[0].error && /laser-interface\.com|ShowNET-SDK/.test(l[0].name)); await assert.rejects(b.open()); assert.ok(!SN.CFG.includes(process.cwd()), 'nøgler ligger uden for repoet'); });
  await test('IDN-stub', async () => { await assert.rejects(IDN.create().open()); });
  console.log(failed ? `${failed} af ${n + failed} tests fejlede` : `✓ backends: alle ${n} tests bestået`);
  process.exit(failed ? 1 : 0);
})();
