import { applyPalette, quantize } from 'gifenc';
import lzwEncode from 'gifenc/src/lzwEncode.js';
import type { Stream } from 'gifenc/src/stream.js';
import createStream from 'gifenc/src/stream.js';
import type { Captured, Shown } from './frames';
import { crop, replay } from './frames';

// Animated GIF from captured frames. One global palette keeps colours steady between
// frames; each frame stores only the area that changed, and pixels inside it that did
// not change are transparent so LZW packs them into long runs.

export interface GifOptions {
  /** Palette size, 2–256. */
  colors: number;
  /** Keep every `step`-th captured frame, to lower the frame rate. */
  step: number;
}

export function encodeGif(captured: Captured, options: GifOptions): Uint8Array {
  const { width, height } = captured;
  // One palette slot is reserved for "unchanged" (transparent) pixels.
  const palette = globalPalette(captured, options.step, Math.max(2, Math.min(256, options.colors)) - 1);
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length + 1)));
  const transparent = palette.length;
  const stream = createStream(width * height);
  const accum = new Uint8Array(256);
  const htab = new Int32Array(5003);
  const codetab = new Int32Array(5003);

  writeAscii(stream, 'GIF89a');
  word(stream, width);
  word(stream, height);
  stream.writeByte(0x80 | ((bits - 1) << 4) | (bits - 1));
  stream.writeByte(0);
  stream.writeByte(0);
  for (let i = 0; i < 1 << bits; i++) {
    const c = palette[i] ?? [0, 0, 0];
    stream.writeByte(c[0]);
    stream.writeByte(c[1]);
    stream.writeByte(c[2]);
  }
  // NETSCAPE2.0 extension: loop forever.
  stream.writeBytes([0x21, 0xff, 0x0b]);
  writeAscii(stream, 'NETSCAPE2.0');
  stream.writeBytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  let prev: Uint8ClampedArray | null = null;
  for (const frame of replay(captured, options.step)) {
    const indices = frameIndices(frame, prev, width, palette, transparent);
    // Graphic control: keep the previous frame under this one, with the transparent slot.
    const delay = Math.max(2, Math.round(frame.delay / 10));
    stream.writeBytes([0x21, 0xf9, 0x04, (1 << 2) | (prev ? 1 : 0), delay & 0xff, delay >> 8, transparent, 0x00]);
    stream.writeByte(0x2c);
    word(stream, frame.rect.x);
    word(stream, frame.rect.y);
    word(stream, frame.rect.w);
    word(stream, frame.rect.h);
    stream.writeByte(0);
    lzwEncode(frame.rect.w, frame.rect.h, indices, Math.max(2, bits), stream, accum, htab, codetab);
    prev = prev ?? new Uint8ClampedArray(width * height * 4);
    prev.set(frame.screen);
  }
  stream.writeByte(0x3b);
  return stream.bytes();
}

function frameIndices(frame: Shown, prev: Uint8ClampedArray | null, width: number, palette: number[][], transparent: number): Uint8Array {
  const pixels = crop(frame.screen, width, frame.rect);
  const indices = applyPalette(pixels, palette, 'rgb565');
  if (!prev) return indices;
  const before = new Uint32Array(crop(prev, width, frame.rect).buffer);
  const now = new Uint32Array(pixels.buffer);
  for (let i = 0; i < now.length; i++) if (now[i] === before[i]) indices[i] = transparent;
  return indices;
}

/** Palette from a handful of screens spread over the animation. */
function globalPalette(captured: Captured, step: number, colors: number): number[][] {
  const screens: Uint8ClampedArray[] = [];
  const all = Array.from(replay(captured, step), (f) => f).length;
  const every = Math.max(1, Math.floor(all / 8));
  let i = 0;
  for (const frame of replay(captured, step)) {
    if (i++ % every === 0 && screens.length < 8) screens.push(frame.screen.slice());
  }
  const joined = new Uint8ClampedArray(screens.reduce((n, s) => n + s.length, 0));
  let offset = 0;
  for (const s of screens) {
    joined.set(s, offset);
    offset += s.length;
  }
  return quantize(joined, colors, { format: 'rgb565' });
}

function word(stream: Stream, v: number): void {
  stream.writeByte(v & 0xff);
  stream.writeByte((v >> 8) & 0xff);
}

function writeAscii(stream: Stream, s: string): void {
  for (let i = 0; i < s.length; i++) stream.writeByte(s.charCodeAt(i));
}
