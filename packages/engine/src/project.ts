import { decode as decodePng, encode as encodePng } from 'fast-png';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import {
  MAX_PROJECT_MANIFEST_BYTES,
  PROJECT_MANIFEST_ENTRY,
  parseProjectManifest,
  type ProjectManifest,
} from '@auram/project-format';
import { BLEND_MODES } from './blend';
import { createLayer, MAX_DOCUMENT_SIZE, MAX_LAYERS, PhotoDocument } from './document';
import { flatten } from './operations';
import { Raster } from './raster';

/*
 * Auram Photo stores documents in the shared Auram project container (.cproj, a
 * ZIP archive; see docs/project-format.md):
 *
 *   manifest.json         shared project metadata read by Auram Launcher
 *   thumbnail.png         flattened preview, longest side ≤ 512 px
 *   document.json         Auram Photo document structure (this module)
 *   layers/<id>.png       one lossless RGBA PNG per layer
 */

export const APP_ID = 'auram.photo';
export const DOCUMENT_ENTRY = 'document.json';
export const THUMBNAIL_ENTRY = 'thumbnail.png';
export const THUMBNAIL_SIZE = 512;

const LayerEntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  name: z.string().min(1).max(200),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  blendMode: z.enum(BLEND_MODES),
});

export const DocumentFileSchema = z.object({
  format: z.literal('auram.photo.document'),
  formatVersion: z.literal(1),
  width: z.number().int().min(1).max(MAX_DOCUMENT_SIZE),
  height: z.number().int().min(1).max(MAX_DOCUMENT_SIZE),
  activeLayerId: z.string(),
  /** Bottom to top. Pixels are stored in `layers/<id>.png`. */
  layers: z.array(LayerEntrySchema).min(1).max(MAX_LAYERS),
});
export type DocumentFile = z.infer<typeof DocumentFileSchema>;

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: string;
  appVersion: string;
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

/** Box-filter downscale of straight-alpha RGBA so the longest side is ≤ `max`. */
export function downscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  max: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (w === width && h === height) return { width, height, data: pixels };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4;
          const alpha = pixels[i + 3]!;
          r += pixels[i]! * alpha;
          g += pixels[i + 1]! * alpha;
          b += pixels[i + 2]! * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

function png(width: number, height: number, data: Uint8ClampedArray): Uint8Array {
  return encodePng({
    width,
    height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    channels: 4,
    depth: 8,
  });
}

/** Decodes any PNG into straight-alpha RGBA8. */
export function decodePngToRgba(bytes: Uint8Array): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const image = decodePng(bytes);
  const { width, height, channels, depth } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  const src = image.data;
  const max = depth === 16 ? 65535 : (1 << depth) - 1;
  const palette = image.palette;
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    if (palette) {
      const entry = palette[src[p]!] ?? [0, 0, 0];
      out[o] = entry[0]!;
      out[o + 1] = entry[1]!;
      out[o + 2] = entry[2]!;
      out[o + 3] = entry[3] ?? 255;
      continue;
    }
    const s = p * channels;
    const v = (k: number) => Math.round((src[s + k]! / max) * 255);
    if (channels === 1 || channels === 2) {
      out[o] = out[o + 1] = out[o + 2] = v(0);
      out[o + 3] = channels === 2 ? v(1) : 255;
    } else {
      out[o] = v(0);
      out[o + 1] = v(1);
      out[o + 2] = v(2);
      out[o + 3] = channels === 4 ? v(3) : 255;
    }
  }
  return { width, height, data: out };
}

