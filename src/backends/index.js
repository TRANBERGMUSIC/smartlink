// Output-backends i main-processen. Alle har samme interface:
//   discover() → [{id, name, …}]   open(opts)   writeFrame(points[int16], pps)   setShutter(bool)   close()
// SD-eksport og DMX/Art-Net ligger i rendereren (de har ingen netværks-stream), men følger samme interface (se app.js: VEC_BACKENDS).
'use strict';
const ipc = require('electron').ipcMain;
const fs = require('fs');
const path = require('path');
const MODS = { etherdream: require('./etherdream'), helios: require('./helios'), idn: require('./idn'), shownet_sdk: require('./shownet_sdk') };

function install(getWin, patDir) {
  let cur = null;
  const status = (s) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('out-status', s); };
  const get = (id) => { if (!MODS[id]) throw new Error('ukendt backend ' + id); return MODS[id].create(status); };
  ipc.handle('out-discover', async (_e, id) => { try { return await get(id).discover(); } catch (e) { return [{ id: '', name: e.message, error: true }]; } });
  ipc.handle('out-open', async (_e, { id, opts }) => { try { if (cur) cur.close(); cur = get(id); await cur.open(opts || {}); return { ok: true }; } catch (e) { cur = null; return { ok: false, error: e.message }; } });
  ipc.on('out-frame', (_e, { points, pps }) => { if (cur) cur.writeFrame(points, pps); });
  ipc.on('out-shutter', (_e, open) => { if (cur) cur.setShutter(!!open); });
  ipc.handle('out-close', () => { if (cur) { cur.setShutter(false); cur.close(); cur = null; } return true; });
  // SD-pakke: NNN.ild + oversigt over kanal 2-værdier (Pro: kanal 2 = N → N.ild)
  ipc.handle('save-sd-package', async (_e, { title, files, table }) => {
    const { dialog } = require('electron'); const r = await dialog.showOpenDialog(getWin(), { title, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null; const dir = r.filePaths[0];
    for (const f of files) { const nm = String(f.num).padStart(3, '0') + '.ild', b = Buffer.from(f.bytes); fs.writeFileSync(path.join(dir, nm), b); if (patDir) { try { fs.mkdirSync(patDir(), { recursive: true }); fs.writeFileSync(path.join(patDir(), nm), b); } catch (_) {} } }
    fs.writeFileSync(path.join(dir, 'SD-oversigt.csv'), '﻿' + table);
    return { dir };
  });
  return { stopAll: () => { if (cur) { try { cur.setShutter(false); cur.close(); } catch (_) {} cur = null; } } };
}
module.exports = { install, MODS };
