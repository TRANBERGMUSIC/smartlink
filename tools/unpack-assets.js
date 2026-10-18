// Billedfiler ligger som base64-tekst i assets/ (så de kan lægges på GitHub via tekst). Pakkes ud før build/start.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const map = { 'icon.png.b64': 'build/icon.png', 'logo-star.png.b64': 'src/logo-star.png', 'touch-icon.png.b64': 'src/touch-icon.png' };
for (const [src, dst] of Object.entries(map)) {
  const from = path.join(root, 'assets', src), to = path.join(root, dst);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, Buffer.from(fs.readFileSync(from, 'utf8').trim(), 'base64'));
  console.log('udpakket', dst);
}
