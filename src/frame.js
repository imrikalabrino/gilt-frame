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
import { cornerComposition, centerComposition, centerpiece, cluster, scroll, rosette } from './ornaments.js';
import { ribbon } from './geometry.js';
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
  const h = new Float32Array(n), mat = new Uint8Array(n), band = new Int16Array(n).fill(-1), tex = new Uint8Array(n);
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
    // pilaster flutes: n concave channels separated by narrow fillets
    fluted: (u, b) => { const t = (u * b.flutes) % 1, c = (t - 0.5) / 0.4; return Math.abs(c) < 1 ? (-b.relief * 0.5 * Math.sqrt(1 - c * c)) / b.flutes : 0; },
  };
  const bands = [];
  let d = 0, level = 0, projEnd = 0;
  const fill = (d0, d1, fn, m, bi) => {
    for (let i = Math.floor(d0 * res); i < Math.min(n, Math.ceil(d1 * res)); i++) {
      const u = clamp01((i / res - d0) / (d1 - d0));
      h[i] = fn(u); mat[i] = m; band[i] = bi;
    }
  };
  g.bands.forEach((b, bi) => {
    const w = (b.w / total) * goldT, f = shapes[b.shape], L = level;
    fill(d, d + w, (u) => L + w * f(u, b), b.matte > 0 ? SAND : GOLD, bi);
    if (b.texture === 'hammer') tex.fill(1, Math.floor(d * res), Math.min(n, Math.ceil((d + w) * res)));
    if (b.proj) projEnd = d + w;
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
  return { h, mat, band, tex, res, bands, projEnd, hole: min - 0.06 * T, low: h[0] - 0.3 * T };
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
  const g = makeGenome(seed, options.style);
  const th = options.thickness ?? g.thickness;
  const T = Math.max(8, Math.round(th > 1 ? th : Math.min(W, H) * th));
  const m = Math.round(T * (options.overhang ?? g.overhang));
  // tabernacle frames are taller at the top (entablature) and bottom (plinth) than at the sides
  const Tt = g.tab ? Math.round(T * g.tab.hTop) : T, Tb = g.tab ? Math.round(T * g.tab.hBottom) : T;
  const fin = resolveFinish(g, options);
  return {
    seed, genome: g, style: g.style, finish: fin.kind, palette: fin.kind === 'wood' ? fin.woodName : fin.kind === 'parcel' ? `${fin.woodName}+${fin.goldName}` : fin.goldName,
    fullWidth: W + 2 * T + 2 * m, fullHeight: H + Tt + Tb + 2 * m,
    imageX: m + T, imageY: m + Tt, imageWidth: W, imageHeight: H, thickness: T, thicknessTop: Tt, thicknessBottom: Tb, overhang: m,
  };
}

/**
 * Phase 0 (serial, cheap): genome, layout, lookup tables, band tiles. All pixel buffers are
 * allocated through `alloc` so a caller can back them with SharedArrayBuffer and run the
 * row phases on several threads. The returned state is plain, structured-cloneable data.
 */
export function setup(options = {}, alloc = ALLOC) {
  const L = frameLayout(options);
  const { seed, genome: g, imageWidth: W, imageHeight: H, thickness: T, thicknessTop: Tt, thicknessBottom: Tb, overhang: m, fullWidth: fullW, fullHeight: fullH } = L;
  const wear = { ...g.wear, amount: options.wear ?? g.wear.amount };
  const fin = resolveFinish(g, options);
  // Detail budget: the frame is rendered with at most `maxThickness` px of moulding, then upscaled.
  const k = Math.min(1, (options.maxThickness ?? 420) / Math.max(T, Tt, Tb));
  const cw = Math.max(1, Math.round(fullW * k)), ch = Math.max(1, Math.round(fullH * k));
  const Tr = T * k, Ttr = Tt * k, Tbr = Tb * k, ox = m * k, oy = m * k, Wo = (W + 2 * T) * k, Ho = (H + Tt + Tb) * k;
  const inner = [ox + Tr, oy + Ttr, ox + Wo - Tr, oy + Ho - Tbr];
  const N = cw * ch;

  const P = profile(g, Tr);
  const rng = createRng(seed);
  const shared = (src) => { const a = new Float32Array(alloc(src.byteLength)); a.set(src); return a; };
  const nLow = shared(makeNoise(rng.fork('n-low'), { cells: 4, octaves: 4 }));
  const nFine = shared(makeNoise(rng.fork('n-fine'), { cells: 16, octaves: 4 }));
  const nWear = shared(makeNoise(rng.fork('n-wear'), { cells: 8, octaves: 5 }));
  const rampFn = goldRamp(fin.gold), ramp = new Float32Array(1025 * 3);
  for (let i = 0; i <= 1024; i++) ramp.set(rampFn(i / 1024), i * 3);

  // band runs: one periodic tile per decorated band; `lengths(dc)` gives the run length per side
  const makeRuns = (bands, lengths) => bands.map((b) => {
    if (!b.motif) return null;
    const bw = b.d1 - b.d0;
    if (bw < 3) return null;
    const inset = bw * 0.05, B = bw - 2 * inset, mo = bandMotif(b.motif, B);
    const tile = new Tile(0, -B * 0.1, mo.len, B * 1.2, { ss: B > 40 ? 1 : 2, wrapX: true, relief: mo.relief ?? 0.9, hCap: B * (mo.hCap ?? 0.42) }).addAll(mo.els).finish();
    const dc = (b.d0 + b.d1) / 2;
    const sx = lengths(dc).map((L) => L / (Math.max(1, Math.round(L / mo.len)) * mo.len));
    return { tile, dm: b.d0 + inset, dc, sx };
  });
  const runs = makeRuns(P.bands, (dc) => [Wo - 2 * dc, Ho - 2 * dc, Wo - 2 * dc, Ho - 2 * dc]);
  const lutOf = (Q) => ({ h: Q.h, mat: Q.mat, band: Q.band, tex: Q.tex, res: Q.res, projEnd: Q.projEnd });
  let tab = null;
  if (g.tab) {
    const top = profile({ bands: g.tab.top, liner: null }, Ttr), bot = profile({ bands: g.tab.bottom, liner: null }, Tbr);
    const pr = ox * 0.92; // cornice / base projection past the sides
    tab = {
      top: lutOf(top), bot: lutOf(bot), pr, sideDrop: Tr * 0.06,
      topRuns: makeRuns(top.bands, () => [Wo + 2 * pr]), botRuns: makeRuns(bot.bands, () => [Wo + 2 * pr]),
      flute: P.bands.find((b) => b.shape === 'fluted'),
    };
  }

  const q = 4, qw = Math.ceil(cw / q), qh = Math.ceil(ch / q);
  const L2 = Math.hypot(KEY[0], KEY[1]);
  const steps = [];
  for (let t = 1.2; t < Math.max(4, Tr * 0.22); t *= 1.38) steps.push(t);

  return {
    seed, g, W, H, T, m, k, fullW, fullH, cw, ch, Tr, Ttr, Tbr, ox, oy, Wo, Ho, inner, tab, style: g.style,
    reach: Tr * 0.32,
    prof: { ...lutOf(P), hole: P.hole, low: P.low },
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
    D: new Float32Array(alloc(N * 4)), O: new Float32Array(alloc(N * 4)), BQ: new Float32Array(alloc(qw * qh * 4)), SD: new Uint8Array(alloc(N)),
    out: new Uint8ClampedArray(alloc(N * 4)),
  };
}

// Rows that cross the picture opening only need the frame plus a margin for its cast shadow;
// the opening's interior never influences the result, so every pass skips it.
function spans(S, y) {
  const py = y + 0.5, [ix0, iy0, ix1, iy1] = S.inner;
  if (py < iy0 + S.reach || py > iy1 - S.reach) return [0, S.cw, S.cw, S.cw];
  return [0, Math.min(S.cw, Math.ceil(ix0 + S.reach)), Math.max(0, Math.floor(ix1 - S.reach)), S.cw];
}

/** Phase 1 (row-parallel): moulding profile + band relief. */
export function heightRows(S, y0, y1) {
  if (S.tab) return tabernacleRows(S, y0, y1);
  const { cw, ox, oy, Wo, Ho, Tr, prof: P, runs, nFine, Hf, A, M, D, SD, finish, sightBand } = S;
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
      SD[i] = side;
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
      if (mat === SAND) h += P.tex[li] ? hammered(nFine, px, py, Tr) : (sample(nFine, px * 2.1, py * 2.1) - 0.5) * 0.9;
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

// punched / hammered ground of a frieze: overlapping dimples at a scale tied to the moulding
const hammered = (n, px, py, T) => {
  const s = 256 / Math.max(24, T * 0.9);
  return -Math.abs(sample(n, px * s, py * s) - 0.5) * T * 0.035 - (sample(n, px * s * 2.7 + 50, py * s * 2.7) - 0.5) * T * 0.01;
};

/**
 * Tabernacle members: entablature on top and plinth below run the full width (butt-jointed), with
 * their cornice / base mouldings projecting past the sides; fluted pilasters fill the sides between.
 */
function tabernacleRows(S, y0, y1) {
  const { cw, ox, oy, Wo, Ho, Tr, Ttr, Tbr, tab, prof: SP, nFine, Hf, A, M, D, SD, finish, inner } = S;
  const [ix0, iy0, ix1, iy1] = inner, s2 = [0, 0];
  const at = (L, d) => Math.min(L.h.length - 1, Math.max(0, Math.round(d * L.res)));
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5, vt = py - oy, vb = oy + Ho - py, sp = spans(S, y);
    Hf.fill(SP.hole, y * cw, (y + 1) * cw);
    D.fill(Infinity, y * cw, (y + 1) * cw);
    for (let x = sp[0]; x < sp[3]; x++) {
      if (x === sp[1]) { x = sp[2] - 1; continue; }
      const i = y * cw + x, px = x + 0.5;
      let L = null, d = 0, side = 0, along = 0, runs = null, edge = Infinity;
      if (vt > -0.5 && vt < Ttr + 0.5 && (px > ox - 0.5 && px < ox + Wo + 0.5 || vt < tab.top.projEnd && px > ox - tab.pr - 0.5 && px < ox + Wo + tab.pr + 0.5)) {
        L = tab.top; d = vt; side = 0; along = px - ox + tab.pr; runs = tab.topRuns;
        edge = vt < tab.top.projEnd ? Math.min(px - (ox - tab.pr), ox + Wo + tab.pr - px) : Math.min(px - ox, ox + Wo - px);
      } else if (vb > -0.5 && vb < Tbr + 0.5 && (px > ox - 0.5 && px < ox + Wo + 0.5 || vb < tab.bot.projEnd && px > ox - tab.pr - 0.5 && px < ox + Wo + tab.pr + 0.5)) {
        L = tab.bot; d = vb; side = 2; along = px - ox + tab.pr; runs = tab.botRuns;
        edge = vb < tab.bot.projEnd ? Math.min(px - (ox - tab.pr), ox + Wo + tab.pr - px) : Math.min(px - ox, ox + Wo - px);
      } else if (px > ox - 0.5 && px < ox + Tr + 0.5 && py > iy0 && py < iy1) {
        L = SP; d = px - ox; side = 3;
      } else if (px > ox + Wo - Tr - 0.5 && px < ox + Wo + 0.5 && py > iy0 && py < iy1) {
        L = SP; d = ox + Wo - px; side = 1;
      }
      if (!L) {
        if (px > ix0 && px < ix1 && py > iy0 && py < iy1) M[i] = HOLE; else Hf[i] = SP.low;
        continue;
      }
      D[i] = Math.min(d, edge);
      SD[i] = side;
      const li = at(L, Math.max(0, d));
      let h = L.h[li] - (L === SP ? tab.sideDrop : 0);
      let mat = L.mat[li];
      const bi = L.band[li];
      let carved = 0;
      if (runs && bi >= 0 && runs[bi]) {
        const r = runs[bi];
        sampleTile(r.tile, along / r.sx[0], d - r.dm, s2);
        h += s2[0]; carved = s2[1];
      }
      if (mat === SAND) h += L.tex[li] ? hammered(nFine, px, py, Tr) : (sample(nFine, px * 2.1, py * 2.1) - 0.5) * 0.9;
      if (finish !== 'gold' && (mat === GOLD || mat === SAND)) mat = finish === 'parcel' && (carved > 0.45 || bi === L.band[L.band.length - 2]) ? GOLD : WOOD;
      Hf[i] = h; M[i] = mat;
      A[i] = clamp01(d + 0.5) * clamp01(edge + 0.5);
    }
  }
}

/** Pilaster capital (local: x across the pilaster, y down from the entablature) and base. */
function capitalEls(kind, w, hgt) {
  const els = [
    { p: ribbon([-w * 0.55, w * 0.55], [hgt * 0.06, hgt * 0.06], [hgt * 0.07, hgt * 0.07]), g: false }, // abacus
    { p: ribbon([-w * 0.5, w * 0.5], [hgt * 0.95, hgt * 0.95], [hgt * 0.045, hgt * 0.045]), g: false }, // astragal
  ];
  for (const s of [1, -1]) {
    els.push(...scroll({ P: [s * w * 0.12, hgt * 0.16], Q: [s * w * 0.4, hgt * 0.34], thick: w * 0.06, kind: 'C', turnsA: 0.1, turnsB: 1.5, flip: s > 0, grooved: false }));
  }
  if (kind === 'acanthus') els.push(...cluster({ c: [0, hgt * 0.92], R: hgt * 0.85, n: 1, spread: 0.5, lobes: 4, curl: 1.4, ang: -Math.PI / 2 }));
  else els.push(...scroll({ P: [-w * 0.2, hgt * 0.7], Q: [w * 0.2, hgt * 0.7], thick: w * 0.05, kind: 'S', turnsA: 1, turnsB: 1, bend: 0 }));
  return els;
}
const baseEls = (w, hgt) => [
  { p: ribbon([-w * 0.55, w * 0.55], [hgt * 0.75, hgt * 0.75], [hgt * 0.16, hgt * 0.16]), g: false },
  { p: ribbon([-w * 0.48, w * 0.48], [hgt * 0.35, hgt * 0.35], [hgt * 0.1, hgt * 0.1]), g: false },
];

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
        if (M[i] === HOLE) continue;
        const qx = x + 0.5 - e, qy = y + 0.5 - f;
        sampleTile(tile, a * qx + b * qy, c * qx + dd * qy, s2); // Mᵀ = M⁻¹ for these orthogonal maps
        const cov = s2[1];
        if (cov < 0.004) continue;
        const cur = Hf[i], base = S.tab ? cur : lut(Math.max(0, d));
        const hn = Math.max(cur, base) + s2[0] + standoff;
        const w = smooth(0, 0.7, cov);
        if (hn > cur) Hf[i] = cur + (hn - cur) * w;
        if (cov > A[i]) A[i] = cov;
        if (cov > O[i]) O[i] = cov;
        if (cov > 0.5 || !M[i]) M[i] = S.finish === 'wood' ? WOOD : GOLD;
      }
    }
  };
  const cs = g.corner ? Math.min(1, (0.42 * Math.min(Wo, Ho)) / (g.corner.len * Tr)) : 0;
  if (g.corner) {
    const cornerTile = compTile(cornerComposition(g.corner, Tr * cs, m * k), Tr * cs);
    for (const M4 of [[1, 0, 0, 1, ox, oy], [-1, 0, 0, 1, ox + Wo, oy], [-1, 0, 0, -1, ox + Wo, oy + Ho], [1, 0, 0, -1, ox, oy + Ho]]) stamp(cornerTile, M4);
  }
  if (S.tab) {
    const { Ttr, Tbr, inner: [, iy0, , iy1] } = S, fl = S.tab.flute, w = fl.d1 - fl.d0, cx = (fl.d0 + fl.d1) / 2;
    const cap = compTile(capitalEls(g.tab.capital, w, Math.min(w * 1.6, Tr * 1.1)), Tr);
    const base = compTile(baseEls(w, Math.min(w * 0.7, Tr * 0.5)), Tr);
    for (const [sx, x0] of [[1, ox + cx], [-1, ox + Wo - cx]]) {
      stamp(cap, [sx, 0, 0, 1, x0, iy0]);
      stamp(base, [sx, 0, 0, -1, x0, iy1]);
      const ros = compTile(rosette({ c: [0, 0], R: Math.min(Tr, Tbr) * 0.3, petals: 6, lobes: 1, inner: true, curl: 0.3 }), Tr);
      stamp(ros, [1, 0, 0, 1, x0, oy + Ho - Tbr * 0.5]);
    }
    if (g.tab.keystone) {
      const fr = g.tab.top.reduce((a, b) => (b.w > a.w ? b : a));
      const R = Ttr * fr.w * 0.9;
      stamp(compTile(centerpiece(g.tab.piece, [0, 0], -Math.PI / 2, R), R), [1, 0, 0, 1, ox + Wo / 2, oy + Ttr * 0.62]);
    }
  }
  if (g.center) {
    const reach = g.corner ? g.corner.len * Tr * cs : 0, made = new Map();
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
  const edgeH = (S.tab ? S.tab.top : P).h[0];
  const Q = new Float32Array(qw * qh), tmp = new Float32Array(qw * qh);
  for (let y = 0; y < ch; y++) {
    const o = ((y / q) | 0) * qw;
    // empty margin isn't a cliff: treat it as level with the outer edge so rims don't read as proud carving
    for (let x = 0; x < cw; x++) { const i = y * cw + x; Q[o + ((x / q) | 0)] += M[i] ? Hf[i] : edgeH; }
  }
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) Q[y * qw + x] /= Math.min(q, ch - y * q) * Math.min(q, cw - x * q);
  blur(Q, BQ, qw, qh, Math.max(1, (Tr * 0.035) / q), tmp);
}

