import { describe, expect, it } from 'vitest';
import type { Captured } from '../src/ui/frames';
import { changedRect, replay } from '../src/ui/frames';
import { encodeGif } from '../src/ui/gif';

function solid(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([...rgb, 255], i * 4);
  return out;
}

// A 4×4 banner: white, then a red 2×1 patch at (1,2) for two ticks, then the same again.
function sample(): Captured {
  return {
    width: 4,
    height: 4,
    fps: 10,
    frames: [
      { rect: { x: 0, y: 0, w: 4, h: 4 }, pixels: solid(4, 4, [255, 255, 255]), ticks: 1 },
      { rect: { x: 1, y: 2, w: 2, h: 1 }, pixels: solid(2, 1, [255, 0, 0]), ticks: 3 },
    ],
  };
}

describe('captured frames', () => {
  it('finds the changed area', () => {
    const a = solid(4, 4, [0, 0, 0]);
    const b = a.slice();
    b.set([9, 9, 9, 255], (2 * 4 + 3) * 4);
    expect(changedRect(a, a.slice(), 4, 4)).toBeNull();
    expect(changedRect(a, b, 4, 4)).toEqual({ x: 3, y: 2, w: 1, h: 1 });
  });

  it('replays frames with their delays and changed areas', () => {
    const shown = Array.from(replay(sample(), 1), (f) => ({ rect: f.rect, delay: f.delay }));
    expect(shown).toEqual([
      { rect: { x: 0, y: 0, w: 4, h: 4 }, delay: 100 },
      { rect: { x: 1, y: 2, w: 2, h: 1 }, delay: 300 },
    ]);
  });

  it('drops frames for a lower frame rate without losing time', () => {
    const total = Array.from(replay(sample(), 3), (f) => f.delay).reduce((a, b) => a + b, 0);
    expect(total).toBe(400);
  });
});

describe('GIF', () => {
  it('writes a looping GIF89a with one image per shown frame', () => {
    const gif = encodeGif(sample(), { colors: 16, step: 1 });
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
    expect(gif[6] | (gif[7] << 8)).toBe(4);
    expect(gif[gif.length - 1]).toBe(0x3b);
    const text = String.fromCharCode(...gif);
    expect(text).toContain('NETSCAPE2.0');
    // Two graphic control extensions, one per frame.
    expect(text.split('\x21\xf9\x04').length - 1).toBe(2);
  });
});
