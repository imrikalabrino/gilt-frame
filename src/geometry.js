// Curve integration and polygon helpers. Polygons are flat [x0,y0,x1,y1,...] arrays.

export const TAU = Math.PI * 2;

/**
 * Integrate a curve of unit arc length from its curvature function k(s), s∈[0,1].
 * Step size adapts so each step turns at most `maxTurn` radians — tight volutes get
 * fine sampling, gentle sweeps stay cheap.
 */
export function integrate(k, maxStep = 1 / 48, maxTurn = 0.2) {
  const X = [0], Y = [0], A = [0], S = [0];
  let x = 0, y = 0, a = 0, s = 0;
  while (s < 1 - 1e-9) {
    let h = Math.min(maxStep, 1 - s);
    const k0 = Math.abs(k(s));
    if (k0 * h > maxTurn) h = maxTurn / k0;
    const km = k(s + h / 2);
    const am = a + (km * h) / 2;
    x += Math.cos(am) * h; y += Math.sin(am) * h; a += km * h; s += h;
    X.push(x); Y.push(y); A.push(a); S.push(s);
  }
  return { X, Y, A, S };
}

/** Similarity transform of a curve in place so that its first point maps to P and last to Q. */
export function fitCurve(c, P, Q, flip = false) {
  const n = c.X.length - 1;
  const sgn = flip ? -1 : 1;
  const dx = c.X[n] - c.X[0], dy = sgn * (c.Y[n] - c.Y[0]);
  const sc = Math.hypot(Q[0] - P[0], Q[1] - P[1]) / (Math.hypot(dx, dy) || 1);
  const rot = Math.atan2(Q[1] - P[1], Q[0] - P[0]) - Math.atan2(dy, dx);
  const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
  const x0 = c.X[0], y0 = c.Y[0];
  for (let i = 0; i <= n; i++) {
    const x = c.X[i] - x0, y = sgn * (c.Y[i] - y0);
    c.X[i] = P[0] + x * cs - y * sn;
    c.Y[i] = P[1] + x * sn + y * cs;
    c.A[i] = sgn * c.A[i] + rot;
  }
  c.scale = sc;
  return c;
}

/** Place a canonical curve: scale, rotate by `ang`, translate to `base`. */
export function placeCurve(c, base, ang, len) {
  const cs = Math.cos(ang) * len, sn = Math.sin(ang) * len;
  for (let i = 0; i < c.X.length; i++) {
    const x = c.X[i], y = c.Y[i];
    c.X[i] = base[0] + x * cs - y * sn;
    c.Y[i] = base[1] + x * sn + y * cs;
    c.A[i] += ang;
  }
  return c;
}

/** Offset a centreline into a closed band polygon; hwL/hwR are per-sample half widths. */
export function ribbon(X, Y, hwL, hwR = hwL, from = 0, to = X.length - 1) {
  const left = [], right = [];
  for (let i = from; i <= to; i++) {
    const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, X.length - 1);
    const dx = X[i1] - X[i0], dy = Y[i1] - Y[i0];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    left.push(X[i] + nx * hwL[i], Y[i] + ny * hwL[i]);
    right.push(X[i] - nx * hwR[i], Y[i] - ny * hwR[i]);
  }
  for (let i = right.length - 2; i >= 0; i -= 2) left.push(right[i], right[i + 1]);
  return left;
}

export function circle(cx, cy, r, n = Math.max(16, Math.min(128, Math.round(r * 1.6)))) {
  const p = [];
  for (let i = 0; i < n; i++) p.push(cx + r * Math.cos((TAU * i) / n), cy + r * Math.sin((TAU * i) / n));
  return p;
}

export function mapPoly(p, fn) {
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    const [x, y] = fn(p[i], p[i + 1]);
    out[i] = x; out[i + 1] = y;
  }
  return out;
}
