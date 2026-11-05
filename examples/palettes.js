// Renders one seed in every palette: node examples/palettes.js [seed] [out.png]
import sharp from 'sharp';
import { frameImage, closePool } from '../src/node.js';
import { GOLDS, WOODS } from '../src/color.js';

const seed = process.argv[2] ?? 'versailles', out = process.argv[3] ?? 'examples/palettes.png';
const pic = await sharp({ create: { width: 520, height: 400, channels: 3, background: '#3c4a56' } }).png().toBuffer();
const variants = [
  ...Object.keys(GOLDS).map((p) => ({ finish: 'gold', palette: p })),
  ...Object.keys(WOODS).map((p) => ({ finish: 'wood', palette: p })),
  { finish: 'parcel', palette: 'walnut' }, { finish: 'parcel', palette: 'ebony' },
];
const cell = 420, cols = 5, tiles = [];
for (const v of variants) {
  const { buffer } = await frameImage(pic, { seed, ...v, overhang: 0.15, wear: 0.2 });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="28"><text x="${cell / 2}" y="20" font-family="sans-serif" font-size="17" fill="#e8dcc4" text-anchor="middle">${v.finish} · ${v.palette}</text></svg>`);
  tiles.push(await sharp(buffer).resize(cell - 16, cell - 44, { fit: 'contain', background: '#2b2724' }).extend({ top: 0, bottom: 28, left: 8, right: 8, background: '#2b2724' }).composite([{ input: label, gravity: 'south' }]).toBuffer());
}
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * cell, height: rows * (cell - 16), channels: 3, background: '#2b2724' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * cell, top: Math.floor(i / cols) * (cell - 16) })))
  .png().toFile(out);
await closePool();
console.log('wrote', out);
