import { FloatCanvas } from './blend';
import type { Rgba } from './color';
import { WHITE } from './color';
import * as commands from './commands';
import { createLayer, PhotoDocument, type Layer, type LayerProps } from './document';
import { intersectRects, isEmptyRect, unionRects, type Rect } from './geometry';
import type { Command } from './history';
import { Raster } from './raster';
import { Selection, type SelectionMode } from './selection';

/*
 * Editing operations. Each returns an undoable Command that has already been
 * applied, or null when there was nothing to do. Command labels are stable keys
 * that the UI translates.
 */

export type Background = 'white' | 'transparent' | Rgba;

export function createDocument(
  width: number,
  height: number,
  background: Background = 'white',
): PhotoDocument {
  const layer = createLayer(width, height, { name: 'Background' });
  if (background !== 'transparent') layer.raster.fill(background === 'white' ? WHITE : background);
  return new PhotoDocument(width, height, [layer]);
}

export function documentFromPixels(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  name = 'Background',
): PhotoDocument {
  return new PhotoDocument(width, height, [
    createLayer(width, height, { name }, new Raster(width, height, pixels)),
  ]);
}

function nextLayerName(doc: PhotoDocument, base = 'Layer'): string {
  const used = new Set(doc.layers.map((layer) => layer.name));
  for (let n = doc.layers.length; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}

export function addLayer(doc: PhotoDocument, name?: string): Command {
  const layer = createLayer(doc.width, doc.height, { name: name ?? nextLayerName(doc) });
  const command = commands.insertLayer(
    'add-layer',
    layer,
    doc.indexOf(doc.activeLayerId) + 1,
    doc.activeLayerId,
  );
  command.redo(doc);
  return command;
}

export function duplicateLayer(doc: PhotoDocument, layerId: string): Command {
  const source = doc.getLayer(layerId);
  const copy = createLayer(
    doc.width,
    doc.height,
    {
      name: `${source.name} copy`,
      visible: source.visible,
      opacity: source.opacity,
      blendMode: source.blendMode,
    },
    source.raster.clone(),
  );
  const command = commands.insertLayer(
    'duplicate-layer',
    copy,
    doc.indexOf(layerId) + 1,
    doc.activeLayerId,
  );
  command.redo(doc);
  return command;
}

export function deleteLayer(doc: PhotoDocument, layerId: string): Command | null {
  if (doc.layers.length <= 1) return null;
  const index = doc.indexOf(layerId);
  const command = commands.removeLayer('delete-layer', doc.getLayer(layerId), index);
  command.redo(doc);
  return command;
}

export function moveLayer(
  doc: PhotoDocument,
  layerId: string,
  direction: 'up' | 'down',
): Command | null {
  const from = doc.indexOf(layerId);
  const to = direction === 'up' ? from + 1 : from - 1;
  if (to < 0 || to >= doc.layers.length) return null;
  const command = commands.moveLayer('move-layer', layerId, from, to);
  command.redo(doc);
  return command;
}

export function setLayerProps(
  doc: PhotoDocument,
  layerId: string,
  props: Partial<LayerProps>,
): Command | null {
  const layer = doc.getLayer(layerId);
  const before: Partial<LayerProps> = {};
  const after: Partial<LayerProps> = {};
  for (const key of Object.keys(props) as Array<keyof LayerProps>) {
    if (props[key] === undefined || props[key] === layer[key]) continue;
    (before as Record<string, unknown>)[key] = layer[key];
    (after as Record<string, unknown>)[key] = props[key];
  }
  if (Object.keys(after).length === 0) return null;
  if (after.opacity !== undefined) after.opacity = Math.min(1, Math.max(0, after.opacity));
  const label =
    'name' in after
      ? 'rename-layer'
      : 'visible' in after
        ? 'toggle-visibility'
        : 'layer-properties';
  const command = commands.layerProps(label, layerId, before, after);
  command.redo(doc);
  return command;
}

/** Flattens the visible layers into straight-alpha RGBA8 using the reference compositor. */
export function flatten(doc: PhotoDocument, layers: Layer[] = doc.layers): Uint8ClampedArray {
  const canvas = new FloatCanvas(doc.width, doc.height);
  for (const layer of layers) {
    if (layer.visible && layer.opacity > 0)
      canvas.composite(layer.raster.data, layer.blendMode, layer.opacity);
  }
  return canvas.toRgba8();
}

/**
 * Merges a layer into the one below. The upper layer's blend mode and opacity are
 * baked into the lower layer's pixels; the lower layer keeps its own properties.
 */
export function mergeDown(doc: PhotoDocument, layerId: string): Command | null {
  const index = doc.indexOf(layerId);
  if (index <= 0) return null;
  const upper = doc.getLayer(layerId);
  const lower = doc.layers[index - 1]!;
  const canvas = new FloatCanvas(doc.width, doc.height);
  canvas.composite(lower.raster.data, 'normal', 1);
  if (upper.visible) canvas.composite(upper.raster.data, upper.blendMode, upper.opacity);
  const before = lower.raster.data.slice();
  const after = canvas.toRgba8();
  const full = lower.raster.bounds;
  // Removing the upper layer activates the one below; undo re-activates the upper layer.
  const command = commands.compound('merge-down', [
    commands.removeLayer('merge-down', upper, index),
    commands.pixelPatch('merge-down', lower.id, full, before, after),
  ]);
  command.redo(doc);
  return command;
}

/** Applies `transform` to the layer's pixels inside `rect`, recording an undo patch. */
function editPixels(
  doc: PhotoDocument,
  label: string,
  layerId: string,
  rect: Rect,
  transform: (data: Uint8ClampedArray, rect: Rect) => void,
): Command | null {
  const raster = doc.getLayer(layerId).raster;
  const area = raster.clip(rect);
  if (isEmptyRect(area)) return null;
  const before = raster.readRegion(area);
  const after = before.slice();
  transform(after, area);
  const command = commands.pixelPatch(label, layerId, area, before, after);
  command.redo(doc);
  return command;
}

/** Fills the selection (or the whole layer) with a colour, respecting soft selection edges. */
export function fill(doc: PhotoDocument, layerId: string, color: Rgba): Command | null {
  const selection = doc.selection;
  const rect = selection ? selection.bounds() : doc.getLayer(layerId).raster.bounds;
  return editPixels(doc, 'fill', layerId, rect, (data, area) => {
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const i = (y * area.width + x) * 4;
        const m = selection ? selection.mask[(area.y + y) * doc.width + area.x + x]! / 255 : 1;
        const a = m * (color.a / 255);
        const oa = data[i + 3]! / 255;
        const ao = a + oa * (1 - a);
        if (ao <= 0) continue;
        data[i] = (color.r * a + data[i]! * oa * (1 - a)) / ao;
        data[i + 1] = (color.g * a + data[i + 1]! * oa * (1 - a)) / ao;
        data[i + 2] = (color.b * a + data[i + 2]! * oa * (1 - a)) / ao;
        data[i + 3] = ao * 255;
      }
    }
  });
}

