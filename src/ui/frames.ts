import type { FrameRenderer } from './render';

// Frames of a banner animation kept in memory for GIF and WebP. Only the area that
// changed since the previous frame is stored, and a frame identical to the previous one
// just extends its time, so pauses in an animation cost nothing.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CapturedFrame {
  /** Area that differs from the previous frame; the whole banner for the first one. */
  rect: Rect;
  /** RGBA pixels of `rect`. */
  pixels: Uint8ClampedArray;
  /** How many capture ticks the frame is shown for. */
  ticks: number;
}

export interface Captured {
  width: number;
  height: number;
  fps: number;
  frames: CapturedFrame[];
}

export async function captureFrames(
  renderer: FrameRenderer,
  options: { fps: number; duration: number; scale?: number },
  onProgress?: (done: number) => void,
  signal?: { cancelled: boolean },
): Promise<Captured | null> {
  const scale = options.scale ?? 1;
  const width = Math.round(renderer.width * scale);
  const height = Math.round(renderer.height * scale);
  const count = Math.max(1, Math.round(options.duration * options.fps));
  const canvas = document.createElement('canvas');
  const frames: CapturedFrame[] = [];
  let prev: Uint8ClampedArray | null = null;
  for (let i = 0; i < count; i++) {
    if (signal?.cancelled) return null;
    await renderer.draw(i / options.fps, canvas);
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    const rect = prev ? changedRect(prev, data, width, height) : { x: 0, y: 0, w: width, h: height };
    if (!rect) frames[frames.length - 1].ticks++;
    else frames.push({ rect, pixels: crop(data, width, rect), ticks: 1 });
    prev = data;
    onProgress?.((i + 1) / count);
  }
  return { width, height, fps: options.fps, frames };
}

/** Bounding box of pixels that differ between two RGBA images, or null when they are equal. */
export function changedRect(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  // Rows are compared as 32-bit words, which is several times faster than bytes.
  const a32 = new Uint32Array(a.buffer, a.byteOffset, width * height);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (a32[row + x] !== b32[row + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (y < y0) y0 = y;
    y1 = y;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function crop(data: Uint8ClampedArray, width: number, r: Rect): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(data.subarray(((r.y + y) * width + r.x) * 4, ((r.y + y) * width + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

export function paste(target: Uint8ClampedArray, width: number, r: Rect, pixels: Uint8ClampedArray): void {
  for (let y = 0; y < r.h; y++) target.set(pixels.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * width + r.x) * 4);
}

export interface Shown {
  /** The whole banner as shown at this frame. */
  screen: Uint8ClampedArray;
  /** Area that changed since the previously shown frame. */
  rect: Rect;
  /** Display time in milliseconds. */
  delay: number;
}

/**
 * Walks the captured animation keeping every `step`-th tick, as full screens with the
 * area changed since the last kept frame. The yielded `screen` buffer is reused, so read
 * it before asking for the next frame.
 */
export function* replay(captured: Captured, step: number): Generator<Shown> {
  const { width, height, fps } = captured;
  const screen = new Uint8ClampedArray(width * height * 4);
  const shown = new Uint8ClampedArray(width * height * 4);
  let tick = 0;
  let pendingTicks = 0;
  let pendingRect: Rect | null = null;
  let first = true;
  // A frame is emitted at each tick that is a multiple of `step`, showing the screen at that tick.
  const ticksTotal = captured.frames.reduce((n, f) => n + f.ticks, 0);
  let fi = 0;
  let left = 0;
  while (tick < ticksTotal) {
    if (left === 0) {
      const f = captured.frames[fi++];
      paste(screen, width, f.rect, f.pixels);
      left = f.ticks;
    }
    if (tick % step === 0) {
      const rect = first ? { x: 0, y: 0, w: width, h: height } : changedRect(shown, screen, width, height);
      if (rect) {
        if (pendingRect) yield { screen: shown, rect: pendingRect, delay: (pendingTicks * 1000) / fps };
        shown.set(screen);
        pendingRect = rect;
        pendingTicks = 0;
        first = false;
      }
    }
    pendingTicks++;
    left--;
    tick++;
  }
  if (pendingRect) yield { screen: shown, rect: pendingRect, delay: (pendingTicks * 1000) / fps };
}

/** Rough memory taken by captured frames, in bytes. */
export function capturedBytes(c: Captured): number {
  return c.frames.reduce((n, f) => n + f.pixels.length, 0);
}
