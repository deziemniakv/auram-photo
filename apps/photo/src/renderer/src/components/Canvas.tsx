import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compositor,
  WebGLUnavailableError,
  type DisplayStyle,
  type ViewTransform,
} from '@auram/photo-engine/webgl';
import { ErrorState } from '@auram/ui';
import { setMaxTextureSize, setView, setViewportSize } from '../editor/actions';
import type { EditorSession } from '../editor/session';
import { useEditor, type ToolId } from '../editor/store';
import { fitView, screenToDoc, zoomAt } from '../editor/view';
import { useT } from '../i18n';
import { createToolHandler, handHandler } from '../tools/handlers';
import type { ToolContext, ToolHandler, ToolOverlay, ToolPointer } from '../tools/types';
import styles from './Canvas.module.css';

function cssColor(name: string, fallback: [number, number, number]): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return fallback;
  const n = parseInt(match[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const CURSORS: Record<ToolId, string> = {
  move: 'move',
  'marquee-rect': 'crosshair',
  'marquee-ellipse': 'crosshair',
  brush: 'none',
  eraser: 'none',
  eyedropper: 'crosshair',
  hand: 'grab',
  zoom: 'zoom-in',
};

/** Keys held anywhere in the window (Space temporarily selects the hand tool). */
const held = new Set<string>();
window.addEventListener('keydown', (event) => {
  if (
    event.code === 'Space' &&
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    held.add('Space');
  }
});
window.addEventListener('keyup', (event) => held.delete(event.code));
window.addEventListener('blur', () => held.clear());

export function Canvas({ session }: { session: EditorSession }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const frameRef = useRef(0);
  const overlayRef2 = useRef<ToolOverlay>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const gestureRef = useRef<{ handler: ToolHandler; pointerId: number } | null>(null);
  const antsRef = useRef(0);
  const cursorFrameRef = useRef(0);
  const styleRef = useRef<DisplayStyle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tool = useEditor((s) => s.tool);
  const [spaceDown, setSpaceDown] = useState(false);

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const { width, height } = sizeRef.current;
    const ratio = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    const v = session.view;
    const toScreen = (x: number, y: number): [number, number] => [
      x * v.scale + v.offsetX,
      y * v.scale + v.offsetY,
    ];

    const dashed = (draw: () => void) => {
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeStyle = '#000';
      g.lineDashOffset = -antsRef.current;
      draw();
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineDashOffset = -antsRef.current + 4;
      draw();
      g.stroke();
      g.setLineDash([]);
    };

    const selection = session.doc.selection;
    if (selection) {
      const segments = selection.outline();
      dashed(() => {
        g.beginPath();
        for (let i = 0; i < segments.length; i += 4) {
          const [x1, y1] = toScreen(segments[i]!, segments[i + 1]!);
          const [x2, y2] = toScreen(segments[i + 2]!, segments[i + 3]!);
          g.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
          g.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
        }
      });
    }

    const overlay = overlayRef2.current;
    if (overlay?.type === 'marquee') {
      const [x, y] = toScreen(overlay.rect.x, overlay.rect.y);
      const w = overlay.rect.width * v.scale;
      const h = overlay.rect.height * v.scale;
      dashed(() => {
        g.beginPath();
        if (overlay.shape === 'rect')
          g.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
        else
          g.ellipse(
            x + w / 2,
            y + h / 2,
            Math.max(0, w / 2),
            Math.max(0, h / 2),
            0,
            0,
            Math.PI * 2,
          );
      });
    }

    const state = useEditor.getState();
    const pointer = pointerRef.current;
    if (pointer && (state.tool === 'brush' || state.tool === 'eraser') && !held.has('Space')) {
      const size = (state.tool === 'brush' ? state.brush : state.eraser).size;
      const radius = Math.max(1, (size / 2) * v.scale);
      for (const [color, offset] of [
        ['rgba(0,0,0,0.8)', 1],
        ['rgba(255,255,255,0.9)', 0],
      ] as const) {
        g.strokeStyle = color;
        g.beginPath();
        g.arc(pointer.x, pointer.y, radius + offset, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.fillRect(pointer.x - 0.5, pointer.y - 0.5, 1, 1);
    }
  }, [session]);

  const render = useCallback(() => {
    frameRef.current = 0;
    const compositor = compositorRef.current;
    const { width, height } = sizeRef.current;
    if (!compositor || width === 0) return;
    styleRef.current ??= {
      checkerA: [0.29, 0.29, 0.31],
      checkerB: [0.22, 0.22, 0.235],
      background: cssColor('--color-surface-0', [0.06, 0.06, 0.063]),
      checkerSize: 8,
    };
    compositor.render(session.view, width, height, window.devicePixelRatio || 1, styleRef.current);
    drawOverlay();
  }, [session, drawOverlay]);

  const requestRender = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(render);
  }, [render]);

  // Attach the compositor when the canvas element mounts (React 19 ref cleanup disposes it).
  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      let compositor: Compositor;
      try {
        compositor = new Compositor(canvas, session.doc);
      } catch (cause) {
        setError(cause instanceof WebGLUnavailableError ? cause.message : String(cause));
        return;
      }
      compositorRef.current = compositor;
      setMaxTextureSize(compositor.maxTextureSize);
      const off = session.doc.on(() => requestRender());
      requestRender();
      return () => {
        off();
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        compositorRef.current = null;
        compositor.dispose();
      };
    },
    [session, requestRender],
  );

  // Track the viewport size; fit the document the first time it is shown.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      sizeRef.current = { width, height };
      setViewportSize(width, height);
      if (!session.viewFitted && width > 0) {
        session.viewFitted = true;
        setView(fitView(session.doc.width, session.doc.height, width, height));
      }
      requestRender();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [session, requestRender]);

  // Re-render on view changes and animate the selection outline.
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.viewRevision !== prev.viewRevision || s.selectionRevision !== prev.selectionRevision)
          requestRender();
      }),
    [requestRender],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (!session.doc.selection) return;
      antsRef.current = (antsRef.current + 1) % 8;
      drawOverlay();
    }, 120);
    return () => clearInterval(timer);
  }, [session, drawOverlay]);

  useEffect(() => {
    const update = () => setSpaceDown(held.has('Space'));
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
    };
  }, []);

  const context = (): ToolContext | null => {
    const compositor = compositorRef.current;
    if (!compositor) return null;
    return {
      session,
      compositor,
      setView: (next: ViewTransform) => setView(next),
      setOverlay: (overlay) => {
        overlayRef2.current = overlay;
        drawOverlay();
      },
      requestRender,
    };
  };

  const toPointer = (event: PointerEvent | React.PointerEvent): ToolPointer => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      screen,
      doc: screenToDoc(session.view, screen.x, screen.y),
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey || event.metaKey,
    };
  };

  const trackCursor = (pointer: ToolPointer) => {
    pointerRef.current = pointer.screen;
    if (cursorFrameRef.current) return;
    cursorFrameRef.current = requestAnimationFrame(() => {
      cursorFrameRef.current = 0;
      const { doc } = pointer;
      const inside =
        doc.x >= 0 && doc.y >= 0 && doc.x < session.doc.width && doc.y < session.doc.height;
      useEditor.setState({
        cursor: inside ? { x: Math.floor(doc.x), y: Math.floor(doc.y) } : null,
      });
      drawOverlay();
    });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const ctx = context();
    if (!ctx || gestureRef.current || (event.button !== 0 && event.button !== 1)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const panning = event.button === 1 || held.has('Space');
    const handler = panning ? handHandler() : createToolHandler(useEditor.getState().tool);
    gestureRef.current = { handler, pointerId: event.pointerId };
    handler.down(ctx, toPointer(event));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = toPointer(event);
    trackCursor(pointer);
    const gesture = gestureRef.current;
    const ctx = context();
    if (!gesture || !ctx || gesture.pointerId !== event.pointerId) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    gesture.handler.move(ctx, pointer, events.length > 0 ? events.map(toPointer) : [pointer]);
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current;
    const ctx = context();
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (!ctx) return;
    if (cancelled) gesture.handler.cancel(ctx);
    else gesture.handler.up(ctx, toPointer(event));
  };

  // Escape abandons the current gesture.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const gesture = gestureRef.current;
      const ctx = context();
      if (event.key === 'Escape' && gesture && ctx) {
        gestureRef.current = null;
        gesture.handler.cancel(ctx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const view = session.view;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
        setView(
          zoomAt(view, view.scale * factor, event.clientX - rect.left, event.clientY - rect.top),
        );
      } else {
        const dx = event.shiftKey ? event.deltaY : event.deltaX;
        const dy = event.shiftKey ? 0 : event.deltaY;
        setView({ ...view, offsetX: view.offsetX - dx, offsetY: view.offsetY - dy });
      }
    },
    [session],
  );

  useEffect(() => {
    const element = containerRef.current;
    element?.addEventListener('wheel', onWheel, { passive: false });
    return () => element?.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const cursor = spaceDown ? 'grab' : CURSORS[tool];

  return (
    <div
      ref={containerRef}
      className={styles.viewport}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endGesture(event, false)}
      onPointerCancel={(event) => endGesture(event, true)}
      onPointerLeave={() => {
        pointerRef.current = null;
        useEditor.setState({ cursor: null });
        drawOverlay();
      }}
      data-testid="canvas"
    >
      <canvas ref={attachCanvas} className={styles.layer} aria-label={t.app.name} role="img" />
      <canvas ref={overlayRef} className={`${styles.layer} ${styles.overlay}`} aria-hidden />
      {error && (
        <div className={styles.error}>
          <ErrorState title={t.toasts.gpuFailed}>{error}</ErrorState>
        </div>
      )}
    </div>
  );
}
