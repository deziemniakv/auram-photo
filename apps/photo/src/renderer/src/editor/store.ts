import { create } from 'zustand';
import {
  DEFAULT_BRUSH,
  BLACK,
  WHITE,
  type BrushSettings,
  type HistoryState,
  type ResampleMethod,
  type Rgba,
  type SelectionMode,
} from '@auram/photo-engine';
import type { ToastMessage } from '@auram/ui';
import type { AppInfo } from '../../../shared/ipc';
import type { EditorSession } from './session';

export type ToolId =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'crop'
  | 'brush'
  | 'eraser'
  | 'eyedropper'
  | 'hand'
  | 'zoom';

export type Dialog =
  | { type: 'new' }
  | { type: 'export' }
  | { type: 'about' }
  | { type: 'image-size' }
  | { type: 'canvas-size' }
  | { type: 'unsaved'; name: string; resolve: (choice: 'save' | 'discard' | 'cancel') => void };

export type Busy = 'opening' | 'saving' | 'exporting' | 'processing' | null;

const EMPTY_HISTORY: HistoryState = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  version: 0,
};

export interface EditorState {
  info: AppInfo | null;
  session: EditorSession | null;
  /** Bumped when layers, their properties or the active layer change. */
  layersRevision: number;
  /** Bumped when pixels change (thumbnails throttle on this). */
  pixelsRevision: number;
  selectionRevision: number;
  history: HistoryState;
  edited: boolean;
  tool: ToolId;
  brush: BrushSettings;
  eraser: BrushSettings;
  primary: Rgba;
  secondary: Rgba;
  marqueeMode: SelectionMode;
  sampleMerged: boolean;
  zoom: number;
  /** Bumped on every pan or zoom. */
  viewRevision: number;
  /** True while a free transform is being edited. */
  transforming: boolean;
  /** Bumped when the free transform or the crop rectangle changes. */
  geometryRevision: number;
  /** Interpolation for free transforms. */
  transformMethod: ResampleMethod;
  cursor: { x: number; y: number } | null;
  busy: Busy;
  dialog: Dialog | null;
  toasts: ToastMessage[];
}

export const useEditor = create<EditorState>(() => ({
  info: null,
  session: null,
  layersRevision: 0,
  pixelsRevision: 0,
  selectionRevision: 0,
  history: EMPTY_HISTORY,
  edited: false,
  tool: 'brush',
  brush: { ...DEFAULT_BRUSH },
  eraser: { ...DEFAULT_BRUSH, hardness: 1 },
  primary: BLACK,
  secondary: WHITE,
  marqueeMode: 'replace',
  sampleMerged: true,
  zoom: 1,
  viewRevision: 0,
  transforming: false,
  geometryRevision: 0,
  transformMethod: 'bicubic',
  cursor: null,
  busy: null,
  dialog: null,
  toasts: [],
}));

const set = useEditor.setState;
const get = useEditor.getState;

let detach: (() => void) | null = null;

/** Makes `session` the open document (or closes it with null). */
export function setSession(session: EditorSession | null): void {
  detach?.();
  detach = null;
  if (session) {
    const offDoc = session.doc.on((change) => {
      if (change.kind === 'pixels') set((s) => ({ pixelsRevision: s.pixelsRevision + 1 }));
      else if (change.kind === 'size')
        set((s) => ({
          layersRevision: s.layersRevision + 1,
          pixelsRevision: s.pixelsRevision + 1,
          selectionRevision: s.selectionRevision + 1,
        }));
      else if (change.kind === 'selection')
        set((s) => ({ selectionRevision: s.selectionRevision + 1 }));
      else set((s) => ({ layersRevision: s.layersRevision + 1 }));
    });
    const offHistory = session.history.onChange((history) =>
      set({ history, edited: session.edited }),
    );
    detach = () => {
      offDoc();
      offHistory();
    };
  }
  set((s) => ({
    session,
    history: session?.history.state ?? EMPTY_HISTORY,
    edited: session?.edited ?? false,
    layersRevision: s.layersRevision + 1,
    selectionRevision: s.selectionRevision + 1,
    cursor: null,
  }));
}

/** Re-reads derived flags after saving. */
export function refreshEdited(): void {
  const session = get().session;
  set({ edited: session?.edited ?? false });
}

let toastCounter = 0;
const TOAST_MS = { info: 4000, success: 4000, error: 9000 } as const;

export function toast(message: Omit<ToastMessage, 'id'>): void {
  const id = `toast-${++toastCounter}`;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { ...message, id }] }));
  setTimeout(() => dismissToast(id), TOAST_MS[message.tone]);
}

export function dismissToast(id: string): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
