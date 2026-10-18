// SmartLink – main process: vindue, Art-Net (UDP) og filer
const { app, BrowserWindow, ipcMain, dialog, systemPreferences } = require('electron');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

let win;
let sock;
let seq = 1;
let stats = { sent: 0, errors: 0, lastError: '' };

let nodes = {}; // Art-Net enheder der har svaret: ip -> { name, seen }

function createSocket(port = 6454) {
  sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', (e) => {
    stats.errors++; stats.lastError = e.message;
    if (port && /EADDRINUSE|EACCES/.test(e.code || e.message)) { try { sock.close(); } catch (_) {} createSocket(0); }
  });
  sock.on('message', (msg, rinfo) => {
    // ArtPollReply (opcode 0x2100) – en laser/node svarer
    if (msg.length > 40 && msg.toString('ascii', 0, 7) === 'Art-Net' && msg.readUInt16LE(8) === 0x2100) {
      const str = (a, b) => msg.toString('ascii', a, Math.min(b, msg.length)).replace(/\0.*$/s, '').trim();
      const name = str(26, 44) || 'Art-Net';
      const net = msg[18] & 0x7f, sub = msg[19] & 0x0f;
      const swOut = msg.length > 190 ? msg[190] & 0x0f : 0;
      const ip = msg.length > 13 ? `${msg[10]}.${msg[11]}.${msg[12]}.${msg[13]}` : rinfo.address;
      if (ip === '0.0.0.0' || !rinfo.address) return;
      nodes[rinfo.address] = { name, longName: str(44, 108), report: str(108, 172), universe: (net << 8) | (sub << 4) | swOut, seen: Date.now() };
    }
  });
  sock.bind(port || undefined, () => { try { sock.setBroadcast(true); } catch (e) { stats.lastError = e.message; } });
}

function artPoll() {
  const b = Buffer.alloc(14);
  b.write('Art-Net\0', 0, 'ascii'); b.writeUInt16LE(0x2000, 8); b.writeUInt16BE(14, 10); b[12] = 0; b[13] = 0;
  return b;
}

// ---- netværk: find/opsæt Mac'ens kablede forbindelse til 2.x.x.x ----
const os = require('os');
const { execFile } = require('child_process');
const SERVICE = 'SmartLink';
const OLD_SERVICES = ['SmartLink', 'LightLink', 'LaserLink', 'LaserStyring'];
const run = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 15000 }, (err, out, errOut) => res({ err, out: String(out || ''), errOut: String(errOut || '') })));

function laserAddrs() {
  const out = [];
  for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && (a.address.startsWith('2.') || a.address.startsWith('169.254.'))) out.push({ ifname, address: a.address });
  }
  return out;
}
async function listServices() {
  const r = await run('/usr/sbin/networksetup', ['-listnetworkserviceorder']);
  const svcs = [];
  const re = /\(\d+\)\s+(.+)\n\(Hardware Port: ([^,]+), Device: ([^)]*)\)/g;
  let m; while ((m = re.exec(r.out))) svcs.push({ name: m[1].replace(/^\*/, '').trim(), port: m[2].trim(), device: m[3].trim() });
  return svcs;
}
function isWired(s) {
  return /^en\d+$/.test(s.device) && !/wi-?fi|airport|bluetooth|bridge|iphone|ipad/i.test(s.port);
}

// hvilket net skal Mac'en være på for at nå laser-IP'en?
function netFor(ip) { return String(ip || '').startsWith('169.254.') ? '169.254.' : '2.'; }
ipcMain.handle('reconnect', async () => {
  // luk UDP-socket, glem fundne enheder, åbn igen og send poll med det samme
  try { if (sock) { sock.removeAllListeners(); sock.close(); } } catch (_) {}
  sock = null; nodes = {}; stats.errors = 0; stats.lastError = '';
  await new Promise((r) => setTimeout(r, 150));
  createSocket();
  await new Promise((r) => setTimeout(r, 150));
  try { for (const a of laserAddrs()) sock.send(artPoll(), 6454, a.address.startsWith('169.254.') ? '169.254.255.255' : '2.255.255.255', () => {}); if (pollTarget) sock.send(artPoll(), 6454, pollTarget, () => {}); } catch (_) {}
  return true;
});
ipcMain.handle('net-status', async (_e, targetIp) => {
  const want = netFor(targetIp);
  const addrs = laserAddrs().filter((a) => a.address.startsWith(want));
  let configured = addrs.length > 0;
  if (!configured && process.platform === 'darwin') configured = (await listServices()).some((s) => OLD_SERVICES.includes(s.name));
  const now = Date.now();
  const found = Object.entries(nodes).filter(([, n]) => now - n.seen < 8000).map(([ip, n]) => ({ ip, ...n }))
    .filter((n) => !laserAddrs().some((a) => a.address === n.ip)); // ikke os selv
  return { ready: addrs.length > 0, configured, addrs, found };
});

