// Seeded PRNG: cyrb128 string hash -> sfc32 generator.
// Every subsystem draws from its own forked stream, so a seed always yields the
// same design regardless of image size, and new features don't reshuffle old seeds.

export function hashString(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  return [h1 >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export function createRng(seed) {
  let [a, b, c, d] = hashString(String(seed));
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(entries) {
      let total = 0;
      for (const e of entries) total += e[1];
      let r = next() * total;
      for (const e of entries) if ((r -= e[1]) < 0) return e[0];
      return entries[entries.length - 1][0];
    },
    fork: (label) => createRng(seed + '␟' + label),
  };
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A fresh random seed: 10 base36 chars (~51 bits), always class-name safe. */
export function randomSeed() {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 10; i++) bytes[i] = (Math.random() * 256) | 0;
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[bytes[i] % 36];
  return s;
}

// Seeds are exposed in a CSS class `gilt-frame-<seed>[-<settings>…]`. In the seed, characters
// outside [A-Za-z0-9] (dashes included, since dashes separate the settings) are escaped as
// `_<hex>_`, so any seed string round-trips.
export const escapeSeed = (seed) => String(seed).replace(/[^A-Za-z0-9]/g, (c) => '_' + c.codePointAt(0).toString(16) + '_');
export const unescapeSeed = (s) => s.replace(/_([0-9a-f]+)_/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));

export function seedToClass(seed) {
  return 'gilt-frame-' + escapeSeed(seed);
}

/** The seed from an element's class list / className string (works on full settings classes too). */
export function seedFromClass(classList) {
  const list = typeof classList === 'string' ? classList.split(/\s+/) : Array.from(classList);
  for (const c of list) if (c.startsWith('gilt-frame-')) return unescapeSeed(c.slice(11).split('-')[0]);
  return null;
}
