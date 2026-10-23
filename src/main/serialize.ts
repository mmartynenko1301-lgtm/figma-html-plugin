import type { Asset, Banner, BannerNode, BoxNode, ImageNode, Matrix, RGBA, Shadow, Stroke, TextNode, TextSegment } from '../shared/ir';
import { fromFigma, relative, translation } from '../core/matrix';
import { t } from '../shared/i18n';

const RASTER_SCALE = 2;

interface State {
  assets: Asset[];
  warnings: string[];
}

/** Converts a banner frame into the IR, exporting every layer that CSS cannot reproduce as an image. */
export async function serializeBanner(frame: FrameNode | ComponentNode | InstanceNode): Promise<{ banner: Banner; warnings: string[] }> {
  const state: State = { assets: [], warnings: [] };
  const rootAbs = fromFigma(frame.absoluteTransform);
  const root = await serializeContainer(frame, rootAbs, rootAbs, state);
  root.transform = [1, 0, 0, 1, 0, 0];
  return {
    banner: { name: frame.name, width: frame.width, height: frame.height, root, assets: state.assets },
    warnings: state.warnings,
  };
}

async function serializeNode(node: SceneNode, parentAbs: Matrix, state: State): Promise<BannerNode | null> {
  if (!node.visible) return null;
  const abs = fromFigma(node.absoluteTransform);

  const reason = rasterReason(node);
  if (reason) {
    state.warnings.push(t(`«${node.name}» експортовано як картинку: ${reason}`, `“${node.name}” was exported as an image: ${reason}`));
    return rasterize(node, parentAbs, state, isVectorLike(node) ? 'svg' : 'png');
  }

  switch (node.type) {
    case 'TEXT':
      return serializeText(node, parentAbs, abs);
    case 'FRAME':
    case 'COMPONENT':
    case 'INSTANCE':
    case 'GROUP':
    case 'RECTANGLE':
    case 'ELLIPSE':
      return serializeContainer(node, parentAbs, abs, state);
    default:
      return rasterize(node, parentAbs, state, isVectorLike(node) ? 'svg' : 'png');
  }
}

type ContainerLike = FrameNode | ComponentNode | InstanceNode | GroupNode | RectangleNode | EllipseNode;

async function serializeContainer(node: ContainerLike, parentAbs: Matrix, abs: Matrix, state: State): Promise<BoxNode> {
  const box: BoxNode = {
    kind: 'box',
    id: node.id,
    name: node.name,
    transform: relative(parentAbs, abs),
    width: node.width,
    height: node.height,
    opacity: node.opacity,
    background: [],
    radius: [0, 0, 0, 0],
    stroke: null,
    shadows: [],
    blur: 0,
    clips: 'clipsContent' in node ? node.clipsContent : false,
    children: [],
  };

  if (node.type !== 'GROUP') {
    const gif = await gifFill(node);
    const look = cssLook(node);
    if (gif) {
      // An animated GIF fill is kept as the original file, since a PNG export would freeze it.
      Object.assign(box, gif.look);
      box.clips = true;
      box.children.push(gifImage(node, gif, state));
    } else if (look) {
      Object.assign(box, look);
    } else {
      // Gradient, image fill or another effect CSS cannot draw: keep the container
      // (so children stay animatable) and draw its own look as a background image.
      state.warnings.push(t(`Фон «${node.name}» експортовано як картинку`, `The background of “${node.name}” was exported as an image`));
      box.children.push(await rasterizeOwnLook(node, abs, state));
    }
  }

  if ('children' in node) {
    for (const child of node.children) {
      const out = await serializeNode(child, abs, state);
      if (out) box.children.push(out);
    }
  }
  return box;
}

interface GifFill {
  bytes: Uint8Array;
  fit: 'cover' | 'contain';
  opacity: number;
  /** The shape's look without the GIF: solid fills under it, corners, stroke, shadows. */
  look: Partial<BoxNode>;
}

/**
 * The GIF of a shape whose top visible fill is a GIF image, when everything else about
 * the shape can be drawn with CSS; null otherwise (the shape is then exported as PNG).
 */
async function gifFill(node: Exclude<ContainerLike, GroupNode>): Promise<GifFill | null> {
  if (node.fills === figma.mixed) return null;
  const visible = node.fills.filter((p) => p.visible !== false);
  const top = visible[visible.length - 1];
  if (!top || top.type !== 'IMAGE' || !top.imageHash) return null;
  const image = figma.getImageByHash(top.imageHash);
  if (!image) return null;
  const bytes = await image.getBytesAsync();
  // "GIF8": GIF87a or GIF89a.
  if (!(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)) return null;
  // The rest of the shape (solid fills under the GIF, corners, stroke, shadows) must be CSS-drawable.
  const look = cssLook(node, visible.slice(0, -1));
  if (!look) return null;
  return { bytes, fit: top.scaleMode === 'FIT' ? 'contain' : 'cover', opacity: top.opacity ?? 1, look };
}

