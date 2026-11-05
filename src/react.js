// <GiltFrame src seed /> — the picture is a normal <img>; the frame is a <canvas> rendered in a
// Web Worker (falls back to the main thread where module workers aren't available).
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { renderFrame, frameLayout } from './frame.js';
import { randomSeed, seedToClass } from './rng.js';

let worker, nextId = 0;
const pending = new Map();
function renderOffThread(options) {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data.frame);
      };
    } catch { worker = null; }
  }
  if (!worker) return Promise.resolve().then(() => renderFrame(options));
  const id = nextId++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, options }); });
}

const pct = (v, t) => `${(v / t) * 100}%`;

export function GiltFrame({
  src, alt = '', seed, width, height, thickness, overhang, wear, frameStyle, finish, palette, maxThickness = 260,
  fit = 'cover', className = '', style, imgProps, onSeed,
}) {
  const [natural, setNatural] = useState(null);
  const [frame, setFrame] = useState(null);
  const [autoSeed] = useState(() => randomSeed()); // stable for the component's lifetime
  const finalSeed = seed ?? autoSeed;
  const canvas = useRef(null);

  useEffect(() => {
    if (width && height) return undefined;
    let live = true;
    const img = new Image();
    img.onload = () => live && setNatural({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = src;
    return () => { live = false; };
  }, [src, width, height]);

  const dims = width && height ? { width, height } : natural;
  const opts = useMemo(
    () => (dims ? { width: dims.width, height: dims.height, seed: finalSeed, thickness, overhang, wear, style: frameStyle, finish, palette, maxThickness } : null),
    [dims?.width, dims?.height, finalSeed, thickness, overhang, wear, frameStyle, finish, palette, maxThickness],
  );

  useEffect(() => {
    if (!opts) return undefined;
    let live = true;
    renderOffThread(opts).then((f) => { if (live) setFrame(f); });
    return () => { live = false; };
  }, [opts]);

  useEffect(() => {
    if (!frame || !canvas.current) return;
    const c = canvas.current;
    c.width = frame.width; c.height = frame.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
    onSeed?.(frame.seed);
  }, [frame]);

  const cls = `gilt-frame ${seedToClass(finalSeed)} ${className}`.trim();
  // Layout is known from the options alone, so the picture shows before the frame finishes.
  const layout = frame ?? (opts && frameLayout(opts));
  if (!layout) return h('div', { className: cls, 'data-gilt-seed': finalSeed, style });
  return h('div', { className: cls, 'data-gilt-seed': finalSeed, style: { position: 'relative', aspectRatio: `${layout.fullWidth} / ${layout.fullHeight}`, ...style } },
    h('img', {
      src, alt, ...imgProps,
      style: {
        position: 'absolute', display: 'block', objectFit: fit,
        left: pct(layout.imageX, layout.fullWidth), top: pct(layout.imageY, layout.fullHeight),
        width: pct(layout.imageWidth, layout.fullWidth), height: pct(layout.imageHeight, layout.fullHeight),
        ...imgProps?.style,
      },
    }),
    h('canvas', { ref: canvas, 'aria-hidden': true, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } }),
  );
}

export { renderFrame, frameLayout, randomSeed, seedToClass };
export { seedFromClass } from './rng.js';
