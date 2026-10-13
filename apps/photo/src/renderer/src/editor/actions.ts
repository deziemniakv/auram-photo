import {
  MAX_DOCUMENT_SIZE,
  addLayer,
  applyGeometry,
  crop,
  resizeCanvas as resizeCanvasOperation,
  rotationLabel,
  clearSelected,
  createDocument,
  deleteLayer,
  deselect,
  documentFromPixels,
  duplicateLayer,
  fill,
  flipDocument,
  invertSelection,
  mergeDown,
  moveLayer,
  selectAll,
  setLayerProps,
  PhotoDocument,
  Raster,
  createLayer,
  type Anchor,
  type Background,
  type Command,
  type LayerProps,
  type QuarterTurns,
  type ResampleMethod,
  type Rgba,
} from '@auram/photo-engine';
import type { ExportFormat, OpenedFile } from '../../../shared/ipc';
import { currentT } from '../i18n';
import { call, messageOf } from '../lib/api';
import {
  IoError,
  computeGeometry,
  decodeImage,
  decodeProject,
  encodeProject,
  exportDocument,
} from '../workers/io-client';
import { cancelTransform, resetGeometryState } from './geometry';
import { EditorSession, stripExtension } from './session';
import { refreshEdited, setSession, toast, useEditor } from './store';
import { centered, fitView, stepZoom, zoomAt } from './view';

const get = useEditor.getState;
const set = useEditor.setState;

/** The GPU limit reported by the canvas, used to reject documents that cannot be displayed. */
let maxTextureSize = MAX_DOCUMENT_SIZE;
export function setMaxTextureSize(size: number): void {
  maxTextureSize = Math.min(MAX_DOCUMENT_SIZE, size);
}
export function maxDocumentSize(): number {
  return maxTextureSize;
}

/** Viewport size, reported by the canvas component; used for fit/zoom commands. */
let viewport = { width: 1200, height: 800 };
export function setViewportSize(width: number, height: number): void {
  viewport = { width, height };
}
export function viewportSize() {
  return viewport;
}

/* ------------------------------ documents ------------------------------- */

/** Asks what to do with unsaved changes. Resolves true when it is safe to continue. */
export async function guardUnsaved(): Promise<boolean> {
  if (get().transforming) cancelTransform();
  const session = get().session;
  if (!session || !session.edited) return true;
  const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) =>
    set({ dialog: { type: 'unsaved', name: session.file.name, resolve } }),
  );
  set({ dialog: null });
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return save(false);
}

function activate(session: EditorSession): void {
  resetGeometryState();
  setSession(session);
  publishDocumentState();
}

export function publishDocumentState(): void {
  const { session } = get();
  const t = currentT();
  const title = session
    ? `${session.edited ? '• ' : ''}${session.file.name} — ${t.app.name}`
    : t.app.name;
  void call((api) =>
    api.window.setDocumentState({
      title,
      hasDocument: session !== null,
      edited: session?.edited ?? false,
    }),
  ).catch(() => {});
}

export async function newDocument(
  width: number,
  height: number,
  background: Background,
): Promise<void> {
  if (!(await guardUnsaved())) return;
  const doc = createDocument(width, height, background);
  doc.layers[0]!.name = currentT().layers.background;
  activate(
    new EditorSession(
      doc,
      {
        projectPath: null,
        name: currentT().common.untitled,
        projectId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      },
      true,
    ),
  );
}

export async function closeDocument(): Promise<void> {
  if (!(await guardUnsaved())) return;
  resetGeometryState();
  setSession(null);
  publishDocumentState();
}