/** Erases the selected pixels of a layer (Delete key). Without a selection nothing happens. */
export function clearSelected(doc: PhotoDocument, layerId: string): Command | null {
  const selection = doc.selection;
  if (!selection) return null;
  return editPixels(doc, 'clear', layerId, selection.bounds(), (data, area) => {
    for (let y = 0; y < area.height; y++) {
      for (let x = 0; x < area.width; x++) {
        const m = selection.mask[(area.y + y) * doc.width + area.x + x]! / 255;
        const i = (y * area.width + x) * 4 + 3;
        data[i] = data[i]! * (1 - m);
      }
    }
  });
}

/**
 * Moves a layer's pixels by a whole number of pixels. With a selection, only the
 * selected pixels move (and the selection moves with them). Pixels moved beyond
 * the document edge are discarded.
 */
export function translate(
  doc: PhotoDocument,
  layerId: string,
  dx: number,
  dy: number,
): Command | null {
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (dx === 0 && dy === 0) return null;
  const raster = doc.getLayer(layerId).raster;
  const selection = doc.selection;
  const source = selection ? selection.bounds() : raster.contentBounds();
  if (isEmptyRect(source)) return null;
  const target = { ...source, x: source.x + dx, y: source.y + dy };
  const area = raster.clip(unionRects(source, target));
  const before = raster.readRegion(area);
  const original = raster.data;
  const width = doc.width;
  const after = before.slice();

  const index = (x: number, y: number) => ((y - area.y) * area.width + (x - area.x)) * 4;
  // Lift: remove the moving pixels from their old position.
  for (let y = source.y; y < source.y + source.height; y++) {
    for (let x = source.x; x < source.x + source.width; x++) {
      if (x < area.x || y < area.y || x >= area.x + area.width || y >= area.y + area.height)
        continue;
      const m = selection ? selection.mask[y * width + x]! / 255 : 1;
      const i = index(x, y) + 3;
      after[i] = after[i]! * (1 - m);
    }
  }
  // Drop: composite them at the new position.
  const dest = intersectRects(target, area);
  for (let y = dest.y; y < dest.y + dest.height; y++) {
    for (let x = dest.x; x < dest.x + dest.width; x++) {
      const sx = x - dx;
      const sy = y - dy;
      const s = (sy * width + sx) * 4;
      const m = selection ? selection.mask[sy * width + sx]! / 255 : 1;
      const a = (original[s + 3]! / 255) * m;
      if (a <= 0) continue;
      const i = index(x, y);
      const oa = after[i + 3]! / 255;
      const ao = a + oa * (1 - a);
      after[i] = (original[s]! * a + after[i]! * oa * (1 - a)) / ao;
      after[i + 1] = (original[s + 1]! * a + after[i + 1]! * oa * (1 - a)) / ao;
      after[i + 2] = (original[s + 2]! * a + after[i + 2]! * oa * (1 - a)) / ao;
      after[i + 3] = ao * 255;
    }
  }

  const steps: Command[] = [commands.pixelPatch('move', layerId, area, before, after)];
  if (selection)
    steps.push(commands.selectionChange('move', selection, selection.translate(dx, dy)));
  const command = commands.compound('move', steps);
  command.redo(doc);
  return command;
}

