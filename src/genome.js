// The "genome": every random design decision, drawn from the seed only.
// Nothing here depends on image dimensions, so one seed = one design at any size/ratio.

import { createRng } from './rng.js';
import { LINERS } from './color.js';

const BAND_W = {
  torus: [0.14, 0.3], cove: [0.07, 0.17], ogee: [0.12, 0.26], flat: [0.09, 0.22],
  bead: [0.028, 0.05], scotia: [0.05, 0.11], bevel: [0.04, 0.08], fluted: [0.5, 0.65],
};

export const STYLES = ['baroque', 'barbizon', 'plain', 'victorian', 'ripple', 'tabernacle'];

function band(r, shape, extra) {
  const [lo, hi] = BAND_W[shape];
  return {
    shape,
    w: r.range(lo, hi),
    relief: shape === 'bead' ? r.range(1.2, 2) : r.range(0.7, 1.6),
    tilt: shape === 'flat' ? r.range(-0.25, 0.2) : shape === 'bevel' ? r.range(-0.7, -0.35) : 0,
    dir: r.sign(),
    step: r.range(-0.012, 0.05), // drop (in moulding widths) from this band to the next — the fillets
    matte: 0,
    ...extra,
  };
}

function motif(r, type) {
  return {
    type,
    aspect: r.next(), size: r.next(), slant: r.next(), lobes: r.int(2, 6), depth: r.range(0.2, 0.5),
    curl: r.range(-1.8, 1.8), flip: r.chance(0.5), variant: r.chance(0.5), invert: r.chance(0.3),
  };
}

function genProfile(r, ro) {
  const bands = [band(r, 'torus', { relief: r.range(1.1, 1.9) })];
  if (r.chance(0.55)) bands.push(band(r, 'bead'));
  const n = r.int(2, 4);
  for (let i = 0; i < n; i++) {
    let shape = r.weighted([['torus', 3], ['cove', 2.5], ['ogee', 2.2], ['flat', 1.6], ['bead', 2], ['scotia', 1]]);
    if (shape === 'bead' && bands[bands.length - 1].shape === 'bead') shape = 'cove';
    bands.push(band(r, shape));
  }
  bands.push(band(r, r.chance(0.6) ? 'bead' : 'bevel'));

  const liner = r.chance(0.32)
    ? { color: LINERS[r.pick(Object.keys(LINERS))], w: r.range(0.1, 0.2), slip: r.chance(0.7) }
    : null;

  // Ornament assignment — big bands get carved runs, small ones pearls / ropes.
  const big = bands
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => i > 0 && b.w >= 0.12 && b.shape !== 'cove' && b.shape !== 'scotia')
    .sort((a, b) => b.b.w - a.b.w);
  const majors = [['acanthus', 3], ['leaves', 2.2], ['gadroon', 2], ['eggdart', 2], ['rinceau', 1.6], ['shells', 1]];
  let budget = 4;
  const used = new Set();
  big.forEach(({ b }, k) => {
    if (budget && ro.chance(k === 0 ? 0.93 : 0.4)) {
      let t = ro.weighted(majors);
      if (used.has(t)) t = ro.weighted(majors);
      used.add(t);
      b.motif = motif(ro, t);
      budget--;
    } else if (b.shape === 'flat') b.matte = ro.range(0.4, 0.9); // sanded frieze
  });
  for (const b of bands) {
    if (b.motif || !budget) continue;
    if (b.shape === 'bead' && ro.chance(0.65)) {
      b.motif = motif(ro, ro.weighted([['pearls', 3], ['rope', 2], ['reel', 1.4]])); budget--;
    } else if (b.shape === 'cove' && b.w > 0.09 && ro.chance(0.3)) {
      b.motif = motif(ro, 'leaves'); budget--;
    }
  }
  if (budget && ro.chance(0.3)) bands[0].motif = motif(ro, ro.pick(['rope', 'gadroon', 'leaves']));
  return { bands, liner };
}

const linerGene = (r, p, linen = 0.3) =>
  r.chance(p) ? { color: LINERS[r.chance(linen) ? 'linen' : r.pick(Object.keys(LINERS))], w: r.range(0.1, 0.2), slip: r.chance(0.8) } : null;