/** Opens a file returned by the main process (dialog, recent list, launcher). */
export async function openFile(file: OpenedFile, guarded = false): Promise<void> {
  if (!guarded && !(await guardUnsaved())) return;
  const t = currentT();
  set({ busy: 'opening' });
  try {
    let session: EditorSession;
    if (file.kind === 'project') {
      const loaded = await decodeProject(file.bytes);
      if (loaded.doc.width > maxTextureSize || loaded.doc.height > maxTextureSize) {
        throw new IoError(
          'too-large',
          t.toasts.tooLarge(loaded.doc.width, loaded.doc.height, maxTextureSize),
        );
      }
      const layers = loaded.doc.layers.map((entry) => ({
        ...createLayer(
          loaded.doc.width,
          loaded.doc.height,
          entry,
          new Raster(loaded.doc.width, loaded.doc.height, entry.data),
        ),
        id: entry.id,
      }));
      const doc = new PhotoDocument(loaded.doc.width, loaded.doc.height, layers);
      doc.activeLayerId = loaded.doc.activeLayerId;
      session = new EditorSession(doc, {
        projectPath: file.path,
        name: stripExtension(file.name),
        projectId: loaded.manifest.id,
        createdAt: loaded.manifest.createdAt,
      });
    } else {
      const image = await decodeImage(file.bytes, file.name, maxTextureSize).catch(
        (error: unknown) => {
          if (error instanceof IoError && error.code === 'too-large') {
            const [w, h] = error.message.split('×').map(Number);
            throw new IoError('too-large', t.toasts.tooLarge(w ?? 0, h ?? 0, maxTextureSize));
          }
          throw error;
        },
      );
      const doc = documentFromPixels(image.width, image.height, image.data, t.layers.background);
      // An imported image is not a project yet: saving asks where to create the .cproj.
      session = new EditorSession(doc, {
        projectPath: null,
        name: stripExtension(file.name),
        projectId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
    }
    activate(session);
  } catch (error) {
    toast({ tone: 'error', title: t.toasts.openFailed, body: messageOf(error) });
  } finally {
    set({ busy: null });
  }
}

export async function openWithDialog(): Promise<void> {
  if (!(await guardUnsaved())) return;
  try {
    const file = await call((api) => api.files.openDialog());
    if (file) await openFile(file, true);
  } catch (error) {
    toast({ tone: 'error', title: currentT().toasts.openFailed, body: messageOf(error) });
  }
}

export async function openRecent(path: string): Promise<void> {
  if (!(await guardUnsaved())) return;
  try {
    await openFile(await call((api) => api.files.openRecent(path)), true);
  } catch (error) {
    toast({ tone: 'error', title: currentT().toasts.openFailed, body: messageOf(error) });
  }
}

/** Saves the project. Returns false when cancelled or failed. */
export async function save(saveAs: boolean): Promise<boolean> {
  const { session, info } = get();
  if (!session || get().busy) return false;
  const t = currentT();
  try {
    // Choose the destination first so the project is named after its file.
    let target = saveAs ? null : session.file.projectPath;
    if (!target) {
      target = await call((api) =>
        api.files.chooseProjectPath({
          currentPath: session.file.projectPath,
          suggestedName: session.file.name,
        }),
      );
      if (!target) return false;
    }
    set({ busy: 'saving' });
    const name = stripExtension(target.split(/[\\/]/).pop() ?? session.file.name);
    const version = session.history.version;
    const bytes = await encodeProject(session.doc, {
      id: session.file.projectId,
      name,
      createdAt: session.file.createdAt,
      appVersion: info?.version ?? '0.0.0',
    });
    const saved = await call((api) => api.files.saveProject({ path: target, bytes }));
    session.file = { ...session.file, projectPath: saved.path, name };
    // Edits made while saving stay marked as unsaved.
    session.savedVersion = version;
    session.unsavedNew = false;
    refreshEdited();
    publishDocumentState();
    toast({ tone: 'success', title: t.toasts.saved(saved.name) });
    return true;
  } catch (error) {
    toast({ tone: 'error', title: t.toasts.saveFailed, body: messageOf(error) });
    return false;
  } finally {
    set({ busy: null });
  }
}

export async function exportImage(format: ExportFormat, quality: number): Promise<void> {
  const { session } = get();
  if (!session) return;
  const t = currentT();
  set({ busy: 'exporting' });
  try {
    const bytes = await exportDocument(session.doc, format, quality);
    const saved = await call((api) =>
      api.files.exportImage({ format, suggestedName: session.file.name, bytes }),
    );
    if (saved) toast({ tone: 'success', title: t.toasts.exported(saved.name) });
  } catch (error) {
    toast({ tone: 'error', title: t.toasts.exportFailed, body: messageOf(error) });
  } finally {
    set({ busy: null });
  }
}

/* -------------------------------- editing -------------------------------- */

/** Runs an operation on the open document and records it for undo. */
export function apply(operation: (session: EditorSession) => Command | null): void {
  const session = get().session;
  if (!session) return;
  const command = operation(session);
  if (command) {
    session.history.push(command);
    publishDocumentState();
  }
}

export function undo(): void {
  get().session?.history.undo();
  publishDocumentState();
}

export function redo(): void {
  get().session?.history.redo();
  publishDocumentState();
}

export const edit = {
  addLayer: () =>
    apply(({ doc }) => addLayer(doc, currentT().layers.defaultName(doc.layers.length))),
  duplicateLayer: () => apply(({ doc }) => duplicateLayer(doc, doc.activeLayerId)),
  deleteLayer: () => apply(({ doc }) => deleteLayer(doc, doc.activeLayerId)),
  mergeDown: () => apply(({ doc }) => mergeDown(doc, doc.activeLayerId)),
  moveLayerUp: () => apply(({ doc }) => moveLayer(doc, doc.activeLayerId, 'up')),
  moveLayerDown: () => apply(({ doc }) => moveLayer(doc, doc.activeLayerId, 'down')),
  setLayerProps: (layerId: string, props: Partial<LayerProps>) =>
    apply(({ doc }) => setLayerProps(doc, layerId, props)),
  selectLayer: (layerId: string) => get().session?.doc.setActiveLayer(layerId),
  fill: () => apply(({ doc }) => fill(doc, doc.activeLayerId, get().primary)),
  clear: () => apply(({ doc }) => clearSelected(doc, doc.activeLayerId)),
  selectAll: () => apply(({ doc }) => selectAll(doc)),
  deselect: () => apply(({ doc }) => deselect(doc)),
  invertSelection: () => apply(({ doc }) => invertSelection(doc)),
  flipHorizontal: () => apply(({ doc }) => flipDocument(doc, true)),
  flipVertical: () => apply(({ doc }) => flipDocument(doc, false)),
};

/* -------------------------------- geometry ------------------------------- */

/** Runs a resampling or rotation in the worker and records the result as one step. */
async function changeGeometry(
  label: string,
  operation: Parameters<typeof computeGeometry>[1],
): Promise<void> {
  const session = get().session;
  if (!session || get().busy) return;
  set({ busy: 'processing' });
  try {
    const geometry = await computeGeometry(session.doc, operation);
    if (get().session === session) apply(({ doc }) => applyGeometry(doc, label, geometry));
  } catch (error) {
    toast({ tone: 'error', title: currentT().toasts.processingFailed, body: messageOf(error) });
  } finally {
    set({ busy: null });
  }
}

export function resizeImage(width: number, height: number, method: ResampleMethod) {
  const session = get().session;
  if (!session || (width === session.doc.width && height === session.doc.height)) return;
  return changeGeometry('image-size', { kind: 'resize', width, height, method });
}

export function rotate(turns: QuarterTurns) {
  return changeGeometry(rotationLabel(turns), { kind: 'rotate', turns });
}

export function resizeCanvas(width: number, height: number, anchor: Anchor, fill: Rgba | null) {
  apply(({ doc }) => resizeCanvasOperation(doc, width, height, anchor, fill));
}

export function cropToSelection() {
  apply(({ doc }) => (doc.selection ? crop(doc, doc.selection.bounds()) : null));
}

/* --------------------------------- view ---------------------------------- */

export function setView(view: { scale: number; offsetX: number; offsetY: number }): void {
  const session = get().session;
  if (!session) return;
  session.view = view;
  set((s) => ({ zoom: view.scale, viewRevision: s.viewRevision + 1 }));
}

export const view = {
  zoomIn: () => zoomStep(1),
  zoomOut: () => zoomStep(-1),
  fit: () => {
    const session = get().session;
    if (session)
      setView(
        fitView(session.doc.width, session.doc.height, viewport.width, viewport.height, true),
      );
  },
  actualSize: () => {
    const session = get().session;
    if (session)
      setView(centered(session.doc.width, session.doc.height, viewport.width, viewport.height, 1));
  },
};

function zoomStep(direction: 1 | -1): void {
  const session = get().session;
  if (!session) return;
  setView(
    zoomAt(
      session.view,
      stepZoom(session.view.scale, direction),
      viewport.width / 2,
      viewport.height / 2,
    ),
  );
}

/* -------------------------------- colours -------------------------------- */

export function swapColors(): void {
  const { primary, secondary } = get();
  set({ primary: secondary, secondary: primary });
}

export function resetColors(): void {
  set({ primary: { r: 0, g: 0, b: 0, a: 255 }, secondary: { r: 255, g: 255, b: 255, a: 255 } });
}
