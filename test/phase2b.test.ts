import { describe, expect, it } from 'vitest';
import { customIterations, animationLength, wrapAnimated } from '../src/core/animate';
import { generate } from '../src/core/generate';
import type { ImageCodec } from '../src/core/optimize';
import { LEVELS, fitToLimit, minifySvg, optimizeAssets } from '../src/core/optimize';
import { defaultCustom, defaultIntro, defaultLoop, defaultOutro, emptyAnim, parseAnim, parsePresets } from '../src/shared/anim';
import type { Asset } from '../src/shared/ir';
import { withNewFrame } from '../src/ui/keyframes';
import { layerBars, moveBar, tickStep, timelineSpan } from '../src/ui/timeline-model';
import { sampleBanner } from './fixtures';

const opts = { maxDuration: 30, isText: false, pieces: 1, radius: null };

describe('custom keyframes', () => {
  it('emits a keyframe wrapper with repeat count', () => {
    const custom = { ...defaultCustom(), delay: 0.5, duration: 2, repeat: 3 };
    const w = wrapAnimated('n1', 'Logo', { ...emptyAnim(), custom }, opts);
    expect(w.open).toBe('<div class="n1-c">');
    const css = w.css.join('\n');
    expect(css).toContain('0%{transform:translate(0px,20px);opacity:0}');
    expect(css).toContain('100%{transform:none;opacity:1}');
    expect(css).toContain('animation:n1-c 2s cubic-bezier(.65,0,.35,1) 0.5s 3 both');
  });

  it('nests custom between intro and loop', () => {
    const anim = { ...emptyAnim(), intro: defaultIntro('fadeIn'), custom: defaultCustom(), loop: defaultLoop('pulse'), outro: defaultOutro('fadeOut') };
    expect(wrapAnimated('n1', 'X', anim, opts).open).toBe('<div class="n1-o"><div class="n1-i"><div class="n1-c"><div class="n1-l">');
  });

  it('cuts repeats to the time limit', () => {
    const custom = { ...defaultCustom(), delay: 1, duration: 4, repeat: 0 };
    expect(customIterations(custom, 30)).toBe(7);
    expect(customIterations(custom, null)).toBe('infinite');
    expect(customIterations({ ...custom, repeat: 20 }, 30)).toBe(7);
    const w = wrapAnimated('n1', 'Logo', { ...emptyAnim(), custom: { ...custom, repeat: 20 } }, opts);
    expect(w.warnings[0]).toContain('7 повторів');
    expect(animationLength([{ ...emptyAnim(), custom }], 30)).toBe(29);
  });

  it('survives storage and rejects broken keyframes', () => {
    const anim = { ...emptyAnim(), custom: { ...defaultCustom(), keyframes: [{ at: 100, x: -5, y: 0, scale: 1, rotate: -10, opacity: 1 }, { at: 0, x: 0, y: 0, scale: 0.5, rotate: 0, opacity: 0 }] } };
    const parsed = parseAnim(JSON.stringify(anim))!;
    expect(parsed.custom!.keyframes.map((k) => k.at)).toEqual([0, 100]);
    expect(parsed.custom!.keyframes[1].rotate).toBe(-10);
    expect(parseAnim(JSON.stringify({ v: 1, custom: { keyframes: [] } }))).toBeNull();
    expect(parseAnim(JSON.stringify({ v: 1, custom: { keyframes: [{ at: 300, opacity: 7 }] } }))!.custom!.keyframes[0]).toMatchObject({ at: 100, opacity: 1 });
  });

  it('adds keyframes where there is room', () => {
    const k = (at: number) => ({ at, x: at, y: 0, scale: 1, rotate: 0, opacity: 1 });
    expect(withNewFrame([k(0)]).map((f) => f.at)).toEqual([0, 100]);
    expect(withNewFrame([k(0), k(100)]).map((f) => f.at)).toEqual([0, 50, 100]);
    expect(withNewFrame([k(0), k(80), k(100)])[1]).toMatchObject({ at: 40, x: 0 });
  });
});

describe('presets', () => {
  it('reads exported JSON and drops broken entries', () => {
    const json = JSON.stringify({
      app: 'banner-export',
      presets: [
        { id: 'a', name: ' CTA pulse ', anim: { ...emptyAnim(), loop: defaultLoop('pulse') } },
        { id: 'b', name: '', anim: { ...emptyAnim(), loop: defaultLoop('pulse') } },
        { id: 'c', name: 'Empty', anim: emptyAnim() },
      ],
    });
    const list = parsePresets(json);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', name: 'CTA pulse' });
    expect(parsePresets('nonsense')).toEqual([]);
  });
});

