// Physically-flavoured raster renderer.
//   1. height field: analytic moulding profile (per-pixel mitre) + carved ornament relief,
//      each unique tile built once (supersampled) and stamped/tiled/mirrored;
//   2. shading: normals, ray-marched cast shadows, cavity occlusion, metallic studio reflections
//      (burnished vs matte), fabric liner, sanded friezes;
//   3. wear: gilding rubbed through to red bole on high points, gesso chips, grime in recesses,
//      gold-leaf squares and seams, opened mitre joints.
// Output: straight-alpha RGBA, picture opening transparent except for the frame's cast shadow.

import { makeGenome } from './genome.js';
import { goldRamp, hsl, GOLDS, WOODS } from './color.js';
import { bandMotif } from './motifs.js';
import { cornerComposition, centerComposition } from './ornaments.js';
import { Tile, sampleTile, blur } from './heightfield.js';
import { makeNoise, sample } from './noise.js';
import { createRng, randomSeed } from './rng.js';

const GOLD = 1, SAND = 2, LINER = 3, HOLE = 4, WOOD = 5;
const SIDES = [
  { ex: [1, 0], ey: [0, 1] }, { ex: [0, 1], ey: [-1, 0] }, { ex: [-1, 0], ey: [0, -1] }, { ex: [0, -1], ey: [1, 0] },
];
const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const KEY = norm3(-0.5, -0.66, 0.62); // toward the key light (upper left), screen y down
const FILL = norm3(0.85, -0.05, 0.55);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Moulding cross-section as a height lookup table over depth d ∈ [0, T] (4 samples/px). */
function profile(g, T) {
  const res = 4, n = Math.ceil(T * res) + 2;
  const h = new Float32Array(n), mat = new Uint8Array(n), band = new Int16Array(n).fill(-1);
  const linerW = g.liner ? g.liner.w : 0, slipW = g.liner?.slip ? 0.035 : 0;
  const total = g.bands.reduce((s, b) => s + b.w, 0), goldT = T * (1 - linerW - slipW);
  const shapes = {
    torus: (u, b) => b.relief * 0.5 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)),
    bead: (u, b) => b.relief * 0.5 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)),
    cove: (u, b) => -b.relief * 0.32 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)),
    scotia: (u, b) => -b.relief * 0.45 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)),
    ogee: (u, b) => b.dir * b.relief * 0.28 * (Math.cos(Math.PI * u) - 1),
    flat: (u, b) => b.tilt * u,
    bevel: (u, b) => b.tilt * u,
  };
  const bands = [];
  let d = 0, level = 0;
  const fill = (d0, d1, fn, m, bi) => {
    for (let i = Math.floor(d0 * res); i < Math.min(n, Math.ceil(d1 * res)); i++) {
      const u = clamp01((i / res - d0) / (d1 - d0));
      h[i] = fn(u); mat[i] = m; band[i] = bi;
    }
  };
  g.bands.forEach((b, bi) => {
    const w = (b.w / total) * goldT, f = shapes[b.shape], L = level;
    fill(d, d + w, (u) => L + w * f(u, b), b.matte > 0 ? SAND : GOLD, bi);
    bands.push({ ...b, d0: d, d1: d + w });
    level = L + w * f(1, b) - b.step * T;
    d += w;
  });
  if (g.liner) {
    const L = level - 0.02 * T;
    fill(d, d + T * linerW, () => L, LINER, -1);
    d += T * linerW;
    level = L;
    if (slipW) { const L2 = level + 0.01 * T, w = T - d; fill(d, T + 1, (u) => L2 + w * 0.6 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)), GOLD, -1); }
  }
  for (let i = Math.floor(d * res); i < n; i++) if (!mat[i]) { h[i] = level; mat[i] = GOLD; }
  // Soften the fillet steps by ~0.6px so the mitred lookup antialiases.
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -1; k <= 1; k++) { const j = i + k; if (j >= 0 && j < n) { s += h[j]; c++; } } tmp[i] = s / c; }
    h.set(tmp);
  }
  const min = h.reduce((a, v) => Math.min(a, v), Infinity);
  return { h, mat, band, res, bands, hole: min - 0.06 * T, low: h[0] - 0.3 * T };
}