/** Plain moulding: one dominant sweep (cushion, scoop or ogee), no carving — wear does the talking. */
function plainProfile(r) {
  const bands = [band(r, r.chance(0.6) ? 'torus' : 'bevel', { w: r.range(0.06, 0.12), relief: r.range(0.8, 1.4), tilt: -0.4 })];
  const main = r.weighted([['cushion', 3], ['scoop', 2.5], ['ogee', 2]]);
  if (main === 'cushion') bands.push(band(r, 'torus', { w: r.range(0.45, 0.7), relief: r.range(0.35, 0.7) }));
  else if (main === 'scoop') bands.push(band(r, 'cove', { w: r.range(0.35, 0.55), relief: r.range(1, 1.5) }), band(r, 'flat', { w: r.range(0.08, 0.16), tilt: r.range(-0.15, 0.1) }));
  else bands.push(band(r, 'ogee', { w: r.range(0.4, 0.6), relief: r.range(1.2, 2) }));
  if (r.chance(0.5)) bands.push(band(r, 'bead'));
  bands.push(band(r, r.chance(0.5) ? 'bead' : 'bevel'));
  return { bands, liner: linerGene(r, 0.15) };
}

/** Barbizon / Louis XV revival: a big swept ogee or cove, a narrow carved run, linen liner and gilt slip. */
function barbizonProfile(r, ro) {
  const bands = [band(r, 'torus', { w: r.range(0.06, 0.1), relief: r.range(1, 1.6) })];
  if (r.chance(0.4)) bands.push(band(r, 'bead', { motif: motif(ro, ro.weighted([['pearls', 2], ['rope', 1]])) }));
  bands.push(band(r, r.chance(0.6) ? 'ogee' : 'cove', { w: r.range(0.3, 0.45), relief: r.range(1, 1.6) }));
  bands.push(band(r, r.chance(0.5) ? 'flat' : 'torus', { w: r.range(0.07, 0.11), relief: r.range(0.6, 1), tilt: 0, motif: motif(ro, ro.weighted([['compo', 3], ['ripple', 1.5], ['leaves', 1]])) }));
  bands.push(band(r, 'flat', { w: r.range(0.05, 0.1), tilt: r.range(-0.2, 0) }));
  bands.push(band(r, 'bead'));
  return { bands, liner: linerGene(r, 0.75, 0.75) };
}

/** Victorian compo: wide flat friezes packed with low-relief scrolling foliage between bead borders. */
function victorianProfile(r, ro) {
  const edge = () => band(r, 'bead', { motif: motif(ro, ro.weighted([['pearls', 3], ['rope', 2], ['reel', 1]])) });
  const bands = [edge(), band(r, 'flat', { w: r.range(0.22, 0.32), tilt: r.range(-0.12, 0.05), motif: motif(ro, 'compo') }), edge()];
  bands.push(band(r, r.chance(0.5) ? 'cove' : 'flat', { w: r.range(0.06, 0.1), tilt: 0 }));
  bands.push(band(r, 'flat', { w: r.range(0.16, 0.26), tilt: r.range(-0.1, 0.08), motif: motif(ro, ro.weighted([['compo', 3], ['leaves', 1], ['acanthus', 1]])) }));
  bands.push(band(r, 'bead'));
  return { bands, liner: linerGene(r, 0.2) };
}

/** Auricular "ripple": one broad cove carved with bold rippling lobes. */
function rippleProfile(r, ro) {
  const bands = [band(r, 'torus', { w: r.range(0.07, 0.12), relief: r.range(0.9, 1.4) })];
  bands.push(band(r, r.chance(0.6) ? 'torus' : 'cove', { w: r.range(0.45, 0.6), relief: r.range(0.35, 0.7), motif: motif(ro, 'ripple') }));
  bands.push(band(r, r.chance(0.5) ? 'flat' : 'ogee', { w: r.range(0.1, 0.18), relief: r.range(0.8, 1.3), tilt: r.range(-0.3, 0) }));
  bands.push(band(r, r.chance(0.5) ? 'bead' : 'bevel'));
  return { bands, liner: null };
}

