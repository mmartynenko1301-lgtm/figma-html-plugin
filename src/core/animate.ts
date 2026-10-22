import type { CustomAnim, Easing, HoverAnim, IntroAnim, Keyframe, LayerAnim, LoopAnim, OutroAnim } from '../shared/anim';
import { introEnd, isSplitPreset } from '../shared/anim';

// Each animated layer becomes nested wrappers, so outro, intro, loop and hover
// transforms never overwrite each other or the layer's own placement:
//   .nX (placement) > .nX-o (outro) > .nX-i (intro) > .nX-c (custom keyframes) > .nX-l (loop) > .nX-h (hover) > layer content
// Split-text intros animate the words or letters inside the text instead of a wrapper.

const EASING_CSS: Record<Easing, string> = {
  easeOut: 'ease-out',
  easeOutCubic: 'cubic-bezier(.33,1,.68,1)',
  easeOutBack: 'cubic-bezier(.34,1.56,.64,1)',
  easeInOut: 'cubic-bezier(.65,0,.35,1)',
  easeIn: 'cubic-bezier(.32,0,.67,0)',
  linear: 'linear',
};

export interface WrapOptions {
  /** Network limit in seconds; loops are cut to fit. Null = loop forever. */
  maxDuration: number | null;
  /** True for text layers, which can take split-text intros. */
  isText: boolean;
  /** Words or letters the split intro animates (1 when not split). */
  pieces: number;
  /** CSS border-radius of the layer, so the shine highlight follows rounded corners. */
  radius: string | null;
}

export interface Wrapped {
  open: string;
  close: string;
  css: string[];
  /** Human-readable problems, e.g. a loop that does not fit the time limit. */
  warnings: string[];
}

/** The intro a layer actually gets: split-text presets fall back to a fade on non-text layers. */
export function effectiveIntro(intro: IntroAnim | null, isText: boolean): IntroAnim | null {
  if (intro && isSplitPreset(intro.preset) && !isText) return { ...intro, preset: 'fadeIn' };
  return intro;
}

/**
 * Builds the wrapper markup and CSS for one layer.
 * @param cls class of the placement element that holds the wrappers
 */
