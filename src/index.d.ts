export interface FrameOptions {
  /** Width of the picture in px. */
  width: number;
  /** Height of the picture in px. */
  height: number;
  /** Any string. Same seed ⇒ same design at any size. Omit for a random one (returned as `seed`). */
  seed?: string | number;
  /** Age, 0 (fresh gilding) … 1 (heavily rubbed to the bole, chipped, grimy). Default: from seed, mild. */
  wear?: number;
  /** Material. 'parcel' = carved wood with gilded carving and sight edge. Default: from seed. */
  finish?: Finish;
  /** Named tone. A gold name tints the gilding, a wood name picks the timber (and implies wood when finish isn't set). Default: from seed. */
  palette?: GoldPalette | WoodPalette;
  /** Moulding width: px when > 1, otherwise a fraction of the picture's short side. Default: from seed. */
  thickness?: number;
  /** Free margin for crests/cartouches outside the moulding, as a fraction of thickness (0 = none). Default: from seed. */
  overhang?: number;
  /** Detail budget: the moulding is rendered at most this many px wide, then upscaled. Default 420. */
  maxThickness?: number;
}

export type Finish = 'gold' | 'wood' | 'parcel';
export type GoldPalette = 'classic' | 'rich' | 'rose' | 'pale' | 'green' | 'bronze';
export type WoodPalette = 'walnut' | 'mahogany' | 'oak' | 'cherry' | 'ebony' | 'honey' | 'rosewood';

export interface FrameLayout {
  seed: string;
  finish: Finish;
  /** Resolved tone: gold name, wood name, or "wood+gold" for parcel-gilt. */
  palette: string;
  /** Full output size including moulding and overhang. */
  fullWidth: number;
  fullHeight: number;
  /** Where the picture goes (full-size px). */
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  thickness: number;
  overhang: number;
  genome: unknown;
}

export interface Frame extends FrameLayout {
  /** Straight-alpha RGBA. The picture opening is transparent apart from the frame's cast shadow. */
  data: Uint8ClampedArray;
  /** Rendered size; equals fullWidth/fullHeight × scale. */
  width: number;
  height: number;
  /** < 1 when rendered under the detail budget (upscale `data` to fullWidth × fullHeight). */
  scale: number;
}

/** Render synchronously on the current thread. Isomorphic: Node, browsers, workers, edge. */
export function renderFrame(options: FrameOptions): Frame;
/** Output geometry without rendering. */
export function frameLayout(options: FrameOptions): FrameLayout;
export function makeGenome(seed: string): unknown;
export const GOLDS: Record<GoldPalette, object>;
export const WOODS: Record<WoodPalette, object>;
export function randomSeed(): string;
/** "gilt-frame-<seed>" with non [A-Za-z0-9-] characters escaped as _hex_. */
export function seedToClass(seed: string): string;
/** Recover the seed from an element's class list / className string. */
export function seedFromClass(classList: string | Iterable<string>): string | null;
