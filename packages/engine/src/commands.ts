import type { Layer, LayerProps, PhotoDocument } from './document';
import type { Rect } from './geometry';
import type { Command } from './history';
import type { Selection } from './selection';

/** Replaces the pixels of one layer inside `rect`. */
export function pixelPatch(
  label: string,
  layerId: string,
  rect: Rect,
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): Command {
  return {
    label,
    bytes: before.byteLength + after.byteLength,
    undo: (doc) => doc.writePixels(layerId, rect, before),
    redo: (doc) => doc.writePixels(layerId, rect, after),
  };
}

export function insertLayer(
  label: string,
  layer: Layer,
  index: number,
  previousActive: string,
): Command {
  return {
    label,
    bytes: layer.raster.data.byteLength,
    undo: (doc) => {
      doc.removeLayer(layer.id);
      doc.setActiveLayer(previousActive);
    },
    redo: (doc) => {
      doc.insertLayer(layer, index);
      doc.setActiveLayer(layer.id);
    },
  };
}

export function removeLayer(label: string, layer: Layer, index: number): Command {
  return {
    label,
    bytes: layer.raster.data.byteLength,
    undo: (doc) => {
      doc.insertLayer(layer, index);
      doc.setActiveLayer(layer.id);
    },
    redo: (doc) => {
      doc.removeLayer(layer.id);
    },
  };
}

export function moveLayer(label: string, layerId: string, from: number, to: number): Command {
  return {
    label,
    bytes: 0,
    undo: (doc) => doc.moveLayer(layerId, from),
    redo: (doc) => doc.moveLayer(layerId, to),
  };
}

export function layerProps(
  label: string,
  layerId: string,
  before: Partial<LayerProps>,
  after: Partial<LayerProps>,
): Command {
  const command: Command = {
    label,
    bytes: 0,
    mergeKey: `props:${layerId}:${Object.keys(after).sort().join(',')}`,
    undo: (doc) => doc.setLayerProps(layerId, before),
    redo: (doc) => doc.setLayerProps(layerId, after),
    merge: (next) => {
      const merged = layerProps(
        next.label,
        layerId,
        before,
        (next as Command & { after: Partial<LayerProps> }).after,
      );
      return merged;
    },
  };
  return Object.assign(command, { after });
}

export function selectionChange(
  label: string,
  before: Selection | null,
  after: Selection | null,
): Command {
  return {
    label,
    bytes: (before?.mask.byteLength ?? 0) + (after?.mask.byteLength ?? 0),
    undo: (doc: PhotoDocument) => doc.setSelection(before),
    redo: (doc: PhotoDocument) => doc.setSelection(after),
  };
}

/** Groups commands into one undo step. Undo runs in reverse order. */
export function compound(label: string, commands: Command[]): Command {
  return {
    label,
    bytes: commands.reduce((sum, command) => sum + command.bytes, 0),
    undo: (doc) => {
      for (let i = commands.length - 1; i >= 0; i--) commands[i]!.undo(doc);
    },
    redo: (doc) => {
      for (const command of commands) command.redo(doc);
    },
  };
}
