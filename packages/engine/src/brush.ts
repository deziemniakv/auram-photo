import type { Rgba } from './color';
import { pixelPatch } from './commands';
import type { PhotoDocument } from './document';
import {
  intersectRects,
  isEmptyRect,
  rectFromBox,
  unionRects,
  EMPTY_RECT,
  type Rect,
} from './geometry';
import type { Command } from './history';

export interface BrushSettings {
  /** Diameter in document pixels. */
  size: number;
  /** 0 = soft edge, 1 = hard edge. */
  hardness: number;
  /** Maximum coverage of a stroke, 0..1. Overlapping dabs never exceed it. */
  opacity: number;
  /** Distance between dabs as a fraction of the diameter. */
  spacing: number;
}

export const DEFAULT_BRUSH: BrushSettings = { size: 24, hardness: 0.8, opacity: 1, spacing: 0.12 };

export type StrokeMode = 'paint' | 'erase';

/** Coverage (0..1) of a round dab at distance `d` from its centre. */
export function dabCoverage(d: number, radius: number, hardness: number): number {
  if (radius <= 0.5) return Math.max(0, Math.min(1, 1 - d));
  const hardEdge = Math.min(1, Math.max(0, radius - d + 0.5));
  if (hardness >= 1) return hardEdge;
  const inner = radius * hardness;
  if (d <= inner) return hardEdge;
  const t = (d - inner) / (radius - inner);
  const soft = 1 - t * t * (3 - 2 * t);
  return Math.max(0, Math.min(hardEdge, soft));
}

/**
 * One brush or eraser stroke on one layer.
 *
 * Coverage from every dab is accumulated with `max`, then the layer is
 * recomputed from its pixels before the stroke. That keeps a stroke at the
 * chosen opacity no matter how often it overlaps itself, and makes the undo
 * patch exact. Painting is limited to the selection when there is one.
 */
export class Stroke {
  private readonly original: Uint8ClampedArray;
  private readonly coverage: Uint8Array;
  private dirty: Rect = EMPTY_RECT;
  private last: { x: number; y: number } | null = null;
  private carry = 0;

  constructor(
    private readonly doc: PhotoDocument,
    private readonly layerId: string,
    private readonly mode: StrokeMode,
    private readonly color: Rgba,
    private readonly brush: BrushSettings,
  ) {
    const raster = doc.getLayer(layerId).raster;
    this.original = raster.data.slice();
    this.coverage = new Uint8Array(raster.width * raster.height);
  }

  /** Adds a point to the stroke and returns the region that changed. */
  addPoint(x: number, y: number): Rect {
    let changed: Rect = EMPTY_RECT;
    const step = Math.max(0.5, this.brush.size * this.brush.spacing);
    if (!this.last) {
      changed = this.stamp(x, y);
    } else {
      const dx = x - this.last.x;
      const dy = y - this.last.y;
      const distance = Math.hypot(dx, dy);
      let travelled = step - this.carry;
      while (travelled <= distance) {
        const t = travelled / distance;
        changed = unionRects(changed, this.stamp(this.last.x + dx * t, this.last.y + dy * t));
        travelled += step;
      }
      this.carry = distance - (travelled - step);
    }
    this.last = { x, y };
    if (!isEmptyRect(changed)) this.apply(changed);
    return changed;
  }

  private stamp(cx: number, cy: number): Rect {
    const radius = this.brush.size / 2;
    const raster = this.doc.getLayer(this.layerId).raster;
    const area = intersectRects(
      rectFromBox(cx - radius - 1, cy - radius - 1, cx + radius + 1, cy + radius + 1),
      raster.bounds,
    );
    if (isEmptyRect(area)) return EMPTY_RECT;
    const hardness = Math.min(1, Math.max(0, this.brush.hardness));
    const maxCoverage = Math.min(1, Math.max(0, this.brush.opacity)) * 255;
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const c =
          dabCoverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), radius, hardness) * maxCoverage;
        const i = y * raster.width + x;
        if (c > this.coverage[i]!) this.coverage[i] = Math.round(c);
      }
    }
    this.dirty = unionRects(this.dirty, area);
    return area;
  }

  private apply(rect: Rect): void {
    const raster = this.doc.getLayer(this.layerId).raster;
    const out = raster.data;
    const selection = this.doc.selection;
    const { r, g, b, a: colorAlpha } = this.color;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const p = y * raster.width + x;
        let a = this.coverage[p]! / 255;
        if (selection) a *= selection.mask[p]! / 255;
        const i = p * 4;
        const oa = this.original[i + 3]! / 255;
        if (this.mode === 'erase') {
          out[i] = this.original[i]!;
          out[i + 1] = this.original[i + 1]!;
          out[i + 2] = this.original[i + 2]!;
          out[i + 3] = Math.round(oa * (1 - a) * 255);
          continue;
        }
        a *= colorAlpha / 255;
        const ao = a + oa * (1 - a);
        if (ao <= 0) {
          out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
          continue;
        }
        const k = (oa * (1 - a)) / ao;
        const s = a / ao;
        out[i] = Math.round(r * s + this.original[i]! * k);
        out[i + 1] = Math.round(g * s + this.original[i + 1]! * k);
        out[i + 2] = Math.round(b * s + this.original[i + 2]! * k);
        out[i + 3] = Math.round(ao * 255);
      }
    }
    this.doc.emit({ kind: 'pixels', layerId: this.layerId, rect });
  }

  /** Finishes the stroke. Returns the undo command, or null if nothing changed. */
  end(): Command | null {
    if (isEmptyRect(this.dirty)) return null;
    const raster = this.doc.getLayer(this.layerId).raster;
    const rect = this.dirty;
    const before = new Uint8ClampedArray(rect.width * rect.height * 4);
    for (let row = 0; row < rect.height; row++) {
      const start = ((rect.y + row) * raster.width + rect.x) * 4;
      before.set(this.original.subarray(start, start + rect.width * 4), row * rect.width * 4);
    }
    return pixelPatch(
      this.mode === 'erase' ? 'erase' : 'paint',
      this.layerId,
      rect,
      before,
      raster.readRegion(rect),
    );
  }
}