export function wrapAnimated(cls: string, name: string, anim: LayerAnim, opts: WrapOptions): Wrapped {
  const css: string[] = [];
  const warnings: string[] = [];
  const opens: string[] = [];
  const intro = effectiveIntro(anim.intro, opts.isText);

  if (anim.outro) {
    opens.push(`${cls}-o`);
    css.push(...outroCss(`${cls}-o`, anim.outro));
  }
  if (intro && !isSplitPreset(intro.preset)) {
    opens.push(`${cls}-i`);
    css.push(...introCss(`${cls}-i`, intro));
  }
  if (anim.custom) {
    const iterations = customIterations(anim.custom, opts.maxDuration);
    if (iterations === 0) {
      warnings.push(`Власна анімація «${name}» не вміщується в ліміт ${opts.maxDuration} с і пропущена.`);
    } else {
      if (anim.custom.repeat > 0 && iterations !== anim.custom.repeat) {
        warnings.push(`Власну анімацію «${name}» скорочено до ${iterations} повторів, щоб вміститися в ліміт ${opts.maxDuration} с.`);
      }
      opens.push(`${cls}-c`);
      css.push(...customCss(`${cls}-c`, anim.custom, iterations));
    }
  }
  if (anim.loop) {
    const start = introEnd({ ...anim, intro }, opts.pieces) + anim.loop.delay;
    const iterations = loopIterations(anim.loop, start, opts.maxDuration);
    if (iterations === 0) {
      warnings.push(`Цикл «${name}» не вміщується в ліміт ${opts.maxDuration} с і пропущений.`);
    } else {
      opens.push(`${cls}-l`);
      css.push(...loopCss(`${cls}-l`, anim.loop, start, iterations, opts.radius));
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

/**
 * CSS for a split-text intro. Each piece gets class `cls` and an inline
 * animation-delay from {@link pieceDelay}.
 */
export function splitCss(cls: string, intro: IntroAnim): string[] {
  const words = intro.preset === 'wordsUp';
  const from = words ? `opacity:0;transform:translateY(${n(intro.amount)}px)` : 'opacity:0';
  return [
    // Words need inline-block to move; letters stay inline so words still wrap as whole words.
    `.${cls}{display:${words ? 'inline-block' : 'inline'};white-space:pre}`,
    `@keyframes ${cls}{from{${from}}}`,
    `#banner.play .${cls}{animation:${cls} ${n(intro.duration)}s ${EASING_CSS[intro.easing]} both}`,
  ];
}

export function pieceDelay(intro: IntroAnim, index: number): string {
  return `${n(intro.delay + intro.stagger * index)}s`;
}

/** Number of loop cycles that fit before the limit; null limit means infinite. */
export function loopIterations(loop: LoopAnim, start: number, maxDuration: number | null): number | 'infinite' {
  if (maxDuration === null) return 'infinite';
  const cycle = loop.duration + loop.pause;
  if (cycle <= 0) return 0;
  // A cycle may end with its pause past the limit; the motion itself must fit.
  return Math.max(0, Math.floor((maxDuration - start - loop.duration) / cycle) + 1);
}

/** Cycles of a custom animation: its repeat count, cut to what fits the limit; repeat 0 fills the limit. */
export function customIterations(custom: CustomAnim, maxDuration: number | null): number | 'infinite' {
  if (maxDuration === null) return custom.repeat === 0 ? 'infinite' : custom.repeat;
  if (custom.duration <= 0) return 0;
  const fit = Math.max(0, Math.floor((maxDuration - custom.delay) / custom.duration + 1e-9));
  return custom.repeat === 0 ? fit : Math.min(custom.repeat, fit);
}

/** When the last motion ends, in seconds, for the time-limit summary in the UI. */
export function animationLength(anims: LayerAnim[], maxDuration: number | null): number | 'infinite' {
  let end = 0;
  for (const anim of anims) {
    end = Math.max(end, introEnd(anim));
    if (anim.outro) end = Math.max(end, anim.outro.at + anim.outro.duration);
    if (anim.custom) {
      const n = customIterations(anim.custom, maxDuration);
      if (n === 'infinite') return 'infinite';
      end = Math.max(end, anim.custom.delay + n * anim.custom.duration);
    }
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
  const from: Record<string, string> = {
    fadeIn: 'opacity:0',
    slideUp: `opacity:0;transform:translateY(${n(a)}px)`,
    slideDown: `opacity:0;transform:translateY(${n(-a)}px)`,
    slideLeft: `opacity:0;transform:translateX(${n(a)}px)`,
    slideRight: `opacity:0;transform:translateX(${n(-a)}px)`,
    scaleIn: `opacity:0;transform:scale(${n(a)})`,
    zoomOut: `opacity:0;transform:scale(${n(a)})`,
    revealRight: 'clip-path:inset(0 100% 0 0)',
    revealUp: 'clip-path:inset(100% 0 0 0)',
  };
  const to = intro.preset.startsWith('reveal') ? 'to{clip-path:inset(0 0 0 0)}' : '';
  return [
    `@keyframes ${cls}{from{${from[intro.preset]}}${to}}`,
    `#banner.play .${cls}{animation:${cls} ${n(intro.duration)}s ${EASING_CSS[intro.easing]} ${n(intro.delay)}s both}`,
  ];
}

function outroCss(cls: string, outro: OutroAnim): string[] {
  const a = outro.amount;
  const to = {
    fadeOut: 'opacity:0',
    slideOutUp: `opacity:0;transform:translateY(${n(-a)}px)`,
    slideOutDown: `opacity:0;transform:translateY(${n(a)}px)`,
    slideOutLeft: `opacity:0;transform:translateX(${n(-a)}px)`,
    slideOutRight: `opacity:0;transform:translateX(${n(a)}px)`,
    zoomAway: `opacity:0;transform:scale(${n(a)})`,
  }[outro.preset];
  return [
    `@keyframes ${cls}{to{${to}}}`,
    `#banner.play .${cls}{animation:${cls} ${n(outro.duration)}s ${EASING_CSS[outro.easing]} ${n(outro.at)}s forwards}`,
  ];
}

function customCss(cls: string, custom: CustomAnim, iterations: number | 'infinite'): string[] {
  const frames = [...custom.keyframes].sort((a, b) => a.at - b.at).map((k) => `${n(k.at)}%{${keyframeRules(k)}}`).join('');
  return [
    `@keyframes ${cls}{${frames}}`,
    `#banner.play .${cls}{animation:${cls} ${n(custom.duration)}s ${EASING_CSS[custom.easing]} ${n(custom.delay)}s ${iterations} both}`,
  ];
}

function keyframeRules(k: Keyframe): string {
  const parts: string[] = [];
  if (k.x !== 0 || k.y !== 0) parts.push(`translate(${n(k.x)}px,${n(k.y)}px)`);
  if (k.rotate !== 0) parts.push(`rotate(${n(k.rotate)}deg)`);
  if (k.scale !== 1) parts.push(`scale(${n(k.scale)})`);
  return `transform:${parts.length ? parts.join(' ') : 'none'};opacity:${n(k.opacity)}`;
}

function loopCss(cls: string, loop: LoopAnim, start: number, iterations: number | 'infinite', radius: string | null): string[] {
  const cycle = loop.duration + loop.pause;
  // Motion takes the first p% of each cycle; the rest is the pause.
  const p = (loop.duration / cycle) * 100;
  const at = (fraction: number) => `${n(p * fraction)}%`;
  const a = loop.amount;
  const timing = `${n(cycle)}s ease-in-out ${n(start)}s ${iterations}`;

  if (loop.preset === 'shine') {
    // A soft light band sweeps across the layer; the wrapper clips it to the layer's shape.
    return [
      `.${cls}{overflow:hidden${radius ? `;border-radius:${radius}` : ''}}`,
      `.${cls}::after{content:"";position:absolute;top:0;left:0;width:60%;height:100%;pointer-events:none;` +
        `background:linear-gradient(100deg,rgba(255,255,255,0) 20%,rgba(255,255,255,${n(a)}) 50%,rgba(255,255,255,0) 80%);transform:translateX(-120%)}`,
      `@keyframes ${cls}{0%{transform:translateX(-120%)}${at(1)},100%{transform:translateX(200%)}}`,
      `#banner.play .${cls}::after{animation:${cls} ${timing}}`,
    ];
  }

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
  return [`@keyframes ${cls}{${frames}}`, `#banner.play .${cls}{animation:${cls} ${timing}}`];
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
