import type { Captured, Rect } from './frames';
import { crop, replay } from './frames';

// Animated WebP from captured frames. The browser encodes each changed area as a still
// WebP; this file wraps them into an animated container (RIFF with VP8X, ANIM and ANMF).
// https://developers.google.com/speed/webp/docs/riff_container

export interface WebpOptions {
  /** Encoder quality, 0–1. */
  quality: number;
  step: number;
}

export async function encodeWebp(captured: Captured, options: WebpOptions): Promise<Uint8Array> {
  const { width, height } = captured;
  const canvas = document.createElement('canvas');
  const parts: Uint8Array[] = [];
  let alpha = false;
  for (const frame of replay(captured, options.step)) {
    // Frame offsets are stored halved, so the area starts on even pixels.
    const rect = evenRect(frame.rect);
    const pixels = crop(frame.screen, width, rect);
    canvas.width = rect.w;
    canvas.height = rect.h;
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, rect.w, rect.h), 0, 0);
    const still = await toBytes(canvas, options.quality);
    const chunks = frameChunks(still);
    if (chunks.alpha) alpha = true;
    parts.push(anmf(rect, Math.round(frame.delay), chunks.data));
  }
  const vp8x = chunk('VP8X', [(alpha ? 0x10 : 0) | 0x02, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]);
  // Background white, loop forever.
  const anim = chunk('ANIM', [0xff, 0xff, 0xff, 0xff, 0, 0]);
  return riff([vp8x, anim, ...parts]);

  function evenRect(r: Rect): Rect {
    const x = r.x & ~1;
    const y = r.y & ~1;
    return { x, y, w: Math.min(width - x, r.w + (r.x - x)), h: Math.min(height - y, r.h + (r.y - y)) };
  }
}

async function toBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') throw new Error('WebP');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Image chunks of a still WebP (VP8, VP8L and ALPH), without its RIFF header and VP8X. */
export function frameChunks(file: Uint8Array): { data: Uint8Array; alpha: boolean } {
  const out: Uint8Array[] = [];
  let alpha = false;
  for (let p = 12; p + 8 <= file.length; ) {
    const id = String.fromCharCode(file[p], file[p + 1], file[p + 2], file[p + 3]);
    const size = file[p + 4] | (file[p + 5] << 8) | (file[p + 6] << 16) | (file[p + 7] << 24);
    const end = p + 8 + size + (size & 1);
    if (id === 'ALPH') alpha = true;
    if (id === 'VP8L') alpha = alpha || ((file[p + 8 + 4] >> 4) & 1) === 1;
    if (id === 'VP8 ' || id === 'VP8L' || id === 'ALPH') out.push(file.subarray(p, end));
    p = end;
  }
  return { data: concat(out), alpha };
}

function anmf(r: Rect, duration: number, data: Uint8Array): Uint8Array {
  // Flags: do not blend (bit 1), keep the frame (no dispose).
  const head = [...u24(r.x / 2), ...u24(r.y / 2), ...u24(r.w - 1), ...u24(r.h - 1), ...u24(Math.max(1, duration)), 0x02];
  return chunk('ANMF', concat([new Uint8Array(head), data]));
}

function chunk(id: string, payload: ArrayLike<number>): Uint8Array {
  const size = payload.length;
  const out = new Uint8Array(8 + size + (size & 1));
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  out.set(u32(size), 4);
  out.set(payload, 8);
  return out;
}

function riff(chunks: Uint8Array[]): Uint8Array {
  const body = concat(chunks);
  const out = new Uint8Array(12 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  out.set(u32(body.length + 4), 4);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(body, 12);
  return out;
}

function u24(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
}

function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
