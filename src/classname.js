// The settings class: `gilt-frame-<seed>-w<wear%>-<style>-<finish>-<palette>[-t<thickness>][-o<overhang>]`,
// e.g. `gilt-frame-e8wffc1rds-w0-ripple-gold-classic`. Inspect a frame in devtools, copy the class,
// and parseFrameClass() gives back options that recreate it exactly.

import { escapeSeed, unescapeSeed } from './rng.js';
import { STYLES } from './genome.js';
import { GOLDS, WOODS } from './color.js';

const FINISHES = ['gold', 'wood', 'parcel'];
const num = (v) => String(Math.round(v * 1e4) / 1e4).replace('.', 'p'); // '.' would need escaping in selectors
const unnum = (s) => Number(s.replace('p', '.'));

/** Settings class for a frame layout / rendered frame (as returned by frameLayout / renderFrame). */
export function frameClass(f) {
  const parts = [escapeSeed(f.seed), 'w' + num(f.wear * 100), f.style, f.finish, f.palette.replace('+', '_')];
  if (f.thicknessOption != null) parts.push('t' + num(f.thicknessOption));
  if (f.overhangOption != null) parts.push('o' + num(f.overhangOption));
  return 'gilt-frame-' + parts.join('-');
}

/**
 * Options from a settings class (string, className or classList). Returns null if none found.
 * Pass the result straight back to renderFrame / frameImage / <GiltFrame> with the picture size.
 */
export function parseFrameClass(classList) {
  const list = typeof classList === 'string' ? classList.split(/\s+/) : Array.from(classList);
  const c = list.find((x) => x.startsWith('gilt-frame-'));
  if (!c) return null;
  const [seed, ...rest] = c.slice(11).split('-');
  const o = { seed: unescapeSeed(seed) };
  for (const p of rest) {
    let m;
    if ((m = /^w([\dp]+)$/.exec(p))) o.wear = Number((unnum(m[1]) / 100).toFixed(6));
    else if (STYLES.includes(p)) o.style = p;
    else if (FINISHES.includes(p)) o.finish = p;
    else if (/^t[\dp]+$/.test(p)) o.thickness = unnum(p.slice(1));
    else if (/^o[\dp]+$/.test(p)) o.overhang = unnum(p.slice(1));
    else if (GOLDS[p] || WOODS[p]) o.palette = p;
    else if (/^[a-z]+_[a-z]+$/.test(p) && WOODS[p.split('_')[0]]) o.palette = p.split('_')[0]; // parcel: wood_gold (gold follows the seed)
  }
  return o;
}
