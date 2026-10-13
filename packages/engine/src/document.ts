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
  /** Full-document-size pixel buffer. Replaced when the document size changes. */
  raster: Raster;
}

export type LayerProps = Pick<Layer, 'name' | 'visible' | 'opacity' | 'blendMode'>;

export type DocumentChange =
  /** Pixels of one layer changed inside `rect`. */
  | { kind: 'pixels'; layerId: string; rect: Rect }
  /** Layers were added, removed, reordered, or their properties changed. */
  | { kind: 'layers' }
  /**
   * The document size changed: every layer has a new raster and the selection was
   * replaced. Treat everything as changed.
   */
  | { kind: 'size' }
  | { kind: 'active-layer' }
  | { kind: 'selection' };

export const MAX_DOCUMENT_SIZE = 16384;

/** Size, layer pixels and selection: everything a size change replaces at once. */
export interface DocumentGeometry {
  width: number;
  height: number;
  /** One raster per layer id, all `width` × `height`. */
  rasters: ReadonlyMap<string, Raster>;
  selection: Selection | null;
}

export function assertDocumentSize(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DOCUMENT_SIZE ||
    height > MAX_DOCUMENT_SIZE
  ) {
    throw new RangeError(`Unsupported document size ${width}×${height}`);
  }
}
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

  private size: { width: number; height: number };

  constructor(width: number, height: number, layers: Layer[]) {
    assertDocumentSize(width, height);
    this.size = { width, height };
    if (layers.length === 0) throw new RangeError('A document needs at least one layer');
    for (const layer of layers) this.assertLayerSize(layer);
    this.layers.push(...layers);
    this.activeLayerId = layers[layers.length - 1]!.id;
  }

  get width(): number {
    return this.size.width;
  }

  get height(): number {
    return this.size.height;
  }

  /** The current size, layer rasters and selection (by reference, not copied). */
  geometry(): DocumentGeometry {
    return {
      width: this.width,
      height: this.height,
      rasters: new Map(this.layers.map((layer) => [layer.id, layer.raster])),
      selection: this.selection,
    };
  }

  /** Replaces the size, every layer's raster and the selection in one step. */
  setGeometry(geometry: DocumentGeometry): void {
    const { width, height, rasters, selection } = geometry;
    assertDocumentSize(width, height);
    for (const layer of this.layers) {
      const raster = rasters.get(layer.id);
      if (!raster || raster.width !== width || raster.height !== height) {
        throw new RangeError(`No ${width}×${height} raster for layer ${layer.id}`);
      }
    }
    if (selection && (selection.width !== width || selection.height !== height)) {
      throw new RangeError('Selection size does not match the document');
    }
    this.size = { width, height };
    for (const layer of this.layers) layer.raster = rasters.get(layer.id)!;
    this.selection = selection && !selection.isEmpty() ? selection : null;
    this.emit({ kind: 'size' });
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
