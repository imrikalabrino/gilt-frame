// Seeded, tileable fBm value-noise textures, baked once (256² floats) and sampled with wrap.

export function makeNoise(rng, { size = 256, cells = 4, octaves = 4 } = {}) {
  const out = new Float32Array(size * size);
  let amp = 1;
  for (let o = 0; o < octaves; o++, amp *= 0.5) {
    const c = cells << o, step = size / c;
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    for (let y = 0; y < size; y++) {
      const gy = y / step, y0 = Math.floor(gy), ty = gy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % c) * c, r1 = ((y0 + 1) % c) * c;
      for (let x = 0; x < size; x++) {
        const gx = x / step, x0 = Math.floor(gx), tx = gx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % c, c1 = (x0 + 1) % c;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += amp * (a + (b - a) * sy);
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

/** Bilinear, wrapping sample; x/y in texels. Texture side must be 256. */
export function sample(t, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), ax = x - x0, ay = y - y0;
  const xa = x0 & 255, xb = (x0 + 1) & 255, ya = (y0 & 255) << 8, yb = ((y0 + 1) & 255) << 8;
  const a = t[ya + xa] + (t[ya + xb] - t[ya + xa]) * ax;
  const b = t[yb + xa] + (t[yb + xb] - t[yb + xa]) * ax;
  return a + (b - a) * ay;
}
