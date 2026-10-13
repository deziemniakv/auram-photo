/**
 * 2D affine transform in canvas convention:
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translation(x: number, y: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaling(x: number, y: number): Affine {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

/** Rotation by `radians` (clockwise on screen, because y points down). */
export function rotation(radians: number): Affine {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** `multiply(m, n)` applies `n` first, then `m`. */
export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** Applies the transforms in order: `compose(t1, t2)` means t1, then t2. */
export function compose(...transforms: Affine[]): Affine {
  return transforms.reduce((result, next) => multiply(next, result), IDENTITY);
}

export function determinant(m: Affine): number {
  return m.a * m.d - m.b * m.c;
}

export function invert(m: Affine): Affine {
  const det = determinant(m);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new RangeError('The transform cannot be inverted');
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function isIdentity(m: Affine, epsilon = 1e-9): boolean {
  return (
    Math.abs(m.a - 1) < epsilon &&
    Math.abs(m.b) < epsilon &&
    Math.abs(m.c) < epsilon &&
    Math.abs(m.d - 1) < epsilon &&
    Math.abs(m.e) < epsilon &&
    Math.abs(m.f) < epsilon
  );
}