/** Tabernacle (aedicula): entablature on top, fluted pilasters at the sides, plinth below. */
function tabernacleGene(r, ro) {
  const flat = (w, extra) => band(r, 'flat', { w, tilt: 0, step: r.range(0.005, 0.02), ...extra });
  const frieze = r.weighted([['hammer', 3], ['compo', 2], ['plain', 1]]);
  const plinth = r.weighted([['rinceau', 2], ['compo', 2], ['hammer', 2]]);
  const panel = (kind, w) => flat(w, kind === 'hammer' ? { texture: 'hammer', matte: 0.7 } : kind === 'plain' ? {} : { motif: motif(ro, kind) });
  const top = [
    band(r, 'ogee', { w: 0.16, relief: r.range(1.4, 2), dir: -1, proj: true }),
    band(r, 'bead', { w: 0.05, proj: true }),
    ...(r.chance(0.7) ? [flat(0.11, { motif: motif(ro, 'dentils'), proj: true })] : []),
    flat(0.04),
    panel(frieze, r.range(0.36, 0.46)),
    band(r, 'bead', { w: 0.05 }), flat(0.06), band(r, 'bevel', { w: 0.06 }),
  ];
  const side = [flat(0.1), band(r, 'fluted', { flutes: r.int(3, 6), relief: r.range(0.6, 1) }), flat(0.08), band(r, 'bead', { w: 0.07 }), band(r, 'bevel', { w: 0.06 })];
  const bottom = [
    band(r, 'torus', { w: 0.15, relief: r.range(1, 1.5), proj: true }), flat(0.05, { proj: true }),
    panel(plinth, r.range(0.44, 0.54)), band(r, 'ogee', { w: 0.13, relief: 1.2, dir: 1 }), band(r, 'bead', { w: 0.06 }),
  ];
  return {
    top, side, bottom,
    hTop: r.range(1.35, 1.9), hBottom: r.range(1.0, 1.45), proj: r.range(0.12, 0.2),
    capital: r.weighted([['acanthus', 3], ['scroll', 2]]), keystone: r.chance(0.7),
    piece: centerpieceGene(r),
  };
}

function leafGene(r, opts = {}) {
  return {
    s: r.range(0.15, 0.85), len: r.range(0.4, 0.9), w: r.range(0.11, 0.19), lobes: r.int(3, 6),
    depth: r.range(0.25, 0.5), curl: r.range(-2.6, 2.6), ang: r.range(-0.7, 0.7), bend: r.range(-1, 1),
    ...opts,
  };
}

function wingGene(r) {
  return {
    kind: r.chance(0.55) ? 'C' : 'S',
    flip: r.chance(0.5),
    ya: r.range(0.28, 0.72), yb: r.range(0.25, 0.75),
    bend: r.range(-1.2, 1.2), turnsA: r.range(0.7, 1.8), turnsB: r.range(0.9, 2.2),
    thick: r.range(0.055, 0.095),
    leaves: Array.from({ length: r.int(1, 3) }, () => leafGene(r)),
    terminal: r.chance(0.75) ? leafGene(r, { len: r.range(0.55, 1.1), ang: r.range(-0.25, 0.25) }) : null,
    crest: r.chance(0.55) ? { s: r.range(0.25, 0.6), h: r.range(0.35, 0.8), turns: r.range(0.8, 1.6), flip: r.chance(0.5) } : null,
    pearls: r.chance(0.4) ? { n: r.int(3, 6), size: r.range(0.05, 0.08), s: r.range(0.3, 0.7) } : null,
  };
}

function centerpieceGene(r) {
  return {
    kind: r.weighted([['shell', 4], ['cluster', 2], ['rosette', 1.4], ['cabochon', 1.4]]),
    size: r.range(0.75, 1.15),
    shell: {
      ribs: r.int(5, 13), spread: r.range(1.7, 3.1), lobe: r.range(0.1, 0.5), fall: r.range(0, 0.3),
      asym: r.chance(0.3) ? r.range(-0.35, 0.35) : 0, ears: r.chance(0.65),
    },
    rosette: { petals: r.int(5, 9), lobes: r.int(0, 2), inner: r.chance(0.5), curl: r.range(-0.6, 0.6) },
    cabochon: { aspect: r.range(0.6, 1), pearls: r.chance(0.75) },
    cluster: { n: r.int(1, 2), spread: r.range(0.45, 0.95), lobes: r.int(3, 6), curl: r.range(0.5, 2.4) },
  };
}