ipcMain.handle('net-setup', async (_e, targetIp) => {
  const [myIp, mask] = netFor(targetIp) === '169.254.' ? ['169.254.77.10', '255.255.0.0'] : ['2.0.0.10', '255.0.0.0'];
  if (process.platform !== 'darwin') return { ok: false, msg: 'Kun på Mac' };
  await run('/usr/sbin/networksetup', ['-detectnewhardware']);
  const svcs = await listServices();
  const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  let script;
  const existing = svcs.find((s) => OLD_SERVICES.includes(s.name));
  if (existing) {
    script = `/usr/sbin/networksetup -setmanual ${q(existing.name)} ${myIp} ${mask}`;
  } else {
    const wired = svcs.filter(isWired).sort((a, b) => (/lan|ethernet/i.test(b.port) ? 1 : 0) - (/lan|ethernet/i.test(a.port) ? 1 : 0));
    if (!wired.length) return { ok: false, msg: 'Jeg kan ikke finde en kablet netværksadapter. Sæt USB-C-til-Ethernet-adapteren i Mac’en og prøv igen.' };
    // Ekstra "service" på samme adapter: internettet via kablet (DHCP) virker stadig, og laseren får sin egen 2.x-adresse.
    script = `/usr/sbin/networksetup -duplicatenetworkservice ${q(wired[0].name)} ${q(SERVICE)} && /usr/sbin/networksetup -setmanual ${q(SERVICE)} ${myIp} ${mask}`;
  }
  const as = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges with prompt "SmartLink vil sætte din netværksadapter op til laseren (${myIp})."`;
  const r = await run('/usr/bin/osascript', ['-e', as]);
  if (r.err) return { ok: false, msg: /User canceled|-128/.test(r.errOut) ? 'Annulleret.' : 'Det lykkedes ikke: ' + (r.errOut || r.err.message).trim() };
  return { ok: true };
});

ipcMain.handle('net-remove', async () => {
  const names = (await listServices()).filter((s) => OLD_SERVICES.includes(s.name)).map((s) => s.name);
  if (!names.length) return { ok: true };
  const cmd = names.map((n) => `/usr/sbin/networksetup -removenetworkservice '${n}'`).join(' ; ');
  const r = await run('/usr/bin/osascript', ['-e', `do shell script "${cmd}" with administrator privileges`]);
  return { ok: !r.err };
});

let pollTarget = null;
ipcMain.on('poll-target', (_e, ip) => { pollTarget = ip; });
function startPolling() {
  setInterval(() => {
    if (!sock) return;
    const mine = laserAddrs();
    if (mine.some((a) => a.address.startsWith('2.'))) sock.send(artPoll(), 6454, '2.255.255.255', () => {});
    if (mine.some((a) => a.address.startsWith('169.254.'))) sock.send(artPoll(), 6454, '169.254.255.255', () => {});
    if (pollTarget && !/255$/.test(pollTarget)) sock.send(artPoll(), 6454, pollTarget, () => {});
  }, 3000);
}

// Art-Net ArtDmx-pakke (opcode 0x5000, protokol 14)
function artDmx(universe, data) {
  const len = 512;
  const buf = Buffer.alloc(18 + len);
  buf.write('Art-Net\0', 0, 'ascii');
  buf.writeUInt16LE(0x5000, 8);
  buf.writeUInt16BE(14, 10);
  buf.writeUInt8(seq, 12);
  seq = seq >= 255 ? 1 : seq + 1;
  buf.writeUInt8(0, 13);
  buf.writeUInt8(universe & 0xff, 14);        // SubUni
  buf.writeUInt8((universe >> 8) & 0x7f, 15); // Net
  buf.writeUInt16BE(len, 16);
  for (let i = 0; i < len; i++) buf[18 + i] = data[i] || 0;
  return buf;
}

ipcMain.on('dmx', (_e, { universe, ip, data }) => {
  if (!sock) return;
  const pkt = artDmx(universe | 0, data);
  // broadcast + direkte til hver laser der har svaret (nogle enheder ignorerer broadcast)
  const targets = new Set([ip || '2.255.255.255']);
  const now = Date.now(), own = laserAddrs().map((a) => a.address);
  for (const [nip, n] of Object.entries(nodes)) if (now - n.seen < 10000 && !own.includes(nip)) targets.add(nip);
  let first = true;
  for (const tgt of targets) {
    sock.send(pkt, 6454, tgt, (err) => {
      if (err) { stats.errors++; stats.lastError = err.message; } else if (first) { stats.sent++; }
      first = false;
    });
  }
});

ipcMain.handle('stats', () => stats);

ipcMain.handle('mic-access', async () => {
  if (process.platform !== 'darwin') return true;
  const s = systemPreferences.getMediaAccessStatus('microphone');
  if (s === 'granted') return true;
  return systemPreferences.askForMediaAccess('microphone');
});

ipcMain.handle('save-ild-batch', async (_e, { title, files }) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0]; fs.mkdirSync(patDir(), { recursive: true });
  for (const f of files) { const buf = Buffer.from(f.bytes); const nm = String(f.num).padStart(3, '0') + '.ild'; fs.writeFileSync(path.join(dir, nm), buf); fs.writeFileSync(path.join(patDir(), nm), buf); }
  return { dir, list: listPatterns() };
});
ipcMain.handle('save-ild', async (_e, { name, bytes, alsoLocal }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Gem laser-mønster (.ild)',
    defaultPath: (name || '140') + '.ild',
    filters: [{ name: 'ILDA', extensions: ['ild'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const buf = Buffer.from(bytes);
  fs.writeFileSync(r.filePath, buf);
  // læg også en kopi i appens egen mønster-mappe, hvis filen hedder NNN.ild – så vises den i appen med det samme
  const m = /^(\d{1,3})\.ild$/i.exec(path.basename(r.filePath));
  if (m && alsoLocal) { try { fs.mkdirSync(patDir(), { recursive: true }); fs.writeFileSync(path.join(patDir(), String(+m[1]).padStart(3, '0') + '.ild'), buf); } catch (_) {} }
  return { path: r.filePath, num: m ? +m[1] : null };
});

ipcMain.handle('save-show', async (_e, { name, json }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Gem show',
    defaultPath: (name || 'show') + '.lasershow',
    filters: [{ name: 'Lasershow', extensions: ['lasershow'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, json, 'utf8');
  return r.filePath;
});

ipcMain.handle('open-show', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Åbn show',
    filters: [{ name: 'Lasershow', extensions: ['lasershow', 'json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('pick-audio', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Vælg sang',
    filters: [{ name: 'Lyd', extensions: ['mp3', 'wav', 'm4a', 'aac', 'aiff', 'flac', 'ogg'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

// ---- mønstre (.ild-filer fra laserens SD-kort) ----
const patDir = () => path.join(app.getPath('userData'), 'patterns');
function listPatterns() {
  try { return fs.readdirSync(patDir()).map((f) => /^(\d{3})\.ild$/i.exec(f)).filter(Boolean).map((m) => +m[1]).sort((a, b) => a - b); }
  catch (_) { return []; }
}
function findIld(dir, depth = 0, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 2 && !e.name.startsWith('.')) findIld(p, depth + 1, out);
    else if (e.isFile() && /\.ild$/i.test(e.name) && !e.name.startsWith('._')) out.push(p);
  }
  return out;
}
ipcMain.handle('pat-import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Vælg mappen med laserens .ild-filer (fra SD-kortet)',
    properties: ['openDirectory', 'openFile', 'multiSelections'],
    filters: [{ name: 'ILDA', extensions: ['ild'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  let files = [];
  for (const p of r.filePaths) {
    try { fs.statSync(p).isDirectory() ? findIld(p, 0, files) : /\.ild$/i.test(p) && files.push(p); } catch (_) {}
  }
  if (!files.length) return { count: 0, numbered: true };
  fs.mkdirSync(patDir(), { recursive: true });
  const numbered = files.filter((f) => /^\d{1,3}\.ild$/i.test(path.basename(f)));
  let count = 0;
  if (numbered.length) {
    for (const f of numbered) {
      const n = parseInt(path.basename(f), 10);
      if (n >= 1 && n <= 255) { fs.copyFileSync(f, path.join(patDir(), String(n).padStart(3, '0') + '.ild')); count++; }
    }
  } else {
    files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
    files.slice(0, 255).forEach((f, i) => { fs.copyFileSync(f, path.join(patDir(), String(i + 1).padStart(3, '0') + '.ild')); count++; });
  }
  return { count, numbered: numbered.length > 0, list: listPatterns() };
});
ipcMain.handle('pat-list', () => listPatterns());
ipcMain.handle('pat-read', (_e, n) => {
  try { const b = fs.readFileSync(path.join(patDir(), String(n).padStart(3, '0') + '.ild')); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  catch (_) { return null; }
});
ipcMain.handle('pat-delete', (_e, n) => { try { fs.unlinkSync(path.join(patDir(), String(n).padStart(3, '0') + '.ild')); return true; } catch (_) { return false; } });
ipcMain.handle('pat-clear', () => { try { fs.rmSync(patDir(), { recursive: true, force: true }); } catch (_) {} return true; });

ipcMain.handle('read-audio', async (_e, p) => {
  try { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  catch (e) { return null; }
});

// ---------- MOBIL-FJERNBETJENING (HTTP + Server-Sent Events på det lokale Wi-Fi) ----------
const http = require('http');
const crypto = require('crypto');
const REMOTE_PORT = 8788;
const remote = { server: null, clients: new Set(), state: '{}', cfgPath: null, cfg: { enabled: false, token: '' } };
function remoteLoad() {
  remote.cfgPath = path.join(app.getPath('userData'), 'remote.json');
  try { remote.cfg = Object.assign(remote.cfg, JSON.parse(fs.readFileSync(remote.cfgPath, 'utf8'))); } catch (_) {}
  if (!remote.cfg.token) remote.cfg.token = crypto.randomBytes(6).toString('base64url');
  remoteSave();
}
function remoteSave() { try { fs.writeFileSync(remote.cfgPath, JSON.stringify(remote.cfg)); } catch (_) {} }
function lanIPs() {
  const out = [];
  for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('2.') || a.address.startsWith('169.254.')) continue; // laser-net / link-local
      out.push({ ifname, address: a.address });
    }
  }
  out.sort((a, b) => (a.ifname === 'en0' ? -1 : 0) - (b.ifname === 'en0' ? -1 : 0));
  return out;
}
function remoteURL() {
  const ip = lanIPs()[0];
  return ip ? `http://${ip.address}:${REMOTE_PORT}/?k=${remote.cfg.token}` : null;
}
function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(buf);
  });
}
function remoteStart() {
  if (remote.server) return;
  remote.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ok = u.searchParams.get('k') === remote.cfg.token;
    if (u.pathname === '/' || u.pathname === '/index.html') return sendFile(res, path.join(__dirname, 'remote.html'), 'text/html; charset=utf-8');
    if (u.pathname === '/touch-icon.png') return sendFile(res, path.join(__dirname, 'touch-icon.png'), 'image/png');
    if (u.pathname === '/logo-star.png') return sendFile(res, path.join(__dirname, 'logo-star.png'), 'image/png');
    if (u.pathname === '/logo.svg') return sendFile(res, path.join(__dirname, 'logo.svg'), 'image/svg+xml');
    if (u.pathname === '/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      return res.end(JSON.stringify({ name: 'SmartLink', short_name: 'SmartLink', display: 'standalone', background_color: '#050505', theme_color: '#050505', start_url: '/?k=' + (u.searchParams.get('k') || ''), icons: [{ src: '/touch-icon.png', sizes: '180x180', type: 'image/png' }] }));
    }
    if (!ok) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"bad key"}'); }
    if (u.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${remote.state}\n\n`);
      remote.clients.add(res);
      notifyRemoteCount();
      req.on('close', () => { remote.clients.delete(res); notifyRemoteCount(); });
      return;
    }
    if (u.pathname === '/cmd' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        try { const cmd = JSON.parse(body); if (win && !win.isDestroyed()) win.webContents.send('remote-cmd', cmd); res.writeHead(204); }
        catch (_) { res.writeHead(400); }
        res.end();
      });
      return;
    }
    const m = /^\/pat\/(\d{1,3})$/.exec(u.pathname);
    if (m) return sendFile(res, path.join(patDir(), String(+m[1]).padStart(3, '0') + '.ild'), 'application/octet-stream');
    if (u.pathname === '/patlist') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(listPatterns())); }
    res.writeHead(404); res.end();
  });
  remote.server.on('error', (e) => { remote.lastError = e.message; remote.server = null; });
  remote.server.listen(REMOTE_PORT, '0.0.0.0');
  setInterval(() => { for (const c of remote.clients) c.write(': ping\n\n'); }, 15000).unref();
}
function remoteStop() {
  if (!remote.server) return;
  for (const c of remote.clients) { try { c.end(); } catch (_) {} }
  remote.clients.clear();
  remote.server.close(); remote.server = null; notifyRemoteCount();
}
function notifyRemoteCount() { if (win && !win.isDestroyed()) win.webContents.send('remote-count', remote.clients.size); }
ipcMain.handle('cam-access', async () => { try { if (process.platform === 'darwin') { const { systemPreferences } = require('electron'); return await systemPreferences.askForMediaAccess('camera'); } } catch (e) { return false; } return true; });
ipcMain.on('remote-state', (_e, json) => {
  if (json === remote.state) return;
  remote.state = json;
  for (const c of remote.clients) c.write(`data: ${json}\n\n`);
});
ipcMain.handle('remote-info', async () => {
  const url = remoteURL();
  let qr = null;
  if (url) { try { qr = await require('qrcode').toDataURL(url, { margin: 1, width: 360, color: { dark: '#000000', light: '#ffffff' } }); } catch (_) {} }
  return { enabled: remote.cfg.enabled && !!remote.server, url, qr, clients: remote.clients.size, error: remote.lastError || null, ips: lanIPs() };
});
ipcMain.handle('remote-enable', (_e, on) => {
  remote.cfg.enabled = !!on; remoteSave();
  if (on) remoteStart(); else remoteStop();
  return true;
});
ipcMain.handle('remote-newkey', () => {
  remote.cfg.token = crypto.randomBytes(6).toString('base64url'); remoteSave();
  for (const c of remote.clients) { try { c.end(); } catch (_) {} }
  remote.clients.clear(); notifyRemoteCount();
  return true;
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 860,
    backgroundColor: '#07080c',
    title: 'SmartLink',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // DMX skal blive ved med at blive sendt
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// ---------- opdateringer fra GitHub Releases ----------
// Appen tjekker den nyeste release, henter SmartLink-Mac.zip, pakker den ud og bytter sig selv ud (uden Apple-signatur).
const UPDATE_REPO = 'TRANBERGMUSIC/smartlink'; // repo-navnet er uændret
const https = require('https');
function httpsGet(url, { onProgress, toFile } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('for mange omdirigeringer'));
    const req = https.get(url, { headers: { 'User-Agent': 'SmartLink/' + app.getVersion(), Accept: 'application/vnd.github+json, application/octet-stream' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); return resolve(httpsGet(new URL(res.headers.location, url).href, { onProgress, toFile }, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = +res.headers['content-length'] || 0; let got = 0;
      if (toFile) {
        const out = fs.createWriteStream(toFile);
        res.on('data', (c) => { got += c.length; if (onProgress && total) onProgress(got / total); });
        res.pipe(out); out.on('finish', () => resolve({ status: 200, file: toFile })); out.on('error', reject);
      } else { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: 200, body: Buffer.concat(chunks).toString('utf8') })); }
    });
    req.on('error', reject); req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}
const semver = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-check', async () => {
  try {
    const r = await httpsGet(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
    const j = JSON.parse(r.body); const latest = String(j.tag_name || '').replace(/^v/, '');
    const asset = (j.assets || []).find((a) => /(SmartLink|LightLink)-Mac\.zip$/i.test(a.name));
    return { ok: true, current: app.getVersion(), latest, newer: newer(latest, app.getVersion()) && !!asset, url: asset ? asset.browser_download_url : null, notes: j.body || '', page: j.html_url || `https://github.com/${UPDATE_REPO}/releases` };
  } catch (e) { return { ok: false, current: app.getVersion(), error: String(e.message || e) }; }
});
ipcMain.handle('update-install', async (_e, url) => {
  const logPath = path.join(app.getPath('userData'), 'update.log');
  const log = (m) => { try { fs.appendFileSync(logPath, new Date().toISOString() + ' ' + m + '\n'); } catch (_) {} };
  try {
    let appPath = path.resolve(app.getPath('exe'), '..', '..', '..');
    log('start ' + url + ' app=' + appPath);
    if (!appPath.endsWith('.app')) return { ok: false, error: 'Kører ikke som installeret app (udviklingstilstand).' };
    // Kører appen fra Downloads med karantæne, kører macOS den fra en skjult, skrivebeskyttet kopi (App Translocation).
    if (appPath.includes('/AppTranslocation/')) {
      let real = [];
      try { real = require('child_process').execFileSync('/usr/bin/mdfind', ['kMDItemCFBundleIdentifier == "dk.willads.smartlink"'], { timeout: 8000 }).toString().split('\n').map((s) => s.trim()).filter((p) => p.endsWith('.app') && !p.includes('/AppTranslocation/') && fs.existsSync(p)); } catch (_) {}
      real.sort((a, b) => (b.startsWith('/Applications/') ? 1 : 0) - (a.startsWith('/Applications/') ? 1 : 0));
      if (!real.length) return { ok: false, error: 'Appen kører fra en midlertidig placering. Flyt SmartLink.app til Programmer, åbn den derfra og prøv igen.' };
      appPath = real[0]; log('translokeret → ' + appPath);
    }
    const dir = path.dirname(appPath);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-upd-')); const zip = path.join(tmp, 'SmartLink-Mac.zip');
    await httpsGet(url, { toFile: zip, onProgress: (p) => { try { win.webContents.send('update-progress', p); } catch (_) {} } });
    log('hentet ' + fs.statSync(zip).size + ' bytes');
    await new Promise((res, rej) => execFile('/usr/bin/ditto', ['-x', '-k', zip, tmp], (err, so, se) => (err ? rej(new Error('ditto: ' + (se || err.message))) : res())));
    const found = fs.readdirSync(tmp).find((f) => f.endsWith('.app')); if (!found) throw new Error('Ingen .app i den hentede fil');
    const newApp = path.join(tmp, found), finalPath = path.join(dir, found), oldPath = path.join(dir, found + '.old');
    log('udpakket ' + newApp + ' → ' + finalPath);
    // kopiér den nye app ind ved siden af (samme disk), byt navne, start den nye og luk
    const staged = path.join(dir, found + '.new');
    try { fs.rmSync(staged, { recursive: true, force: true }); } catch (_) {}
    await new Promise((res, rej) => execFile('/usr/bin/ditto', [newApp, staged], (err, so, se) => (err ? rej(new Error('kopiering: ' + (se || err.message))) : res())));
    try { execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged], () => {}); } catch (_) {}
    try { fs.rmSync(oldPath, { recursive: true, force: true }); } catch (_) {}
    fs.renameSync(appPath, oldPath); log('gammel → ' + oldPath);
    fs.renameSync(staged, finalPath); log('ny → ' + finalPath);
    const { spawn } = require('child_process');
    spawn('/bin/sh', ['-c', `sleep 1; /usr/bin/open "${finalPath}"; sleep 8; rm -rf "${oldPath}"`], { detached: true, stdio: 'ignore' }).unref();
    log('genstarter'); setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (e) { log('FEJL ' + (e.stack || e)); return { ok: false, error: String(e.message || e) + ' (log: ' + logPath + ')' }; }
});