function gifImage(node: Exclude<ContainerLike, GroupNode>, gif: GifFill, state: State): ImageNode {
  const assetId = `${node.id}:${state.assets.length}`;
  state.assets.push({ id: assetId, ext: 'gif', bytes: gif.bytes });
  if (gif.bytes.length > 150 * 1024) {
    const gifKb = Math.round(gif.bytes.length / 1024);
    state.warnings.push(t(`«${node.name}»: анімований GIF важить ${gifKb} KB і не стискається автоматично.`, `“${node.name}”: the animated GIF is ${gifKb} KB and is not compressed automatically.`));
  }
  return {
    kind: 'image',
    id: `${node.id}#gif`,
    name: node.name,
    transform: [1, 0, 0, 1, 0, 0],
    width: node.width,
    height: node.height,
    opacity: gif.opacity,
    assetId,
    fit: gif.fit,
  };
}

/**
 * CSS description of a shape's fills, stroke, corners and effects, or null if CSS cannot match it.
 * `fills` overrides the shape's own, e.g. to check it without a GIF fill that is exported separately.
 */
function cssLook(node: Exclude<ContainerLike, GroupNode>, fills = node.fills): Partial<BoxNode> | null {
  const background: RGBA[] = [];
  if (fills === figma.mixed) return null;
  for (const paint of fills) {
    if (!paint.visible) continue;
    if (paint.type !== 'SOLID' || (paint.blendMode && !isNormalBlend(paint.blendMode))) return null;
    background.push(rgba(paint.color, paint.opacity));
  }

  let stroke: Stroke | null = null;
  const strokes = node.strokes.filter((p) => p.visible !== false);
  if (strokes.length > 1) return null;
  if (strokes.length === 1) {
    const paint = strokes[0];
    if (paint.type !== 'SOLID' || node.strokeWeight === figma.mixed || node.dashPattern.length > 0) return null;
    stroke = { color: rgba(paint.color, paint.opacity), weight: node.strokeWeight, align: node.strokeAlign };
  }

  const shadows: Shadow[] = [];
  let blur = 0;
  for (const effect of node.effects) {
    if (!effect.visible) continue;
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      shadows.push({
        inset: effect.type === 'INNER_SHADOW',
        x: effect.offset.x,
        y: effect.offset.y,
        blur: effect.radius,
        spread: effect.spread ?? 0,
        color: effect.color,
      });
    } else if (effect.type === 'LAYER_BLUR' && (!('blurType' in effect) || effect.blurType === 'NORMAL')) {
      blur = effect.radius;
    } else {
      return null;
    }
  }

  let radius: BoxNode['radius'] = [0, 0, 0, 0];
  if (node.type === 'ELLIPSE') {
    const arc = node.arcData;
    const full = arc.innerRadius === 0 && Math.abs(arc.endingAngle - arc.startingAngle - 2 * Math.PI) < 1e-3;
    if (!full) return null;
    radius = 'ellipse';
  } else {
    radius = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
    if ('cornerSmoothing' in node && node.cornerSmoothing > 0 && radius.some((r) => r > 0)) return null;
  }

  return { background, stroke, shadows, blur, radius };
}

function serializeText(node: globalThis.TextNode, parentAbs: Matrix, abs: Matrix): TextNode {
  const segments: TextSegment[] = node
    .getStyledTextSegments(['fontName', 'fontSize', 'fontWeight', 'fills', 'letterSpacing', 'lineHeight', 'textDecoration', 'textCase'])
    .map((seg) => {
      const fill = seg.fills.find((p) => p.visible !== false);
      return {
        text: seg.characters,
        fontFamily: seg.fontName.family,
        fontWeight: seg.fontWeight,
        italic: /italic|oblique/i.test(seg.fontName.style),
        fontSize: seg.fontSize,
        lineHeight:
          seg.lineHeight.unit === 'AUTO' ? null : seg.lineHeight.unit === 'PIXELS' ? seg.lineHeight.value : (seg.lineHeight.value / 100) * seg.fontSize,
        letterSpacing: seg.letterSpacing.unit === 'PIXELS' ? seg.letterSpacing.value : (seg.letterSpacing.value / 100) * seg.fontSize,
        color: fill && fill.type === 'SOLID' ? rgba(fill.color, fill.opacity) : { r: 0, g: 0, b: 0, a: 1 },
        decoration: seg.textDecoration,
        textCase: seg.textCase === 'UPPER' || seg.textCase === 'LOWER' || seg.textCase === 'TITLE' ? seg.textCase : 'ORIGINAL',
      };
    });

  return {
    kind: 'text',
    id: node.id,
    name: node.name,
    transform: relative(parentAbs, abs),
    width: node.width,
    height: node.height,
    opacity: node.opacity,
    segments,
    align: node.textAlignHorizontal,
    verticalAlign: node.textAlignVertical,
    autoWidth: node.textAutoResize === 'WIDTH_AND_HEIGHT',
  };
}

