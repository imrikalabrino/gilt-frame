# gilt-frame

Procedurally generated **ornate Baroque / Rococo carved picture frames** (gilt, wood or parcel-gilt) for any image, any size, any ratio, rendered per pixel to look like photographed gilding, wear included.

Designs aren't picked from a pool. Each seed drives continuous parameters:
- **Moulding profile:** torus, cove, ogee, scotia, bead, sanded frieze, and a velvet or linen liner.
- **Carved runs:** acanthus, water-leaf, gadroon, egg-and-dart, rinceau, rope, pearls, bead-and-reel and shells.
- **Cartouches:** volute curvature, leaf lobing and curl, shell ribs and asymmetry, and their layout.
- **Finish:** gilt, carved wood or parcel-gilt; the gold alloy or timber; burnish; and the type and amount of wear.

Pass a seed string to get the same frame back at any image size.

![contact sheet](examples/sheet.png)

One seed in every finish and palette:

![palettes](examples/palettes.png)

`wear: 0` vs `wear: 0.75`, same seed:

![wear](examples/wear.png)

## Install

```bash
npm i gilt-frame          # zero-dependency core (Node, browsers, workers, edge)
npm i sharp               # optional: framed PNG/JPEG/WebP/AVIF in Node
```

## Use

### Node

```js
import { frameImageToFile, frameImage } from 'gilt-frame/node';

const { seed } = await frameImageToFile('photo.jpg', 'framed.png');            // random frame
await frameImageToFile('other.jpg', 'same-frame.webp', { seed });               // same design, other picture
const { buffer } = await frameImage(buf, { seed: 'louis-xiv', wear: 0.6, format: 'jpeg', quality: 90 });
```

Rendering is spread over CPU cores (worker threads on shared memory). The output is bit-identical to the single-threaded render, so seeds stay reproducible.

### CLI

```bash
npx gilt-frame photo.jpg framed.png --seed louis-xiv --wear 0.4
npx gilt-frame photo.jpg framed.png --finish parcel --palette walnut
```

### React

```jsx
import { GiltFrame } from 'gilt-frame/react';

<GiltFrame src="/painting.jpg" seed="rocaille-7" wear={0.3} onSeed={(s) => console.log(s)} />
<GiltFrame src="/portrait.jpg" finish="wood" palette="mahogany" />
```

The picture is a normal `<img>`. The frame is a `<canvas>` rendered in a Web Worker, so the main thread stays free. It is responsive, and layout is known before rendering finishes. Pass `width`/`height` (the image's intrinsic size) to skip measuring the image.

### Anywhere (raw pixels)

```js
import { renderFrame } from 'gilt-frame';

const f = renderFrame({ width: 1200, height: 800, seed: 'versailles' });
ctx.putImageData(new ImageData(f.data, f.width, f.height), 0, 0);
// the picture goes at (f.imageX, f.imageY) × f.scale; the opening holds only the frame's cast shadow
```

`examples/browser.html` is a live demo. Run `node examples/serve.js` and open http://localhost:5178/.

## Finding a frame's seed

Every frame's root element has the class `gilt-frame gilt-frame-<SEED>` (plus `data-gilt-seed`), so you can inspect a frame you like in devtools and copy its seed. Characters that aren't class-safe are escaped as `_<hex>_` (`"my seed"` becomes `gilt-frame-my_20_seed`). `seedFromClass` decodes it:

```js
import { seedFromClass } from 'gilt-frame';
seedFromClass(document.querySelector('.gilt-frame').classList); // 'my seed'
```

## Options

| option | default | |
|---|---|---|
| `width`, `height` | required | picture size in px |
| `seed` | random | any string; the same seed gives the same design at **every** size and ratio |
| `wear` | from seed (0.15–0.45) | 0 = fresh gilding … 1 = rubbed through to the red bole, chipped to the gesso, grime in the recesses |
| `finish` | from seed (gold 62%, wood 24%, parcel 14%) | `gold`, `wood`, or `parcel` (carved wood with gilded carving and sight edge) |
| `palette` | from seed | gold: `classic` `rich` `rose` `pale` `green` `bronze`; wood: `walnut` `mahogany` `oak` `cherry` `ebony` `honey` `rosewood`. Each seed adds a small tint jitter. A wood name implies `wood` when `finish` isn't set |
| `thickness` | from seed (15–25% of short side) | moulding width; px if > 1, else a fraction of the short side |
| `overhang` | from seed | room for crests outside the moulding, as a fraction of thickness (`0` = flush rectangle) |
| `maxThickness` | 420 (React: 260) | detail budget: the moulding renders at most this wide, then upscales (lanczos) |
| `format`, `quality`, `background`, `threads` | `png` | Node output encoding and thread count; JPEG is flattened onto `background` (white by default) |

## How it looks real

1. **Height field, not vector art.** The moulding cross-section is a real height profile with fillet steps, mitred per pixel. Every carved element (leaf, volute, shell rib, pearl) is scan-filled, turned into a rounded dome by an exact Euclidean distance transform, and stacked on what's beneath it. Midribs, veins and scroll channels are carved in the same way.
2. **Lighting.** Normals; ray-marched cast shadows; cavity occlusion; and a metallic studio-reflection model with burnished highlights on proud surfaces and matte gold in recesses and sanded friezes. Velvet or linen liners are lit as fabric.
3. **Wood is its own material.** Annual rings and pore streaks run along each side and change direction at the mitres, as in real joinery. The wood takes diffuse light with a varnish highlight, and wear exposes paler bare wood rather than bole.
4. **Wear driven by exposure.** Gilding is rubbed through to red bole where hands and dusting cloths reach: the proudest carving, sharp ridges and outer edges. The abrasion is streaked along the moulding. Gesso chips show on the worst spots, grime settles in crevices, gold-leaf sheets vary slightly in tone with faint seams, and mitre joints open up.

## Performance

Measured on an Apple M-series machine (10 performance cores) with `node examples/bench.js`:

| | single thread (`renderFrame`) | Node pipeline (`frameImage` to JPEG, threaded) |
|---|---|---|
| 800×600 | 170 ms | 100 ms |
| 1920×1080 | 510 ms | — |
| 3000×2000 | 1.3 s | 0.52 s |
| 6000×4000 | 1.6 s | 0.80 s |

What keeps it fast:
- **Build once, stamp many.** Each band motif is one periodic relief tile, sampled with wrap-around along all four sides. Corner cartouches are built once and mirrored into four corners; side cartouches are rotated copies. Tiles are supersampled 2× only when they're small enough to need it.
- **No wasted pixels.** Rows that cross the picture opening only process the frame plus the margin where its shadow falls. The wide occlusion blur runs at quarter resolution, and the ridge detector is an inline 4-tap test.
- **Detail budget.** A 6000 px photo doesn't need a 1200 px-wide carving rendered at full size. The moulding renders at up to `maxThickness` px, then upscales with lanczos.
- **Threads, not a port.** Profiling showed the remaining cost is ordinary per-pixel lighting maths. In Node the row phases run on a worker pool over SharedArrayBuffers, with an atomic counter for load balancing: about 4× faster, with the same bytes out. Browsers render in a Web Worker. One readable JS codebase runs everywhere, with no native or WASM build step.

## Determinism

Each subsystem (proportions, colour, profile, bands, corner, centre, wear, noise) draws from its own forked PRNG stream (cyrb128 hash, then sfc32). A seed's design never depends on image dimensions; only tiling, fitting and detail scale adapt to the size. Rendering has no per-thread randomness.