app.whenReady().then(() => {
  try { const me = path.resolve(app.getPath('exe'), '..', '..', '..'); const old = me + '.old'; if (fs.existsSync(old)) fs.rmSync(old, { recursive: true, force: true }); } catch (_) {}
  // fjern karantæne-mærket på den installerede app, så macOS ikke kører den fra en midlertidig kopi næste gang
  try { const me = path.resolve(app.getPath('exe'), '..', '..', '..'); if (me.endsWith('.app') && !me.includes('/AppTranslocation/')) execFile('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', me], () => {}); } catch (_) {}
  // flyt indstillinger og mønstre med fra LightLink (det gamle navn), første gang SmartLink starter
  try {
    const oldDir = path.join(app.getPath('appData'), 'LightLink'), newDir = app.getPath('userData');
    if (fs.existsSync(oldDir) && !fs.existsSync(path.join(newDir, 'patterns')) && !fs.existsSync(path.join(newDir, '.migrated'))) {
      fs.mkdirSync(newDir, { recursive: true });
      for (const f of fs.readdirSync(oldDir)) { if (/lock|Cache|GPUCache|Code Cache|DawnCache/i.test(f)) continue; try { fs.cpSync(path.join(oldDir, f), path.join(newDir, f), { recursive: true, force: false, errorOnExist: false }); } catch (_) {} }
      fs.writeFileSync(path.join(newDir, '.migrated'), 'fra LightLink');
    }
  } catch (_) {}
  createSocket();
  startPolling();
  remoteLoad();
  if (remote.cfg.enabled) remoteStart();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // Send blackout før vi lukker
  try {
    const zero = new Array(512).fill(0);
    sock.send(artDmx(0, zero), 6454, '2.255.255.255');
  } catch (_) {}
  setTimeout(() => app.quit(), 150);
});
