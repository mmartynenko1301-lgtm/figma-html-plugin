import { describe, expect, it } from 'vitest';
import { animationLength, effectiveIntro, loopIterations, wrapAnimated } from '../src/core/animate';
import { defaultHover, defaultIntro, defaultLoop, defaultOutro, emptyAnim } from '../src/shared/anim';

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

const opts = (maxDuration: number | null) => ({ maxDuration, isText: false, pieces: 1, radius: null });

describe('wrapAnimated', () => {
  it('nests intro, loop and hover wrappers in that order', () => {
    const anim = { v: 1 as const, intro: defaultIntro('slideUp'), loop: defaultLoop('pulse'), hover: defaultHover('grow'), outro: null };
    const w = wrapAnimated('n5', 'CTA', anim, opts(30));
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
    expect(wrapAnimated('n2', 'CTA', anim, opts(null)).css).toContain('.n2:hover .n2-h{transform:translateY(-3px)}');
  });

  it('skips a loop that cannot fit and says so', () => {
    const anim = { ...emptyAnim(), loop: { ...defaultLoop('shake'), delay: 40 } };
    const w = wrapAnimated('n3', 'Logo', anim, opts(30));
    expect(w.open).toBe('');
    expect(w.warnings[0]).toContain('Logo');
  });
});

describe('phase 2 presets', () => {
  it('reveals with clip-path and slides out at the given time', () => {
    const anim = { ...emptyAnim(), intro: defaultIntro('revealRight'), outro: { ...defaultOutro('slideOutUp'), at: 4 } };
    const w = wrapAnimated('n4', 'Logo', anim, opts(30));
    expect(w.open).toBe('<div class="n4-o"><div class="n4-i">');
    const css = w.css.join('\n');
    expect(css).toContain('@keyframes n4-i{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}');
    expect(css).toContain('@keyframes n4-o{to{opacity:0;transform:translateY(-24px)}}');
    expect(css).toContain('#banner.play .n4-o{animation:n4-o 0.5s cubic-bezier(.32,0,.67,0) 4s forwards}');
  });

  it('clips the shine band to the layer corners', () => {
    const anim = { ...emptyAnim(), loop: defaultLoop('shine') };
    const css = wrapAnimated('n6', 'CTA', anim, { ...opts(30), radius: '8px' }).css.join('\n');
    expect(css).toContain('.n6-l{overflow:hidden;border-radius:8px}');
    expect(css).toMatch(/#banner\.play \.n6-l::after\{animation:n6-l 2\.8s ease-in-out 0\.5s \d+\}/);
  });

  it('starts a loop after the last split-text piece and drops split presets on non-text layers', () => {
    const intro = { ...defaultIntro('wordsUp'), delay: 0, duration: 0.5, stagger: 0.1 };
    const anim = { ...emptyAnim(), intro, loop: { ...defaultLoop('pulse'), delay: 0 } };
    // 4 words: last one starts at 0.3 s and ends at 0.8 s
    const text = wrapAnimated('n7', 'Title', anim, { ...opts(30), isText: true, pieces: 4 }).css.join('\n');
    expect(text).toMatch(/n7-l 2\.5s ease-in-out 0\.8s/);
    expect(effectiveIntro(intro, false)?.preset).toBe('fadeIn');
  });
});