export function makeGenome(seed, style) {
  const R = createRng(seed);
  const rs = R.fork('style');
  style ??= rs.weighted([['baroque', 40], ['barbizon', 16], ['plain', 14], ['victorian', 12], ['ripple', 9], ['tabernacle', 9]]);
  if (!STYLES.includes(style)) throw new TypeError(`gilt-frame: style must be one of ${STYLES.join(', ')}`);
  const rp = R.fork('proportions'), rc = R.fork('color'), rpr = R.fork('profile');
  const ro = R.fork('bands'), rk = R.fork('corner'), rm = R.fork('center');

  // Finish: gilt (most), carved wood, or parcel-gilt (wood with gilded carving). Palettes are
  // named starting points; per-seed jitter means no two frames share exactly the same tone.
  const rf = R.fork('finish');
  const finish = {
    kind: rf.weighted([['gold', 62], ['wood', 24], ['parcel', 14]]),
    gold: rf.weighted([['classic', 4], ['rich', 2.5], ['rose', 1.4], ['pale', 1.4], ['green', 0.8], ['bronze', 1.2]]),
    wood: rf.weighted([['walnut', 3], ['mahogany', 2], ['oak', 1.6], ['cherry', 1.6], ['ebony', 1.2], ['honey', 1], ['rosewood', 1]]),
    woodJit: [rf.range(-4, 4), rf.range(0.9, 1.1), rf.range(0.88, 1.12)],
  };
  const gold = {
    dh: rc.range(-2.5, 2.5),
    ds: rc.range(0.9, 1.1),
    antique: rc.chance(0.35) ? rc.range(0.3, 0.8) : rc.range(0, 0.25),
    warmth: rc.range(-4, 6),
    burnish: rc.range(0.35, 0.9), // water-gilt gloss on the high flats vs. oil-gilt matte
  };
  const rw = R.fork('wear');
  const wear = { amount: rw.range(0.15, 0.45), bole: rw.range(0, 1), chips: rw.range(0.2, 1), grime: rw.range(0.3, 1), leaf: rw.range(0.45, 0.8), crack: rw.chance(0.6) };
  // later wear traits draw from their own stream so the ones above stay put for existing seeds
  const rw2 = R.fork('wear-2');
  wear.wash = rw2.chance(style === 'ripple' ? 0.75 : style === 'victorian' ? 0.35 : 0.12); // pale gesso left in the recesses
  wear.flake = style === 'plain' ? rw2.range(0.4, 1) : rw2.chance(0.25) ? rw2.range(0.2, 0.7) : 0; // gilding lost in patches
  wear.crackle = rw2.range(0.2, 1); // craquelure in the gesso, shows with age
  if (style === 'plain') wear.amount = rw2.range(0.3, 0.65);

  // style-specific structure; baroque keeps the original streams so existing seeds look the same
  const rst = R.fork('style-' + style);
  let thickness = rp.range(0.15, 0.25), overhang = rp.chance(0.2) ? 0 : rp.range(0.1, 0.32);
  let profile, corner = null, center = null, tab = null;
  if (style === 'baroque') profile = genProfile(rpr, ro);
  else if (style === 'plain') { profile = plainProfile(rst); thickness = rst.range(0.08, 0.16); overhang = 0; }
  else if (style === 'barbizon') { profile = barbizonProfile(rst, ro); thickness = rst.range(0.14, 0.22); overhang = rst.range(0, 0.08); }
  else if (style === 'victorian') { profile = victorianProfile(rst, ro); thickness = rst.range(0.18, 0.28); overhang = 0; }
  else if (style === 'ripple') { profile = rippleProfile(rst, ro); thickness = rst.range(0.16, 0.24); overhang = 0; }
  else { tab = tabernacleGene(rst, ro); profile = { bands: tab.side, liner: null }; thickness = rst.range(0.1, 0.15); overhang = tab.proj; }
  const { bands, liner } = profile;
  if (style === 'baroque') {
    corner = { len: rk.range(1.45, 2.6), depth: rk.range(0.38, 0.6), outward: rk.chance(0.82), piece: centerpieceGene(rk), wing: wingGene(rk) };
    center = rm.chance(0.78) ? { len: rm.range(0.9, 1.9), depth: rm.range(0.4, 0.62), outward: rm.chance(0.75), piece: centerpieceGene(rm), wing: wingGene(rm) } : null;
  } else if (style === 'barbizon') {
    // small corner cartouche: a cabochon or rosette with leaf sprays running along the rails
    const piece = centerpieceGene(rk);
    piece.kind = rk.weighted([['cabochon', 3], ['rosette', 2], ['shell', 1]]);
    piece.size = rk.range(0.5, 0.72);
    const wing = wingGene(rk);
    wing.crest = null; wing.thick *= 0.7; wing.leaves = wing.leaves.slice(0, 2);
    corner = { len: rk.range(0.9, 1.4), depth: rk.range(0.3, 0.42), outward: rk.chance(0.5), piece, wing };
  }
  return {
    style,
    thickness,
    overhang,
    tab,
    finish,
    gold,
    wear,
    bands,
    liner,
    corner,
    center,
  };
}
