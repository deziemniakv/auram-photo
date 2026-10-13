import {
  IDENTITY,
  applyLayerTransform,
  commands,
  crop,
  isEmptyRect,
  isIdentity,
  liftPixels,
  transformSource,
  type Affine,
  type Command,
  type Rect,
} from '@auram/photo-engine';
import type { Compositor } from '@auram/photo-engine/webgl';
import { currentT } from '../i18n';
import { messageOf } from '../lib/api';
import { computeTransform } from '../workers/io-client';
import { apply, publishDocumentState } from './actions';
import { toast, useEditor } from './store';

/*
 * Free transform and crop: interactive edits whose state lives here until they
 * are applied. While a free transform is open, the moving pixels are lifted off
 * the layer (a preview change that is not in the history) and drawn by the
 * compositor through the current matrix.
 */

const get = useEditor.getState;
const set = useEditor.setState;

const bump = () => set((s) => ({ geometryRevision: s.geometryRevision + 1 }));

let compositor: Compositor | null = null;

/** Called by the canvas when its compositor is created or disposed. */
export function attachCompositor(next: Compositor | null): void {
  compositor = next;
}

/* ----------------------------- free transform ---------------------------- */

export interface FreeTransform {
  layerId: string;
  /** Document rectangle of the lifted pixels before transforming. */
  source: Rect;
  matrix: Affine;
  /** Preview change that lifts the pixels off the layer; undone on apply or cancel. */
  lift: Command;
}

let transform: FreeTransform | null = null;

export function currentTransform(): FreeTransform | null {
  return transform;
}

export function beginTransform(): void {
  const { session, busy } = get();
  if (!session || busy || transform || !compositor) return;
  const t = currentT();
  const { doc } = session;
  const layer = doc.activeLayer;
  if (!layer.visible) {
    toast({ tone: 'info', title: t.toasts.lockedLayer });
    return;
  }
  const source = transformSource(layer.raster, doc.selection);
  if (isEmptyRect(source)) {
    toast({ tone: 'info', title: t.toasts.nothingToTransform });
    return;
  }
  const { floating, remaining } = liftPixels(layer.raster, doc.selection, source);
  const lift = commands.pixelPatch(
    'transform',
    layer.id,
    source,
    layer.raster.readRegion(source),
    remaining,
  );
  lift.redo(doc);
  compositor.setFloating({
    layerId: layer.id,
    data: floating,
    width: source.width,
    height: source.height,
    x: source.x,
    y: source.y,
  });
  transform = { layerId: layer.id, source, matrix: IDENTITY, lift };
  set({ transforming: true });
  bump();
}

export function setTransformMatrix(matrix: Affine): void {
  if (!transform) return;
  transform.matrix = matrix;
  compositor?.setFloatingTransform(matrix);
  bump();
}

function endTransform(): FreeTransform | null {
  const ended = transform;
  if (!ended) return null;
  transform = null;
  const session = get().session;
  if (session) ended.lift.undo(session.doc);
  compositor?.clearFloating();
  set({ transforming: false });
  bump();
  return ended;
}

export function cancelTransform(): void {
  endTransform();
}

/** Applies the free transform as one undoable step. */
export async function commitTransform(): Promise<void> {
  const session = get().session;
  if (!session || !transform || get().busy) return;
  if (isIdentity(transform.matrix)) {
    endTransform();
    return;
  }
  const { doc } = session;
  const active = transform;
  const { layerId, matrix, lift } = active;
  set({ busy: 'processing' });
  try {
    // The worker needs the layer as it was before lifting; the copy is taken synchronously.
    lift.undo(doc);
    let pending: ReturnType<typeof computeTransform>;
    try {
      pending = computeTransform(doc, layerId, matrix, get().transformMethod);
    } finally {
      lift.redo(doc);
    }
    const result = await pending;
    // The document was closed or the transform cancelled while the worker ran.
    if (transform !== active || get().session !== session) return;
    endTransform();
    if (result) apply(() => applyLayerTransform(doc, layerId, result));
  } catch (error) {
    toast({ tone: 'error', title: currentT().toasts.transformFailed, body: messageOf(error) });
  } finally {
    set({ busy: null });
    publishDocumentState();
  }
}

/* ---------------------------------- crop --------------------------------- */

let cropRect: Rect | null = null;

export function currentCrop(): Rect | null {
  return cropRect;
}

export function setCropRect(rect: Rect | null): void {
  cropRect = rect && !isEmptyRect(rect) ? rect : null;
  bump();
}

export function applyCrop(): void {
  const rect = cropRect;
  if (!rect) return;
  setCropRect(null);
  apply(({ doc }) => crop(doc, rect));
}

/** Drops interactive state when the document is closed or replaced. */
export function resetGeometryState(): void {
  if (transform) endTransform();
  if (cropRect) setCropRect(null);
}
