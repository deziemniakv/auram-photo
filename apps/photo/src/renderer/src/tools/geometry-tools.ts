import {
  applyAffine,
  compose,
  intersectRects,
  invert,
  rectFromBox,
  rotation,
  scaling,
  sizeRect,
  translation,
  type Affine,
  type Rect,
} from '@auram/photo-engine';
import type { ViewTransform } from '@auram/photo-engine/webgl';
import {
  currentCrop,
  currentTransform,
  setCropRect,
  setTransformMatrix,
  type FreeTransform,
} from '../editor/geometry';
import type { ToolContext, ToolHandler, ToolPointer } from './types';

/*
 * Pointer handling and overlay drawing for the free transform box and the crop
 * rectangle. Both use eight handles: corners and edge midpoints, identified by
 * their position relative to the box centre (-1, 0 or 1 on each axis).
 */

type Side = -1 | 0 | 1;
interface Handle {
  hx: Side;
  hy: Side;
}

const HANDLES: Handle[] = [
  { hx: -1, hy: -1 },
  { hx: 0, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 1 },
  { hx: -1, hy: 0 },
];

/** Hit radius of a handle in CSS pixels. */
const HANDLE_HIT = 7;
const HANDLE_SIZE = 7;

const toScreen = (view: ViewTransform, x: number, y: number) => ({
  x: x * view.scale + view.offsetX,
  y: y * view.scale + view.offsetY,
});

/** Point of `rect` at handle position (hx, hy). */
const handlePoint = (rect: Rect, h: Handle) => ({
  x: rect.x + ((h.hx + 1) / 2) * rect.width,
  y: rect.y + ((h.hy + 1) / 2) * rect.height,
});

