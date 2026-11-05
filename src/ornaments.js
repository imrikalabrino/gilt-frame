// Carved elements (volutes, acanthus leaves, shells, rosettes, cabochons) and the corner /
// centre cartouche compositions built from them. Shapes come from integrating curvature
// functions, so every gene value bends the result continuously.
//
// Every builder returns an ordered element list [{p: polygon, g: isGroove}] — order is
// carving order: later bodies rest on earlier ones, grooves cut into what's below them.

import { TAU, integrate, fitCurve, placeCurve, ribbon, circle, mapPoly } from './geometry.js';

const at = (S, s) => {
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] < s) lo = mid; else hi = mid; }
  return s - S[lo] < S[hi] - s ? lo : hi;
};
const body = (p) => ({ p, g: false });
const groove = (p) => ({ p, g: true });
const mapAll = (els, fn) => els.map((e) => ({ p: mapPoly(e.p, fn), g: e.g }));

/** C- or S-volute between two eye centres P and Q. Returns elements plus its centreline `c`. */
export function scroll({ P, Q, thick, kind = 'C', turnsA = 1.2, turnsB = 1.6, bend = 0, flip = false, eyes = true, grooved = true }) {
  const g = 9;
  const a = turnsB * TAU * g, b = (kind === 'C' ? 1 : -1) * turnsA * TAU * g;
  const c = fitCurve(integrate((s) => bend + a * Math.exp(g * (s - 1)) + b * Math.exp(-g * s), 1 / 60, 0.2), P, Q, flip);
  const n = c.X.length, hw = new Array(n), gw = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.sin(Math.PI * c.S[i]) ** 0.6;
    hw[i] = thick * (0.3 + 0.7 * t);
    gw[i] = thick * 0.17 * t;
  }
  const els = [body(ribbon(c.X, c.Y, hw))];
  if (grooved) els.push(groove(ribbon(c.X, c.Y, gw, gw, at(c.S, 0.1), at(c.S, 0.9))));
  if (eyes) {
    if (turnsA > 0.3) els.push(body(circle(c.X[0], c.Y[0], thick * 0.6)));
    els.push(body(circle(c.X[n - 1], c.Y[n - 1], thick * 0.6)));
  }
  els.c = c;
  return els;
}

/** Acanthus-style leaf: lobed outline around a curling spine, with midrib and veins. */
export function leaf({ base, ang, len, w, lobes = 4, depth = 0.35, curl = 0, bend = 0, veins = true }) {
  const c = placeCurve(integrate((s) => bend + curl * 5 * Math.exp(5 * (s - 1)), 1 / (lobes * 14 + 30), 0.15), base, ang, len);
  const n = c.X.length, hw = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = c.S[i];
    const env = (s ** 0.5 * (1 - s) ** 0.9) / 0.4017;
    const lob = lobes ? 1 - depth * (1 - Math.abs(Math.sin(Math.PI * lobes * s))) ** 3 : 1;
    hw[i] = w * env * lob;
  }
  const els = [body(ribbon(c.X, c.Y, hw))];
  const rib = hw.map((_, i) => w * 0.07 * Math.max(0, 1 - c.S[i] / 0.88));
  els.push(groove(ribbon(c.X, c.Y, rib, rib, 1, at(c.S, 0.86))));
  if (veins && lobes > 1) {
    for (let k = 1; k < lobes; k++) {
      const s = k / lobes, i0 = at(c.S, s - 0.1), i1 = at(c.S, s - 0.035), ie = at(c.S, s);
      for (const side of [1, -1]) {
        const dx = c.X[Math.min(ie + 1, n - 1)] - c.X[Math.max(ie - 1, 0)], dy = c.Y[Math.min(ie + 1, n - 1)] - c.Y[Math.max(ie - 1, 0)];
        const l = Math.hypot(dx, dy) || 1, r = hw[ie] * 0.82 * side;
        els.push(groove([c.X[i0], c.Y[i0], c.X[ie] - (dy / l) * r, c.Y[ie] + (dx / l) * r, c.X[i1], c.Y[i1]]));
      }
    }
  }
  return els;
}

