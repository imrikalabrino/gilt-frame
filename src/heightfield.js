// Turns carved-element outlines into relief: scanline fill -> exact Euclidean distance
// transform -> rounded dome, stacked element over element; grooves are carved the same way.
// Tiles are built supersampled once and then stamped (tiled / mirrored) into the frame.

const INF = 1e20;
let bufN = 0, MASK, DIST, F, D, V, Z;
function scratch(n, line) {
  if (n > bufN) { bufN = n; MASK = new Uint8Array(n); DIST = new Float32Array(n); }
  if (!F || line > F.length) { F = new Float64Array(line); D = new Float64Array(line); V = new Int32Array(line); Z = new Float64Array(line + 1); }
}

/** Closed Catmull-Rom resampling so straight polygon edges don't show up as facets in the lighting. */
export function densify(p, maxSeg) {
  const n = p.length >> 1, out = [];
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 2, b = i * 2, c = ((i + 1) % n) * 2, d = ((i + 2) % n) * 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1]) / maxSeg));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
      out.push(w0 * p[a] + w1 * p[b] + w2 * p[c] + w3 * p[d], w0 * p[a + 1] + w1 * p[b + 1] + w2 * p[c + 1] + w3 * p[d + 1]);
    }
  }
  return out;
}

/** Nonzero-winding scanline fill of a polygon (grid coords) into mask[w*h]. */
function rasterize(P, w, h, mask) {
  mask.fill(0, 0, w * h);
  const rows = new Array(h);
  const n = P.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = ((i + 1) % n) * 2, x0 = P[i * 2], y0 = P[i * 2 + 1], x1 = P[j], y1 = P[j + 1];
    if (y0 === y1) continue;
    const dir = y1 > y0 ? 1 : -1, ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    const r1 = Math.min(h - 1, Math.ceil(yb - 0.5) - 1), inv = (x1 - x0) / (y1 - y0);
    for (let r = Math.max(0, Math.ceil(ya - 0.5)); r <= r1; r++) (rows[r] ||= []).push(x0 + (r + 0.5 - y0) * inv, dir);
  }
  for (let r = 0; r < h; r++) {
    const c = rows[r];
    if (!c) continue;
    for (let i = 2; i < c.length; i += 2) { // insertion sort of (x, dir) pairs — lists are tiny
      const x = c[i], d = c[i + 1];
      let k = i - 2;
      while (k >= 0 && c[k] > x) { c[k + 2] = c[k]; c[k + 3] = c[k + 1]; k -= 2; }
      c[k + 2] = x; c[k + 3] = d;
    }
    let wind = 0, start = 0;
    for (let i = 0; i < c.length; i += 2) {
      const prev = wind;
      wind += c[i + 1];
      if (prev === 0 && wind !== 0) start = c[i];
      else if (prev !== 0 && wind === 0) {
        const a = Math.max(0, Math.ceil(start - 0.5)), b = Math.min(w - 1, Math.ceil(c[i] - 0.5) - 1);
        if (b >= a) mask.fill(1, r * w + a, r * w + b + 1);
      }
    }
  }
}

function dt1d(n) { // Felzenszwalb–Huttenlocher squared distance transform of F[0..n) into D
  let k = 0;
  V[0] = 0; Z[0] = -Infinity; Z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let v = V[k], s = (F[q] + q * q - (F[v] + v * v)) / (2 * q - 2 * v);
    while (s <= Z[k]) {
      k--; v = V[k];
      s = (F[q] + q * q - (F[v] + v * v)) / (2 * q - 2 * v);
    }
    k++; V[k] = q; Z[k] = s; Z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (Z[k + 1] < q) k++;
    const v = V[k];
    D[q] = (q - v) * (q - v) + F[v];
  }
}

/** Distance from each inside pixel to the nearest outside pixel. Returns max distance. */
function edt(mask, w, h, dist) {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) F[y] = mask[y * w + x] ? INF : 0;
    dt1d(h);
    for (let y = 0; y < h; y++) dist[y * w + x] = D[y];
  }
  let max = 0;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) F[x] = dist[o + x];
    dt1d(w);
    for (let x = 0; x < w; x++) {
      const d = Math.sqrt(D[x]);
      dist[o + x] = d;
      if (d > max) max = d;
    }
  }
  return max;
}

export class Tile {
  /** Region in render px: [x0, x0+w) × [y0, y0+h). wrapX makes it periodic along x (band runs). */
  constructor(x0, y0, w, h, { ss = 2, wrapX = false, relief = 0.85, hCap = Infinity } = {}) {
    this.x0 = x0; this.y0 = y0; this.ss = ss; this.wrapX = wrapX;
    this.gw = Math.max(2, Math.round(w * ss)); this.gh = Math.max(2, Math.ceil(h * ss));
    this.w = w; this.h = h; this.relief = relief; this.hCap = hCap * ss;
    this.H = new Float32Array(this.gw * this.gh);
    this.C = new Uint8Array(this.gw * this.gh);
  }

