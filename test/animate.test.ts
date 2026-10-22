import { describe, expect, it } from 'vitest';
import { animationLength, loopIterations, wrapAnimated } from '../src/core/animate';
import { defaultHover, defaultIntro, defaultLoop, emptyAnim } from '../src/shared/anim';

describe('loopIterations', () => {
  const loop = { ...defaultLoop('pulse'), duration: 1, pause: 1 };

  it('fits whole motions inside the limit', () => {
    // starts at 2 s; motions end at 3, 5, …, 29 s → 14 cycles; the 15th would end at 31 s
    expect(loopIterations(loop, 2, 30)).toBe(14);
    expect(loopIterations(loop, 29.5, 30)).toBe(0);
  });

  it('loops forever without a limit', () => {
    expect(loopIterations(loop, 2, null)).toBe('infinite');
  });
});

describe('animationLength', () => {
  it('takes the latest intro or loop end', () => {
    const a = { ...emptyAnim(), intro: { ...defaultIntro('fadeIn'), delay: 0.5, duration: 1 } };
    const b = { ...emptyAnim(), loop: { ...defaultLoop('pulse'), delay: 0, duration: 1, pause: 1 } };
    expect(animationLength([a], 30)).toBe(1.5);
    expect(animationLength([a, b], 30)).toBe(29);
    expect(animationLength([a, b], null)).toBe('infinite');
  });
});

describe('wrapAnimated', () => {
  it('nests intro, loop and hover wrappers in that order', () => {
    const anim = { v: 1 as const, intro: defaultIntro('slideUp'), loop: defaultLoop('pulse'), hover: defaultHover('grow') };
    const w = wrapAnimated('n5', 'CTA', anim, 30);
    expect(w.open).toBe('<div class="n5-i"><div class="n5-l"><div class="n5-h">');
    expect(w.close).toBe('</div></div></div>');
    const css = w.css.join('\n');
    expect(css).toContain('@keyframes n5-i{from{opacity:0;transform:translateY(24px)}}');
    expect(css).toContain('#banner.play .n5-i{animation:n5-i 0.6s cubic-bezier(.33,1,.68,1) 0s both}');
    // pulse: 1 s motion + 1.5 s pause → motion is the first 40% of a 2.5 s cycle, starting 0.5 s after the intro
    expect(css).toContain('@keyframes n5-l{0%,40%,100%{transform:scale(1)}20%{transform:scale(1.08)}}');
    expect(css).toMatch(/#banner\.play \.n5-l\{animation:n5-l 2\.5s ease-in-out 1\.1s \d+\}/);
    expect(css).toContain('#banner:hover .n5-h{transform:scale(1.06)}');
  });

  it('uses the layer itself as hover trigger when asked', () => {
    const anim = { ...emptyAnim(), hover: { ...defaultHover('lift'), trigger: 'layer' as const } };
    expect(wrapAnimated('n2', 'CTA', anim, null).css).toContain('.n2:hover .n2-h{transform:translateY(-3px)}');
  });

  it('skips a loop that cannot fit and says so', () => {
    const anim = { ...emptyAnim(), loop: { ...defaultLoop('shake'), delay: 40 } };
    const w = wrapAnimated('n3', 'Logo', anim, 30);
    expect(w.open).toBe('');
    expect(w.warnings[0]).toContain('Logo');
  });
});
