import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import sharp from 'sharp';
import { renderFrame, frameLayout, makeGenome, seedFromClass, seedToClass, GOLDS, WOODS, STYLES } from '../src/index.js';
import { frameImage, renderFrameParallel, closePool } from '../src/node.js';
import { GiltFrame } from '../src/react.js';

after(closePool);
const digest = (f) => createHash('sha1').update(f.data).digest('hex');

test('same seed -> identical pixels', () => {
  assert.equal(digest(renderFrame({ width: 400, height: 300, seed: 'versailles' })), digest(renderFrame({ width: 400, height: 300, seed: 'versailles' })));
});

test('different seeds -> different frames', () => {
  const set = new Set(Array.from({ length: 12 }, (_, i) => digest(renderFrame({ width: 200, height: 160, seed: 'x' + i }))));
  assert.equal(set.size, 12);
});

test('design (genome) is independent of image size and ratio', () => {
  assert.deepEqual(makeGenome('louis'), frameLayout({ width: 3000, height: 200, seed: 'louis' }).genome);
  assert.deepEqual(frameLayout({ width: 10, height: 10, seed: 'louis' }).genome, frameLayout({ width: 9000, height: 7000, seed: 'louis' }).genome);
});

test('random seed is returned and reproduces the frame', () => {
  const a = renderFrame({ width: 240, height: 180 });
  assert.match(a.seed, /^[0-9a-z]{10}$/);
  assert.equal(digest(renderFrame({ width: 240, height: 180, seed: a.seed })), digest(a));
});

test('wear changes the surface, not the design', () => {
  const a = renderFrame({ width: 300, height: 300, seed: 'w', wear: 0 }), b = renderFrame({ width: 300, height: 300, seed: 'w', wear: 1 });
  assert.notEqual(digest(a), digest(b));
  assert.deepEqual(a.genome, b.genome);
});

test('finishes: seeds spread over gold / wood / parcel and every palette', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) { const l = frameLayout({ width: 10, height: 10, seed: 'f' + i }); seen.add(l.finish); seen.add(l.palette.split('+')[0]); }
  for (const k of ['gold', 'wood', 'parcel', ...Object.keys(GOLDS), ...Object.keys(WOODS)]) assert.ok(seen.has(k), k);
});

test('finish / palette overrides keep the design and change the material', () => {
  const base = { width: 260, height: 200, seed: 'mat' };
  const gold = renderFrame({ ...base, finish: 'gold', palette: 'rose' }), wood = renderFrame({ ...base, palette: 'walnut' });
  assert.equal(gold.palette, 'rose');
  assert.equal(wood.finish, 'wood');
  assert.equal(renderFrame({ ...base, finish: 'parcel', palette: 'oak' }).palette.split('+')[0], 'oak');
  assert.deepEqual(gold.genome, wood.genome);
  assert.notEqual(digest(gold), digest(wood));
  assert.throws(() => renderFrame({ ...base, palette: 'plywood' }), /unknown palette/);
});

test('every style renders, keeps the opening clear, and is chosen by seeds', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(frameLayout({ width: 10, height: 10, seed: 's' + i }).style);
  assert.deepEqual([...seen].sort(), [...STYLES].sort());
  for (const style of STYLES) {
    const f = renderFrame({ width: 400, height: 300, seed: 'sty', style });
    assert.equal(f.style, style);
    const cx = Math.round((f.imageX + 200) * f.scale), cy = Math.round((f.imageY + 150) * f.scale);
    assert.equal(f.data[(cy * f.width + cx) * 4 + 3], 0, style);
    assert.equal(f.fullHeight, 300 + f.thicknessTop + f.thicknessBottom + 2 * f.overhang);
  }
  assert.throws(() => renderFrame({ width: 10, height: 10, style: 'gothic' }), /style must be one of/);
});

test('tabernacle: taller entablature and plinth than the sides; threads still identical', async () => {
  const f = frameLayout({ width: 600, height: 800, seed: 'tab', style: 'tabernacle' });
  assert.ok(f.thicknessTop > f.thickness && f.thicknessBottom >= f.thickness);
  assert.equal(f.imageY, f.overhang + f.thicknessTop);
  const opts = { width: 1200, height: 1500, seed: 'tab', style: 'tabernacle' };
  assert.equal(digest(await renderFrameParallel({ ...opts, threads: 4 })), digest(renderFrame(opts)));
});

test('baroque seeds keep their design when the style is forced', () => {
  const g = makeGenome('keep', 'baroque'), h = makeGenome('keep', 'baroque');
  assert.deepEqual(g, h);
  assert.ok(g.corner);
});

test('seed class round-trips any string', () => {
  for (const seed of ['abc123', 'with space', 'émoji 🖼️', '"><script>', 'a_b']) {
    const cls = seedToClass(seed);
    assert.match(cls, /^gilt-frame-[A-Za-z0-9_-]+$/);
    assert.equal(seedFromClass(`foo gilt-frame ${cls} bar`), seed);
  }
});

test('layout adds up for extreme ratios; opening is transparent', () => {
  for (const [w, h] of [[1, 1], [37, 900], [2400, 120], [640, 480]]) {
    const f = renderFrame({ width: w, height: h, seed: 'r' });
    assert.equal(f.fullWidth, w + 2 * (f.thickness + f.overhang));
    assert.equal(f.width, Math.round(f.fullWidth * f.scale));
    if (w > 100 && h > 100) {
      const cx = Math.round((f.imageX + w / 2) * f.scale), cy = Math.round((f.imageY + h / 2) * f.scale);
      assert.equal(f.data[(cy * f.width + cx) * 4 + 3], 0);
    }
  }
});

test('detail budget scales the render, not the layout', () => {
  const f = renderFrame({ width: 3000, height: 2000, seed: 'big', maxThickness: 120 });
  assert.ok(f.scale < 1);
  assert.equal(f.fullWidth, frameLayout({ width: 3000, height: 2000, seed: 'big' }).fullWidth);
});

test('parallel render is bit-identical to single-threaded', async () => {
  const opts = { width: 1400, height: 1000, seed: 'threads' };
  assert.equal(digest(await renderFrameParallel({ ...opts, threads: 4 })), digest(renderFrame(opts)));
});

test('node: frameImage wraps a raster and leaves the picture centre untouched', async () => {
  const img = await sharp({ create: { width: 300, height: 180, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const { buffer, seed, frame, info } = await frameImage(img, { seed: 'node' });
  assert.equal(seed, 'node');
  assert.equal(info.width, frame.fullWidth);
  const px = await sharp(buffer).extract({ left: frame.imageX + 150, top: frame.imageY + 90, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...px.subarray(0, 3)], [255, 0, 0]);
});

test('react: wrapper carries the seed class and lays out before rendering', () => {
  const html = renderToString(createElement(GiltFrame, { src: '/a.jpg', width: 400, height: 300, seed: 'react' }));
  assert.match(html, /class="gilt-frame gilt-frame-react"/);
  assert.match(html, /<img/);
  assert.match(html, /<canvas/);
});
