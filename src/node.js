// Node pipeline: render the frame (RGBA), upscale if it was rendered under the detail budget,
// then one libvips pass — extend the photo with transparent margins and composite the frame over it.

import { renderFrame } from './frame.js';
import { renderFrameParallel, closePool } from './parallel.js';

let sharpModule;
async function loadSharp() {
  if (!sharpModule) {
    try { sharpModule = (await import('sharp')).default; }
    catch { throw new Error('gilt-frame/node needs the optional peer dependency "sharp": npm i sharp'); }
  }
  return sharpModule;
}

/** Rendered frame as an RGBA buffer at full output size (picture opening transparent). */
export async function frameOverlay(options) {
  const sharp = await loadSharp();
  const f = await renderFrameParallel(options);
  let buf = Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength);
  if (f.scale < 1) {
    buf = await sharp(buf, { raw: { width: f.width, height: f.height, channels: 4 } })
      .resize(f.fullWidth, f.fullHeight, { kernel: 'lanczos3', fit: 'fill' })
      .raw().toBuffer();
  }
  return { ...f, data: buf, width: f.fullWidth, height: f.fullHeight };
}

/**
 * Frame an image (path, Buffer or sharp-compatible input).
 * Resolves to { buffer, seed, info, frame }.
 */
export async function frameImage(input, options = {}) {
  const sharp = await loadSharp();
  const { format = 'png', quality, background, ...frameOpts } = options;
  const meta = await sharp(input).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
  const frame = await frameOverlay({ ...frameOpts, width, height });

  const extended = await sharp(input)
    .rotate()
    .ensureAlpha()
    .extend({
      top: frame.imageY, left: frame.imageX,
      bottom: frame.height - frame.imageY - height, right: frame.width - frame.imageX - width,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let pipeline = sharp(extended.data, { raw: extended.info })
    .composite([{ input: frame.data, raw: { width: frame.width, height: frame.height, channels: 4 } }]);
  const opaque = format === 'jpeg' || format === 'jpg';
  if (opaque || background) pipeline = pipeline.flatten({ background: background ?? '#ffffff' });
  pipeline = pipeline.toFormat(opaque ? 'jpeg' : format, quality ? { quality } : undefined);
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const { data: _, ...meta2 } = frame;
  return { buffer: data, seed: frame.seed, info, frame: meta2 };
}

/** Frame an image and write it to disk; the format follows the output extension. */
export async function frameImageToFile(input, output, options = {}) {
  const ext = output.split('.').pop().toLowerCase();
  const res = await frameImage(input, { format: ext === 'jpg' ? 'jpeg' : ext, ...options });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(output, res.buffer);
  return res;
}

export { renderFrame, renderFrameParallel, closePool };
export { randomSeed, seedToClass, seedFromClass } from './rng.js';
