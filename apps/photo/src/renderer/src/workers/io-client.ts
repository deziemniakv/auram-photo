import {
  Raster,
  Selection,
  type Affine,
  type DocumentGeometry,
  type LayerTransformResult,
  type PhotoDocument,
  type ProjectInfo,
  type ResampleMethod,
} from '@auram/photo-engine';
import type { ExportFormat } from '../../../shared/ipc';
import type { DocumentData, GeometryOperation, WorkerRequest, WorkerResponse } from './protocol';

export class IoError extends Error {
  constructor(
    readonly code: 'format' | 'too-large' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'IoError';
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: WorkerResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./io.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; response: WorkerResponse }>) => {
    pending.get(event.data.id)?.(event.data.response);
    pending.delete(event.data.id);
  };
  worker.onerror = (event) => {
    for (const resolve of pending.values())
      resolve({ type: 'error', code: 'unknown', message: event.message });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function request(
  message: WorkerRequest,
  transfer: Transferable[] = [],
): Promise<WorkerResponse> {
  const id = nextId++;
  const response = await new Promise<WorkerResponse>((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ id, request: message }, transfer);
  });
  if (response.type === 'error') throw new IoError(response.code, response.message);
  return response;
}

/** Copies the document's layers so the worker can use them while editing continues. */
export function snapshot(doc: PhotoDocument): DocumentData {
  return {
    width: doc.width,
    height: doc.height,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map(({ id, name, visible, opacity, blendMode, raster }) => ({
      id,
      name,
      visible,
      opacity,
      blendMode,
      data: raster.data.slice(),
    })),
  };
}

export async function encodeProject(doc: PhotoDocument, info: ProjectInfo): Promise<Uint8Array> {
  const data = snapshot(doc);
  const response = await request(
    { type: 'encode-project', doc: data, info },
    data.layers.map((l) => l.data.buffer),
  );
  if (response.type !== 'bytes') throw new IoError('unknown', 'Unexpected worker response');
  return response.bytes;
}

export async function decodeProject(bytes: Uint8Array) {
  const response = await request({ type: 'decode-project', bytes });
  if (response.type !== 'project') throw new IoError('unknown', 'Unexpected worker response');
  return response;
}

export async function decodeImage(bytes: Uint8Array, fileName: string, maxSize: number) {
  const response = await request({ type: 'decode-image', bytes, fileName, maxSize });
  if (response.type !== 'image') throw new IoError('unknown', 'Unexpected worker response');
  return response;
}

export async function exportDocument(
  doc: PhotoDocument,
  format: ExportFormat,
  quality: number,
): Promise<Uint8Array> {
  const data = snapshot(doc);
  const response = await request(
    { type: 'export', doc: data, format, quality },
    data.layers.map((l) => l.data.buffer),
  );
  if (response.type !== 'bytes') throw new IoError('unknown', 'Unexpected worker response');
  return response.bytes;
}

/** Resamples or rotates every layer (and the selection) in the worker. */
export async function computeGeometry(
  doc: PhotoDocument,
  operation: GeometryOperation,
): Promise<DocumentGeometry> {
  const layers = doc.layers.map((layer) => ({ id: layer.id, data: layer.raster.data.slice() }));
  const selection = doc.selection?.mask.slice() ?? null;
  const response = await request(
    {
      type: 'geometry',
      geometry: { width: doc.width, height: doc.height, layers, selection },
      operation,
    },
    [...layers.map((layer) => layer.data.buffer), ...(selection ? [selection.buffer] : [])],
  );
  if (response.type !== 'geometry') throw new IoError('unknown', 'Unexpected worker response');
  const { width, height } = response.geometry;
  return {
    width,
    height,
    rasters: new Map(
      response.geometry.layers.map((layer) => [layer.id, new Raster(width, height, layer.data)]),
    ),
    selection:
      response.geometry.selection && new Selection(width, height, response.geometry.selection),
  };
}

/** Free-transforms the selected pixels of a layer (or all of it) in the worker. */
export async function computeTransform(
  doc: PhotoDocument,
  layerId: string,
  transform: Affine,
  method: ResampleMethod,
): Promise<LayerTransformResult | null> {
  const data = doc.getLayer(layerId).raster.data.slice();
  const selection = doc.selection?.mask.slice() ?? null;
  const response = await request(
    {
      type: 'transform',
      layer: { width: doc.width, height: doc.height, data, selection, transform, method },
    },
    [data.buffer, ...(selection ? [selection.buffer] : [])],
  );
  if (response.type !== 'transform') throw new IoError('unknown', 'Unexpected worker response');
  const result = response.result;
  if (!result) return null;
  return {
    rect: result.rect,
    pixels: result.pixels,
    selection: result.selection && new Selection(doc.width, doc.height, result.selection),
  };
}
