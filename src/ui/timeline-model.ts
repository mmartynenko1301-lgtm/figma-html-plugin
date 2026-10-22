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

/** Seconds the timeline shows: the whole animation plus a little air, or 10 s for endless loops. */
export function timelineSpan(anims: LayerAnim[], maxDuration: number | null): number {
  const length = animationLength(anims, maxDuration);
  if (length === 'infinite') return 10;
  return Math.max(2, Math.ceil(length + 0.5));
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