/** Mirrors every layer (and the selection) of the document. */
export function flipDocument(doc: PhotoDocument, horizontal: boolean): Command {
  const flipRaster = (raster: Raster) => {
    const out = new Uint8ClampedArray(raster.data.length);
    const w = raster.width;
    const h = raster.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = horizontal ? w - 1 - x : x;
        const sy = horizontal ? y : h - 1 - y;
        out.set(raster.data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
      }
    }
    return out;
  };
  const label = horizontal ? 'flip-horizontal' : 'flip-vertical';
  const steps: Command[] = doc.layers.map((layer) =>
    commands.pixelPatch(
      label,
      layer.id,
      layer.raster.bounds,
      layer.raster.data.slice(),
      flipRaster(layer.raster),
    ),
  );
  if (doc.selection)
    steps.push(commands.selectionChange(label, doc.selection, doc.selection.flip(horizontal)));
  const command = commands.compound(label, steps);
  command.redo(doc);
  return command;
}

export type SelectionShape = { type: 'rect' | 'ellipse'; rect: Rect };

export function select(
  doc: PhotoDocument,
  shape: SelectionShape,
  mode: SelectionMode = 'replace',
): Command | null {
  const shaped =
    shape.type === 'rect'
      ? Selection.rect(doc.width, doc.height, shape.rect)
      : Selection.ellipse(doc.width, doc.height, shape.rect);
  const base =
    doc.selection ?? new Selection(doc.width, doc.height, new Uint8Array(doc.width * doc.height));
  return setSelection(doc, mode === 'replace' ? shaped : base.combine(shaped, mode), 'select');
}

export function selectAll(doc: PhotoDocument): Command | null {
  return setSelection(doc, Selection.all(doc.width, doc.height), 'select-all');
}

export function deselect(doc: PhotoDocument): Command | null {
  return doc.selection ? setSelection(doc, null, 'deselect') : null;
}

export function invertSelection(doc: PhotoDocument): Command | null {
  const current = doc.selection;
  return setSelection(doc, current ? current.invert() : null, 'invert-selection');
}

function setSelection(doc: PhotoDocument, next: Selection | null, label: string): Command | null {
  const normalized = next && !next.isEmpty() ? next : null;
  if (normalized === doc.selection) return null;
  const command = commands.selectionChange(label, doc.selection, normalized);
  command.redo(doc);
  return command;
}

/** Colour at a document position, from the active layer or from all visible layers. */
export function sampleColor(
  doc: PhotoDocument,
  x: number,
  y: number,
  merged: boolean,
): Rgba | null {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  if (!merged) return doc.activeLayer.raster.getPixel(x, y);
  const canvas = new FloatCanvas(1, 1);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    canvas.composite(
      layer.raster.data.subarray((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4),
      layer.blendMode,
      layer.opacity,
    );
  }
  const [r, g, b, a] = canvas.toRgba8();
  return { r: r!, g: g!, b: b!, a: a! };
}