/** Rocaille / scallop shell fanning from a hinge along direction `ang`. */
export function shell({ hinge, ang, R, ribs, spread, lobe, fall, asym, ears }) {
  const els = [];
  if (ears) {
    for (const side of [1, -1]) {
      els.push(...scroll({ P: [R * 0.08, side * R * 0.2], Q: [-R * 0.1, side * R * 0.62], thick: R * 0.075, kind: 'C', turnsA: 0.15, turnsB: 1.3, flip: side < 0, grooved: false }));
    }
  }
  const hwBase = spread / ribs / 2;
  for (let i = 0; i < ribs; i++) {
    const t = (i + 0.5) / ribs - 0.5;
    const phi = spread * t + asym * (t * t - 1 / 12) * spread * 2;
    const hw = hwBase * 0.9, Ri = R * (1 - fall * 4 * t * t), r0 = R * 0.15;
    const p = [];
    p.push(r0 * Math.cos(phi + hw * 0.4), r0 * Math.sin(phi + hw * 0.4));
    p.push(r0 * Math.cos(phi - hw * 0.4), r0 * Math.sin(phi - hw * 0.4));
    for (const f of [0.35, 0.7]) p.push(Ri * f * Math.cos(phi - hw), Ri * f * Math.sin(phi - hw));
    const ux = Math.cos(phi), uy = Math.sin(phi), rho = Ri * Math.sin(hw);
    for (let k = 0; k <= 10; k++) {
      const be = -Math.PI / 2 + (Math.PI * k) / 10;
      const a = rho * Math.sin(be), r = rho * (0.35 + lobe) * Math.cos(be);
      p.push(Ri * ux + ux * r - uy * a, Ri * uy + uy * r + ux * a);
    }
    for (const f of [0.7, 0.35]) p.push(Ri * f * Math.cos(phi + hw), Ri * f * Math.sin(phi + hw));
    els.push(body(p));
  }
  els.push(body(circle(R * 0.02, 0, R * 0.17)));
  return place(els, hinge, ang);
}

export function rosette({ c, R, petals, lobes, inner, curl, ang = 0 }) {
  const els = [];
  for (let i = 0; i < petals; i++) {
    const a = ang + (TAU * i) / petals;
    els.push(...leaf({ base: [c[0] + Math.cos(a) * R * 0.1, c[1] + Math.sin(a) * R * 0.1], ang: a, len: R * 0.9, w: R * Math.sin(Math.PI / petals) * 0.85, lobes, depth: 0.3, curl, veins: false }));
  }
  if (inner) {
    for (let i = 0; i < petals; i++) {
      const a = ang + (TAU * (i + 0.5)) / petals;
      els.push(...leaf({ base: c, ang: a, len: R * 0.58, w: R * Math.sin(Math.PI / petals) * 0.6, lobes: 0, curl: -curl, veins: false }));
    }
  }
  els.push(body(circle(c[0], c[1], R * 0.22)));
  return els;
}

export function cabochon({ c, R, aspect, pearls, ang }) {
  const els = [];
  const ry = R * 0.62, rx = ry * aspect, n = Math.max(32, Math.round(R));
  const oval = (k) => { const p = []; for (let i = 0; i < n; i++) p.push(ry * k * Math.cos((TAU * i) / n), rx * k * Math.sin((TAU * i) / n)); return p; };
  if (pearls) {
    const m = Math.max(8, Math.round((Math.PI * (rx + ry)) / (R * 0.16)));
    for (let i = 0; i < m; i++) {
      const a = (TAU * i) / m;
      els.push(body(circle(ry * 1.2 * Math.cos(a), rx * 1.2 * Math.sin(a), R * 0.065)));
    }
  }
  els.push(body(oval(1)), body(oval(0.7)));
  return place(els, c, ang);
}

export function cluster({ c, R, n, spread, lobes, curl, ang }) {
  const els = [];
  for (let k = n; k >= 1; k--) {
    for (const side of [1, -1]) {
      els.push(...leaf({ base: c, ang: ang + side * spread * (k / n), len: R * (0.95 - 0.12 * k), w: R * 0.22, lobes, depth: 0.4, curl: side * curl }));
    }
  }
  els.push(...leaf({ base: c, ang, len: R * 1.1, w: R * 0.26, lobes, depth: 0.35, curl: curl * 0.25 }));
  els.push(body(circle(c[0], c[1], R * 0.13)));
  return els;
}

function place(els, origin, ang) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return mapAll(els, (x, y) => [origin[0] + x * ca - y * sa, origin[1] + x * sa + y * ca]);
}

