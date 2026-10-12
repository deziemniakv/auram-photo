import type { Compositor, ViewTransform } from '@auram/photo-engine/webgl';
import type { Rect } from '@auram/photo-engine';
import type { EditorSession } from '../editor/session';

export interface ToolPointer {
  /** Position in document pixels (fractional). */
  doc: { x: number; y: number };
  /** Position in canvas CSS pixels. */
  screen: { x: number; y: number };
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

/** Transient drawing on top of the canvas while a tool is in use. */
export type ToolOverlay = { type: 'marquee'; shape: 'rect' | 'ellipse'; rect: Rect } | null;

export interface ToolContext {
  session: EditorSession;
  compositor: Compositor;
  setView(view: ViewTransform): void;
  setOverlay(overlay: ToolOverlay): void;
  requestRender(): void;
}

export interface ToolHandler {
  down(ctx: ToolContext, pointer: ToolPointer): void;
  move(ctx: ToolContext, pointer: ToolPointer, coalesced: ToolPointer[]): void;
  up(ctx: ToolContext, pointer: ToolPointer): void;
  /** Abandons the gesture (e.g. Escape or lost pointer capture). */
  cancel(ctx: ToolContext): void;
}
