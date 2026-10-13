import {
  Stroke,
  deselect,
  rectFromBox,
  sampleColor,
  select,
  translate,
  type Command,
  type SelectionMode,
} from '@auram/photo-engine';
import { publishDocumentState } from '../editor/actions';
import { toast, useEditor, type ToolId } from '../editor/store';
import { stepZoom, zoomAt } from '../editor/view';
import { currentT } from '../i18n';
import { cropHandler } from './geometry-tools';
import type { ToolContext, ToolHandler, ToolPointer } from './types';

const get = useEditor.getState;

function record(ctx: ToolContext, command: Command | null): void {
  if (!command) return;
  ctx.session.history.push(command);
  publishDocumentState();
}

function strokeTool(mode: 'paint' | 'erase'): ToolHandler {
  let stroke: Stroke | null = null;
  return {
    down(ctx, p) {
      const { doc } = ctx.session;
      if (!doc.activeLayer.visible) {
        toast({ tone: 'info', title: currentT().toasts.lockedLayer });
        return;
      }
      const state = get();
      stroke = new Stroke(
        doc,
        doc.activeLayerId,
        mode,
        state.primary,
        mode === 'paint' ? state.brush : state.eraser,
      );
      stroke.addPoint(p.doc.x, p.doc.y);
    },
    move(_ctx, _p, coalesced) {
      if (!stroke) return;
      for (const point of coalesced) stroke.addPoint(point.doc.x, point.doc.y);
    },
    up(ctx) {
      if (!stroke) return;
      record(ctx, stroke.end());
      stroke = null;
    },
    cancel(ctx) {
      if (!stroke) return;
      // Revert what has been painted so far.
      stroke.end()?.undo(ctx.session.doc);
      stroke = null;
    },
  };
}

function marqueeTool(shape: 'rect' | 'ellipse'): ToolHandler {
  let start: { x: number; y: number } | null = null;
  let mode: SelectionMode = 'replace';
  const rectTo = (p: ToolPointer) =>
    rectFromBox(
      Math.round(start!.x),
      Math.round(start!.y),
      Math.round(p.doc.x),
      Math.round(p.doc.y),
    );
  return {
    down(ctx, p) {
      start = p.doc;
      mode =
        p.shift && p.alt ? 'intersect' : p.shift ? 'add' : p.alt ? 'subtract' : get().marqueeMode;
      ctx.setOverlay({ type: 'marquee', shape, rect: rectTo(p) });
    },
    move(ctx, p) {
      if (start) ctx.setOverlay({ type: 'marquee', shape, rect: rectTo(p) });
    },
    up(ctx, p) {
      if (!start) return;
      const rect = rectTo(p);
      ctx.setOverlay(null);
      start = null;
      const { doc } = ctx.session;
      if (rect.width < 1 || rect.height < 1) {
        // A click without dragging clears the selection, as in other editors.
        if (mode === 'replace') record(ctx, deselect(doc));
        return;
      }
      record(ctx, select(doc, { type: shape, rect }, mode));
    },
    cancel(ctx) {
      start = null;
      ctx.setOverlay(null);
    },
  };
}

/**
 * Moves the active layer. Without a selection the move is previewed on the GPU
 * (no pixel copies while dragging); with a selection the selected pixels are
 * moved live, at most once per frame.
 */
function moveTool(): ToolHandler {
  let start: { x: number; y: number } | null = null;
  let layerId = '';
  let preview: Command | null = null;
  let pending: { dx: number; dy: number } | null = null;
  let frame = 0;
  const delta = (p: ToolPointer) => ({
    dx: Math.round(p.doc.x - start!.x),
    dy: Math.round(p.doc.y - start!.y),
  });

  const applyPreview = (ctx: ToolContext) => {
    frame = 0;
    if (!pending) return;
    preview?.undo(ctx.session.doc);
    preview = translate(ctx.session.doc, layerId, pending.dx, pending.dy);
    pending = null;
  };

  return {
    down(ctx, p) {
      start = p.doc;
      layerId = ctx.session.doc.activeLayerId;
      preview = null;
    },
    move(ctx, p) {
      if (!start) return;
      const { dx, dy } = delta(p);
      if (ctx.session.doc.selection) {
        pending = { dx, dy };
        frame ||= requestAnimationFrame(() => applyPreview(ctx));
      } else {
        ctx.compositor.setLayerOffset(layerId, dx, dy);
        ctx.requestRender();
      }
    },
    up(ctx, p) {
      if (!start) return;
      const { dx, dy } = delta(p);
      start = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      ctx.compositor.clearLayerOffsets();
      preview?.undo(ctx.session.doc);
      preview = null;
      record(ctx, translate(ctx.session.doc, layerId, dx, dy));
      ctx.requestRender();
    },
    cancel(ctx) {
      start = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      preview?.undo(ctx.session.doc);
      preview = null;
      ctx.compositor.clearLayerOffsets();
      ctx.requestRender();
    },
  };
}

function eyedropperTool(): ToolHandler {
  let active = false;
  let secondary = false;
  const pick = (ctx: ToolContext, p: ToolPointer) => {
    const color = sampleColor(ctx.session.doc, p.doc.x, p.doc.y, get().sampleMerged);
    if (!color) return;
    const opaque = { ...color, a: 255 };
    useEditor.setState(secondary ? { secondary: opaque } : { primary: opaque });
  };
  return {
    down(ctx, p) {
      active = true;
      secondary = p.alt;
      pick(ctx, p);
    },
    move(ctx, p) {
      if (active) pick(ctx, p);
    },
    up() {
      active = false;
    },
    cancel() {
      active = false;
    },
  };
}

function handTool(): ToolHandler {
  let last: { x: number; y: number } | null = null;
  return {
    down(_ctx, p) {
      last = p.screen;
    },
    move(ctx, p) {
      if (!last) return;
      const view = ctx.session.view;
      ctx.setView({
        ...view,
        offsetX: view.offsetX + p.screen.x - last.x,
        offsetY: view.offsetY + p.screen.y - last.y,
      });
      last = p.screen;
    },
    up() {
      last = null;
    },
    cancel() {
      last = null;
    },
  };
}

function zoomTool(): ToolHandler {
  return {
    down(ctx, p) {
      const view = ctx.session.view;
      ctx.setView(zoomAt(view, stepZoom(view.scale, p.alt ? -1 : 1), p.screen.x, p.screen.y));
    },
    move() {},
    up() {},
    cancel() {},
  };
}

export function createToolHandler(tool: ToolId): ToolHandler {
  switch (tool) {
    case 'brush':
      return strokeTool('paint');
    case 'eraser':
      return strokeTool('erase');
    case 'marquee-rect':
      return marqueeTool('rect');
    case 'marquee-ellipse':
      return marqueeTool('ellipse');
    case 'move':
      return moveTool();
    case 'crop':
      return cropHandler();
    case 'eyedropper':
      return eyedropperTool();
    case 'hand':
      return handTool();
    case 'zoom':
      return zoomTool();
  }
}

export const handHandler = handTool;
