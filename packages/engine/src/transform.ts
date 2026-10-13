import { applyAffine, isIdentity, type Affine } from './affine';
import type { Rgba } from './color';
import * as commands from './commands';
import { assertDocumentSize, type DocumentGeometry, type PhotoDocument } from './document';
import {
  intersectRects,
  isEmptyRect,
  rectFromBox,
  sizeRect,
  unionRects,
  type Rect,
} from './geometry';
import type { Command } from './history';
import { Raster } from './raster';
import {
  resampleRaster,
  resampleSelection,
  transformPixels,
  type ResampleMethod,
} from './resample';
import { Selection } from './selection';

/*
 * Operations that change the document's geometry (size, crop, rotation) and
 * free transforms of layer pixels. The pure functions do the pixel work and can
 * run in a worker; the document operations wrap them in undoable commands.
 */

/** Records and applies a new size, set of layer rasters and selection. */
export function applyGeometry(doc: PhotoDocument, label: string, after: DocumentGeometry): Command {
  const command = commands.geometryChange(label, doc.geometry(), after);
  command.redo(doc);
  return command;
}

/* ------------------------------ image size ------------------------------- */

/** The geometry after resampling every layer (and the selection) to a new size. */
export function resizedGeometry(
  geometry: DocumentGeometry,
  width: number,
  height: number,
  method: ResampleMethod,
): DocumentGeometry {
  assertDocumentSize(width, height);
  const rasters = new Map(
    [...geometry.rasters].map(([id, raster]) => [
      id,
      resampleRaster(raster, width, height, method),
    ]),
  );
  const selection =
    geometry.selection && resampleSelection(geometry.selection, width, height, method);
  return { width, height, rasters, selection };
}

export function resizeImage(
  doc: PhotoDocument,
  width: number,
  height: number,
  method: ResampleMethod,
): Command | null {
  assertDocumentSize(width, height);
  if (width === doc.width && height === doc.height) return null;
  return applyGeometry(doc, 'image-size', resizedGeometry(doc.geometry(), width, height, method));
}

/* --------------------------- canvas size, crop --------------------------- */

/** Where existing pixels stay when the canvas grows or shrinks: 0 = start, 0.5 = centre, 1 = end. */
export interface Anchor {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}

/** Copies a raster onto a new canvas, with old pixel (x, y) landing at (x + dx, y + dy). */
export function reframeRaster(
  raster: Raster,
  width: number,
  height: number,
  dx: number,
  dy: number,
  fill?: Rgba | null,
): Raster {
  const out = new Raster(width, height);
  if (fill) out.fill(fill);
  const target = intersectRects(
    { x: dx, y: dy, width: raster.width, height: raster.height },
    out.bounds,
  );
  if (isEmptyRect(target)) return out;
  out.writeRegion(target, raster.readRegion({ ...target, x: target.x - dx, y: target.y - dy }));
  return out;
}

export function reframeSelection(
  selection: Selection,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Selection {
  const mask = new Uint8Array(width * height);
  const target = intersectRects(
    { x: dx, y: dy, width: selection.width, height: selection.height },
    sizeRect(width, height),
  );
  for (let y = target.y; y < target.y + target.height; y++) {
    const from = (y - dy) * selection.width + (target.x - dx);
    mask.set(selection.mask.subarray(from, from + target.width), y * width + target.x);
  }
  return new Selection(width, height, mask);
}

function reframe(
  doc: PhotoDocument,
  label: string,
  width: number,
  height: number,
  dx: number,
  dy: number,
  bottomFill: Rgba | null,
): Command | null {
  assertDocumentSize(width, height);
  if (width === doc.width && height === doc.height && dx === 0 && dy === 0) return null;
  const bottomId = doc.layers[0]!.id;
  const rasters = new Map(
    doc.layers.map((layer) => [
      layer.id,
      reframeRaster(layer.raster, width, height, dx, dy, layer.id === bottomId ? bottomFill : null),
    ]),
  );
  const selection = doc.selection && reframeSelection(doc.selection, width, height, dx, dy);
  return applyGeometry(doc, label, { width, height, rasters, selection });
}

/**
 * Changes the canvas size without scaling. Existing pixels are placed according
 * to `anchor`; pixels outside the new canvas are discarded. New areas are
 * transparent, except on the bottom layer when `bottomFill` is given.
 */
export function resizeCanvas(
  doc: PhotoDocument,
  width: number,
  height: number,
  anchor: Anchor,
  bottomFill: Rgba | null = null,
): Command | null {
  const dx = Math.round((width - doc.width) * anchor.x);
  const dy = Math.round((height - doc.height) * anchor.y);
  return reframe(doc, 'canvas-size', width, height, dx, dy, bottomFill);
}

/** Crops the document to `rect` (clipped to the canvas). The selection is cleared. */
export function crop(doc: PhotoDocument, rect: Rect): Command | null {
  const area = intersectRects(
    {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    sizeRect(doc.width, doc.height),
  );
  if (isEmptyRect(area)) return null;
  if (area.width === doc.width && area.height === doc.height) return null;
  const rasters = new Map(
    doc.layers.map((layer) => [
      layer.id,
      reframeRaster(layer.raster, area.width, area.height, -area.x, -area.y),
    ]),
  );
  return applyGeometry(doc, 'crop', {
    width: area.width,
    height: area.height,
    rasters,
    selection: null,
  });
}

/* -------------------------------- rotation ------------------------------- */

export type QuarterTurns = 1 | 2 | 3;

/** Exact rotation by quarter turns clockwise. */
export function rotateRaster(raster: Raster, turns: QuarterTurns): Raster {
  const { width: w, height: h } = raster;
  const swap = turns !== 2;
  const out = new Raster(swap ? h : w, swap ? w : h);
  const data = raster.data.byteOffset % 4 === 0 ? raster.data : raster.data.slice();
  const src = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const dst = new Uint32Array(out.data.buffer, out.data.byteOffset, w * h);
  const ow = out.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]!;
      if (turns === 1) dst[x * ow + (h - 1 - y)] = v;
      else if (turns === 2) dst[(h - 1 - y) * ow + (w - 1 - x)] = v;
      else dst[(w - 1 - x) * ow + y] = v;
    }
  }
  return out;
}

