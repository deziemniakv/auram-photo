/// <reference lib="webworker" />
import {
  FloatCanvas,
  PhotoDocument,
  ProjectFormatError,
  Raster,
  createLayer,
  decodePngToRgba,
  flatten,
  readProject,
  writeProject,
} from '@auram/photo-engine';
import { encode as encodePng } from 'fast-png';
import type { DocumentData, WorkerRequest, WorkerResponse } from './protocol';

/*
 * File work that would block the editor: PNG/ZIP encoding and decoding,
 * flattening for export, and decoding imported images.
 */

declare const self: DedicatedWorkerGlobalScope;

function toDocument(data: DocumentData): PhotoDocument {
  const layers = data.layers.map((entry) => ({
    ...createLayer(data.width, data.height, entry, new Raster(data.width, data.height, entry.data)),
    id: entry.id,
  }));
  const doc = new PhotoDocument(data.width, data.height, layers);
  doc.activeLayerId = data.activeLayerId;
  return doc;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

async function decodeImage(bytes: Uint8Array, maxSize: number): Promise<WorkerResponse> {
  // PNG is decoded in JavaScript so semi-transparent pixels survive exactly.
  if (isPng(bytes)) {
    const image = decodePngToRgba(bytes);
    if (image.width > maxSize || image.height > maxSize) {
      return { type: 'error', code: 'too-large', message: `${image.width}×${image.height}` };
    }
    return { type: 'image', ...image };
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), {
    premultiplyAlpha: 'none',
  });
  try {
    if (bitmap.width > maxSize || bitmap.height > maxSize) {
      return { type: 'error', code: 'too-large', message: `${bitmap.width}×${bitmap.height}` };
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { type: 'image', width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}

async function exportImage(
  data: DocumentData,
  format: 'png' | 'jpeg' | 'webp',
  quality: number,
): Promise<Uint8Array> {
  const doc = toDocument(data);
  if (format === 'png') {
    const flat = flatten(doc);
    return encodePng({
      width: doc.width,
      height: doc.height,
      data: new Uint8Array(flat.buffer),
      channels: 4,
      depth: 8,
    });
  }
  let flat: Uint8ClampedArray;
  if (format === 'jpeg') {
    // JPEG has no alpha channel: composite onto white instead of black.
    const canvas = new FloatCanvas(doc.width, doc.height);
    const white = new Uint8ClampedArray(doc.width * doc.height * 4).fill(255);
    canvas.composite(white, 'normal', 1);
    for (const layer of doc.layers) {
      if (layer.visible && layer.opacity > 0)
        canvas.composite(layer.raster.data, layer.blendMode, layer.opacity);
    }
    flat = canvas.toRgba8();
  } else {
    flat = flatten(doc);
  }
  const canvas = new OffscreenCanvas(doc.width, doc.height);
  const context = canvas.getContext('2d')!;
  context.putImageData(
    new ImageData(flat as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height),
    0,
    0,
  );
  const blob = await canvas.convertToBlob({
    type: format === 'jpeg' ? 'image/jpeg' : 'image/webp',
    quality,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function run(
  request: WorkerRequest,
): Promise<{ response: WorkerResponse; transfer: Transferable[] }> {
  switch (request.type) {
    case 'encode-project': {
      const bytes = writeProject(toDocument(request.doc), request.info);
      return { response: { type: 'bytes', bytes }, transfer: [bytes.buffer] };
    }
    case 'decode-project': {
      const { doc, manifest } = readProject(request.bytes);
      const data: DocumentData = {
        width: doc.width,
        height: doc.height,
        activeLayerId: doc.activeLayerId,
        layers: doc.layers.map(({ id, name, visible, opacity, blendMode, raster }) => ({
          id,
          name,
          visible,
          opacity,
          blendMode,
          data: raster.data,
        })),
      };
      return {
        response: {
          type: 'project',
          doc: data,
          manifest: { id: manifest.id, name: manifest.name, createdAt: manifest.createdAt },
        },
        transfer: data.layers.map((layer) => layer.data.buffer),
      };
    }
    case 'decode-image': {
      const response = await decodeImage(request.bytes, request.maxSize);
      return { response, transfer: response.type === 'image' ? [response.data.buffer] : [] };
    }
    case 'export': {
      const bytes = await exportImage(request.doc, request.format, request.quality);
      return { response: { type: 'bytes', bytes }, transfer: [bytes.buffer] };
    }
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; request: WorkerRequest }>) => {
  const { id, request } = event.data;
  try {
    const { response, transfer } = await run(request);
    self.postMessage({ id, response }, transfer);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      code: error instanceof ProjectFormatError ? 'format' : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage({ id, response });
  }
};
