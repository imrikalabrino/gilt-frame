// One frame per style: node examples/styles.js [seedPrefix] [out.png]
import sharp from 'sharp';
import { frameImage, closePool } from '../src/node.js';
import { STYLES } from '../src/genome.js';

const prefix = process.argv[2] ?? 'st', out = process.argv[3] ?? 'examples/styles.png';
const cell = 520, tiles = [];
for (const [i, style] of STYLES.entries()) {
  const [w, h] = style === 'tabernacle' ? [460, 640] : i % 2 ? [640, 480] : [520, 640];
  const pic = await sharp({ create: { width: w, height: h, channels: 3, background: '#3c4a56' } }).png().toBuffer();
  const { buffer, frame } = await frameImage(pic, { seed: prefix + i, style, finish: 'gold' });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="30"><text x="${cell / 2}" y="21" font-family="sans-serif" font-size="18" fill="#e8dcc4" text-anchor="middle">${style} · ${frame.palette} · seed ${frame.seed}</text></svg>`);
  tiles.push(await sharp(buffer).resize(cell - 20, cell - 50, { fit: 'contain', background: '#2b2724' }).extend({ top: 0, bottom: 30, left: 10, right: 10, background: '#2b2724' }).composite([{ input: label, gravity: 'south' }]).toBuffer());
}
await sharp({ create: { width: 3 * cell, height: 2 * (cell - 20), channels: 3, background: '#2b2724' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % 3) * cell, top: Math.floor(i / 3) * (cell - 20) })))
  .png().toFile(out);
await closePool();
console.log('wrote', out);
