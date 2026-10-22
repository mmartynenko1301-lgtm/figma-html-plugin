import { describe, expect, it } from 'vitest';
import { defaultHover, defaultIntro, defaultLoop } from '../src/shared/anim';
import { color, generate, googleFontsUrl } from '../src/core/generate';
import { sampleBanner } from './fixtures';

describe('generate', () => {
  const { html, files } = generate(sampleBanner(), { clickTag: 'https://example.com/?a=1&b="2"' });

  it('produces the head tags ad networks require', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta name="ad.size" content="width=300,height=250">');
    expect(html).toContain('var clickTag = "https://example.com/?a=1&b=\\"2\\"";');
    expect(html).toContain('window.open(window.clickTag,"_blank")');
  });

  it('places layers with left/top or a matrix', () => {
    expect(html).toMatch(/\.n\d+\{width:120px;height:40px;left:20px;top:180px;background-color:#0d99ff;border-radius:8px\}/);
    expect(html).toMatch(/\.n\d+\{width:50px;height:40px;transform:matrix\(0,1,-1,0,100,100\);opacity:0\.5\}/);
  });

  it('escapes text and keeps segment styles', () => {
    expect(html).toContain('<span class="n2s1">sale &lt;50%&gt;</span>');
    expect(html).toMatch(/\.n2s1\{font-family:'Inter',sans-serif;font-weight:700;font-size:16px;line-height:normal;color:#ff0000;font-style:italic\}/);
  });

  it('links the Google Fonts styles in use', () => {
    expect(html).toContain('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700&amp;display=swap');
  });

  it('writes identical images once', () => {
    expect(files.map((f) => f.path)).toEqual(['index.html', 'img/1.png']);
    expect(html.match(/src="img\/1\.png"/g)).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('formats colors', () => {
    expect(color({ r: 1, g: 0.5, b: 0, a: 1 })).toBe('#ff8000');
    expect(color({ r: 0, g: 0, b: 0, a: 0.25 })).toBe('rgba(0,0,0,0.25)');
  });

  it('builds a Google Fonts URL for several families', () => {
    const url = googleFontsUrl(new Map([['Open Sans', new Set(['0,700', '0,400'])], ['Inter', new Set(['0,400'])]]));
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400&family=Open+Sans:ital,wght@0,400;0,700&display=swap');
  });
});

describe('generate with animations', () => {
  const banner = sampleBanner();
  const anims = {
    '0:2': { v: 1 as const, intro: defaultIntro('fadeIn'), loop: null, hover: null },
    '0:3': { v: 1 as const, intro: null, loop: defaultLoop('pulse'), hover: defaultHover('grow') },
  };
  const { html, warnings } = generate(banner, { clickTag: 'https://example.com', anims, maxDuration: 30 });

  it('moves placement to an outer element and keeps the layer inside the wrappers', () => {
    expect(html).toMatch(/<div class="(n\d+)"><div class="\1-i"><div class="n\d+" data-name="Headline">/);
    expect(html).toMatch(/<div class="(n\d+)"><div class="\1-l"><div class="\1-h"><div class="n\d+" data-name="CTA">/);
    // the CTA content keeps its size but loses its left/top
    expect(html).toMatch(/\.n\d+\{width:120px;height:40px;background-color:#0d99ff;border-radius:8px\}/);
    expect(warnings).toEqual([]);
  });

  it('starts animations only after load and respects reduced motion', () => {
    expect(html).toContain('#banner.play{visibility:visible}');
    expect(html).toContain('prefers-reduced-motion:reduce');
    expect(html).toContain('b.classList.add("play")');
  });
});
