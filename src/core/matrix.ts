import type { Matrix } from '../shared/ir';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Figma's Transform [[a, c, e], [b, d, f]] in CSS order. */
export function fromFigma(t: [[number, number, number], [number, number, number]]): Matrix {
  return [t[0][0], t[1][0], t[0][1], t[1][1], t[0][2], t[1][2]];
}

export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error('Matrix is not invertible');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Transform of `child` expressed in the coordinate space of `parent` (both absolute). */
export function relative(parentAbs: Matrix, childAbs: Matrix): Matrix {
  return multiply(invert(parentAbs), childAbs);
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function isTranslation(m: Matrix, eps = 1e-6): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps;
}