/** Resize cursor for a handle pointing in screen direction (dx, dy). */
function resizeCursor(dx: number, dy: number): string {
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180;
  if (angle < 22.5 || angle >= 157.5) return 'ew-resize';
  if (angle < 67.5) return 'nwse-resize';
  if (angle < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

/* ----------------------------- free transform ---------------------------- */

type TransformHit = { kind: 'scale'; handle: Handle } | { kind: 'move' } | { kind: 'rotate' };

function hitTransform(t: FreeTransform, view: ViewTransform, p: ToolPointer): TransformHit {
  for (const handle of HANDLES) {
    const point = handlePoint(t.source, handle);
    const doc = applyAffine(t.matrix, point.x, point.y);
    const screen = toScreen(view, doc.x, doc.y);
    if (
      Math.abs(screen.x - p.screen.x) <= HANDLE_HIT &&
      Math.abs(screen.y - p.screen.y) <= HANDLE_HIT
    )
      return { kind: 'scale', handle };
  }
  const local = applyAffine(invert(t.matrix), p.doc.x, p.doc.y);
  const { x, y, width, height } = t.source;
  const inside = local.x >= x && local.y >= y && local.x <= x + width && local.y <= y + height;
  return inside ? { kind: 'move' } : { kind: 'rotate' };
}

function transformCursor(t: FreeTransform, view: ViewTransform, p: ToolPointer): string {
  const hit = hitTransform(t, view, p);
  if (hit.kind === 'move') return 'move';
  if (hit.kind === 'rotate') return 'alias';
  const center = applyAffine(
    t.matrix,
    t.source.x + t.source.width / 2,
    t.source.y + t.source.height / 2,
  );
  const point = handlePoint(t.source, hit.handle);
  const handle = applyAffine(t.matrix, point.x, point.y);
  return resizeCursor(handle.x - center.x, handle.y - center.y);
}

const SNAP = Math.PI / 12;

/** Gestures on the free transform box: move inside, scale on handles, rotate outside. */
export function transformHandler(): ToolHandler {
  let start: { pointer: ToolPointer; matrix: Affine; hit: TransformHit } | null = null;

  const update = (p: ToolPointer) => {
    const t = currentTransform();
    if (!start || !t) return;
    const m0 = start.matrix;
    const { source } = t;
    if (start.hit.kind === 'move') {
      let dx = p.doc.x - start.pointer.doc.x;
      let dy = p.doc.y - start.pointer.doc.y;
      if (p.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      setTransformMatrix(compose(m0, translation(Math.round(dx), Math.round(dy))));
      return;
    }
    if (start.hit.kind === 'rotate') {
      const c = applyAffine(m0, source.x + source.width / 2, source.y + source.height / 2);
      let angle =
        Math.atan2(p.doc.y - c.y, p.doc.x - c.x) -
        Math.atan2(start.pointer.doc.y - c.y, start.pointer.doc.x - c.x);
      if (p.shift) {
        const current = Math.atan2(m0.b, m0.a);
        angle = Math.round((current + angle) / SNAP) * SNAP - current;
      }
      setTransformMatrix(
        compose(m0, translation(-c.x, -c.y), rotation(angle), translation(c.x, c.y)),
      );
      return;
    }
    // Scale in the box's own (untransformed) coordinates.
    const { handle } = start.hit;
    const local = applyAffine(invert(m0), p.doc.x, p.doc.y);
    const h = handlePoint(source, handle);
    const anchor = p.alt
      ? { x: source.x + source.width / 2, y: source.y + source.height / 2 }
      : handlePoint(source, { hx: (-handle.hx || 0) as Side, hy: (-handle.hy || 0) as Side });
    const factor = (value: number, from: number, to: number, size: number) => {
      const s = (value - from) / (to - from);
      const min = 1 / Math.max(1, size);
      return Math.abs(s) < min ? (s < 0 ? -min : min) : s;
    };
    let sx = handle.hx === 0 ? 1 : factor(local.x, anchor.x, h.x, source.width);
    let sy = handle.hy === 0 ? 1 : factor(local.y, anchor.y, h.y, source.height);
    if (p.shift && handle.hx !== 0 && handle.hy !== 0) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = Math.sign(sx) * s;
      sy = Math.sign(sy) * s;
    }
    setTransformMatrix(
      compose(
        translation(-anchor.x, -anchor.y),
        scaling(sx, sy),
        translation(anchor.x, anchor.y),
        m0,
      ),
    );
  };

  return {
    down(ctx, p) {
      const t = currentTransform();
      if (!t) return;
      start = { pointer: p, matrix: t.matrix, hit: hitTransform(t, ctx.session.view, p) };
    },
    move(_ctx, p) {
      update(p);
    },
    up(_ctx, p) {
      update(p);
      start = null;
    },
    cancel() {
      if (start) setTransformMatrix(start.matrix);
      start = null;
    },
    hover(ctx, p) {
      const t = currentTransform();
      return t ? transformCursor(t, ctx.session.view, p) : null;
    },
  };
}

/** Moves the free transform by whole document pixels (arrow keys). */
export function nudgeTransform(dx: number, dy: number): void {
  const t = currentTransform();
  if (t) setTransformMatrix(compose(t.matrix, translation(dx, dy)));
}

/* ---------------------------------- crop --------------------------------- */

type CropHit = { kind: 'resize'; handle: Handle } | { kind: 'move' } | { kind: 'new' };

function hitCrop(rect: Rect | null, view: ViewTransform, p: ToolPointer): CropHit {
  if (!rect) return { kind: 'new' };
  for (const handle of HANDLES) {
    const point = handlePoint(rect, handle);
    const screen = toScreen(view, point.x, point.y);
    if (
      Math.abs(screen.x - p.screen.x) <= HANDLE_HIT &&
      Math.abs(screen.y - p.screen.y) <= HANDLE_HIT
    )
      return { kind: 'resize', handle };
  }
  const inside =
    p.doc.x >= rect.x &&
    p.doc.y >= rect.y &&
    p.doc.x <= rect.x + rect.width &&
    p.doc.y <= rect.y + rect.height;
  return inside ? { kind: 'move' } : { kind: 'new' };
}

/** Crop tool: drag to draw the crop rectangle, then adjust it with its handles. */
export function cropHandler(): ToolHandler {
  let start: { pointer: ToolPointer; rect: Rect | null; hit: CropHit } | null = null;

  const update = (ctx: ToolContext, p: ToolPointer) => {
    if (!start) return;
    const { doc } = ctx.session;
    const bounds = sizeRect(doc.width, doc.height);
    const clampX = (x: number) => Math.min(doc.width, Math.max(0, Math.round(x)));
    const clampY = (y: number) => Math.min(doc.height, Math.max(0, Math.round(y)));
    const { hit, rect } = start;
    if (hit.kind === 'new' || !rect) {
      setCropRect(
        rectFromBox(
          clampX(start.pointer.doc.x),
          clampY(start.pointer.doc.y),
          clampX(p.doc.x),
          clampY(p.doc.y),
        ),
      );
      return;
    }
    if (hit.kind === 'move') {
      const dx = Math.round(p.doc.x - start.pointer.doc.x);
      const dy = Math.round(p.doc.y - start.pointer.doc.y);
      const x = Math.min(doc.width - rect.width, Math.max(0, rect.x + dx));
      const y = Math.min(doc.height - rect.height, Math.max(0, rect.y + dy));
      setCropRect({ ...rect, x, y });
      return;
    }
    let left = rect.x;
    let top = rect.y;
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    if (hit.handle.hx < 0) left = clampX(p.doc.x);
    if (hit.handle.hx > 0) right = clampX(p.doc.x);
    if (hit.handle.hy < 0) top = clampY(p.doc.y);
    if (hit.handle.hy > 0) bottom = clampY(p.doc.y);
    setCropRect(intersectRects(rectFromBox(left, top, right, bottom), bounds));
  };

  return {
    down(ctx, p) {
      const rect = currentCrop();
      start = { pointer: p, rect, hit: hitCrop(rect, ctx.session.view, p) };
      if (start.hit.kind === 'new') setCropRect(null);
    },
    move(ctx, p) {
      update(ctx, p);
    },
    up(ctx, p) {
      update(ctx, p);
      start = null;
    },
    cancel() {
      if (start) setCropRect(start.rect);
      start = null;
    },
    hover(ctx, p) {
      const hit = hitCrop(currentCrop(), ctx.session.view, p);
      if (hit.kind === 'move') return 'move';
      if (hit.kind === 'new') return 'crosshair';
      return resizeCursor(hit.handle.hx, hit.handle.hy);
    },
  };
}

/* -------------------------------- overlays ------------------------------- */

function drawHandles(g: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>): void {
  g.lineWidth = 1;
  for (const point of points) {
    const x = Math.round(point.x - HANDLE_SIZE / 2) + 0.5;
    const y = Math.round(point.y - HANDLE_SIZE / 2) + 0.5;
    g.fillStyle = '#fff';
    g.fillRect(x, y, HANDLE_SIZE, HANDLE_SIZE);
    g.strokeStyle = '#000';
    g.strokeRect(x, y, HANDLE_SIZE, HANDLE_SIZE);
  }
}

export function drawTransformOverlay(g: CanvasRenderingContext2D, view: ViewTransform): void {
  const t = currentTransform();
  if (!t) return;
  const corners = [
    { hx: -1, hy: -1 },
    { hx: 1, hy: -1 },
    { hx: 1, hy: 1 },
    { hx: -1, hy: 1 },
  ].map((h) => {
    const point = handlePoint(t.source, h as Handle);
    const doc = applyAffine(t.matrix, point.x, point.y);
    return toScreen(view, doc.x, doc.y);
  });
  for (const [color, width] of [
    ['rgba(0,0,0,0.8)', 3],
    ['#fff', 1],
  ] as const) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    corners.forEach((c, i) => (i === 0 ? g.moveTo(c.x, c.y) : g.lineTo(c.x, c.y)));
    g.closePath();
    g.stroke();
  }
  drawHandles(
    g,
    HANDLES.map((h) => {
      const point = handlePoint(t.source, h);
      const doc = applyAffine(t.matrix, point.x, point.y);
      return toScreen(view, doc.x, doc.y);
    }),
  );
}

export function drawCropOverlay(
  g: CanvasRenderingContext2D,
  view: ViewTransform,
  docWidth: number,
  docHeight: number,
): void {
  const rect = currentCrop();
  if (!rect) return;
  const doc = { ...toScreen(view, 0, 0), w: docWidth * view.scale, h: docHeight * view.scale };
  const a = toScreen(view, rect.x, rect.y);
  const w = rect.width * view.scale;
  const h = rect.height * view.scale;
  // Dim what will be cropped away.
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.rect(doc.x, doc.y, doc.w, doc.h);
  g.rect(a.x + w, a.y, -w, h);
  g.fill('evenodd');
  // Rule-of-thirds guides.
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  for (const k of [1, 2]) {
    g.moveTo(Math.round(a.x + (w * k) / 3) + 0.5, a.y);
    g.lineTo(Math.round(a.x + (w * k) / 3) + 0.5, a.y + h);
    g.moveTo(a.x, Math.round(a.y + (h * k) / 3) + 0.5);
    g.lineTo(a.x + w, Math.round(a.y + (h * k) / 3) + 0.5);
  }
  g.stroke();
  g.strokeStyle = '#fff';
  g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(w), Math.round(h));
  drawHandles(
    g,
    HANDLES.map((handle) => {
      const point = handlePoint(rect, handle);
      return toScreen(view, point.x, point.y);
    }),
  );
}
