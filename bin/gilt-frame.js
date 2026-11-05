#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { frameImageToFile } from '../src/node.js';
import { parseFrameClass } from '../src/classname.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: 'string', short: 's' },
    class: { type: 'string', short: 'c' },
    wear: { type: 'string', short: 'w' },
    style: { type: 'string', short: 'y' },
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

  -s, --seed <str>        reproduce a specific frame (its settings class is printed after every run)
  -c, --class <class>     reproduce a frame from its settings class, e.g. gilt-frame-e8wffc1rds-w0-ripple-gold-classic
  -w, --wear <0..1>       age: 0 = fresh gilding, 1 = heavily rubbed (default: from seed, mild)
  -y, --style <name>      baroque | barbizon | plain | victorian | ripple | tabernacle (default: from seed)
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
try {
  const fromClass = values.class ? parseFrameClass(values.class) : {};
  if (values.class && !fromClass) throw new Error(`gilt-frame: "${values.class}" is not a gilt-frame settings class`);
  const { info, frame } = await frameImageToFile(input, output, {
    ...fromClass,
    seed: values.seed ?? fromClass.seed, wear: num(values.wear) ?? fromClass.wear, style: values.style ?? fromClass.style, finish: values.finish ?? fromClass.finish, palette: values.palette ?? fromClass.palette,
    thickness: num(values.thickness) ?? fromClass.thickness, overhang: num(values.overhang) ?? fromClass.overhang,
    maxThickness: num(values.detail), quality: num(values.quality), background: values.background,
  });
  console.log(`${frame.className}  (${info.width}x${info.height})`);
} catch (e) {
  console.error(e.message.replace(/^gilt-frame: /, 'gilt-frame: '));
  process.exit(1);
}