describe('optimize', () => {
  const png = (id: string, size: number): Asset => ({ id, ext: 'png', bytes: new Uint8Array(size) });
  const codec = (opaque: boolean): ImageCodec => ({
    isOpaque: async () => opaque,
    encode: async (asset, o) => new Uint8Array(Math.round(asset.bytes.length * o.scale * o.scale * (o.format === 'jpg' ? o.quality / 3 : 1))),
  });

  it('turns opaque PNGs into smaller JPEGs and only downscales transparent ones', async () => {
    const assets = [png('a', 30000), png('tiny', 500)];
    const l1 = await optimizeAssets(assets, LEVELS[1], codec(true));
    expect(l1[0].ext).toBe('jpg');
    expect(l1[1]).toBe(assets[1]);
    const t1 = await optimizeAssets(assets, LEVELS[1], codec(false));
    expect(t1[0]).toBe(assets[0]);
    const t3 = await optimizeAssets(assets, LEVELS[3], codec(false));
    expect(t3[0]).toMatchObject({ ext: 'png' });
    expect(t3[0].bytes.length).toBe(7500);
  });

  it('stops at the first level that fits', async () => {
    const sizes = [900, 700, 500, 300, 200];
    const tried: number[] = [];
    const fit = await fitToLimit(600, sizes.length, async (level) => (tried.push(level), { bytes: sizes[level], result: level }));
    expect(fit).toEqual({ result: 2, level: 2, fits: true });
    expect(tried).toEqual([0, 1, 2]);
    expect(await fitToLimit(100, sizes.length, async (l) => ({ bytes: sizes[l], result: l }))).toEqual({ result: 4, level: 4, fits: false });
    expect((await fitToLimit(null, sizes.length, async (l) => ({ bytes: sizes[l], result: l }))).level).toBe(0);
  });

  it('keeps generated paths in step with new extensions', async () => {
    const banner = sampleBanner();
    const assets = await optimizeAssets(
      banner.assets.map((a) => ({ ...a, bytes: new Uint8Array(5000) })),
      LEVELS[2],
      codec(true),
    );
    const { html, files } = generate({ ...banner, assets }, { clickTag: 'x' });
    const raster = files.filter((f) => f.path.startsWith('img/') && !f.path.endsWith('.svg'));
    for (const f of raster) {
      expect(f.path.endsWith('.jpg')).toBe(true);
      expect(html).toContain(`src="${f.path}"`);
    }
  });

  it('minifies SVG without touching the drawing', () => {
    const svg = '<?xml version="1.0"?>\n<!-- Figma -->\n<svg width="2">\n  <path d="M0 0"/>\n</svg>\n';
    expect(new TextDecoder().decode(minifySvg(new TextEncoder().encode(svg)))).toBe('<svg width="2"><path d="M0 0"/></svg>');
  });
});

describe('timeline', () => {
  it('lays out bars and moves them by dragging', () => {
    const anim = { ...emptyAnim(), intro: { ...defaultIntro('fadeIn'), delay: 0.5, duration: 1 }, loop: { ...defaultLoop('pulse'), delay: 0, duration: 1, pause: 1 }, outro: { ...defaultOutro('fadeOut'), at: 6 } };
    const span = timelineSpan([anim], 8);
    expect(span).toBe(7);
    const bars = layerBars(anim, 8, span);
    expect(bars[0]).toEqual({ kind: 'intro', start: 0.5, end: 1.5 });
    expect(bars.filter((b) => b.kind === 'loop').map((b) => b.start)).toEqual([1.5, 3.5, 5.5]);
    expect(bars[bars.length - 1]).toEqual({ kind: 'outro', start: 6, end: 6.5 });
    expect(moveBar(anim, 'intro', 0.33).intro!.delay).toBe(0.85);
    expect(moveBar(anim, 'outro', -10).outro!.at).toBe(0);
    expect(timelineSpan([{ ...emptyAnim(), loop: defaultLoop('pulse') }], null)).toBe(6);
    expect(tickStep(7)).toBe(2);
    expect(tickStep(3)).toBe(0.5);
  });
});

describe('gif', () => {
  it('keeps GIF files as they are and sizes them like Figma', async () => {
    const gif: Asset = { id: 'g', ext: 'gif', bytes: new Uint8Array(50000) };
    const never: ImageCodec = { isOpaque: async () => true, encode: async () => { throw new Error('no re-encode'); } };
    expect((await optimizeAssets([gif], LEVELS[4], never))[0]).toBe(gif);

    const banner = sampleBanner();
    banner.assets.push(gif);
    banner.root.children.push({ kind: 'image', id: 'bg#gif', name: 'Bg', transform: [1, 0, 0, 1, 0, 0], width: 300, height: 250, opacity: 1, assetId: 'g', fit: 'cover' });
    const { html, files } = generate(banner, { clickTag: 'x' });
    const path = files.find((f) => f.path.endsWith('.gif'))!.path;
    expect(html).toContain(`src="${path}"`);
    expect(html).toMatch(/width:300px;height:250px;object-fit:cover/);
  });
});