function centerpiece(g, hinge, ang, R) {
  switch (g.kind) {
    case 'shell': return shell({ hinge, ang, R, ...g.shell });
    case 'rosette': return rosette({ c: hinge, R: R * 0.75, ang, ...g.rosette });
    case 'cabochon': return cabochon({ c: hinge, R: R * 0.8, ang, ...g.cabochon });
    default: return cluster({ c: hinge, R, ang, ...g.cluster });
  }
}

/** One wing of a cartouche: a volute running along the moulding with leaves sprouting from it. */
function wing(w, U, x0, x1, room) {
  const els = [];
  const P = [x0, w.ya * U], Q = [Math.max(x1, x0 + U * 0.4), w.yb * U];
  const thick = w.thick * U;
  // Keep the volute inside the moulding (plus crest room): try the gene's handedness first, then the mirror.
  const spill = (s) => { let lo = Infinity, hi = -Infinity; for (const y of s.c.Y) { lo = Math.min(lo, y); hi = Math.max(hi, y); } return Math.max(-room * 0.6 - lo, hi - U * 0.95, 0); };
  let sc = scroll({ P, Q, thick, kind: w.kind, turnsA: w.turnsA, turnsB: w.turnsB, bend: w.bend, flip: w.flip });
  if (spill(sc) > 0) {
    const alt = scroll({ P, Q, thick, kind: w.kind, turnsA: w.turnsA, turnsB: w.turnsB, bend: w.bend, flip: !w.flip });
    if (spill(alt) < spill(sc)) sc = alt;
  }
  const c = sc.c;
  if (w.terminal) {
    const t = w.terminal;
    els.push(...leaf({ base: Q, ang: t.ang, len: t.len * U, w: t.w * U, lobes: t.lobes, depth: t.depth, curl: t.curl * 0.6, bend: t.bend * 0.5 }));
  }
  if (w.crest) {
    const i = at(c.S, w.crest.s), by = c.Y[i], top = Math.max(by - w.crest.h * U, -room + thick);
    if (by - top > U * 0.18) {
      els.push(...scroll({ P: [c.X[i], by], Q: [c.X[i] + U * 0.32, top], thick: thick * 0.7, kind: 'C', turnsA: 0.1, turnsB: w.crest.turns, flip: w.crest.flip }));
    }
  }
  els.push(...sc);
  for (const l of w.leaves) {
    const i = at(c.S, l.s);
    els.push(...leaf({ base: [c.X[i], c.Y[i]], ang: c.A[i] + l.ang, len: l.len * U, w: l.w * U, lobes: l.lobes, depth: l.depth, curl: l.curl, bend: l.bend }));
  }
  if (w.pearls) {
    const r = w.pearls.size * U;
    let i = at(c.S, w.pearls.s);
    for (let k = 0; k < w.pearls.n; k++) {
      const j = Math.min(c.X.length - 1, i), a = c.A[j];
      els.push(body(circle(c.X[j] - Math.sin(a) * thick * 2.2, c.Y[j] + Math.cos(a) * thick * 2.2, r)));
      i = at(c.S, c.S[j] + (r * 2.3) / (c.scale || 1));
    }
  }
  return els;
}

/**
 * Corner cartouche in top-left corner space (origin = outer corner, x along top, y inward).
 * U = moulding width in px; room = free margin outside the moulding (for crests).
 */
export function cornerComposition(g, U, room) {
  const h = g.depth * U;
  let R = g.piece.size * U * 0.62;
  let hinge, ang;
  if (g.outward) {
    R = Math.min(R, (h + room * 0.85) / 0.82);
    hinge = [h, h]; ang = (-3 * Math.PI) / 4;
  } else {
    hinge = [h * 0.55, h * 0.55]; ang = Math.PI / 4;
  }
  const wg = wing(g.wing, U, h + R * 0.25, g.len * U, room);
  return [...wg, ...mapAll(wg, (x, y) => [y, x]), ...centerpiece(g.piece, hinge, ang, R)];
}

/** Centre cartouche in top-side space (origin = middle of the outer edge). */
export function centerComposition(g, U, room) {
  const h = g.depth * U;
  let R = g.piece.size * U * 0.6;
  let ang = -Math.PI / 2;
  if (g.outward) R = Math.min(R, (h + room * 0.85) / 1.15);
  else ang = Math.PI / 2;
  const wg = wing(g.wing, U, R * 0.45, g.len * U, room);
  return [...wg, ...mapAll(wg, (x, y) => [-x, y]), ...centerpiece(g.piece, [0, h], ang, R)];
}
