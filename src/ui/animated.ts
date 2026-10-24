import type { OutputFile } from '../core/generate';
import { fitToLimit } from '../core/optimize';
import type { AnimatedSettings } from '../shared/anim';
import { t } from '../shared/i18n';
import type { Captured } from './frames';
import { captureFrames, capturedBytes } from './frames';
import { encodeGif } from './gif';
import { createRenderer } from './render';
import { encodeWebp } from './webp';

// Animated GIF and WebP of one banner, compressed step by step until each fits the
// chosen size. Levels lower colours or quality first and frame rate last, since a
// choppy animation is the most visible loss.

export const GIF_LEVELS = [
  { colors: 256, step: 1 },
  { colors: 128, step: 1 },
  { colors: 64, step: 1 },
  { colors: 64, step: 2 },
  { colors: 32, step: 2 },
  { colors: 32, step: 3 },
  { colors: 16, step: 3 },
];

export const WEBP_LEVELS = [
  { quality: 0.9, step: 1 },
  { quality: 0.8, step: 1 },
  { quality: 0.7, step: 1 },
  { quality: 0.55, step: 1 },
  { quality: 0.45, step: 2 },
  { quality: 0.35, step: 2 },
  { quality: 0.25, step: 3 },
];

/** Frames above this much memory are refused, to keep Figma responsive. */
const MAX_CAPTURE_BYTES = 400 * 1024 * 1024;

export interface AnimatedFile {
  ext: 'gif' | 'webp';
  bytes: Uint8Array;
  /** What the compression settled on, for display. */
  label: string;
  fits: boolean;
}

export interface AnimatedResult {
  files: AnimatedFile[];
  /** Seconds of animation in the files. */
  duration: number;
}

export async function buildAnimated(
  page: { html: string; files: OutputFile[]; width: number; height: number },
  settings: AnimatedSettings,
  duration: number,
  onProgress?: (share: number) => void,
  signal?: { cancelled: boolean },
): Promise<AnimatedResult | null> {
  const renderer = await createRenderer(page.html, page.files, page.width, page.height);
  let captured: Captured | null;
  try {
    // Capture is most of the work, so it takes most of the progress bar.
    captured = await captureFrames(renderer, { fps: settings.fps, duration }, (s) => onProgress?.(s * 0.8), signal);
  } finally {
    renderer.dispose();
  }
  if (!captured) return null;
  if (capturedBytes(captured) > MAX_CAPTURE_BYTES) {
    throw new Error(t('Анімація задовга для GIF/WebP: зменште FPS або тривалість.', 'The animation is too long for GIF/WebP: lower the FPS or the duration.'));
  }
  const maxBytes = settings.maxKb === null ? null : settings.maxKb * 1024;
  const files: AnimatedFile[] = [];
  const fpsAt = (step: number) => Math.round((settings.fps / step) * 10) / 10;
  if (settings.gif) {
    const c = captured;
    const fitted = await fitToLimit(maxBytes, GIF_LEVELS.length, async (level) => {
      await idle();
      const bytes = encodeGif(c, GIF_LEVELS[level]);
      return { bytes: bytes.length, result: bytes };
    });
    const level = GIF_LEVELS[fitted.level];
    files.push({ ext: 'gif', bytes: fitted.result, fits: fitted.fits, label: t(`${level.colors} кольорів, ${fpsAt(level.step)} fps`, `${level.colors} colours, ${fpsAt(level.step)} fps`) });
  }
  onProgress?.(0.9);
  if (settings.webp) {
    const c = captured;
    const fitted = await fitToLimit(maxBytes, WEBP_LEVELS.length, async (level) => {
      const bytes = await encodeWebp(c, WEBP_LEVELS[level]);
      return { bytes: bytes.length, result: bytes };
    });
    const level = WEBP_LEVELS[fitted.level];
    files.push({ ext: 'webp', bytes: fitted.result, fits: fitted.fits, label: t(`якість ${Math.round(level.quality * 100)}%, ${fpsAt(level.step)} fps`, `quality ${Math.round(level.quality * 100)}%, ${fpsAt(level.step)} fps`) });
  }
  onProgress?.(1);
  return { files, duration };
}

/** Lets the interface repaint between long synchronous steps. */
function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
