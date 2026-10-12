/** Integer pixel rectangle. `width`/`height` of zero means empty. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

export function intersectRects(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return EMPTY_RECT;
  return { x, y, width: right - x, height: bottom - y };
}

export function unionRects(a: Rect, b: Rect): Rect {
  if (isEmptyRect(a)) return b;
  if (isEmptyRect(b)) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Smallest integer rectangle containing the real-valued box. */
export function rectFromBox(left: number, top: number, right: number, bottom: number): Rect {
  const x = Math.floor(Math.min(left, right));
  const y = Math.floor(Math.min(top, bottom));
  return {
    x,
    y,
    width: Math.ceil(Math.max(left, right)) - x,
    height: Math.ceil(Math.max(top, bottom)) - y,
  };
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function sizeRect(width: number, height: number): Rect {
  return { x: 0, y: 0, width, height };
}
