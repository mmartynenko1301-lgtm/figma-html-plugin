import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultIntro, defaultLoop, parseAnim, parseSettings } from '../src/shared/anim';

describe('parseAnim', () => {
  it('round-trips stored settings', () => {
    const anim = { v: 1 as const, intro: defaultIntro('slideUp'), loop: defaultLoop('pulse'), hover: null, outro: null, custom: null };
    expect(parseAnim(JSON.stringify(anim))).toEqual(anim);
  });

  it('drops unknown presets and broken data instead of throwing', () => {
    expect(parseAnim('')).toBeNull();
    expect(parseAnim('{not json')).toBeNull();
    expect(parseAnim(JSON.stringify({ v: 2, intro: defaultIntro('fadeIn') }))).toBeNull();
    const parsed = parseAnim(JSON.stringify({ v: 1, intro: { preset: 'teleport' }, loop: { preset: 'shake', duration: -1, amount: 9 } }));
    expect(parsed?.intro).toBeNull();
    expect(parsed?.loop).toEqual({ ...defaultLoop('shake'), amount: 9 });
  });
});

describe('parseSettings', () => {
  it('falls back to defaults', () => {
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ v: 1, network: 'myspace', clickTag: 'https://a.b', backup: false }))).toEqual({
      ...DEFAULT_SETTINGS,
      clickTag: 'https://a.b',
      backup: false,
    });
  });

  it('reads the export format and keeps GIF or WebP on', () => {
    const stored = { v: 1, format: 'animated', animated: { gif: false, webp: false, fps: 10 }, image: { format: 'png', scale: 2 } };
    const s = parseSettings(JSON.stringify(stored));
    expect(s.format).toBe('animated');
    expect(s.animated).toMatchObject({ gif: true, webp: false, fps: 10 });
    expect(s.image).toEqual({ format: 'png', scale: 2 });
    expect(parseSettings(JSON.stringify({ v: 1, format: 'pdf', image: { format: 'bmp', scale: 3 } }))).toMatchObject({ format: 'html', image: { format: 'jpg', scale: 1 } });
  });
});

describe('older stored data', () => {
  it('reads phase 1 animations without outro or stagger', () => {
    const stored = JSON.stringify({ v: 1, intro: { preset: 'slideUp', delay: 1, duration: 0.6, easing: 'easeOut', amount: 24 }, loop: null, hover: null });
    const anim = parseAnim(stored);
    expect(anim?.outro).toBeNull();
    expect(anim?.intro).toMatchObject({ delay: 1, easing: 'easeOut', stagger: 0.08 });
  });
});