/** Phase 3 (row-parallel): lighting, materials and wear -> RGBA. */
export function shadeRows(S, y0, y1) {
  const { cw, ch, Tr, ox, oy, Wo, Ho, Hf, A, M, D, O, SD, out, ramp, nLow, nFine, nWear, steps, sdx, sdy, tanE, q, qw, qh, BQ, wear, inner, tab } = S;
  const [ix0, iy0, ix1, iy1] = inner;
  const { burnish, liner, linen, bole, gesso, leafOff, wood } = S;
  // wood figure: rings run along each side (and so turn at the mitres), with long pore streaks
  const grainA = 256 / (Tr * 4), grainD = 256 / (Tr * 0.7), ringF = (2 * Math.PI * wood.rings) / (Tr * 0.055);
  const poreA = 256 / (Tr * 1.2), poreD = 256 / Math.max(2, Tr * 0.035), wShin = 20 + 90 * wood.gloss;
  const cavScale = 1 / (Tr * 0.022), convScale = 1 / Math.max(0.6, Tr * 0.004), rc = Math.max(1, Math.round(Tr * 0.006));
  const rimW = 2 + Tr * 0.015, leafSize = Tr * wear.leaf, wearAmt = wear.amount, crackW = wear.crack ? 0.35 + 0.5 * wearAmt : 0;
  const lowS = 256 / Math.max(32, Tr * 1.6), wearS = 256 / Math.max(16, Tr * 0.45);
  const exposure = 2.5;
  const sTop = Tr * 0.07, sLeft = Tr * 0.05, sHair = Math.max(0.8, Tr * 0.008);
  const crS = 16 / Math.max(6, Tr * 0.06), flakeS = wearS * 0.12, washC = [206, 198, 180];
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
      if (!mat) continue;
      const it = y + 0.5 - iy0, il = x + 0.5 - ix0, ib = iy1 - y - 0.5, ir = ix1 - x - 0.5;
      if (mat === HOLE && Math.min(it, il, ib, ir) > S.reach) continue;
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
        const al = clamp01(0.62 * Math.exp(-it / sTop) + 0.45 * Math.exp(-il / sLeft) + 0.18 * Math.exp(-ib / sHair) + 0.14 * Math.exp(-ir / sHair));
        if (al > 0.004) { out[o] = 12; out[o + 1] = 8; out[o + 2] = 4; out[o + 3] = al * 255; }
        continue;
      }
      // Slopes and ridges only look at solid neighbours: the empty margin and the picture opening
      // aren't surface, and treating them as a cliff turns the 1px edge fringe into a fake ridge.
      const nb = (j) => (M[j] && M[j] !== HOLE ? Hf[j] : h);
      const hx = x > 0 && x < cw - 1 ? (nb(i + 1) - nb(i - 1)) * 0.5 : 0;
      const hy = y > 0 && y < ch - 1 ? (nb(i + cw) - nb(i - cw)) * 0.5 : 0;
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
        const conv = (h - 0.25 * (nb(y * cw + xa) + nb(y * cw + xb) + nb(ya * cw + x) + nb(yb * cw + x))) * convScale;
        const prom = (h - bl) * cavScale;
        const sd = SD[i], along = sd === 0 ? px : sd === 1 ? py : sd === 2 ? -px : -py;
        const wn = sample(nWear, along * wearS * 0.22, d * wearS * 2.2);
        const carved = Math.min(1.6, Math.max(0, prom) * 0.55) + Math.min(0.7, Math.max(0, conv) * 0.12);
        const expo = carved + (d < Tr * 0.035 ? 0.55 : 0);
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
            // Chips are where a flake of gesso broke away: coarse blobs on the proudest carving only.
            // Fine noise or thin features would make them read as stray specks, so neither is used.
            const cn = sample(nWear, px * wearS * 0.2 + 97, py * wearS * 0.2 + 41);
            const chip = smooth(0.86, 0.9, cn + 0.06 * wear.chips) * smooth(0.85, 1, rub) * smooth(0.8, 1.1, carved) * (d > rimW && -Math.min(it, il, ib, ir) > rimW ? 1 : 0);
            if (chip > 0) {
              const gv = (0.5 + 0.55 * diff) * ao;
              r += (gesso[0] * gv - r) * chip; gg += (gesso[1] * gv - gg) * chip; b += (gesso[2] * gv - b) * chip;
            }
          }
        }
        if (mat !== WOOD) {
          // craquelure: the gesso under the leaf cracks into a fine network on the flatter surfaces
          if (wear.crackle && nz > 0.8) {
            const c1 = Math.abs(sample(nFine, px * crS, py * crS) - 0.5), c2 = Math.abs(sample(nFine, py * crS * 0.8 + 90, px * crS * 0.8 + 30) - 0.5);
            const line = 1 - smooth(0, 0.014, Math.min(c1, c2));
            if (line > 0) { const f = 1 - 0.32 * line * wear.crackle * smooth(0.1, 0.6, wearAmt); r *= f; gg *= f; b *= f; }
          }
          // flaking: whole patches of leaf lost to the white gesso, more at the edges and lower rails
          if (wear.flake) {
            // streaked along the moulding and concentrated on edges / the lower rail, like real losses
            const fn = sample(nWear, along * flakeS * 0.35 + 31, d * flakeS * 2.5 + 71);
            const thr = 0.9 - 0.2 * wear.flake * (0.2 + wearAmt) - 0.09 * (1 - smooth(0, Tr * 0.14, d)) - (sd === 2 ? 0.035 : 0);
            if (fn > thr - 0.02 && d > rimW) {
              const gv = (0.5 + 0.55 * diff) * ao, t = smooth(thr, thr + 0.012, fn);
              const lip = fn < thr ? 0.78 : 1; // the lifted edge of the surviving leaf casts a hairline
              r = (r + (gesso[0] * 0.86 * gv - r) * t) * lip; gg = (gg + (gesso[1] * 0.82 * gv - gg) * t) * lip; b = (b + (gesso[2] * 0.72 * gv - b) * t) * lip;
            }
          }
        }
        // what settles in the recesses: dark grime, or on limed / gesso-washed frames a pale residue
        const grime = clamp01(cav * 0.55) * wear.grime * (0.35 + wearAmt);
        if (wear.wash) {
          const w = clamp01(cav * 0.8) * (0.55 + 0.6 * wearAmt), v = 0.55 + 0.5 * diff;
          r += (washC[0] * v - r) * w * 0.85; gg += (washC[1] * v - gg) * w * 0.85; b += (washC[2] * v - b) * w * 0.85;
        } else if (grime > 0) { r += (38 - r) * grime * 0.8; gg += (29 - gg) * grime * 0.8; b += (16 - b) * grime * 0.8; }
      }
      // butt joints of a tabernacle: a fine dark seam where members meet
      if (tab && O[i] < 0.3 && ((y > 0 && M[i - cw] && M[i - cw] !== HOLE && SD[i - cw] !== SD[i]) || (x > 0 && M[i - 1] && M[i - 1] !== HOLE && SD[i - 1] !== SD[i]))) { r *= 0.55; gg *= 0.55; b *= 0.55; }
      // opened mitre joints
      if (!tab && crackW && d < Tr * 0.92 && O[i] < 0.3) {
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
    fullWidth: S.fullW, fullHeight: S.fullH, imageX: S.m + S.T, imageY: S.m + Math.round(S.Ttr / S.k), imageWidth: S.W, imageHeight: S.H,
    thickness: S.T, thicknessTop: S.Ttr / S.k, thicknessBottom: S.Tbr / S.k, overhang: S.m, style: S.style, finish: S.finish, palette: S.palette,
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