export function rotateSelection(selection: Selection, turns: QuarterTurns): Selection {
  const { width: w, height: h } = selection;
  const swap = turns !== 2;
  const ow = swap ? h : w;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = selection.mask[y * w + x]!;
      if (turns === 1) out[x * ow + (h - 1 - y)] = v;
      else if (turns === 2) out[(h - 1 - y) * ow + (w - 1 - x)] = v;
      else out[(w - 1 - x) * ow + y] = v;
    }
  }
  return new Selection(ow, swap ? w : h, out);
}

/** The geometry after rotating every layer (and the selection) by quarter turns clockwise. */
export function rotatedGeometry(geometry: DocumentGeometry, turns: QuarterTurns): DocumentGeometry {
  const swap = turns !== 2;
  return {
    width: swap ? geometry.height : geometry.width,
    height: swap ? geometry.width : geometry.height,
    rasters: new Map(
      [...geometry.rasters].map(([id, raster]) => [id, rotateRaster(raster, turns)]),
    ),
    selection: geometry.selection && rotateSelection(geometry.selection, turns),
  };
}

export function rotationLabel(turns: QuarterTurns): string {
  return turns === 1 ? 'rotate-cw' : turns === 2 ? 'rotate-180' : 'rotate-ccw';
}

/** Rotates the whole document by quarter turns clockwise. */
export function rotateDocument(doc: PhotoDocument, turns: QuarterTurns): Command {
  return applyGeometry(doc, rotationLabel(turns), rotatedGeometry(doc.geometry(), turns));
}

/* ----------------------------- free transform ---------------------------- */

/** The pixels a free transform moves: the selected pixels, or the layer's content. */
export function transformSource(raster: Raster, selection: Selection | null): Rect {
  return selection ? intersectRects(selection.bounds(), raster.bounds) : raster.contentBounds();
}

/** Document-space bounding box of `rect` after `transform`, as whole pixels. */
export function transformedBounds(rect: Rect, transform: Affine): Rect {
  const corners = [
    applyAffine(transform, rect.x, rect.y),
    applyAffine(transform, rect.x + rect.width, rect.y),
    applyAffine(transform, rect.x, rect.y + rect.height),
    applyAffine(transform, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  // Tolerate floating-point noise so exact transforms do not grow by a pixel.
  const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);
  return rectFromBox(
    snap(Math.min(...xs)),
    snap(Math.min(...ys)),
    snap(Math.max(...xs)),
    snap(Math.max(...ys)),
  );
}

/**
 * Splits the pixels of `source` into the part a free transform moves (`floating`)
 * and the part that stays behind (`remaining`), both `source`-sized.
 */
export function liftPixels(
  raster: Raster,
  selection: Selection | null,
  source: Rect,
): { floating: Uint8ClampedArray; remaining: Uint8ClampedArray } {
  const floating = raster.readRegion(source);
  if (!selection) return { floating, remaining: new Uint8ClampedArray(floating.length) };
  const remaining = floating.slice();
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const m = selection.mask[(source.y + y) * raster.width + source.x + x]! / 255;
      const i = (y * source.width + x) * 4 + 3;
      floating[i] = floating[i]! * m;
      remaining[i] = remaining[i]! * (1 - m);
    }
  }
  return { floating, remaining };
}

