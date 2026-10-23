import type { Asset, Banner, BannerNode, BoxNode, ImageNode, Matrix, RGBA, Shadow, TextNode, TextSegment } from '../shared/ir';
import type { IntroAnim, LayerAnim } from '../shared/anim';
import { isEmptyAnim, isSplitPreset } from '../shared/anim';
import { effectiveIntro, pieceDelay, splitCss, wrapAnimated } from './animate';
import { isTranslation } from './matrix';
import type { Platform } from './networks';

export interface GenerateOptions {
  clickTag: string;
  /** Animations by layer id. Layers missing from the banner (e.g. inside a rasterized group) are ignored. */
  anims?: Record<string, LayerAnim>;
  /** Network time limit in seconds; loops are cut to fit. Null or absent = no limit. */
  maxDuration?: number | null;
  /** Packaging and click handling for the target network. Default: standard index.html + clickTag. */
  platform?: Platform;
}

export interface OutputFile {
  path: string;
  data: string | Uint8Array;
}

export interface GenerateResult {
  /** A complete HTML document for previewing (for Admixer, body.html wrapped in a page). */
  html: string;
  files: OutputFile[];
  warnings: string[];
}

export function generate(banner: Banner, options: GenerateOptions): GenerateResult {
  const assetPaths = placeAssets(banner.assets);
  const ctx: Ctx = {
    css: [],
    fonts: new Map(),
    assetPaths,
    counter: 0,
    anims: options.anims ?? {},
    maxDuration: options.maxDuration ?? null,
    warnings: [],
  };

  const body = renderBox(banner.root, ctx, true);
  const platform = options.platform ?? 'standard';
  const parts = pageParts(banner, options, ctx, body, platform);

  let html: string;
  const files: OutputFile[] = [];
  if (platform === 'admixer') {
    // Admixer injects body.html into its own page, so the file holds only body content.
    const fragment = [...parts.head, ...parts.body].join('\n') + '\n';
    files.push({ path: 'body.html', data: fragment });
    html = documentOf(banner, [], [fragment]);
  } else {
    html = documentOf(banner, parts.head, parts.body);
    files.push({ path: 'index.html', data: html });
  }
  if (platform === 'adform') files.push({ path: 'manifest.json', data: adformManifest(banner, options.clickTag) });

  const written = new Set<string>();
  for (const asset of banner.assets) {
    const path = assetPaths.get(asset.id)!;
    if (written.has(path)) continue;
    written.add(path);
    files.push({ path, data: asset.bytes });
  }
  return { html, files, warnings: ctx.warnings };
}

interface Ctx {
  css: string[];
  /** family → set of "italic,weight" keys */
  fonts: Map<string, Set<string>>;
  assetPaths: Map<string, string>;
  counter: number;
  anims: Record<string, LayerAnim>;
  maxDuration: number | null;
  warnings: string[];
}

function pageParts(banner: Banner, options: GenerateOptions, ctx: Ctx, body: string, platform: Platform): { head: string[]; body: string[] } {
  const { width: w, height: h } = banner;
  const fontsLink = googleFontsUrl(ctx.fonts);
  const head = [
    fontsLink ? `<link rel="stylesheet" href="${escapeHtml(fontsLink)}">` : '',
    platform === 'adform' ? `<script>${ADFORM_DHTML}</script>` : '',
    '<style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    `html,body{width:${w}px;height:${h}px;overflow:hidden}`,
    `#banner{position:relative;width:${w}px;height:${h}px;overflow:hidden;cursor:pointer;visibility:hidden}`,
    '#banner.play{visibility:visible}',
    // :where() keeps specificity at zero so per-layer classes override these defaults.
    ':where(#banner div,#banner img){position:absolute;left:0;top:0;transform-origin:0 0}',
    ':where(#banner img){display:block}',
    ...ctx.css,
    '@media (prefers-reduced-motion:reduce){#banner *,#banner *::after{animation:none!important;transition:none!important}}',
    '</style>',
    `<script>var clickTag = ${JSON.stringify(options.clickTag).replace(/</g, '\\u003c')};</script>`,
  ].filter((line) => line !== '');
  return { head, body: [body, `<script>${runtime(platform, w, h)}</script>`] };
}

