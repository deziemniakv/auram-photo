import type { BlendMode, ProjectInfo } from '@auram/photo-engine';
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

export type WorkerRequest =
  | { type: 'encode-project'; doc: DocumentData; info: ProjectInfo }
  | { type: 'decode-project'; bytes: Uint8Array }
  | { type: 'decode-image'; bytes: Uint8Array; fileName: string; maxSize: number }
  | { type: 'export'; doc: DocumentData; format: ExportFormat; quality: number };

export type WorkerResponse =
  | { type: 'bytes'; bytes: Uint8Array }
  | {
      type: 'project';
      doc: DocumentData;
      manifest: { id: string; name: string; createdAt: string };
    }
  | { type: 'image'; width: number; height: number; data: Uint8ClampedArray }
  | { type: 'error'; code: 'format' | 'too-large' | 'unknown'; message: string };
