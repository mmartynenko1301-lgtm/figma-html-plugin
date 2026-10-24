// Types for the parts of gifenc this plugin uses.
declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}

declare module 'gifenc/src/stream.js' {
  export interface Stream {
    writeByte(byte: number): void;
    writeBytes(data: ArrayLike<number>): void;
    bytes(): Uint8Array;
  }
  export default function createStream(initialCapacity?: number): Stream;
}

declare module 'gifenc/src/lzwEncode.js' {
  import type { Stream } from 'gifenc/src/stream.js';
  export default function lzwEncode(width: number, height: number, pixels: Uint8Array, colorDepth: number, stream: Stream, accum?: Uint8Array, htab?: Int32Array, codetab?: Int32Array): void;
}