export interface LayerTransformResult {
  /** Changed area of the layer. */
  rect: Rect;
  /** New pixels of `rect`. */
  pixels: Uint8ClampedArray;
  /** Transformed selection, or null when there was none. */
  selection: Selection | null;
}

/**
 * Transforms the selected pixels of a layer (or all of it without a selection).
 * `transform` maps document coordinates to document coordinates. Pixels that
 * land outside the canvas are discarded. Returns null when nothing would change.
 */
export function transformLayerPixels(
  raster: Raster,
  selection: Selection | null,
  transform: Affine,
  method: ResampleMethod,
): LayerTransformResult | null {
  if (isIdentity(transform)) return null;
  const source = transformSource(raster, selection);
  if (isEmptyRect(source)) return null;
  const dest = intersectRects(transformedBounds(source, transform), raster.bounds);
  const rect = unionRects(source, dest);

  const { floating, remaining } = liftPixels(raster, selection, source);
  const pixels = raster.readRegion(rect);
  for (let y = 0; y < source.height; y++) {
    pixels.set(
      remaining.subarray(y * source.width * 4, (y + 1) * source.width * 4),
      ((source.y - rect.y + y) * rect.width + (source.x - rect.x)) * 4,
    );
  }

  // Drop them, transformed, over what remains.
  if (!isEmptyRect(dest)) {
    const moved = transformPixels(
      floating,
      source.width,
      source.height,
      source,
      transform,
      dest,
      4,
      method,
    );
    for (let y = 0; y < dest.height; y++) {
      for (let x = 0; x < dest.width; x++) {
        const s = (y * dest.width + x) * 4;
        const a = moved[s + 3]! / 255;
        if (a <= 0) continue;
        const i = ((dest.y - rect.y + y) * rect.width + (dest.x - rect.x + x)) * 4;
        const oa = pixels[i + 3]! / 255;
        const ao = a + oa * (1 - a);
        pixels[i] = (moved[s]! * a + pixels[i]! * oa * (1 - a)) / ao;
        pixels[i + 1] = (moved[s + 1]! * a + pixels[i + 1]! * oa * (1 - a)) / ao;
        pixels[i + 2] = (moved[s + 2]! * a + pixels[i + 2]! * oa * (1 - a)) / ao;
        pixels[i + 3] = ao * 255;
      }
    }
  }

  let nextSelection: Selection | null = null;
  if (selection) {
    const mask = new Uint8Array(selection.mask.length);
    if (!isEmptyRect(dest)) {
      const region = new Uint8Array(source.width * source.height);
      for (let y = 0; y < source.height; y++) {
        const from = (source.y + y) * selection.width + source.x;
        region.set(selection.mask.subarray(from, from + source.width), y * source.width);
      }
      const moved = transformPixels(
        region,
        source.width,
        source.height,
        source,
        transform,
        dest,
        1,
        method === 'nearest' ? 'nearest' : 'bilinear',
      );
      for (let y = 0; y < dest.height; y++) {
        mask.set(
          moved.subarray(y * dest.width, (y + 1) * dest.width),
          (dest.y + y) * selection.width + dest.x,
        );
      }
    }
    nextSelection = new Selection(selection.width, selection.height, mask);
  }
  return { rect, pixels, selection: nextSelection };
}

/** Records and applies the result of {@link transformLayerPixels}. */
export function applyLayerTransform(
  doc: PhotoDocument,
  layerId: string,
  result: LayerTransformResult,
): Command {
  const raster = doc.getLayer(layerId).raster;
  const steps: Command[] = [
    commands.pixelPatch(
      'transform',
      layerId,
      result.rect,
      raster.readRegion(result.rect),
      result.pixels,
    ),
  ];
  if (doc.selection || result.selection) {
    steps.push(commands.selectionChange('transform', doc.selection, result.selection));
  }
  const command = commands.compound('transform', steps);
  command.redo(doc);
  return command;
}

/** Free-transforms the active pixels of a layer. */
export function transformLayer(
  doc: PhotoDocument,
  layerId: string,
  transform: Affine,
  method: ResampleMethod,
): Command | null {
  const result = transformLayerPixels(
    doc.getLayer(layerId).raster,
    doc.selection,
    transform,
    method,
  );
  return result && applyLayerTransform(doc, layerId, result);
}