/** Tile a composition's elements into a finished relief tile. */
function compTile(els, U, opts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) for (let i = 0; i < e.p.length; i += 2) {
    const x = e.p[i], y = e.p[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pad = 3;
  return new Tile(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad, { ss: U > 220 ? 1 : 2, relief: 1.05, hCap: U * 0.16, ...opts }).addAll(els).finish();
}

const ALLOC = (bytes) => new ArrayBuffer(bytes);

/** Resolve finish + palette from the genome and optional overrides ({finish, palette}). */
export function resolveFinish(g, options = {}) {
  const { palette } = options;
  if (palette != null && !GOLDS[palette] && !WOODS[palette]) {
    throw new TypeError(`gilt-frame: unknown palette "${palette}" (gold: ${Object.keys(GOLDS).join(', ')}; wood: ${Object.keys(WOODS).join(', ')})`);
  }
  let kind = options.finish ?? g.finish.kind;
  if (!['gold', 'wood', 'parcel'].includes(kind)) throw new TypeError(`gilt-frame: finish must be "gold", "wood" or "parcel"`);
  if (options.finish == null && palette != null) { // a palette implies its material
    if (WOODS[palette] && kind === 'gold') kind = 'wood';
    if (GOLDS[palette] && kind === 'wood') kind = 'gold';
  }
  const goldName = GOLDS[palette] ? palette : g.finish.gold, woodName = WOODS[palette] ? palette : g.finish.wood;
  const G = GOLDS[goldName], Wd = WOODS[woodName], j = g.finish.woodJit;
  return {
    kind, goldName, woodName,
    gold: {
      hue: G.hue + g.gold.dh, sat: G.sat * g.gold.ds, lift: G.lift ?? 0,
      antique: Math.max(G.antique ?? 0, g.gold.antique), warmth: (G.warmth ?? 0) + g.gold.warmth * 0.5,
    },
    wood: { rgb: hsl(Wd.color[0] + j[0], Wd.color[1] * j[1], Wd.color[2] * j[2]), grain: Wd.grain, rings: Wd.rings, gloss: Wd.gloss },
  };
}

/** Output geometry for given options, without rendering (cheap: genome + arithmetic). */
export function frameLayout(options = {}) {
  const W = Math.round(options.width), H = Math.round(options.height);
  if (!(W > 0 && H > 0)) throw new TypeError('gilt-frame: width and height must be positive numbers');
  const seed = options.seed == null || options.seed === '' ? randomSeed() : String(options.seed);
  const g = makeGenome(seed);
  const th = options.thickness ?? g.thickness;
  const T = Math.max(8, Math.round(th > 1 ? th : Math.min(W, H) * th));
  const m = Math.round(T * (options.overhang ?? g.overhang));
  const fin = resolveFinish(g, options);
  return {
    seed, genome: g, finish: fin.kind, palette: fin.kind === 'wood' ? fin.woodName : fin.kind === 'parcel' ? `${fin.woodName}+${fin.goldName}` : fin.goldName,
    fullWidth: W + 2 * T + 2 * m, fullHeight: H + 2 * T + 2 * m,
    imageX: m + T, imageY: m + T, imageWidth: W, imageHeight: H, thickness: T, overhang: m,
  };
}

/**
 * Phase 0 (serial, cheap): genome, layout, lookup tables, band tiles. All pixel buffers are
 * allocated through `alloc` so a caller can back them with SharedArrayBuffer and run the
 * row phases on several threads. The returned state is plain, structured-cloneable data.
 */
export function setup(options = {}, alloc = ALLOC) {
  const L = frameLayout(options);
  const { seed, genome: g, imageWidth: W, imageHeight: H, thickness: T, overhang: m, fullWidth: fullW, fullHeight: fullH } = L;
  const wear = { ...g.wear, amount: options.wear ?? g.wear.amount };
  const fin = resolveFinish(g, options);
  // Detail budget: the frame is rendered with at most `maxThickness` px of moulding, then upscaled.
  const k = Math.min(1, (options.maxThickness ?? 420) / T);
  const cw = Math.max(1, Math.round(fullW * k)), ch = Math.max(1, Math.round(fullH * k));
  const Tr = T * k, ox = m * k, oy = m * k, Wo = (W + 2 * T) * k, Ho = (H + 2 * T) * k;
  const N = cw * ch;

  const P = profile(g, Tr);
  const rng = createRng(seed);
  const shared = (src) => { const a = new Float32Array(alloc(src.byteLength)); a.set(src); return a; };
  const nLow = shared(makeNoise(rng.fork('n-low'), { cells: 4, octaves: 4 }));
  const nFine = shared(makeNoise(rng.fork('n-fine'), { cells: 16, octaves: 4 }));
  const nWear = shared(makeNoise(rng.fork('n-wear'), { cells: 8, octaves: 5 }));
  const rampFn = goldRamp(fin.gold), ramp = new Float32Array(1025 * 3);
  for (let i = 0; i <= 1024; i++) ramp.set(rampFn(i / 1024), i * 3);

  // band runs: one periodic tile per decorated band
  const runs = P.bands.map((b) => {
    if (!b.motif) return null;
    const bw = b.d1 - b.d0;
    if (bw < 3) return null;
    const inset = bw * 0.05, B = bw - 2 * inset, mo = bandMotif(b.motif, B);
    const tile = new Tile(0, -B * 0.1, mo.len, B * 1.2, { ss: B > 40 ? 1 : 2, wrapX: true, relief: 0.9, hCap: B * 0.42 }).addAll(mo.els).finish();
    const dc = (b.d0 + b.d1) / 2;
    const sx = [0, 1, 2, 3].map((s) => { const L = (s % 2 ? Ho : Wo) - 2 * dc; return L / (Math.max(1, Math.round(L / mo.len)) * mo.len); });
    return { tile, dm: b.d0 + inset, dc, sx };
  });

  const q = 4, qw = Math.ceil(cw / q), qh = Math.ceil(ch / q);
  const L2 = Math.hypot(KEY[0], KEY[1]);
  const steps = [];
  for (let t = 1.2; t < Math.max(4, Tr * 0.22); t *= 1.38) steps.push(t);

  return {
    seed, g, W, H, T, m, k, fullW, fullH, cw, ch, Tr, ox, oy, Wo, Ho,
    reach: Tr * 0.32,
    prof: { h: P.h, mat: P.mat, band: P.band, res: P.res, hole: P.hole, low: P.low },
    runs, nLow, nFine, nWear, ramp, q, qw, qh,
    steps, sdx: KEY[0] / L2, sdy: KEY[1] / L2, tanE: KEY[2] / L2,
    wear,
    burnish: g.gold.burnish,
    finish: L.finish, palette: L.palette,
    wood: fin.wood, sightBand: g.bands.length - 1,
    liner: g.liner ? hsl(...g.liner.color) : null,
    linen: !!g.liner && g.liner.color[2] > 0.5,
    bole: hsl(12 + 6 * wear.bole, 0.58, 0.3 + 0.08 * wear.bole),
    gesso: hsl(40, 0.22, 0.82),
    leafOff: rng.fork('leaf').next() * 1000,
    Hf: new Float32Array(alloc(N * 4)), A: new Float32Array(alloc(N * 4)), M: new Uint8Array(alloc(N)),
    D: new Float32Array(alloc(N * 4)), O: new Float32Array(alloc(N * 4)), BQ: new Float32Array(alloc(qw * qh * 4)),
    out: new Uint8ClampedArray(alloc(N * 4)),
  };
}

// Rows that cross the picture opening only need the frame plus a margin for its cast shadow;
// the opening's interior never influences the result, so every pass skips it.
function spans(S, y) {
  const py = y + 0.5;
  if (py < S.oy + S.Tr + S.reach || py > S.oy + S.Ho - S.Tr - S.reach) return [0, S.cw, S.cw, S.cw];
  return [0, Math.min(S.cw, Math.ceil(S.ox + S.Tr + S.reach)), Math.max(0, Math.floor(S.ox + S.Wo - S.Tr - S.reach)), S.cw];
}

/** Phase 1 (row-parallel): moulding profile + band relief. */
export function heightRows(S, y0, y1) {
  const { cw, ox, oy, Wo, Ho, Tr, prof: P, runs, nFine, Hf, A, M, D, finish, sightBand } = S;
  const s2 = [0, 0];
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5, dt = py - oy, db = oy + Ho - py, sp = spans(S, y);
    Hf.fill(P.hole, y * cw, (y + 1) * cw);
    D.fill(Infinity, y * cw, (y + 1) * cw);
    for (let x = sp[0]; x < sp[3]; x++) {
      if (x === sp[1]) { x = sp[2] - 1; continue; }
      const i = y * cw + x, px = x + 0.5, dl = px - ox, dr = ox + Wo - px;
      let d = dt, side = 0, a = dl;
      if (dr < d) { d = dr; side = 1; a = dt; }
      if (db < d) { d = db; side = 2; a = dr; }
      if (dl < d) { d = dl; side = 3; a = db; }
      D[i] = d;
      if (d < -0.5) { Hf[i] = P.low; continue; }
      if (d > Tr + 0.5) { M[i] = HOLE; continue; }
      const li = Math.min(P.h.length - 1, Math.max(0, Math.round(d * P.res)));
      let h = P.h[li];
      let mat = P.mat[li];
      const bi = P.band[li];
      let carved = 0;
      if (bi >= 0 && runs[bi]) {
        const r = runs[bi];
        sampleTile(r.tile, (a - r.dc) / r.sx[side], d - r.dm, s2);
        h += s2[0];
        carved = s2[1];
      }
      if (mat === SAND) h += (sample(nFine, px * 2.1, py * 2.1) - 0.5) * 0.9;
      if (finish !== 'gold' && (mat === GOLD || mat === SAND)) {
        // parcel-gilt: gold only on the carving and the sight edge
        mat = finish === 'parcel' && (carved > 0.45 || bi === sightBand || bi < 0) ? GOLD : WOOD;
      }
      Hf[i] = h;
      M[i] = mat;
      A[i] = clamp01(d + 0.5) * clamp01(Tr + 0.5 - d);
    }
  }
}

