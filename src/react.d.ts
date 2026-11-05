import type { ReactElement, CSSProperties, ImgHTMLAttributes } from 'react';
export { renderFrame, frameLayout, randomSeed, seedToClass, seedFromClass } from './index.js';

export interface GiltFrameProps {
  src: string;
  alt?: string;
  /** Reproduce a frame. Omit for a random one (stable for the component's lifetime). */
  seed?: string;
  /** Intrinsic image size; skips preloading the image to measure it (and enables SSR layout). */
  width?: number;
  height?: number;
  wear?: number;
  /** Frame type (named frameStyle because `style` is the CSS prop). Default: from seed. */
  frameStyle?: import('./index.js').Style;
  finish?: import('./index.js').Finish;
  palette?: import('./index.js').GoldPalette | import('./index.js').WoodPalette;
  thickness?: number;
  overhang?: number;
  /** Detail budget for the canvas (max moulding px). Default 260 — plenty for screens. */
  maxThickness?: number;
  fit?: 'cover' | 'contain' | 'fill';
  className?: string;
  style?: CSSProperties;
  imgProps?: ImgHTMLAttributes<HTMLImageElement>;
  /** Called with the seed in use once the frame is drawn (handy when it was random). */
  onSeed?: (seed: string) => void;
}

/** Wrapper <div> carries class="gilt-frame gilt-frame-<seed>". */
export function GiltFrame(props: GiltFrameProps): ReactElement;
