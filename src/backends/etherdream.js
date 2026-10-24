// Ether Dream – åben protokol (ether-dream.com/protocol.html). Kører i main-processen.
// Discovery: DAC'en broadcaster 36 bytes på UDP 7654 hvert sekund. Styring: TCP 7765.
// Kommandoer: p (prepare), b (begin: low_water u16, rate u32), d (data: n u16 + n × 18 bytes), q (rate), s (stop), c (clear e-stop), ? (ping).
// Svar: 22 bytes = response u8, command u8, dac_status (20 bytes). Alt little-endian. UTESTET mod rigtig hardware.
'use strict';
const dgram = require('dgram');
const net = require('net');

function parseStatus(b, o = 0) {
  return { protocol: b[o], lightEngine: b[o + 1], playback: b[o + 2], source: b[o + 3], lightFlags: b.readUInt16LE(o + 4), playbackFlags: b.readUInt16LE(o + 6), sourceFlags: b.readUInt16LE(o + 8), fullness: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), count: b.readUInt32LE(o + 16) };
}
function packPoints(points) { // int16-punkter → 18 bytes hver; farver 8 → 16 bit
  const b = Buffer.alloc(points.length * 18);
  points.forEach((p, i) => { const o = i * 18, c = (v) => (v & 255) * 257; b.writeUInt16LE(0, o); b.writeInt16LE(p.x, o + 2); b.writeInt16LE(p.y, o + 4); b.writeUInt16LE(p.blank ? 0 : c(p.r), o + 6); b.writeUInt16LE(p.blank ? 0 : c(p.g), o + 8); b.writeUInt16LE(p.blank ? 0 : c(p.b), o + 10); b.writeUInt16LE(p.blank ? 0 : 65535, o + 12); b.writeUInt32LE(0, o + 14); });
  return b;
}

function create(onStatus) {
  let sock = null, frame = [], pps = 20000, shutter = true, cap = 1799, status = null, timer = null, started = false, pending = [], buf = Buffer.alloc(0), idx = 0, lastFrameAt = 0;
  const say = (s) => onStatus && onStatus({ backend: 'etherdream', ...s });

  function discover(ms = 1500) {
    return new Promise((res) => {
      const found = new Map(), u = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      u.on('message', (m, r) => { if (m.length >= 36) found.set(r.address, { id: r.address, name: 'Ether Dream ' + [...m.slice(0, 6)].map((x) => x.toString(16).padStart(2, '0')).join(':'), ip: r.address, capacity: m.readUInt16LE(10), maxRate: m.readUInt32LE(12) }); });
      u.on('error', () => { try { u.close(); } catch (_) {} res([]); });
      u.bind(7654, () => setTimeout(() => { try { u.close(); } catch (_) {} res([...found.values()]); }, ms));
    });
  }
  const send = (b) => new Promise((res, rej) => { if (!sock) return rej(new Error('ikke forbundet')); pending.push({ res, rej }); sock.write(b); });
  function onData(d) {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 22) {
      const r = String.fromCharCode(buf[0]), cmd = String.fromCharCode(buf[1]); status = parseStatus(buf, 2); buf = buf.slice(22);
      const w = pending.shift(); if (w) (r === 'a' ? w.res : w.rej)(Object.assign(new Error('Ether Dream svarede ' + r + ' på ' + cmd), { status }));
      if (status.lightEngine === 3) say({ state: 'estop' });
    }
  }
  async function open({ ip, capacity } = {}) {
    if (!ip) throw new Error('Ingen IP – kør "Find" først');
    cap = Math.max(100, (capacity || 1800) - 1);
    await new Promise((res, rej) => { sock = net.connect(7765, ip, res); sock.setNoDelay(true); sock.once('error', rej); pending.push({ res: () => {}, rej: () => {} }); }); // DAC'en sender en hilsen ved connect
    sock.on('data', onData);
    sock.on('error', (e) => { say({ state: 'lost', error: e.message }); close(); });
    sock.on('close', () => { if (sock) { say({ state: 'lost' }); close(); } });
    try { await send(Buffer.from('c')); } catch (_) {}
    await send(Buffer.from('p')); started = false; idx = 0; lastFrameAt = Date.now();
    timer = setInterval(pump, 10); say({ state: 'open', ip });
  }
  async function pump() {
    if (!sock || !status || pump.busy) return; pump.busy = true;
    try {
      if (Date.now() - lastFrameAt > 500) shutter = true; // watchdog: ingen frames fra appen → blank
      const src = shutter || !frame.length ? [{ x: 0, y: 0, r: 0, g: 0, b: 0, blank: true }] : frame;
      const free = cap - status.fullness, n = Math.min(free, Math.round(pps / 50));
      if (n >= 50) { const pts = []; for (let i = 0; i < n; i++) { pts.push(src[idx % src.length]); idx = (idx + 1) % src.length; } const h = Buffer.alloc(3); h[0] = 0x64; h.writeUInt16LE(n, 1); await send(Buffer.concat([h, packPoints(pts)])); }
      if (!started && status.fullness > 200) { const b = Buffer.alloc(7); b[0] = 0x62; b.writeUInt16LE(0, 1); b.writeUInt32LE(pps, 3); await send(b); started = true; }
      else if (n < 50) await send(Buffer.from('?'));
    } catch (e) { if (e.status && e.status.playback === 0) { started = false; try { await send(Buffer.from('p')); } catch (_) {} } }
    pump.busy = false;
  }
  function writeFrame(points, rate) { frame = points; lastFrameAt = Date.now(); if (rate && rate !== pps) { pps = rate; if (sock && started) { const q = Buffer.alloc(5); q[0] = 0x71; q.writeUInt32LE(pps, 1); send(q).catch(() => {}); } } }
  function setShutter(open_) { shutter = !open_; if (open_) lastFrameAt = Date.now(); }
  function close() { clearInterval(timer); timer = null; const s = sock; sock = null; pending.splice(0).forEach((w) => w.rej(new Error('lukket'))); if (s) { try { s.write(Buffer.from('s')); } catch (_) {} try { s.end(); } catch (_) {} } say({ state: 'closed' }); }
  return { id: 'etherdream', discover, open, writeFrame, setShutter, close };
}
module.exports = { create, packPoints, parseStatus };
