// Intermediate representation of a banner. The main thread builds it from Figma
// nodes; the generator in src/core turns it into HTML/CSS without touching Figma.

/** 2D affine matrix in CSS order: matrix(a, b, c, d, e, f). */
export type Matrix = [number, number, number, number, number, number];

export interface RGBA {
  r: number; // 0..1
  g: number;
  b: number;
  a: number;
}

export interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: RGBA;
}

export interface Stroke {
  color: RGBA;
  weight: number;
  align: 'INSIDE' | 'CENTER' | 'OUTSIDE';
}

interface BaseNode {
  id: string;
  name: string;
  /** Position and orientation relative to the emitted parent. */
  transform: Matrix;
  width: number;
  height: number;
  opacity: number;
}

/** Frame, group, rectangle or ellipse drawn with plain CSS. */
export interface BoxNode extends BaseNode {
  kind: 'box';
  background: RGBA[]; // bottom to top
  radius: [number, number, number, number] | 'ellipse';
  stroke: Stroke | null;
  shadows: Shadow[];
  blur: number;
  clips: boolean;
  children: BannerNode[];
}

export interface TextSegment {
  text: string;
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  fontSize: number;
  /** Pixels, or null for the font's normal line height. */
  lineHeight: number | null;
  letterSpacing: number; // px
  color: RGBA;
  decoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
}

export interface TextNode extends BaseNode {
  kind: 'text';
  segments: TextSegment[];
  align: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  verticalAlign: 'TOP' | 'CENTER' | 'BOTTOM';
  /** True when Figma sizes the box to the text, so the browser must not wrap it. */
  autoWidth: boolean;
}

/** Anything exported from Figma as a file (raster or SVG). */
export interface ImageNode extends BaseNode {
  kind: 'image';
  assetId: string;
  /** How the file fills the box when its aspect ratio differs (GIF fills keep Figma's scale mode). Default: stretch. */
  fit?: 'cover' | 'contain';
}

export type BannerNode = BoxNode | TextNode | ImageNode;

export interface Asset {
  id: string;
  ext: 'png' | 'jpg' | 'svg' | 'gif';
  bytes: Uint8Array;
}

export interface Banner {
  name: string;
  width: number;
  height: number;
  root: BoxNode;
  assets: Asset[];
}
