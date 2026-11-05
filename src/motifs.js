// Repeating band motifs. Each returns one periodic tile in band space:
// x ∈ [0, len) along the moulding, y ∈ [0, B] from the band's outer edge inward,
// as an ordered element list (see ornaments.js). Elements may overhang the tile; the
// heightfield wraps them so the run is seamless.

import { TAU, ribbon, circle } from './geometry.js';
import { leaf, scroll, shell } from './ornaments.js';

const lerp = (a, b, t) => a + (b - a) * t;
const body = (p) => ({ p, g: false });

function ellipse(cx, cy, rx, ry) {
  const n = Math.max(20, Math.min(128, Math.round(Math.max(rx, ry) * 1.6))), p = [];
  for (let i = 0; i < n; i++) p.push(cx + rx * Math.cos((TAU * i) / n), cy + ry * Math.sin((TAU * i) / n));
  return p;
}

function strand(x0, y0, x1, y1, hwMax, pow, grow = 0) {
  const X = [], Y = [], hw = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    X.push(lerp(x0, x1, u)); Y.push(lerp(y0, y1, u));
    hw.push(hwMax * Math.sin(Math.PI * Math.min(0.995, Math.max(0.005, u))) ** pow * (1 - grow + grow * u));
  }
  return ribbon(X, Y, hw);
}

/** Teardrop along a quadratic curve P0 -> P1 bending through C (fat at the start, tapering). */
function drop(P0, C, P1, hwMax, taper = 0.65) {
  const X = [], Y = [], hw = [];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32, a = (1 - u) ** 2, b = 2 * u * (1 - u), c = u * u;
    X.push(a * P0[0] + b * C[0] + c * P1[0]); Y.push(a * P0[1] + b * C[1] + c * P1[1]);
    hw.push(hwMax * Math.sin(Math.PI * Math.min(0.995, Math.max(0.005, u))) ** 0.45 * (1 - taper * u));
  }
  return ribbon(X, Y, hw);
}