/** Phase 2 (serial): cartouches built once and stamped through mirror/rotation matrices, then the quarter-res cavity blur. */
export function relief(S) {
  const { g, cw, ch, Tr, ox, oy, Wo, Ho, m, k, prof: P, Hf, A, M, D, O } = S;
  const lut = (d) => P.h[Math.min(P.h.length - 1, Math.max(0, Math.round(d * P.res)))];
  const standoff = Tr * 0.03, s2 = [0, 0];
  const stamp = (tile, mat) => {
    const [a, b, c, dd, e, f] = mat;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [lx, ly] of [[tile.x0, tile.y0], [tile.x0 + tile.w, tile.y0], [tile.x0, tile.y0 + tile.h], [tile.x0 + tile.w, tile.y0 + tile.h]]) {
      const sx = a * lx + c * ly + e, sy = b * lx + dd * ly + f;
      bx0 = Math.min(bx0, sx); bx1 = Math.max(bx1, sx); by0 = Math.min(by0, sy); by1 = Math.max(by1, sy);
    }
    for (let y = Math.max(0, Math.floor(by0)); y < Math.min(ch, Math.ceil(by1)); y++) {
      for (let x = Math.max(0, Math.floor(bx0)); x < Math.min(cw, Math.ceil(bx1)); x++) {
        const i = y * cw + x, d = D[i];
        if (d > Tr + 0.5) continue;
        const qx = x + 0.5 - e, qy = y + 0.5 - f;
        sampleTile(tile, a * qx + b * qy, c * qx + dd * qy, s2); // Mᵀ = M⁻¹ for these orthogonal maps
        const cov = s2[1];
        if (cov < 0.004) continue;
        const base = lut(Math.max(0, d)), cur = Hf[i];
        const hn = Math.max(cur, base) + s2[0] + standoff;
        const w = smooth(0, 0.7, cov);
        if (hn > cur) Hf[i] = cur + (hn - cur) * w;
        if (cov > A[i]) A[i] = cov;
        if (cov > O[i]) O[i] = cov;
        if (cov > 0.5 || !M[i]) M[i] = S.finish === 'wood' ? WOOD : GOLD;
      }
    }
  };
  const cs = Math.min(1, (0.42 * Math.min(Wo, Ho)) / (g.corner.len * Tr));
  const cornerTile = compTile(cornerComposition(g.corner, Tr * cs, m * k), Tr * cs);
  for (const M4 of [[1, 0, 0, 1, ox, oy], [-1, 0, 0, 1, ox + Wo, oy], [-1, 0, 0, -1, ox + Wo, oy + Ho], [1, 0, 0, -1, ox, oy + Ho]]) stamp(cornerTile, M4);
  if (g.center) {
    const reach = g.corner.len * Tr * cs, made = new Map();
    for (let s = 0; s < 4; s++) {
      const L = s % 2 ? Ho : Wo;
      const sc = Math.min(1, (L - 2 * reach - Tr * 0.4) / (2 * g.center.len * Tr));
      if (sc < 0.55) continue;
      const key = Math.round(sc * 100);
      if (!made.has(key)) made.set(key, compTile(centerComposition(g.center, Tr * sc, m * k), Tr * sc));
      const { ex, ey } = SIDES[s];
      const o = s === 0 ? [ox + Wo / 2, oy] : s === 1 ? [ox + Wo, oy + Ho / 2] : s === 2 ? [ox + Wo / 2, oy + Ho] : [ox, oy + Ho / 2];
      stamp(made.get(key), [ex[0], ex[1], ey[0], ey[1], o[0], o[1]]);
    }
  }
  const { q, qw, qh, BQ } = S;
  const Q = new Float32Array(qw * qh), tmp = new Float32Array(qw * qh);
  for (let y = 0; y < ch; y++) {
    const o = ((y / q) | 0) * qw;
    for (let x = 0; x < cw; x++) Q[o + ((x / q) | 0)] += Hf[y * cw + x];
  }
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) Q[y * qw + x] /= Math.min(q, ch - y * q) * Math.min(q, cw - x * q);
  blur(Q, BQ, qw, qh, Math.max(1, (Tr * 0.035) / q), tmp);
}

