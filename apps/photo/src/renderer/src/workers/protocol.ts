import type {
  Affine,
  BlendMode,
  ProjectInfo,
  QuarterTurns,
  Rect,
  ResampleMethod,
} from '@auram/photo-engine';
import type { ExportFormat } from '../../../shared/ipc';

/** A document in transferable form. */
export interface DocumentData {
  width: number;
  height: number;
  activeLayerId: string;
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    blendMode: BlendMode;
    data: Uint8ClampedArray;
  }>;
}

/** Size, layer pixels and selection mask in transferable form. */
export interface GeometryData {
  width: number;
  height: number;
  layers: Array<{ id: string; data: Uint8ClampedArray }>;
  selection: Uint8Array | null;
}

export type GeometryOperation =
  | { kind: 'resize'; width: number; height: number; method: ResampleMethod }
  | { kind: 'rotate'; turns: QuarterTurns };

export interface TransformData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  selection: Uint8Array | null;
  transform: Affine;
  method: ResampleMethod;
}

export type WorkerRequest =
  | { type: 'encode-project'; doc: DocumentData; info: ProjectInfo }
  | { type: 'decode-project'; bytes: Uint8Array }
  | { type: 'decode-image'; bytes: Uint8Array; fileName: string; maxSize: number }
  | { type: 'export'; doc: DocumentData; format: ExportFormat; quality: number }
  | { type: 'geometry'; geometry: GeometryData; operation: GeometryOperation }
  | { type: 'transform'; layer: TransformData };

export type WorkerResponse =
  | { type: 'bytes'; bytes: Uint8Array }
  | {
      type: 'project';
      doc: DocumentData;
      manifest: { id: string; name: string; createdAt: string };
    }
  | { type: 'image'; width: number; height: number; data: Uint8ClampedArray }
  | { type: 'geometry'; geometry: GeometryData }
  | {
      type: 'transform';
      result: { rect: Rect; pixels: Uint8ClampedArray; selection: Uint8Array | null } | null;
    }
  | { type: 'error'; code: 'format' | 'too-large' | 'unknown'; message: string };
