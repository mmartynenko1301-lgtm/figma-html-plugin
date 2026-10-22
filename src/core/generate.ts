import type { Asset, Banner, BannerNode, BoxNode, ImageNode, Matrix, RGBA, Shadow, TextNode, TextSegment } from '../shared/ir';
import { isTranslation } from './matrix';

export interface GenerateOptions {
  clickTag: string;
}

export interface OutputFile {
  path: string;
  data: string | Uint8Array;
}

export interface GenerateResult {
  html: string;
  files: OutputFile[];
}

export function generate(banner: Banner, options: GenerateOptions): GenerateResult {
  const assetPaths = placeAssets(banner.assets);
  const ctx: Ctx = { css: [], fonts: new Map(), assetPaths, counter: 0 };

  const body = renderBox(banner.root, ctx, true);
  const html = page(banner, options, ctx, body);

  const files: OutputFile[] = [{ path: 'index.html', data: html }];
  const written = new Set<string>();
  for (const asset of banner.assets) {
    const path = assetPaths.get(asset.id)!;
    if (written.has(path)) continue;
    written.add(path);
    files.push({ path, data: asset.bytes });
  }
  return { html, files };
}

interface Ctx {
  css: string[];
  /** family → set of "italic,weight" keys */
  fonts: Map<string, Set<string>>;
  assetPaths: Map<string, string>;
  counter: number;
}

function page(banner: Banner, options: GenerateOptions, ctx: Ctx, body: string): string {
  const { width: w, height: h } = banner;
  const fontsLink = googleFontsUrl(ctx.fonts);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta name="ad.size" content="width=${w},height=${h}">`,
    `<title>${escapeHtml(banner.name)}</title>`,
    fontsLink ? `<link rel="stylesheet" href="${escapeHtml(fontsLink)}">` : '',
    '<style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    `html,body{width:${w}px;height:${h}px;overflow:hidden}`,
    `#banner{position:relative;width:${w}px;height:${h}px;overflow:hidden;cursor:pointer}`,
    // :where() keeps specificity at zero so per-layer classes override these defaults.
    ':where(#banner div,#banner img){position:absolute;left:0;top:0;transform-origin:0 0}',
    ':where(#banner img){display:block}',
    ...ctx.css,
    '</style>',
    `<script>var clickTag = ${JSON.stringify(options.clickTag).replace(/</g, '\\u003c')};</script>`,
    '</head>',
    '<body>',
    body,
    '<script>document.getElementById("banner").addEventListener("click",function(){window.open(window.clickTag,"_blank")});</script>',
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function renderNode(node: BannerNode, ctx: Ctx): string {
  switch (node.kind) {
    case 'box':
      return renderBox(node, ctx, false);
    case 'text':
      return renderText(node, ctx);
    case 'image':
      return renderImage(node, ctx);
  }
}

function renderBox(node: BoxNode, ctx: Ctx, isRoot: boolean): string {
  const cls = nextClass(ctx);
  const rules: string[] = isRoot ? [] : [...placement(node), ...common(node)];
  if (isRoot && node.opacity < 1) rules.push(`opacity:${num(node.opacity)}`);

  if (node.background.length === 1) {
    rules.push(`background-color:${color(node.background[0])}`);
  } else if (node.background.length > 1) {
    // CSS lists backgrounds top first; Figma lists fills bottom first.
    const layers = [...node.background].reverse().map((c) => `linear-gradient(${color(c)},${color(c)})`);
    rules.push(`background:${layers.join(',')}`);
  }

  if (node.radius === 'ellipse') {
    rules.push('border-radius:50%');
  } else if (node.radius.some((r) => r > 0)) {
    const [tl, tr, br, bl] = node.radius;
    rules.push(tl === tr && tr === br && br === bl ? `border-radius:${px(tl)}` : `border-radius:${[tl, tr, br, bl].map(px).join(' ')}`);
  }

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

function renderText(node: TextNode, ctx: Ctx): string {
  const cls = nextClass(ctx);
  const justify = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[node.verticalAlign];
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[node.align];
  ctx.css.push(
    `.${cls}{${[
      ...placement(node),
      ...common(node),
      'display:flex',
      'flex-direction:column',
      `justify-content:${justify}`,
      `text-align:${align}`,
      node.autoWidth ? 'white-space:pre' : 'white-space:pre-wrap',
      'overflow-wrap:break-word',
    ].join(';')}}`,
  );

  const spans = node.segments
    .map((seg, i) => {
      const segCls = `${cls}s${i}`;
      ctx.css.push(`.${segCls}{${segmentRules(seg).join(';')}}`);
      addFont(ctx, seg);
      return `<span class="${segCls}">${escapeHtml(seg.text)}</span>`;
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

function renderImage(node: ImageNode, ctx: Ctx): string {
  const cls = nextClass(ctx);
  ctx.css.push(`.${cls}{${[...placement(node), ...common(node)].join(';')}}`);
  const src = ctx.assetPaths.get(node.assetId);
  if (!src) throw new Error(`Missing asset ${node.assetId} for layer "${node.name}"`);
  return `<img class="${cls}" src="${src}" alt="" data-name="${escapeHtml(node.name)}">`;
}

function placement(node: BannerNode): string[] {
  const rules = [`width:${px(node.width)}`, `height:${px(node.height)}`];
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
