import type { BlendMode } from './blend';
import type { Rect } from './geometry';
import { Raster } from './raster';
import type { Selection } from './selection';

export interface Layer {
  readonly id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
  /** Full-document-size pixel buffer. */
  readonly raster: Raster;
}

export type LayerProps = Pick<Layer, 'name' | 'visible' | 'opacity' | 'blendMode'>;

export type DocumentChange =
  /** Pixels of one layer changed inside `rect`. */
  | { kind: 'pixels'; layerId: string; rect: Rect }
  /** Layers were added, removed, reordered, or their properties changed. */
  | { kind: 'layers' }
  | { kind: 'active-layer' }
  | { kind: 'selection' };

export const MAX_DOCUMENT_SIZE = 16384;
export const MAX_LAYERS = 256;

export function createId(): string {
  return globalThis.crypto.randomUUID();
}

export function createLayer(
  width: number,
  height: number,
  props: Partial<LayerProps> = {},
  raster?: Raster,
): Layer {
  return {
    id: createId(),
    name: props.name ?? 'Layer',
    visible: props.visible ?? true,
    opacity: props.opacity ?? 1,
    blendMode: props.blendMode ?? 'normal',
    raster: raster ?? new Raster(width, height),
  };
}

/**
 * An image document: a stack of full-size raster layers (bottom to top), the
 * active layer and an optional selection. Mutators here do not record history;
 * use the operations module, which wraps them in undoable commands.
 */
export class PhotoDocument {
  readonly layers: Layer[] = [];
  activeLayerId: string;
  selection: Selection | null = null;
  private readonly listeners = new Set<(change: DocumentChange) => void>();

  constructor(
    readonly width: number,
    readonly height: number,
    layers: Layer[],
  ) {
    if (width < 1 || height < 1 || width > MAX_DOCUMENT_SIZE || height > MAX_DOCUMENT_SIZE) {
      throw new RangeError(`Unsupported document size ${width}×${height}`);
    }
    if (layers.length === 0) throw new RangeError('A document needs at least one layer');
    for (const layer of layers) this.assertLayerSize(layer);
    this.layers.push(...layers);
    this.activeLayerId = layers[layers.length - 1]!.id;
  }

  private assertLayerSize(layer: Layer): void {
    if (layer.raster.width !== this.width || layer.raster.height !== this.height) {
      throw new RangeError('Layer size does not match the document');
    }
  }

  on(listener: (change: DocumentChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change: DocumentChange): void {
    for (const listener of this.listeners) listener(change);
  }

  getLayer(id: string): Layer {
    const layer = this.layers.find((candidate) => candidate.id === id);
    if (!layer) throw new Error(`Unknown layer ${id}`);
    return layer;
  }

  indexOf(id: string): number {
    return this.layers.findIndex((layer) => layer.id === id);
  }

  get activeLayer(): Layer {
    return this.getLayer(this.activeLayerId);
  }

  setActiveLayer(id: string): void {
    this.getLayer(id);
    if (this.activeLayerId === id) return;
    this.activeLayerId = id;
    this.emit({ kind: 'active-layer' });
  }

  insertLayer(layer: Layer, index: number): void {
    if (this.layers.length >= MAX_LAYERS)
      throw new RangeError(`A document can have at most ${MAX_LAYERS} layers`);
    this.assertLayerSize(layer);
    this.layers.splice(Math.max(0, Math.min(index, this.layers.length)), 0, layer);
    this.emit({ kind: 'layers' });
  }

  removeLayer(id: string): { layer: Layer; index: number } {
    const index = this.indexOf(id);
    if (index < 0) throw new Error(`Unknown layer ${id}`);
    if (this.layers.length === 1) throw new Error('A document needs at least one layer');
    const [layer] = this.layers.splice(index, 1);
    if (this.activeLayerId === id) this.activeLayerId = this.layers[Math.max(0, index - 1)]!.id;
    this.emit({ kind: 'layers' });
    return { layer: layer!, index };
  }

  moveLayer(id: string, index: number): void {
    const from = this.indexOf(id);
    if (from < 0) throw new Error(`Unknown layer ${id}`);
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(Math.max(0, Math.min(index, this.layers.length)), 0, layer!);
    this.emit({ kind: 'layers' });
  }

  setLayerProps(id: string, props: Partial<LayerProps>): void {
    Object.assign(this.getLayer(id), props);
    this.emit({ kind: 'layers' });
  }

  writePixels(layerId: string, rect: Rect, pixels: Uint8ClampedArray): void {
    this.getLayer(layerId).raster.writeRegion(rect, pixels);
    this.emit({ kind: 'pixels', layerId, rect });
  }

  setSelection(selection: Selection | null): void {
    this.selection = selection && !selection.isEmpty() ? selection : null;
    this.emit({ kind: 'selection' });
  }
}
