import type { FrameOptions, Frame } from './index.js';
export * from './index.js';

export interface FrameImageOptions extends Omit<FrameOptions, 'width' | 'height'> {
  format?: 'png' | 'jpeg' | 'jpg' | 'webp' | 'avif' | 'tiff';
  quality?: number;
  /** Flatten transparency onto this colour (always applied for JPEG, default white). */
  background?: string;
  /** Worker threads for rendering. Default: min(8, cores − 1). Renders may run concurrently; they share one pool. */
  threads?: number;
  /** Refuse outputs larger than this (full size, after upscaling). Default 268 MP, libvips' own input limit. */
  maxOutputPixels?: number;
}

export interface FrameImageResult {
  buffer: Buffer;
  seed: string;
  info: { width: number; height: number; format: string; size: number };
  frame: Omit<Frame, 'data'>;
}

/** Input: path, Buffer, or anything sharp accepts. EXIF orientation is honoured. */
export function frameImage(input: string | Buffer | Uint8Array, options?: FrameImageOptions): Promise<FrameImageResult>;
export function frameImageToFile(input: string | Buffer | Uint8Array, output: string, options?: FrameImageOptions): Promise<FrameImageResult>;
/** The frame alone as full-size RGBA (picture opening transparent). */
export function frameOverlay(options: FrameOptions & { threads?: number }): Promise<Frame>;
/** renderFrame() spread across CPU cores; output is identical. */
export function renderFrameParallel(options: FrameOptions & { threads?: number }): Promise<Frame>;
/** Terminate the worker pool (idle workers never keep the process alive). */
export function closePool(): Promise<void>;
