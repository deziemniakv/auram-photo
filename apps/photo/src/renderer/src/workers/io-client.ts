import type { PhotoDocument, ProjectInfo } from '@auram/photo-engine';
import type { ExportFormat } from '../../../shared/ipc';
import type { DocumentData, WorkerRequest, WorkerResponse } from './protocol';

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
