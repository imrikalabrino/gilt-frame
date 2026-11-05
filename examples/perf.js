// node --expose-gc examples/perf.js — render time per style and size, Node pipeline time, memory.
import { performance } from 'node:perf_hooks';

const t0 = performance.now();
const core = await import('../src/index.js');
const tImport = performance.now() - t0;
const { frameImage, closePool } = await import('../src/node.js');
const sharp = (await import('sharp')).default;

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const time = async (fn, n = 5) => {
  await fn(0);
  const ts = [];
  for (let i = 1; i <= n; i++) { const t = performance.now(); await fn(i); ts.push(performance.now() - t); }
  return median(ts);
};
const sizes = [[800, 600], [1920, 1080], [4000, 3000]];

console.log('core import', tImport.toFixed(0), 'ms');
console.log('\nsingle-thread renderFrame, median ms');
console.log('style'.padEnd(12) + sizes.map(([w, h]) => `${w}x${h}`.padStart(11)).join(''));
for (const style of core.STYLES) {
  let row = style.padEnd(12);
  for (const [w, h] of sizes) row += (await time((i) => core.renderFrame({ width: w, height: h, seed: 'p' + i, style }))).toFixed(0).padStart(11);
  console.log(row);
}

console.log('\nNode frameImage -> JPEG (threaded), median ms');
for (const [w, h] of sizes) {
  const img = await sharp({ create: { width: w, height: h, channels: 3, background: '#456' } }).jpeg().toBuffer();
  console.log(`${w}x${h}`.padEnd(12) + (await time((i) => frameImage(img, { seed: 'p' + i, format: 'jpeg' }), 3)).toFixed(0).padStart(11));
}

for (const [w, h] of sizes) {
  global.gc?.();
  const before = process.memoryUsage().arrayBuffers;
  const f = core.renderFrame({ width: w, height: h, seed: 'mem' });
  const after = process.memoryUsage().arrayBuffers;
  console.log(`buffers held during a ${w}x${h} render ≈ ${((after - before) / 1e6).toFixed(0)} MB (output ${f.width}x${f.height})`);
}
await closePool();
