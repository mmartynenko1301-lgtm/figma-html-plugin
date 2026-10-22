import type { Easing, HoverAnim, IntroAnim, LayerAnim, LoopAnim } from '../shared/anim';
import { introEnd } from '../shared/anim';

// Each animated layer becomes nested wrappers, so intro, loop and hover transforms
// never overwrite each other or the layer's own placement:
//   .nX (placement) > .nX-i (intro) > .nX-l (loop) > .nX-h (hover) > layer content

const EASING_CSS: Record<Easing, string> = {
  easeOut: 'ease-out',
  easeOutCubic: 'cubic-bezier(.33,1,.68,1)',
  easeOutBack: 'cubic-bezier(.34,1.56,.64,1)',
  easeInOut: 'cubic-bezier(.65,0,.35,1)',
  easeIn: 'cubic-bezier(.32,0,.67,0)',
  linear: 'linear',
};

export interface Wrapped {
  open: string;
  close: string;
  css: string[];
  /** Human-readable problems, e.g. a loop that does not fit the time limit. */
  warnings: string[];
}

/**
 * Builds the wrapper markup and CSS for one layer.
 * @param cls class of the placement element that holds the wrappers
 * @param maxDuration network limit in seconds; loops are cut to fit, null = loop forever
 */
export function wrapAnimated(cls: string, name: string, anim: LayerAnim, maxDuration: number | null): Wrapped {
  const css: string[] = [];
  const warnings: string[] = [];
  const opens: string[] = [];

  if (anim.intro) {
    opens.push(`${cls}-i`);
    css.push(...introCss(`${cls}-i`, anim.intro));
  }
  if (anim.loop) {
    const start = introEnd(anim) + anim.loop.delay;
    const iterations = loopIterations(anim.loop, start, maxDuration);
    if (iterations === 0) {
      warnings.push(`Цикл «${name}» не вміщується в ліміт ${maxDuration} с і пропущений.`);
    } else {
      opens.push(`${cls}-l`);
      css.push(...loopCss(`${cls}-l`, anim.loop, start, iterations));
    }
  }
  if (anim.hover) {
    opens.push(`${cls}-h`);
    css.push(...hoverCss(cls, `${cls}-h`, anim.hover));
  }

  if (opens.length) css.unshift(`${opens.map((c) => `.${c}`).join(',')}{width:100%;height:100%;transform-origin:50% 50%}`);
  return {
    open: opens.map((c) => `<div class="${c}">`).join(''),
    close: '</div>'.repeat(opens.length),
    css,
    warnings,
  };
}

/** Number of loop cycles that fit before the limit; null limit means infinite. */
export function loopIterations(loop: LoopAnim, start: number, maxDuration: number | null): number | 'infinite' {
  if (maxDuration === null) return 'infinite';
  const cycle = loop.duration + loop.pause;
  if (cycle <= 0) return 0;
  // A cycle may end with its pause past the limit; the motion itself must fit.
  return Math.max(0, Math.floor((maxDuration - start - loop.duration) / cycle) + 1);
}

/** When the last motion ends, in seconds, for the time-limit summary in the UI. */
export function animationLength(anims: LayerAnim[], maxDuration: number | null): number | 'infinite' {
  let end = 0;
  for (const anim of anims) {
    end = Math.max(end, introEnd(anim));
    if (anim.loop) {
      const start = introEnd(anim) + anim.loop.delay;
      const n = loopIterations(anim.loop, start, maxDuration);
      if (n === 'infinite') return 'infinite';
      if (n > 0) end = Math.max(end, start + (n - 1) * (anim.loop.duration + anim.loop.pause) + anim.loop.duration);
    }
  }
  return round(end);
}

function introCss(cls: string, intro: IntroAnim): string[] {
  const a = intro.amount;
  const from = {
    fadeIn: 'opacity:0',
    slideUp: `opacity:0;transform:translateY(${n(a)}px)`,
    slideDown: `opacity:0;transform:translateY(${n(-a)}px)`,
    slideLeft: `opacity:0;transform:translateX(${n(a)}px)`,
    slideRight: `opacity:0;transform:translateX(${n(-a)}px)`,
    scaleIn: `opacity:0;transform:scale(${n(a)})`,
    zoomOut: `opacity:0;transform:scale(${n(a)})`,
  }[intro.preset];
  return [
    `@keyframes ${cls}{from{${from}}}`,
    `#banner.play .${cls}{animation:${cls} ${n(intro.duration)}s ${EASING_CSS[intro.easing]} ${n(intro.delay)}s both}`,
  ];
}

function loopCss(cls: string, loop: LoopAnim, start: number, iterations: number | 'infinite'): string[] {
  const cycle = loop.duration + loop.pause;
  // Motion takes the first p% of each cycle; the rest is the pause.
  const p = (loop.duration / cycle) * 100;
  const at = (fraction: number) => `${n(p * fraction)}%`;
  const a = loop.amount;
  let frames: string;
  switch (loop.preset) {
    case 'pulse':
      frames = `0%,${at(1)},100%{transform:scale(1)}${at(0.5)}{transform:scale(${n(a)})}`;
      break;
    case 'shake':
      frames =
        `0%,${at(1)},100%{transform:translateX(0)}` +
        `${at(0.2)},${at(0.6)}{transform:translateX(${n(-a)}px)}${at(0.4)},${at(0.8)}{transform:translateX(${n(a)}px)}`;
      break;
    case 'bounce':
      frames =
        `0%,${at(0.5)},${at(1)},100%{transform:translateY(0)}` +
        `${at(0.3)}{transform:translateY(${n(-a)}px)}${at(0.7)}{transform:translateY(${n(-a / 2)}px)}`;
      break;
    case 'float':
      frames = `0%,${at(1)},100%{transform:translateY(0)}${at(0.5)}{transform:translateY(${n(-a)}px)}`;
      break;
    case 'wiggle':
      frames =
        `0%,${at(1)},100%{transform:rotate(0)}` +
        `${at(0.2)},${at(0.6)}{transform:rotate(${n(-a)}deg)}${at(0.4)},${at(0.8)}{transform:rotate(${n(a)}deg)}`;
      break;
  }
  return [
    `@keyframes ${cls}{${frames}}`,
    `#banner.play .${cls}{animation:${cls} ${n(cycle)}s ease-in-out ${n(start)}s ${iterations}}`,
  ];
}

function hoverCss(placementCls: string, cls: string, hover: HoverAnim): string[] {
  const a = hover.amount;
  const state = {
    grow: `transform:scale(${n(a)})`,
    shrink: `transform:scale(${n(a)})`,
    lift: `transform:translateY(${n(-a)}px)`,
    brighten: `filter:brightness(${n(a)})`,
  }[hover.preset];
  const trigger = hover.trigger === 'banner' ? '#banner:hover' : `.${placementCls}:hover`;
  return [
    `.${cls}{transition:transform ${n(hover.duration)}s ease-out,filter ${n(hover.duration)}s ease-out}`,
    `${trigger} .${cls}{${state}}`,
  ];
}

function n(v: number): string {
  return String(round(v));
}

function round(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}
