import type { Banner, BoxNode, TextSegment } from '../src/shared/ir';

const black = { r: 0, g: 0, b: 0, a: 1 };

export function segment(text: string, extra: Partial<TextSegment> = {}): TextSegment {
  return {
    text,
    fontFamily: 'Inter',
    fontWeight: 400,
    italic: false,
    fontSize: 16,
    lineHeight: null,
    letterSpacing: 0,
    color: black,
    decoration: 'NONE',
    textCase: 'ORIGINAL',
    ...extra,
  };
}

export function box(extra: Partial<BoxNode> = {}): BoxNode {
  return {
    kind: 'box',
    id: '1:1',
    name: 'Box',
    transform: [1, 0, 0, 1, 0, 0],
    width: 100,
    height: 50,
    opacity: 1,
    background: [],
    radius: [0, 0, 0, 0],
    stroke: null,
    shadows: [],
    blur: 0,
    clips: false,
    children: [],
    ...extra,
  };
}

/** 300×250 banner: white background, a headline, a CTA button with text, and a logo image. */
export function sampleBanner(): Banner {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  return {
    name: 'Spring sale',
    width: 300,
    height: 250,
    assets: [
      { id: 'logo', ext: 'png', bytes: png },
      { id: 'logo-copy', ext: 'png', bytes: png.slice() },
    ],
    root: box({
      id: '0:1',
      name: 'Spring sale',
      width: 300,
      height: 250,
      background: [{ r: 1, g: 1, b: 1, a: 1 }],
      clips: true,
      children: [
        {
          kind: 'text',
          id: '0:2',
          name: 'Headline',
          transform: [1, 0, 0, 1, 20, 24],
          width: 260,
          height: 58,
          opacity: 1,
          segments: [segment('Spring '), segment('sale <50%>', { fontWeight: 700, italic: true, color: { r: 1, g: 0, b: 0, a: 1 } })],
          align: 'LEFT',
          verticalAlign: 'TOP',
          autoWidth: false,
        },
        box({
          id: '0:3',
          name: 'CTA',
          transform: [1, 0, 0, 1, 20, 180],
          width: 120,
          height: 40,
          background: [{ r: 0.05, g: 0.6, b: 1, a: 1 }],
          radius: [8, 8, 8, 8],
          children: [],
        }),
        { kind: 'image', id: '0:4', name: 'Logo', transform: [1, 0, 0, 1, 230, 190], width: 50, height: 40, opacity: 1, assetId: 'logo' },
        { kind: 'image', id: '0:5', name: 'Logo copy', transform: [0, 1, -1, 0, 100, 100], width: 50, height: 40, opacity: 0.5, assetId: 'logo-copy' },
      ],
    }),
  };
}