export function bandMotif(m, B) {
  switch (m.type) {
    case 'pearls': {
      const len = B * (0.95 + 0.35 * m.aspect), r = B * 0.4 * (0.88 + 0.14 * m.size);
      return { len, els: [body(ellipse(len / 2, B / 2, Math.min(r * (1 + 0.35 * m.slant), len * 0.47), r))] };
    }
    case 'reel': {
      const len = B * (1.6 + 0.6 * m.aspect);
      return { len, els: [body(ellipse(B * 0.1, B / 2, B * 0.08, B * 0.3)), body(ellipse(-B * 0.1, B / 2, B * 0.08, B * 0.3)), body(ellipse(len / 2, B / 2, len * 0.3, B * 0.38))] };
    }
    case 'rope': {
      const len = B * (0.4 + 0.45 * m.aspect), sx = len * (1.2 + 1.2 * m.slant) * (m.flip ? -1 : 1);
      return { len, els: [body(strand(len / 2 - sx / 2, B * 1.04, len / 2 + sx / 2, -B * 0.04, len * 0.62, 0.5))] };
    }
    case 'gadroon': {
      const len = B * (0.3 + 0.35 * m.aspect), sx = m.variant ? len * 1.6 * m.slant * (m.flip ? -1 : 1) : 0;
      return { len, els: [body(strand(len / 2 - sx / 2, B * 0.98, len / 2 + sx / 2, B * 0.02, len * 0.47, 0.3, m.invert ? 0.5 : 0))] };
    }
    case 'eggdart': {
      const len = B * (0.85 + 0.4 * m.aspect), cx = len / 2, cy = B * 0.47, s = m.invert ? -1 : 1;
      const rx = len * 0.29, ry = B * 0.33, egg = [], cup = [];
      for (let i = 0; i < 48; i++) {
        const t = (TAU * i) / 48;
        egg.push(cx + rx * Math.cos(t) * (1 - 0.16 * s * Math.sin(t)), cy + ry * Math.sin(t));
      }
      for (let i = 0; i <= 24; i++) {
        const t = lerp(-0.35, Math.PI + 0.35, i / 24);
        cup.push(cx + len * 0.44 * Math.cos(t), cy + s * B * 0.46 * Math.sin(t));
      }
      for (let i = 24; i >= 0; i--) {
        const t = lerp(-0.2, Math.PI + 0.2, i / 24);
        cup.push(cx + rx * 1.16 * Math.cos(t), cy + s * ry * 1.16 * Math.sin(t));
      }
      const dart = [0, B * 0.06, len * 0.06, B * 0.55, 0, B * 0.97, -len * 0.06, B * 0.55];
      return { len, els: [body(cup), body(dart), body(egg)] };
    }
    case 'leaves': {
      const len = B * (0.45 + 0.45 * m.aspect);
      const els = [];
      if (m.variant) els.push(body(strand(0, m.invert ? B : 0, 0, m.invert ? B * 0.3 : B * 0.7, len * 0.09, 0.6)));
      els.push(...leaf({ base: [len / 2, m.invert ? B * 0.99 : B * 0.01], ang: m.invert ? -Math.PI / 2 : Math.PI / 2, len: B * 0.97, w: len * 0.46, lobes: Math.max(0, m.lobes - 2), depth: m.depth * 0.6, curl: m.curl * 0.25, veins: false }));
      return { len, els };
    }
    case 'acanthus': {
      const len = B * (1.6 + 1.4 * m.aspect), dir = m.flip ? -1 : 1;
      return { len, els: leaf({ base: [dir > 0 ? -0.06 * len : len * 1.06, B * 0.52], ang: dir > 0 ? 0 : Math.PI, len: len * 1.28, w: B * 0.42, lobes: m.lobes, depth: m.depth, curl: m.curl * dir, bend: 0.2 * dir }) };
    }
    case 'rinceau': {
      const len = B * (2.2 + 1.2 * m.aspect), amp = B * 0.2, hwS = B * 0.06;
      const X = [], Y = [], hw = [];
      for (let i = 0; i <= 64; i++) {
        const x = lerp(-0.05, 1.05, i / 64) * len;
        X.push(x); Y.push(B / 2 + amp * Math.sin((TAU * x) / len)); hw.push(hwS);
      }
      const els = [body(ribbon(X, Y, hw))];
      for (const s of [1, -1]) {
        const ox = s > 0 ? 0 : len / 2, y = (v) => (s > 0 ? v : B - v);
        els.push(...scroll({ P: [ox + len * 0.08, y(B / 2 + amp * Math.sin(TAU * 0.08))], Q: [ox + len * 0.34, y(B * 0.27)], thick: B * 0.055, kind: 'C', turnsA: 0.05, turnsB: 1.3 + 0.4 * m.size, flip: s < 0 }));
        els.push(...leaf({ base: [ox + len * 0.2, y(B / 2 + amp * 0.95)], ang: s > 0 ? 0.25 : -0.25, len: len * 0.26, w: B * 0.15, lobes: 3, depth: 0.35, curl: 0.8 * s }));
      }
      return { len, els };
    }
    case 'ripple': {
      // Auricular lobes: a fat teardrop sweeping across the cove, a round drop and a crescent nestled beside it.
      const len = B * (1.0 + 0.5 * m.aspect), f = m.flip ? -1 : 1, X = (v) => (f > 0 ? v : len - v);
      const sw = 0.35 + 0.3 * m.slant;
      return {
        len, hCap: 0.38, relief: 1.1,
        els: [
          body(drop([X(len * 0.12), B * 0.1], [X(len * (0.2 + sw)), B * 0.42], [X(len * (0.55 + sw * 0.4)), B * 0.94], len * 0.3)),
          body(drop([X(len * 0.78), B * 0.08], [X(len * 0.95), B * 0.2], [X(len * 1.02), B * 0.4], len * 0.13, 0.4)),
          body(circle(X(len * 0.2), B * 0.76, B * (0.12 + 0.04 * m.size))),
        ],
      };
    }
    case 'compo': {
      // Victorian composition ornament: a scrolling stem dense with small leaves, curls and berries, in low relief.
      const len = B * (1.4 + 0.8 * m.aspect), amp = B * 0.2;
      const X = [], Y = [], hw = [];
      for (let i = 0; i <= 64; i++) {
        const x = lerp(-0.05, 1.05, i / 64) * len;
        X.push(x); Y.push(B / 2 + amp * Math.sin((TAU * x) / len)); hw.push(B * 0.045);
      }
      const els = [body(ribbon(X, Y, hw))];
      for (const s of [1, -1]) {
        const ox = s > 0 ? 0 : len / 2, y = (v) => (s > 0 ? v : B - v);
        els.push(...scroll({ P: [ox + len * 0.1, y(B / 2 + amp * 0.6)], Q: [ox + len * 0.3, y(B * 0.22)], thick: B * 0.04, kind: 'C', turnsA: 0.05, turnsB: 1.1 + 0.5 * m.size, flip: s < 0, grooved: false }));
        for (const [t, a] of [[0.18, -0.6], [0.36, 0.5]]) {
          els.push(...leaf({ base: [ox + len * t, y(B / 2 + amp * Math.sin(TAU * t))], ang: s * a + (s > 0 ? 0 : Math.PI), len: B * 0.32, w: B * 0.1, lobes: 3, depth: 0.4, curl: 0.9 * s, veins: false }));
        }
        els.push(body(circle(ox + len * 0.42, y(B * 0.8), B * 0.06)));
      }
      return { len, els, hCap: 0.17, relief: 0.8 };
    }
    case 'dentils': {
      const len = B * (0.75 + 0.3 * m.aspect), a = len * 0.2, b = len * 0.8;
      return { len, hCap: 0.32, relief: 1, els: [body([a, B * 0.05, b, B * 0.05, b, B * 0.95, a, B * 0.95])] };
    }
    case 'shells':
    default: {
      const len = B * (1.1 + 0.6 * m.aspect);
      return { len, els: [body(circle(0, B * 0.75, B * 0.1)), ...shell({ hinge: [len / 2, B * 0.9], ang: -Math.PI / 2, R: B * 0.78, ribs: 5 + (m.lobes % 3), spread: 2.3 + m.slant * 0.6, lobe: 0.3, fall: 0.15, asym: 0, ears: false })] };
    }
  }
}
