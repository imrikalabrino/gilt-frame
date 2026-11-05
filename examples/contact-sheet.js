// Renders a grid of random frames around a synthetic painting.
// usage: node examples/contact-sheet.js [out.png] [count] [seedPrefix]
import sharp from 'sharp';
import { frameImage } from '../src/node.js';

const out = process.argv[2] ?? 'examples/sheet.png';
const count = Number(process.argv[3] ?? 6);
const prefix = process.argv[4] ?? 's';
const sizes = [[600, 800], [800, 600], [700, 700], [1000, 450], [450, 900], [640, 480]];

const painting = (w, h, i) => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="a" x2="0" y2="1">
  <stop offset="0" stop-color="hsl(${(i * 53) % 360},35%,45%)"/><stop offset="1" stop-color="hsl(${(i * 53 + 40) % 360},30%,18%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#a)"/><circle cx="${w * 0.55}" cy="${h * 0.45}" r="${Math.min(w, h) * 0.22}" fill="hsl(${(i * 53 + 180) % 360},40%,60%)" opacity=".8"/></svg>`)).png().toBuffer();

const cell = 760;
const tiles = [];
for (let i = 0; i < count; i++) {
  const [w, h] = sizes[i % sizes.length];
  const t0 = performance.now();
  const { buffer, seed } = await frameImage(await painting(w, h, i), { seed: `${prefix}${i}` });
  console.log(`${seed}  ${w}x${h}  ${(performance.now() - t0).toFixed(0)}ms`);
  tiles.push(await sharp(buffer).resize(cell - 20, cell - 20, { fit: 'contain', background: '#2b2b2b' }).toBuffer());
}
const cols = 3, rows = Math.ceil(count / cols);
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#2b2b2b' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * cell + 10, top: Math.floor(i / cols) * cell + 10 })))
  .png().toFile(out);
console.log('wrote', out);