function documentOf(banner: Banner, head: string[], body: string[]): string {
  const { width: w, height: h } = banner;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta name="ad.size" content="width=${w},height=${h}">`,
    `<title>${escapeHtml(banner.name)}</title>`,
    ...head,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Loads Adform's DHTML library, which provides dhtml.getVar for clickTAG.
// https://support.adform.com/documentation/coty-manuals-old/building-banners-for-use-in-adform/adding-clicktag-s-to-banners
const ADFORM_DHTML =
  "document.write('<script src=\"'+(window.API_URL||'https://s1.adform.net/banners/scripts/rmb/Adform.DHTML.js?bv='+Math.random())+'\"><\\/script>');";

function adformManifest(banner: Banner, clickTag: string): string {
  const manifest = {
    version: '1.0',
    title: banner.name,
    description: '',
    width: String(Math.round(banner.width)),
    height: String(Math.round(banner.height)),
    events: { enabled: 1, list: {} },
    clicktags: { clickTAG: clickTag },
    source: 'index.html',
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

// Starts animations once images and fonts are ready, so nothing pops in mid-animation,
// and sends clicks the way each network expects. Falls back to clickTag when the
// network's library is absent (local preview).
function runtime(platform: Platform, w: number, h: number): string {
  const click = {
    standard: 'window.open(window.clickTag,"_blank")',
    adform:
      'var d=window.dhtml;window.open(d?d.getVar("clickTAG",window.clickTag):window.clickTag,d?d.getVar("landingPageTarget","_blank"):"_blank")',
    admixer: 'var g=window.globalHTML5Api;g?g.click():window.open(window.clickTag,"_blank")',
  }[platform];
  const start =
    platform === 'admixer'
      ? `var g=window.globalHTML5Api;g?g.on("load",function(){g.init({resize:[{name:"state-1",width:"${w}px",height:"${h}px"}]});ready()}):window.addEventListener("load",ready);`
      : 'window.addEventListener("load",ready);';
  return [
    'var b=document.getElementById("banner");',
    `b.addEventListener("click",function(){${click}});`,
    'function play(){b.classList.add("play")}',
    'function ready(){document.fonts?document.fonts.ready.then(play,play):play()}',
    start,
  ].join('');
}

function renderNode(node: BannerNode, ctx: Ctx): string {
  const anim = ctx.anims[node.id];
  if (!anim || isEmptyAnim(anim)) return renderPlain(node, ctx, true);

  // Placement lives on an outer element so animation transforms stay independent of it.
  const cls = nextClass(ctx);
  ctx.css.push(`.${cls}{${placement(node, true).join(';')}}`);

  const intro = effectiveIntro(anim.intro, node.kind === 'text');
  const split = node.kind === 'text' && intro && isSplitPreset(intro.preset) ? { intro, cls: `${cls}-w` } : null;
  if (split) ctx.css.push(...splitCss(split.cls, split.intro));

  const wrapped = wrapAnimated(cls, node.name, anim, {
    maxDuration: ctx.maxDuration,
    isText: node.kind === 'text',
    pieces: split && node.kind === 'text' ? splitPieces(node, split.intro).length : 1,
    radius: node.kind === 'box' ? radiusCss(node) : null,
  });
  ctx.css.push(...wrapped.css);
  ctx.warnings.push(...wrapped.warnings);
  const inner = node.kind === 'text' ? renderText(node, ctx, false, split) : renderPlain(node, ctx, false);
  return `<div class="${cls}">${wrapped.open}${inner}${wrapped.close}</div>`;
}

interface Split {
  intro: IntroAnim;
  cls: string;
}

/** Text of each segment cut into animated pieces (words or letters) and the whitespace between them. */
function splitPieces(node: TextNode, intro: IntroAnim): { segment: number; text: string; animated: boolean }[] {
  const out: { segment: number; text: string; animated: boolean }[] = [];
  node.segments.forEach((seg, segment) => {
    const tokens = intro.preset === 'wordsUp' ? seg.text.split(/(\s+)/) : Array.from(seg.text);
    for (const text of tokens) if (text) out.push({ segment, text, animated: /\S/.test(text) });
  });
  return out.filter((p) => p.animated);
}

function renderPlain(node: BannerNode, ctx: Ctx, placed: boolean): string {
  switch (node.kind) {
    case 'box':
      return renderBox(node, ctx, false, placed);
    case 'text':
      return renderText(node, ctx, placed);
    case 'image':
      return renderImage(node, ctx, placed);
  }
}

function renderBox(node: BoxNode, ctx: Ctx, isRoot: boolean, placed = true): string {
  const cls = nextClass(ctx);
  const rules: string[] = isRoot ? [] : [...placement(node, placed), ...common(node)];
  if (isRoot && node.opacity < 1) rules.push(`opacity:${num(node.opacity)}`);

  if (node.background.length === 1) {
    rules.push(`background-color:${color(node.background[0])}`);
  } else if (node.background.length > 1) {
    // CSS lists backgrounds top first; Figma lists fills bottom first.
    const layers = [...node.background].reverse().map((c) => `linear-gradient(${color(c)},${color(c)})`);
    rules.push(`background:${layers.join(',')}`);
  }

  const radius = radiusCss(node);
  if (radius) rules.push(`border-radius:${radius}`);

  const shadows = node.shadows.map(shadow);
  if (node.stroke) {
    const { weight: wgt, align } = node.stroke;
    const c = color(node.stroke.color);
    // Strokes as box-shadow keep the box size exactly as in Figma.
    if (align === 'INSIDE') shadows.push(`inset 0 0 0 ${px(wgt)} ${c}`);
    if (align === 'OUTSIDE') shadows.push(`0 0 0 ${px(wgt)} ${c}`);
    if (align === 'CENTER') shadows.push(`inset 0 0 0 ${px(wgt / 2)} ${c}`, `0 0 0 ${px(wgt / 2)} ${c}`);
  }
  if (shadows.length) rules.push(`box-shadow:${shadows.join(',')}`);
  if (node.blur > 0) rules.push(`filter:blur(${px(node.blur / 2)})`);
  if (node.clips && !isRoot) rules.push('overflow:hidden');

  if (rules.length) ctx.css.push(`.${cls}{${rules.join(';')}}`);
  const children = node.children.map((child) => renderNode(child, ctx)).join('');
  const attrs = isRoot ? `id="banner" class="${cls}"` : `class="${cls}"`;
  return `<div ${attrs} data-name="${escapeHtml(node.name)}">${children}</div>`;
}

function renderText(node: TextNode, ctx: Ctx, placed: boolean, split: Split | null = null): string {
  const cls = nextClass(ctx);
  const justify = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.verticalAlign];
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[node.align];
  ctx.css.push(
    `.${cls}{${[
      ...placement(node, placed),
      ...common(node),
      'display:flex',
      'flex-direction:column',
      `justify-content:${justify}`,
      `text-align:${align}`,
      node.autoWidth ? 'white-space:pre' : 'white-space:pre-wrap',
      'overflow-wrap:break-word',
    ].join(';')}}`,
  );

  let piece = 0;
  const spans = node.segments
    .map((seg, i) => {
      const segCls = `${cls}s${i}`;
      ctx.css.push(`.${segCls}{${segmentRules(seg).join(';')}}`);
      addFont(ctx, seg);
      if (!split) return `<span class="${segCls}">${escapeHtml(seg.text)}</span>`;
      const tokens = split.intro.preset === 'wordsUp' ? seg.text.split(/(\s+)/) : Array.from(seg.text);
      const inner = tokens
        .filter((t) => t !== '')
        .map((t) =>
          /\S/.test(t) ? `<span class="${split.cls}" style="animation-delay:${pieceDelay(split.intro, piece++)}">${escapeHtml(t)}</span>` : escapeHtml(t),
        )
        .join('');
      return `<span class="${segCls}">${inner}</span>`;
    })
    .join('');
  return `<div class="${cls}" data-name="${escapeHtml(node.name)}"><p>${spans}</p></div>`;
}

function segmentRules(seg: TextSegment): string[] {
  const rules = [
    `font-family:${cssString(seg.fontFamily)},sans-serif`,
    `font-weight:${seg.fontWeight}`,
    `font-size:${px(seg.fontSize)}`,
    `line-height:${seg.lineHeight === null ? 'normal' : px(seg.lineHeight)}`,
    `color:${color(seg.color)}`,
  ];
  if (seg.italic) rules.push('font-style:italic');
  if (seg.letterSpacing !== 0) rules.push(`letter-spacing:${px(seg.letterSpacing)}`);
  if (seg.decoration === 'UNDERLINE') rules.push('text-decoration:underline');
  if (seg.decoration === 'STRIKETHROUGH') rules.push('text-decoration:line-through');
  const transform = { ORIGINAL: '', UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' }[seg.textCase];
  if (transform) rules.push(`text-transform:${transform}`);
  return rules;
}

function renderImage(node: ImageNode, ctx: Ctx, placed: boolean): string {
  const cls = nextClass(ctx);
  const fit = node.fit ? [`object-fit:${node.fit}`] : [];
  ctx.css.push(`.${cls}{${[...placement(node, placed), ...common(node), ...fit].join(';')}}`);
  const src = ctx.assetPaths.get(node.assetId);
  if (!src) throw new Error(`Missing asset ${node.assetId} for layer "${node.name}"`);
  return `<img class="${cls}" src="${src}" alt="" data-name="${escapeHtml(node.name)}">`;
}

/** Size, plus position when `placed` (an animated layer's position sits on its wrapper instead). */
function radiusCss(node: BoxNode): string | null {
  if (node.radius === 'ellipse') return '50%';
  if (!node.radius.some((r) => r > 0)) return null;
  const [tl, tr, br, bl] = node.radius;
  return tl === tr && tr === br && br === bl ? px(tl) : [tl, tr, br, bl].map(px).join(' ');
}

function placement(node: BannerNode, placed: boolean): string[] {
  const rules = [`width:${px(node.width)}`, `height:${px(node.height)}`];
  if (!placed) return rules;
  const t = node.transform;
  if (isTranslation(t)) {
    if (t[4] !== 0) rules.push(`left:${px(t[4])}`);
    if (t[5] !== 0) rules.push(`top:${px(t[5])}`);
  } else {
    rules.push(`transform:${matrix(t)}`);
  }
  return rules;
}

function common(node: BannerNode): string[] {
  return node.opacity < 1 ? [`opacity:${num(node.opacity)}`] : [];
}

/** Assigns each asset a path in the ZIP; identical files share one path. */
function placeAssets(assets: Asset[]): Map<string, string> {
  const byHash = new Map<string, string>();
  const paths = new Map<string, string>();
  let n = 0;
  for (const asset of assets) {
    const key = `${asset.ext}:${hash(asset.bytes)}`;
    let path = byHash.get(key);
    if (!path) {
      n += 1;
      path = `img/${n}.${asset.ext}`;
      byHash.set(key, path);
    }
    paths.set(asset.id, path);
  }
  return paths;
}

function addFont(ctx: Ctx, seg: TextSegment): void {
  let styles = ctx.fonts.get(seg.fontFamily);
  if (!styles) ctx.fonts.set(seg.fontFamily, (styles = new Set()));
  styles.add(`${seg.italic ? 1 : 0},${seg.fontWeight}`);
}

export function googleFontsUrl(fonts: Map<string, Set<string>>): string | null {
  if (fonts.size === 0) return null;
  const families = [...fonts.keys()].sort().map((family) => {
    const styles = [...fonts.get(family)!]
      .map((s) => s.split(',').map(Number) as [number, number])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return `family=${family.trim().replace(/ +/g, '+')}:ital,wght@${styles.map(([i, w]) => `${i},${w}`).join(';')}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

function nextClass(ctx: Ctx): string {
  ctx.counter += 1;
  return `n${ctx.counter}`;
}

function shadow(s: Shadow): string {
  return `${s.inset ? 'inset ' : ''}${px(s.x)} ${px(s.y)} ${px(s.blur)} ${px(s.spread)} ${color(s.color)}`;
}

function matrix(m: Matrix): string {
  return `matrix(${m.map(num).join(',')})`;
}

export function color(c: RGBA): string {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const [r, g, b] = [to255(c.r), to255(c.g), to255(c.b)];
  if (c.a >= 1) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r},${g},${b},${num(c.a)})`;
}

function px(v: number): string {
  return v === 0 ? '0' : `${num(v)}px`;
}

function num(v: number): string {
  const rounded = Math.round(v * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function cssString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** FNV-1a; good enough to spot identical exported images. */
function hash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${bytes.length}`;
}