/** Phase 3 (row-parallel): lighting, materials and wear -> RGBA. */
export function shadeRows(S, y0, y1) {
  const { cw, ch, Tr, ox, oy, Wo, Ho, Hf, A, M, D, O, out, ramp, nLow, nFine, nWear, steps, sdx, sdy, tanE, q, qw, qh, BQ, wear } = S;
  const { burnish, liner, linen, bole, gesso, leafOff, wood } = S;
  // wood figure: rings run along each side (and so turn at the mitres), with long pore streaks
  const grainA = 256 / (Tr * 4), grainD = 256 / (Tr * 0.7), ringF = (2 * Math.PI * wood.rings) / (Tr * 0.055);
  const poreA = 256 / (Tr * 1.2), poreD = 256 / Math.max(2, Tr * 0.035), wShin = 20 + 90 * wood.gloss;
  const cavScale = 1 / (Tr * 0.022), convScale = 1 / Math.max(0.6, Tr * 0.004), rc = Math.max(1, Math.round(Tr * 0.006));
  const leafSize = Tr * wear.leaf, wearAmt = wear.amount, crackW = wear.crack ? 0.35 + 0.5 * wearAmt : 0;
  const lowS = 256 / Math.max(32, Tr * 1.6), wearS = 256 / Math.max(16, Tr * 0.45);
  const exposure = 2.5;
  const holeReach = Tr + S.reach, sTop = Tr * 0.07, sLeft = Tr * 0.05, sHair = Math.max(0.8, Tr * 0.008);
  const wide = (x, y) => {
    const fx = Math.min(qw - 1, Math.max(0, (x + 0.5) / q - 0.5)), fy = Math.min(qh - 1, Math.max(0, (y + 0.5) / q - 0.5));
    const x0 = fx | 0, yy0 = fy | 0, x1 = Math.min(qw - 1, x0 + 1), yy1 = Math.min(qh - 1, yy0 + 1), ax = fx - x0, ay = fy - yy0;
    const a = BQ[yy0 * qw + x0] + (BQ[yy0 * qw + x1] - BQ[yy0 * qw + x0]) * ax;
    const b = BQ[yy1 * qw + x0] + (BQ[yy1 * qw + x1] - BQ[yy1 * qw + x0]) * ax;
    return a + (b - a) * ay;
  };

  for (let y = y0; y < y1; y++) {
    const sp = spans(S, y);
    for (let x = sp[0]; x < sp[3]; x++) {
      if (x === sp[1]) { x = sp[2] - 1; continue; }
      const i = y * cw + x, mat = M[i], d = D[i];
      if (!mat || (mat === HOLE && d > holeReach)) continue;
      const h = Hf[i];
      const jit = 0.75 + 0.5 * (((Math.imul(x, 2654435761) ^ Math.imul(y, 2246822519)) >>> 0) / 4294967296); // decorrelate rays
      let sh = 0;
      for (let s = 0; s < steps.length; s++) {
        const t = steps[s] * jit, xx = Math.round(x + sdx * t), yy = Math.round(y + sdy * t);
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) break;
        const v = (Hf[yy * cw + xx] - h - t * tanE) / (0.3 * t + 0.6);
        if (v > sh) sh = v;
      }
      if (sh > 1) sh = 1;
      const bl = wide(x, y), cav = Math.max(0, bl - h) * cavScale;
      const ao = 1 / (1 + 1.1 * cav);
      const o = i * 4;
      if (mat === HOLE) {
        const it = y + 0.5 - oy - Tr, il = x + 0.5 - ox - Tr, ib = oy + Ho - Tr - y - 0.5, ir = ox + Wo - Tr - x - 0.5;
        const al = clamp01(0.62 * Math.exp(-it / sTop) + 0.45 * Math.exp(-il / sLeft) + 0.18 * Math.exp(-ib / sHair) + 0.14 * Math.exp(-ir / sHair));
        if (al > 0.004) { out[o] = 12; out[o + 1] = 8; out[o + 2] = 4; out[o + 3] = al * 255; }
        continue;
      }
      const hx = x > 0 && x < cw - 1 ? (Hf[i + 1] - Hf[i - 1]) * 0.5 : 0;
      const hy = y > 0 && y < ch - 1 ? (Hf[i + cw] - Hf[i - cw]) * 0.5 : 0;
      const nl = 1 / Math.sqrt(hx * hx + hy * hy + 1), nx = -hx * nl, ny = -hy * nl, nz = nl;
      const diff = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]) * (1 - 0.85 * sh);
      const px = x + 0.5, py = y + 0.5;
      let r, gg, b;

      if (mat === LINER) {
        let v = (0.28 + 0.85 * diff) * ao;
        if (linen) v *= 1 + 0.07 * Math.sin(px * 2.3) * Math.sin(py * 2.3);
        else v += (1 - nz) * 0.25 + (sample(nFine, px * 3, py * 3) - 0.5) * 0.06;
        r = liner[0] * v; gg = liner[1] * v; b = liner[2] * v;
      } else {
        // Wear: exposure decides where hands and dusting cloths reach — proud carving, sharp ridges,
        // outer edges. Noise is stretched along the moulding so abrasion reads as streaks, not spots.
        const xa = Math.max(0, x - rc), xb = Math.min(cw - 1, x + rc), ya = Math.max(0, y - rc), yb = Math.min(ch - 1, y + rc);
        const conv = (h - 0.25 * (Hf[y * cw + xa] + Hf[y * cw + xb] + Hf[ya * cw + x] + Hf[yb * cw + x])) * convScale;
        const prom = (h - bl) * cavScale;
        const along = d === py - oy ? px : d === ox + Wo - px ? py : d === oy + Ho - py ? -px : -py;
        const wn = sample(nWear, along * wearS * 0.22, d * wearS * 2.2);
        const expo = Math.min(1.6, Math.max(0, prom) * 0.55) + Math.min(0.7, Math.max(0, conv) * 0.12) + (d < Tr * 0.035 ? 0.55 : 0);
        const rub = smooth(0, 0.35, expo * 0.85 + (wn - 0.5) * 0.9 - 1.3 + wearAmt * 1.35);
        if (mat === WOOD) {
          // Carved wood under varnish: grain-figured albedo, diffuse light, a clear-coat highlight.
          const fig = sample(nLow, along * grainA, d * grainD);
          const late = (0.5 + 0.5 * Math.sin(d * ringF + fig * 9)) ** 4;
          const pore = sample(nFine, along * poreA, d * poreD) - 0.5;
          const tone = 1 - wood.grain * (0.55 * late + 0.5 * pore) + 0.12 * (fig - 0.5);
          const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;
          const kd = Math.max(0, rx * KEY[0] + ry * KEY[1] + rz * KEY[2]);
          const up = Math.max(0, -ry);
          const spec = (kd ** wShin * (0.12 + 0.55 * wood.gloss) * (1 - 0.92 * sh) + 0.06 * up * up * wood.gloss) * ao * 255;
          const v = (0.27 + 0.9 * diff) * ao * tone;
          r = wood.rgb[0] * v + spec; gg = wood.rgb[1] * v + spec * 0.94; b = wood.rgb[2] * v + spec * 0.84;
          if (rub > 0) { // finish worn through: paler, drier bare wood on the exposed spots
            const t = rub * 0.7;
            r += (Math.min(255, wood.rgb[0] * 1.7 + 30) * v - r) * t;
            gg += (Math.min(255, wood.rgb[1] * 1.7 + 22) * v - gg) * t;
            b += (Math.min(255, wood.rgb[2] * 1.6 + 12) * v - b) * t;
          }
        } else {
          // Metallic gilt: what you see is the studio reflected in the gold.
          const low = sample(nLow, px * lowS, py * lowS);
          let gloss = burnish * (mat === SAND ? 0.15 : 1) * (1 - Math.min(1, cav * 0.7)) * (0.8 + 0.4 * low);
          if (gloss > 1) gloss = 1;
          const shin = 5 + 110 * gloss * gloss;
          const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;
          const kd = Math.max(0, rx * KEY[0] + ry * KEY[1] + rz * KEY[2]);
          const fd = Math.max(0, rx * FILL[0] + ry * FILL[1] + rz * FILL[2]);
          const key = kd ** shin * (0.55 + shin * 0.022) * 2.2 * (1 - 0.92 * sh);
          const fill = fd ** (shin * 0.6) * (0.3 + shin * 0.008) * 0.45 * (1 - 0.3 * sh);
          const up = Math.max(0, -ry), ceil = 0.7 * up * up * (1 - 0.6 * sh);
          const front = 0.15 * rz * rz;
          let env = 0.035 + front + ceil + key + fill;
          env = env * (0.5 + 0.5 * gloss) + (0.12 + 0.5 * diff) * (0.5 - 0.5 * gloss);
          // gold-leaf squares: each sheet sits a touch differently; overlaps leave faint seams
          const lu = (px + leafOff) / leafSize, lv = (py + leafOff * 0.7) / leafSize;
          const cu = Math.floor(lu), cvv = Math.floor(lv);
          const sheet = ((Math.imul(cu, 73856093) ^ Math.imul(cvv, 19349663)) >>> 0) / 4294967296;
          const fx = (lu - cu) * leafSize, fy = (lv - cvv) * leafSize;
          const seam = (fx < 1.1 || fy < 1.1) ? 0.9 : 1;
          env *= ao * (0.9 + 0.2 * low) * (0.95 + 0.1 * sheet) * (nz > 0.9 ? seam : 1);
          const ri = Math.round(clamp01(1 - Math.exp(-env * exposure)) * 1024) * 3;
          r = ramp[ri]; gg = ramp[ri + 1]; b = ramp[ri + 2];

          if (rub > 0) {
            const v = (0.4 + 0.75 * diff) * ao;
            const t = rub * (0.6 + 0.4 * sample(nFine, px * 1.7, py * 1.7)); // gold hangs on in the rub
            r += (bole[0] * v - r) * t; gg += (bole[1] * v - gg) * t; b += (bole[2] * v - b) * t;
            const cn = sample(nWear, px * wearS * 0.6 + 97, py * wearS * 0.6 + 41);
            const chip = smooth(0.82, 0.88, cn + 0.08 * wear.chips) * smooth(0.75, 1, rub) * (expo > 0.5 ? 1 : 0);
            if (chip > 0) {
              const gv = (0.5 + 0.55 * diff) * ao;
              r += (gesso[0] * gv - r) * chip; gg += (gesso[1] * gv - gg) * chip; b += (gesso[2] * gv - b) * chip;
            }
          }
        }
        // grime settles in recesses
        const grime = clamp01(cav * 0.55) * wear.grime * (0.35 + wearAmt);
        if (grime > 0) { r += (38 - r) * grime * 0.8; gg += (29 - gg) * grime * 0.8; b += (16 - b) * grime * 0.8; }
      }
      // opened mitre joints
      if (crackW && d < Tr * 0.92 && O[i] < 0.3) {
        const dl = px - ox, dr = ox + Wo - px, dt = py - oy, db = oy + Ho - py;
        // at a mitre the two nearest edges are equidistant: (second-nearest − nearest) ≈ 0
        const sec = Math.min(dl === d ? Infinity : dl, dr === d ? Infinity : dr, dt === d ? Infinity : dt, db === d ? Infinity : db) - d;
        if (sec < crackW) { const f = 0.55 + 0.45 * (sec / crackW); r *= f; gg *= f; b *= f; }
      }
      out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = A[i] * 255;
    }
  }
}

export function result(S) {
  return {
    data: S.out, width: S.cw, height: S.ch, scale: S.k, seed: S.seed, genome: S.g,
    fullWidth: S.fullW, fullHeight: S.fullH, imageX: S.m + S.T, imageY: S.m + S.T, imageWidth: S.W, imageHeight: S.H,
    thickness: S.T, overhang: S.m, finish: S.finish, palette: S.palette,
  };
}

/** Render a frame synchronously on the current thread (browsers, workers, small sizes). */
export function renderFrame(options = {}) {
  const S = setup(options);
  heightRows(S, 0, S.ch);
  relief(S);
  shadeRows(S, 0, S.ch);
  return result(S);
}
