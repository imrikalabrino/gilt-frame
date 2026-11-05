// Colour helpers: HSL, and the gilt tone ramp the renderer maps reflected light through.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp01(s); l = clamp01(l);
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * x∈[0,1] (tone-mapped reflected light) -> sRGB. Anchors follow photographed water gilding:
 * near-black umber in the crevices, saturated orange-gold midtones, pale straw highlights.
 */
export function goldRamp({ hue, sat, antique, warmth, lift = 0 }) {
  const dh = (hue - 42) * 0.8, sm = sat / 0.68;
  // [x, hue, sat, lightness]
  const ctrl = [
    [0.0, 24, 0.7, 0.045], [0.12, 27, 0.74, 0.1], [0.28, 30, 0.78, 0.21], [0.45, 34, 0.74, 0.35],
    [0.6, 38, 0.7, 0.47], [0.74, 42, 0.72, 0.61], [0.86, 45 + warmth * 0.5, 0.78, 0.76], [1.0, 48 + warmth, 0.85, 0.91],
  ];
  const pts = ctrl.map(([x, h, s, l]) => {
    const dark = 1 - x;
    const L = l * (1 - 0.3 * antique * dark * dark);
    return [x, hsl(h + dh - 4 * antique * dark, Math.min(1, s * sm * (1 - 0.3 * antique)), L + lift * (1 - L) * x)];
  });
  const table = new Array(1025);
  for (let i = 0; i <= 1024; i++) {
    const x = i / 1024;
    let j = 1;
    while (j < pts.length - 1 && pts[j][0] < x) j++;
    const [x0, c0] = pts[j - 1], [x1, c1] = pts[j];
    table[i] = mix(c0, c1, clamp01((x - x0) / (x1 - x0)));
  }
  return (x) => table[Math.round(clamp01(x) * 1024)];
}

export const LINERS = {
  crimson: [348, 0.55, 0.24],
  bordeaux: [340, 0.45, 0.17],
  forest: [150, 0.32, 0.18],
  navy: [222, 0.4, 0.19],
  ebony: [30, 0.12, 0.08],
  linen: [42, 0.22, 0.74],
  ochre: [36, 0.35, 0.42],
};

/** Gold leaf alloys / tones. hue & sat steer the ramp; lift pales the upper tones; antique dulls it. */
export const GOLDS = {
  classic: { hue: 42, sat: 0.68 },
  rich: { hue: 37, sat: 0.84, warmth: 2 },
  rose: { hue: 29, sat: 0.62, warmth: -2 },
  pale: { hue: 46, sat: 0.42, lift: 0.14, warmth: 4 },
  green: { hue: 50, sat: 0.52, warmth: 3 },
  bronze: { hue: 33, sat: 0.5, antique: 0.75 },
};

/** Carving woods: base colour [h, s, l], grain contrast, ring density, varnish gloss. */
export const WOODS = {
  walnut: { color: [27, 0.42, 0.2], grain: 0.5, rings: 1, gloss: 0.6 },
  mahogany: { color: [11, 0.55, 0.22], grain: 0.35, rings: 0.7, gloss: 0.8 },
  oak: { color: [34, 0.45, 0.4], grain: 0.55, rings: 1.4, gloss: 0.4 },
  cherry: { color: [17, 0.5, 0.3], grain: 0.3, rings: 0.8, gloss: 0.7 },
  ebony: { color: [25, 0.12, 0.07], grain: 0.25, rings: 0.6, gloss: 0.9 },
  honey: { color: [36, 0.55, 0.5], grain: 0.45, rings: 1.2, gloss: 0.5 },
  rosewood: { color: [6, 0.42, 0.15], grain: 0.6, rings: 1.1, gloss: 0.75 },
};
