import { describe, expect, it } from 'vitest';
import { fromFigma, invert, multiply, relative } from '../src/core/matrix';
import type { Matrix } from '../src/shared/ir';

const close = (m: Matrix, n: Matrix) => m.forEach((v, i) => expect(v).toBeCloseTo(n[i], 6));

describe('matrix', () => {
  it('converts Figma transforms to CSS order', () => {
    expect(fromFigma([[1, 2, 3], [4, 5, 6]])).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('inverts', () => {
    const m: Matrix = [0.8, 0.6, -0.6, 0.8, 40, -10];
    close(multiply(m, invert(m)), [1, 0, 0, 1, 0, 0]);
  });

  it('expresses a child relative to a rotated parent', () => {
    const parent: Matrix = [0, 1, -1, 0, 100, 0]; // rotated 90°, origin at (100, 0)
    const child: Matrix = [0, 1, -1, 0, 90, 20]; // same rotation, offset inside the parent
    close(relative(parent, child), [1, 0, 0, 1, 20, 10]);
  });
});
