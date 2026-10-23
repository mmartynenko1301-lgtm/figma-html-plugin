import { animationLength, customIterations, loopIterations } from '../core/animate';
import type { LayerAnim } from '../shared/anim';
import { introEnd } from '../shared/anim';

/** Which setting a drag on the bar changes. */
export type BarKind = 'intro' | 'custom' | 'loop' | 'outro';

export interface Bar {
  kind: BarKind;
  start: number; // s
  end: number; // s
}

/**
 * Seconds the timeline shows: everything up to the last intro, keyframe or outro,
 * plus the first two cycles of each loop, so a loop running to the time limit
 * does not squeeze the rest into a corner.
 */
export function timelineSpan(anims: LayerAnim[], maxDuration: number | null): number {
  let end = 0;
  for (const anim of anims) {
    end = Math.max(end, introEnd(anim));
    if (anim.outro) end = Math.max(end, anim.outro.at + anim.outro.duration);
    if (anim.custom) {
      const n = customIterations(anim.custom, maxDuration);
      end = Math.max(end, anim.custom.delay + Math.min(n === 'infinite' ? 2 : n, 2) * anim.custom.duration);
    }
    if (anim.loop) end = Math.max(end, introEnd(anim) + anim.loop.delay + 2 * (anim.loop.duration + anim.loop.pause));
  }
  const length = animationLength(anims, maxDuration);
  const limit = length === 'infinite' ? Infinity : Math.max(length, 2);
  return Math.max(2, Math.ceil(Math.min(end, limit) + 0.5));
}

/** Tick step in seconds so the axis has at most about six labels. */
export function tickStep(span: number): number {
  return [0.5, 1, 2, 5, 10].find((step) => span / step <= 6) ?? 20;
}

/** Bars of one layer's timed animations, clipped to `span`. Split-text intros are drawn as one piece. */
export function layerBars(anim: LayerAnim, maxDuration: number | null, span: number): Bar[] {
  const bars: Bar[] = [];
  const push = (kind: BarKind, start: number, end: number) => {
    if (start < span) bars.push({ kind, start, end: Math.min(end, span) });
  };
  if (anim.intro) push('intro', anim.intro.delay, introEnd(anim));
  if (anim.custom) {
    const n = customIterations(anim.custom, maxDuration);
    const cycles = n === 'infinite' ? Math.ceil((span - anim.custom.delay) / Math.max(anim.custom.duration, 0.05)) : n;
    if (cycles > 0) push('custom', anim.custom.delay, anim.custom.delay + cycles * anim.custom.duration);
  }
  if (anim.loop) {
    const start = introEnd(anim) + anim.loop.delay;
    const cycle = anim.loop.duration + anim.loop.pause;
    const n = loopIterations(anim.loop, start, maxDuration);
    const count = n === 'infinite' ? Math.ceil((span - start) / Math.max(cycle, 0.05)) : n;
    for (let i = 0; i < count && i < 200; i++) push('loop', start + i * cycle, start + i * cycle + anim.loop.duration);
  }
  if (anim.outro) push('outro', anim.outro.at, anim.outro.at + anim.outro.duration);
  return bars;
}

/** The animation with the dragged bar moved by `dt` seconds (snapped to 0.05 s, never before 0). */
export function moveBar(anim: LayerAnim, kind: BarKind, dt: number): LayerAnim {
  const shift = (v: number) => Math.max(0, Math.round((v + dt) * 20) / 20);
  switch (kind) {
    case 'intro':
      return anim.intro ? { ...anim, intro: { ...anim.intro, delay: shift(anim.intro.delay) } } : anim;
    case 'custom':
      return anim.custom ? { ...anim, custom: { ...anim.custom, delay: shift(anim.custom.delay) } } : anim;
    case 'loop':
      return anim.loop ? { ...anim, loop: { ...anim.loop, delay: shift(anim.loop.delay) } } : anim;
    case 'outro':
      return anim.outro ? { ...anim, outro: { ...anim.outro, at: shift(anim.outro.at) } } : anim;
  }
}