/** Why a node has to become an image, or null if it can be built from HTML/CSS. */
function rasterReason(node: SceneNode): string | null {
  if ('isMask' in node && node.isMask) return t('маска', 'mask');
  if ('children' in node && node.children.some((c) => 'isMask' in c && c.isMask)) return t('група з маскою', 'group with a mask');
  if ('blendMode' in node && !isNormalBlend(node.blendMode)) return t(`режим накладання ${node.blendMode}`, `blend mode ${node.blendMode}`);
  if (node.type === 'TEXT') {
    if (node.strokes.some((p) => p.visible !== false)) return t('обведення тексту', 'text stroke');
    if (node.effects.some((e) => e.visible)) return t('ефекти на тексті', 'effects on text');
    const fills = node.getStyledTextSegments(['fills']).flatMap((s) => s.fills.filter((p) => p.visible !== false));
    if (fills.some((p) => p.type !== 'SOLID')) return t('градієнт або картинка в тексті', 'gradient or image in text');
    if (node.textAlignVertical !== 'TOP' && node.textAutoResize === 'TRUNCATE') return t('обрізаний текст', 'truncated text');
  }
  return null;
}

function isVectorLike(node: SceneNode): boolean {
  if (!['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'POLYGON'].includes(node.type)) return false;
  // SVG export of image fills embeds base64 rasters; PNG is smaller then.
  return !('fills' in node && node.fills !== figma.mixed && node.fills.some((p) => p.type === 'IMAGE'));
}

async function rasterize(node: SceneNode, parentAbs: Matrix, state: State, ext: 'png' | 'svg'): Promise<ImageNode | null> {
  const bounds = 'absoluteRenderBounds' in node ? node.absoluteRenderBounds : null;
  if (!bounds) return null;
  const bytes =
    ext === 'svg'
      ? await node.exportAsync({ format: 'SVG', svgOutlineText: true, svgIdAttribute: false })
      : await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: RASTER_SCALE } });
  return imageNode(node, bounds, parentAbs, bytes, ext, state);
}

/** Exports a shape's own fills, strokes and effects as an image; children stay separate layers. */
async function rasterizeOwnLook(node: Exclude<ContainerLike, GroupNode>, abs: Matrix, state: State): Promise<ImageNode> {
  if (!('children' in node) || node.children.length === 0) {
    const bounds = node.absoluteRenderBounds ?? { x: abs[4], y: abs[5], width: node.width, height: node.height };
    const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: RASTER_SCALE } });
    return imageNode(node, bounds, abs, bytes, 'png', state, `${node.id}#look`);
  }
  // The copy can land elsewhere on the canvas (on the page, or moved by auto layout),
  // so its render bounds are measured against its own transform, not the original's.
  const clone = node.clone();
  try {
    for (const child of [...clone.children]) child.remove();
    const cloneAbs = fromFigma(clone.absoluteTransform);
    const bounds = clone.absoluteRenderBounds ?? { x: cloneAbs[4], y: cloneAbs[5], width: node.width, height: node.height };
    const bytes = await clone.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: RASTER_SCALE } });
    return imageNode(node, bounds, cloneAbs, bytes, 'png', state, `${node.id}#look`);
  } finally {
    clone.remove();
  }
}

function imageNode(
  node: SceneNode,
  bounds: Rect,
  parentAbs: Matrix,
  bytes: Uint8Array,
  ext: 'png' | 'svg',
  state: State,
  id = node.id,
): ImageNode {
  const assetId = `${node.id}:${state.assets.length}`;
  state.assets.push({ id: assetId, ext, bytes });
  return {
    kind: 'image',
    id,
    name: node.name,
    // Render bounds are axis-aligned, so rotation is already baked into the image.
    transform: relative(parentAbs, translation(bounds.x, bounds.y)),
    width: bounds.width,
    height: bounds.height,
    // Opacity is part of the exported image only for the node itself; keep 1 to avoid applying it twice.
    opacity: 1,
    assetId,
  };
}

function isNormalBlend(mode: BlendMode): boolean {
  return mode === 'NORMAL' || mode === 'PASS_THROUGH';
}

function rgba(c: RGB, opacity = 1): RGBA {
  return { r: c.r, g: c.g, b: c.b, a: opacity };
}
