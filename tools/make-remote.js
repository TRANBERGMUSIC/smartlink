// Bygger src/remote.html ud fra skabelonen + den samme ILDA-kode som Mac-appen bruger
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src');
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
const cut = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); if (a < 0 || b < 0) throw new Error('mangler ' + from); return app.slice(a, b); };
const ilda = cut('const ILDA_PAL', 'const patData') + cut('// tegn ét frame', 'function sizeCanvas');
const tpl = fs.readFileSync(path.join(src, 'remote.template.html'), 'utf8');
fs.writeFileSync(path.join(src, 'remote.html'), tpl.replace('/*ILDA*/', ilda));
console.log('remote.html bygget');
