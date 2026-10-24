// Helios Laser DAC (USB) – via det OFFICIELLE SDK (github.com/Grix/helios_dac), ikke egen USB-kode.
// SDK'et er et C-bibliotek (HeliosDacAPI.dll / libHeliosDacAPI.dylib / .so). Det kaldes via FFI-pakken "koffi" hvis den er installeret:
//   npm install koffi   og læg biblioteket i  ~/.smartlink/helios/  (eller sæt sti i ~/.smartlink/helios.json: {"lib": "/sti/til/lib"})
// Uden begge dele melder backend'en tydeligt hvad der mangler. UTESTET mod rigtig hardware.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function libPath() {
  const dir = path.join(os.homedir(), '.smartlink', 'helios');
  try { const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.smartlink', 'helios.json'), 'utf8')); if (c.lib) return c.lib; } catch (_) {}
  const name = process.platform === 'win32' ? 'HeliosDacAPI.dll' : process.platform === 'darwin' ? 'libHeliosDacAPI.dylib' : 'libHeliosDacAPI.so';
  return path.join(dir, name);
}
function load() {
  let koffi; try { koffi = require('koffi'); } catch (_) { throw new Error('Helios kræver FFI-pakken "koffi" (npm install koffi) og det officielle Helios-SDK'); }
  const p = libPath(); if (!fs.existsSync(p)) throw new Error('Helios-SDK ikke fundet: ' + p + ' – hent det fra github.com/Grix/helios_dac');
  const lib = koffi.load(p), Pt = koffi.struct('HeliosPoint', { x: 'uint16', y: 'uint16', r: 'uint8', g: 'uint8', b: 'uint8', i: 'uint8' });
  return { koffi, Pt, OpenDevices: lib.func('int OpenDevices()'), CloseDevices: lib.func('int CloseDevices()'), GetStatus: lib.func('int GetStatus(uint32 dacNum)'), WriteFrame: lib.func('int WriteFrame(uint32 dacNum, int pps, uint8 flags, HeliosPoint *points, int numOfPoints)'), Stop: lib.func('int Stop(uint32 dacNum)') };
}

function create(onStatus) {
  let api = null, dac = 0, frame = [], pps = 20000, shutter = true, timer = null, lastFrameAt = 0;
  const say = (s) => onStatus && onStatus({ backend: 'helios', ...s });
  const to12 = (v) => Math.max(0, Math.min(4095, Math.round((v + 32768) / 16))); // int16 → 12 bit
  async function discover() { try { api = api || load(); const n = api.OpenDevices(); return Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: String(i), name: 'Helios #' + (i + 1) })); } catch (e) { return [{ id: '', name: e.message, error: true }]; } }
  async function open({ id } = {}) {
    api = api || load(); if (api.OpenDevices() <= 0) throw new Error('Ingen Helios fundet på USB'); dac = +id || 0; lastFrameAt = Date.now();
    timer = setInterval(() => {
      if (Date.now() - lastFrameAt > 500) shutter = true;
      if (api.GetStatus(dac) !== 1) return; // 1 = klar til næste frame
      const src = shutter || !frame.length ? [{ x: 0, y: 0, r: 0, g: 0, b: 0, blank: true }] : frame;
      const pts = src.map((p) => ({ x: to12(p.x), y: to12(p.y), r: p.blank ? 0 : p.r, g: p.blank ? 0 : p.g, b: p.blank ? 0 : p.b, i: p.blank ? 0 : 255 }));
      if (api.WriteFrame(dac, pps, 0, pts, pts.length) < 0) { say({ state: 'lost' }); close(); }
    }, 2);
    say({ state: 'open' });
  }
  function writeFrame(points, rate) { frame = points; if (rate) pps = rate; lastFrameAt = Date.now(); }
  function setShutter(o) { shutter = !o; if (o) lastFrameAt = Date.now(); }
  function close() { clearInterval(timer); timer = null; try { api && api.Stop(dac); api && api.CloseDevices(); } catch (_) {} say({ state: 'closed' }); }
  return { id: 'helios', discover, open, writeFrame, setShutter, close };
}
module.exports = { create };