/** Serialises a document into a .cproj archive. */
export function writeProject(doc: PhotoDocument, info: ProjectInfo, now = new Date()): Uint8Array {
  const manifest: ProjectManifest = {
    format: 'auram.project',
    formatVersion: 1,
    id: info.id,
    name: info.name,
    appId: APP_ID,
    appVersion: info.appVersion,
    createdAt: info.createdAt,
    modifiedAt: now.toISOString(),
  };
  const documentFile: DocumentFile = {
    format: 'auram.photo.document',
    formatVersion: 1,
    width: doc.width,
    height: doc.height,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map(({ id, name, visible, opacity, blendMode }) => ({
      id,
      name,
      visible,
      opacity,
      blendMode,
    })),
  };
  const thumb = downscale(flatten(doc), doc.width, doc.height, THUMBNAIL_SIZE);

  // PNG data is already compressed; storing it avoids paying for deflate twice.
  const stored = { level: 0 as const };
  const files: Zippable = {
    [PROJECT_MANIFEST_ENTRY]: strToU8(JSON.stringify(manifest, null, 2)),
    [DOCUMENT_ENTRY]: strToU8(JSON.stringify(documentFile, null, 2)),
    [THUMBNAIL_ENTRY]: [png(thumb.width, thumb.height, thumb.data), stored],
  };
  for (const layer of doc.layers) {
    files[`layers/${layer.id}.png`] = [png(doc.width, doc.height, layer.raster.data), stored];
  }
  return zipSync(files, { level: 6 });
}

export interface LoadedProject {
  doc: PhotoDocument;
  manifest: ProjectManifest;
}

/** Reads a .cproj archive written by Auram Photo. Throws ProjectFormatError for invalid files. */
export function readProject(bytes: Uint8Array): LoadedProject {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) =>
        file.name === PROJECT_MANIFEST_ENTRY ||
        file.name === DOCUMENT_ENTRY ||
        /^layers\/[A-Za-z0-9-]{1,64}\.png$/.test(file.name),
    });
  } catch {
    throw new ProjectFormatError('The file is not a valid Auram project archive.');
  }

  const manifestBytes = entries[PROJECT_MANIFEST_ENTRY];
  if (!manifestBytes || manifestBytes.byteLength > MAX_PROJECT_MANIFEST_BYTES) {
    throw new ProjectFormatError('The project has no valid manifest.json.');
  }
  const manifest = parseProjectManifest(strFromU8(manifestBytes));
  if (!manifest.ok) throw new ProjectFormatError(`Invalid project manifest: ${manifest.error}`);
  if (manifest.manifest.appId !== APP_ID) {
    throw new ProjectFormatError(
      `This project belongs to another application (${manifest.manifest.appId}).`,
    );
  }

  const documentBytes = entries[DOCUMENT_ENTRY];
  if (!documentBytes) throw new ProjectFormatError('The project has no document.json.');
  let documentJson: unknown;
  try {
    documentJson = JSON.parse(strFromU8(documentBytes));
  } catch {
    throw new ProjectFormatError('document.json is not valid JSON.');
  }
  const parsed = DocumentFileSchema.safeParse(documentJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProjectFormatError(
      `document.json is invalid (${issue?.path.join('.')}: ${issue?.message}).`,
    );
  }
  const file = parsed.data;

  const layers = file.layers.map((entry) => {
    const pngBytes = entries[`layers/${entry.id}.png`];
    if (!pngBytes) throw new ProjectFormatError(`Layer "${entry.name}" is missing its image data.`);
    let image: ReturnType<typeof decodePngToRgba>;
    try {
      image = decodePngToRgba(pngBytes);
    } catch {
      throw new ProjectFormatError(`Layer "${entry.name}" has corrupted image data.`);
    }
    if (image.width !== file.width || image.height !== file.height) {
      throw new ProjectFormatError(`Layer "${entry.name}" does not match the document size.`);
    }
    const layer = createLayer(
      file.width,
      file.height,
      entry,
      new Raster(file.width, file.height, image.data),
    );
    return { ...layer, id: entry.id };
  });
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) {
    throw new ProjectFormatError('The project contains duplicate layer ids.');
  }

  const doc = new PhotoDocument(file.width, file.height, layers);
  if (layers.some((layer) => layer.id === file.activeLayerId))
    doc.activeLayerId = file.activeLayerId;
  return { doc, manifest: manifest.manifest };
}
