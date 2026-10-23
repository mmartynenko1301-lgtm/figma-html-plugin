import type { Asset } from '../shared/ir';
import { t } from '../shared/i18n';

// Shrinks a banner until its ZIP fits the network limit. Each level is tried in
// order and the first that fits wins, so images lose only as much quality as needed.
// Image work goes through an ImageCodec so this logic runs without a browser in tests.

export interface OptimizeLevel {
  /** JPEG quality for opaque images, or null to keep them as PNG. */
  jpegQuality: number | null;
  /** Pixel size relative to the export (images are exported @2x, so 0.5 is 1x). */
  scale: number;
  label: string;
}

export const LEVELS: OptimizeLevel[] = [
  {
    jpegQuality: null,
    scale: 1,
    get label() {
      return t('без стиснення', 'no compression');
    },
  },
  { jpegQuality: 0.9, scale: 1, label: 'JPEG 90%, @2x' },
  { jpegQuality: 0.82, scale: 0.75, label: 'JPEG 82%, @1.5x' },
  { jpegQuality: 0.75, scale: 0.5, label: 'JPEG 75%, @1x' },
  { jpegQuality: 0.6, scale: 0.5, label: 'JPEG 60%, @1x' },
];

export interface EncodeOptions {
  format: 'png' | 'jpg';
  quality: number;
  scale: number;
}

export interface ImageCodec {
  /** True when the raster image has no transparent pixels, so it can become a JPEG. */
  isOpaque(asset: Asset): Promise<boolean>;
  /** Re-encodes a raster image; null when it cannot be decoded. */
  encode(asset: Asset, options: EncodeOptions): Promise<Uint8Array | null>;
}

/** Images smaller than this are left alone: re-encoding them saves almost nothing. */
const MIN_BYTES = 2048;

/** Assets for one level. Lossless SVG cleanup applies at every level. */
export async function optimizeAssets(assets: Asset[], level: OptimizeLevel, codec: ImageCodec): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const asset of assets) {
    // A canvas re-encode would keep only the first frame of an animated GIF.
    if (asset.ext === 'gif') {
      out.push(asset);
      continue;
    }
    if (asset.ext === 'svg') {
      out.push({ ...asset, bytes: minifySvg(asset.bytes) });
      continue;
    }
    const lossy = level.jpegQuality !== null || level.scale < 1;
    if (!lossy || asset.bytes.length < MIN_BYTES) {
      out.push(asset);
      continue;
    }
    const opaque = level.jpegQuality !== null && (await codec.isOpaque(asset));
    const format = opaque ? 'jpg' : 'png';
    // A transparent PNG at full scale has nothing to gain from a canvas re-encode.
    if (format === 'png' && level.scale >= 1) {
      out.push(asset);
      continue;
    }
    const bytes = await codec.encode(asset, { format, quality: level.jpegQuality ?? 1, scale: level.scale });
    out.push(bytes && bytes.length < asset.bytes.length ? { ...asset, ext: format, bytes } : asset);
  }
  return out;
}

export interface Attempt<T> {
  bytes: number;
  result: T;
}

export interface Fitted<T> {
  result: T;
  /** Index into LEVELS of the level used. */
  level: number;
  fits: boolean;
}

/**
 * Tries levels in order until one fits `maxBytes`; with no limit only the first level runs.
 * When nothing fits, returns the smallest result.
 */
export async function fitToLimit<T>(maxBytes: number | null, levels: number, attempt: (level: number) => Promise<Attempt<T>>): Promise<Fitted<T>> {
  let best: (Attempt<T> & { level: number }) | null = null;
  for (let level = 0; level < levels; level++) {
    const a = await attempt(level);
    if (maxBytes === null || a.bytes <= maxBytes) return { result: a.result, level, fits: true };
    if (!best || a.bytes < best.bytes) best = { ...a, level };
  }
  return { result: best!.result, level: best!.level, fits: false };
}

/** Drops comments, metadata and whitespace between tags; the drawing itself is untouched. */
export function minifySvg(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  const min = text
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
    // Only line breaks between tags: spaces inside <text> may be content.
    .replace(/>\s*\n\s*</g, '><')
    .trim();
  const out = new TextEncoder().encode(min);
  return out.length < bytes.length ? out : bytes;
}