  /** Stack an element: body = raised dome, groove = carved channel into what's already there. */
  add(poly, groove = false) {
    const { ss, gw, gh } = this;
    const sx = this.wrapX ? gw / (this.w * ss) : 1; // exact period when wrapping
    const P = new Array(poly.length);
    for (let i = 0; i < poly.length; i += 2) { P[i] = (poly[i] - this.x0) * ss * sx; P[i + 1] = (poly[i + 1] - this.y0) * ss; }
    const Q = densify(P, 1.25);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < Q.length; i += 2) {
      if (Q[i] < minX) minX = Q[i]; if (Q[i] > maxX) maxX = Q[i];
      if (Q[i + 1] < minY) minY = Q[i + 1]; if (Q[i + 1] > maxY) maxY = Q[i + 1];
    }
    if (!this.wrapX && (maxX < 0 || minX > gw)) return;
    if (maxY < 0 || minY > gh) return;
    const lx = Math.floor(minX) - 2, ly = Math.floor(minY) - 2;
    const lw = Math.ceil(maxX) - lx + 3, lh = Math.ceil(maxY) - ly + 3;
    scratch(lw * lh, Math.max(lw, lh));
    for (let i = 0; i < Q.length; i += 2) { Q[i] -= lx; Q[i + 1] -= ly; }
    rasterize(Q, lw, lh, MASK);
    const R = edt(MASK, lw, lh, DIST);
    if (R < 0.5) return;
    const { H, C } = this;
    if (groove) {
      const depth = Math.min(R * 1.4, this.hCap * 0.3);
      for (let y = 0; y < lh; y++) {
        const ty = ly + y;
        if (ty < 0 || ty >= gh) continue;
        for (let x = 0; x < lw; x++) {
          const d = DIST[y * lw + x];
          if (!d) continue;
          let tx = lx + x;
          if (this.wrapX) tx = ((tx % gw) + gw) % gw; else if (tx < 0 || tx >= gw) continue;
          const i = ty * gw + tx;
          if (!C[i]) continue;
          const t = 1 - d / R;
          H[i] = Math.max(H[i] * 0.35, H[i] - depth * Math.sqrt(1 - t * t));
        }
      }
      return;
    }
    const hMax = Math.min(R * this.relief, this.hCap);
    const lift = 0.35 * ss;
    for (let y = 0; y < lh; y++) {
      const ty = ly + y;
      if (ty < 0 || ty >= gh) continue;
      for (let x = 0; x < lw; x++) {
        const d = DIST[y * lw + x];
        if (!d) continue;
        let tx = lx + x;
        if (this.wrapX) tx = ((tx % gw) + gw) % gw; else if (tx < 0 || tx >= gw) continue;
        const i = ty * gw + tx;
        const t = 1 - d / R;
        const h = hMax * Math.sqrt(1 - t * t) + lift;
        const cur = H[i];
        const v = cur * 0.55 + h;
        if (v > cur) H[i] = v;
        C[i] = 1;
      }
    }
  }

  addAll(elements) {
    for (const e of elements) this.add(e.p, e.g);
    return this;
  }

  /** Box-downsample to render resolution: heights in render px, coverage 0..1 (antialiased edges). */
  finish() {
    const { ss, gw, gh } = this;
    const w = Math.floor(gw / ss), h = Math.floor(gh / ss), k = 1 / (ss * ss);
    const H = new Float32Array(w * h), C = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sh = 0, sc = 0;
        for (let j = 0; j < ss; j++) {
          const o = (y * ss + j) * gw + x * ss;
          for (let i = 0; i < ss; i++) { sh += this.H[o + i]; sc += this.C[o + i]; }
        }
        H[y * w + x] = (sh * k) / ss;
        C[y * w + x] = sc * k;
      }
    }
    return { x0: this.x0, y0: this.y0, w, h, scaleX: this.wrapX ? w / this.w : 1, wrapX: this.wrapX, H, C };
  }
}

/** Bilinear sample of a finished tile at render-space local coords; writes [height, coverage] into out. */
export function sampleTile(t, x, y, out) {
  let fx = (x - t.x0) * t.scaleX - 0.5, fy = y - t.y0 - 0.5;
  const w = t.w, h = t.h;
  if (fy < -1 || fy > h) { out[0] = 0; out[1] = 0; return; }
  if (t.wrapX) { fx %= w; if (fx < 0) fx += w; } else if (fx < -1 || fx > w) { out[0] = 0; out[1] = 0; return; }
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const ax = fx - x0, ay = fy - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  if (t.wrapX) { if (x1 >= w) x1 -= w; } else { if (x0 < 0) x0 = 0; if (x1 >= w) x1 = w - 1; }
  if (y0 < 0) y0 = 0; if (y1 >= h) y1 = h - 1; if (y0 >= h) y0 = h - 1;
  const i00 = y0 * w + x0, i10 = y0 * w + x1, i01 = y1 * w + x0, i11 = y1 * w + x1;
  const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
  out[0] = t.H[i00] * w00 + t.H[i10] * w10 + t.H[i01] * w01 + t.H[i11] * w11;
  out[1] = t.C[i00] * w00 + t.C[i10] * w10 + t.C[i01] * w01 + t.C[i11] * w11;
}

/** Separable box blur (2 passes ≈ tent) — O(n) regardless of radius. */
export function blur(src, dst, w, h, r, tmp) {
  r = Math.max(1, Math.round(r));
  const pass = (a, b) => {
    for (let y = 0; y < h; y++) { // horizontal a -> tmp
      const o = y * w;
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s / (2 * r + 1);
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) { // vertical tmp -> b
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        b[y * w + x] = s / (2 * r + 1);
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  };
  pass(src, dst);
  pass(dst, dst);
}
