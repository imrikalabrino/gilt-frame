// node examples/bench.js — frame render (pure JS) and full Node pipeline timings.
import sharp from 'sharp';
import { renderFrame } from '../src/index.js';
import { frameImage } from '../src/node.js';

const time = async (label, n, fn) => {
  await fn(0);
  const t = performance.now();
  for (let i = 1; i <= n; i++) await fn(i);
  console.log(label.padEnd(46), ((performance.now() - t) / n).toFixed(0).padStart(6), 'ms');
};

for (const [w, h] of [[800, 600], [1920, 1080], [3000, 2000], [6000, 4000]]) {
  await time(`renderFrame ${w}x${h}`, 5, (i) => renderFrame({ width: w, height: h, seed: 'b' + i }));
}
for (const [w, h] of [[800, 600], [3000, 2000], [6000, 4000]]) {
  const img = await sharp({ create: { width: w, height: h, channels: 3, background: '#456' } }).jpeg().toBuffer();
  await time(`frameImage -> jpeg ${w}x${h}`, 3, (i) => frameImage(img, { seed: 'b' + i, format: 'jpeg' }));
}
