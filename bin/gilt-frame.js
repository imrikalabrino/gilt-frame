#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { frameImageToFile } from '../src/node.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: 'string', short: 's' },
    wear: { type: 'string', short: 'w' },
    finish: { type: 'string', short: 'f' },
    palette: { type: 'string', short: 'p' },
    thickness: { type: 'string', short: 't' },
    overhang: { type: 'string', short: 'o' },
    detail: { type: 'string', short: 'd' },
    quality: { type: 'string', short: 'q' },
    background: { type: 'string', short: 'b' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || positionals.length < 2) {
  console.log(`gilt-frame <input> <output.(png|jpg|webp|avif)> [options]

  -s, --seed <str>        reproduce a specific frame (printed after every run)
  -w, --wear <0..1>       age: 0 = fresh gilding, 1 = heavily rubbed (default: from seed, mild)
  -f, --finish <kind>     gold | wood | parcel (wood with gilded carving)   (default: from seed)
  -p, --palette <name>    gold: classic rich rose pale green bronze
                          wood: walnut mahogany oak cherry ebony honey rosewood
  -t, --thickness <n>     moulding width: px (>1) or fraction of the short side (<=1)
  -o, --overhang <n>      room for crests outside the moulding, fraction of thickness
  -d, --detail <px>       max rendered moulding width before upscaling (default 420)
  -q, --quality <n>       jpeg/webp/avif quality
  -b, --background <css>  flatten transparency onto this colour`);
  process.exit(values.help ? 0 : 1);
}

const num = (v) => (v == null ? undefined : Number(v));
const [input, output] = positionals;
const { seed, info, frame } = await frameImageToFile(input, output, {
  seed: values.seed, wear: num(values.wear), finish: values.finish, palette: values.palette, thickness: num(values.thickness), overhang: num(values.overhang),
  maxThickness: num(values.detail), quality: num(values.quality), background: values.background,
});
console.log(`seed: ${seed}  ${frame.finish}/${frame.palette}  (${info.width}x${info.height})`);
