import type { ViewTransform } from '@auram/photo-engine/webgl';

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;
const STEPS = [
  0.01,
  0.02,
  0.03,
  0.05,
  1 / 12,
  0.125,
  1 / 6,
  0.25,
  1 / 3,
  0.5,
  2 / 3,
  1,
  1.5,
  2,
  3,
  4,
  6,
  8,
  12,
  16,
  24,
  32,
  48,
  64,
];

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Centres the document in the viewport. With `allowUpscale` false, small images stay at 100%. */
export function fitView(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  allowUpscale = false,
  padding = 32,
): ViewTransform {
  const available = {
    w: Math.max(1, viewWidth - padding * 2),
    h: Math.max(1, viewHeight - padding * 2),
  };
  let scale = Math.min(available.w / docWidth, available.h / docHeight);
  if (!allowUpscale) scale = Math.min(1, scale);
  scale = clampZoom(scale);
  return centered(docWidth, docHeight, viewWidth, viewHeight, scale);
}

export function centered(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  scale: number,
): ViewTransform {
  return {
    scale,
    offsetX: Math.round((viewWidth - docWidth * scale) / 2),
    offsetY: Math.round((viewHeight - docHeight * scale) / 2),
  };
}

/** Changes the zoom while keeping the document point under (x, y) in place. */
export function zoomAt(view: ViewTransform, scale: number, x: number, y: number): ViewTransform {
  const next = clampZoom(scale);
  const docX = (x - view.offsetX) / view.scale;
  const docY = (y - view.offsetY) / view.scale;
  return { scale: next, offsetX: x - docX * next, offsetY: y - docY * next };
}

/** Next preset zoom level in the given direction. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((step) => step > scale * 1.0001) ?? MAX_ZOOM;
  return [...STEPS].reverse().find((step) => step < scale * 0.9999) ?? MIN_ZOOM;
}

export function screenToDoc(view: ViewTransform, x: number, y: number): { x: number; y: number } {
  return { x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale };
}
