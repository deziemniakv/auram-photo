import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Merge, Plus, Trash2 } from 'lucide-react';
import { BLEND_MODES, type BlendMode, type Layer } from '@auram/photo-engine';
import { Field, IconButton, Select, cx } from '@auram/ui';
import { edit } from '../editor/actions';
import { COMMANDS } from '../editor/commands';
import type { EditorSession } from '../editor/session';
import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import { Slider } from './Slider';
import styles from './Panels.module.css';

const THUMB_W = 48;
const THUMB_H = 36;

/** Nearest-neighbour preview over a checkerboard; cheap enough to redraw after every stroke. */
function drawThumbnail(canvas: HTMLCanvasElement, layer: Layer): void {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(THUMB_W * ratio);
  const h = Math.round(THUMB_H * ratio);
  canvas.width = w;
  canvas.height = h;
  const { raster } = layer;
  const scale = Math.min(w / raster.width, h / raster.height);
  const tw = Math.max(1, Math.round(raster.width * scale));
  const th = Math.max(1, Math.round(raster.height * scale));
  const ox = Math.floor((w - tw) / 2);
  const oy = Math.floor((h - th) / 2);
  const image = new ImageData(w, h);
  const out = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const checker = ((x >> 2) + (y >> 2)) % 2 ? 74 : 56;
      const inside = x >= ox && y >= oy && x < ox + tw && y < oy + th;
      if (!inside) {
        out[o] = out[o + 1] = out[o + 2] = 15;
        out[o + 3] = 255;
        continue;
      }
      const sx = Math.min(raster.width - 1, Math.floor((x - ox) / scale));
      const sy = Math.min(raster.height - 1, Math.floor((y - oy) / scale));
      const i = (sy * raster.width + sx) * 4;
      const a = raster.data[i + 3]! / 255;
      out[o] = raster.data[i]! * a + checker * (1 - a);
      out[o + 1] = raster.data[i + 1]! * a + checker * (1 - a);
      out[o + 2] = raster.data[i + 2]! * a + checker * (1 - a);
      out[o + 3] = 255;
    }
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0);
}

function Thumbnail({ session, layer }: { session: EditorSession; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawThumbnail(ref.current, layer);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = session.doc.on((change) => {
      if (change.kind !== 'pixels' || change.layerId !== layer.id || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (ref.current) drawThumbnail(ref.current, layer);
      }, 250);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [session, layer]);
  return <canvas ref={ref} className={styles.thumb} aria-hidden />;
}

function LayerRow({
  session,
  layer,
  active,
}: {
  session: EditorSession;
  layer: Layer;
  active: boolean;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(layer.name);

  const commit = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== layer.name)
      edit.setLayerProps(layer.id, { name: trimmed.slice(0, 200) });
    else setName(layer.name);
  };

  return (
    <li className={cx(styles.row, active && styles.active, !layer.visible && styles.hidden)}>
      <IconButton
        icon={layer.visible ? Eye : EyeOff}
        label={layer.visible ? t.layers.hide : t.layers.show}
        size="sm"
        aria-pressed={layer.visible}
        onClick={() => edit.setLayerProps(layer.id, { visible: !layer.visible })}
      />
      {renaming ? (
        <div className={styles.select}>
          <Thumbnail session={session} layer={layer} />
          <input
            className={styles.renameInput}
            aria-label={t.layers.rename}
            value={name}
            autoFocus
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setName(layer.name);
                setRenaming(false);
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.select}
          aria-current={active ? 'true' : undefined}
          onClick={() => edit.selectLayer(layer.id)}
          onDoubleClick={() => {
            setName(layer.name);
            setRenaming(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              setName(layer.name);
              setRenaming(true);
            }
          }}
        >
          <Thumbnail session={session} layer={layer} />
          <span className={styles.name}>
            {layer.name}
            <span className={styles.meta}>
              {t.blendModes[layer.blendMode]} · {Math.round(layer.opacity * 100)}%
            </span>
          </span>
        </button>
      )}
    </li>
  );
}

export function LayersPanel({ session }: { session: EditorSession }) {
  const t = useT();
  useEditor((s) => s.layersRevision);
  const state = useEditor();
  const doc = session.doc;
  const active = doc.activeLayer;

  const enabled = (id: keyof typeof COMMANDS) => {
    const command = COMMANDS[id] as { enabled?: (s: typeof state) => boolean };
    return command.enabled ? command.enabled(state) : true;
  };

  return (
    <section className={cx(styles.panel, styles.layersPanel)} aria-labelledby="panel-layers">
      <h2 id="panel-layers" className={styles.header}>
        {t.layers.title}
      </h2>
      <div className={styles.layerControls}>
        <Field label={t.layers.blendMode}>
          {({ controlId }) => (
            <Select<BlendMode>
              id={controlId}
              value={active.blendMode}
              options={BLEND_MODES.map((mode) => ({ value: mode, label: t.blendModes[mode] }))}
              onChange={(blendMode) => edit.setLayerProps(active.id, { blendMode })}
            />
          )}
        </Field>
        <Slider
          label={t.layers.opacity}
          value={Math.round(active.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(value) => edit.setLayerProps(active.id, { opacity: value / 100 })}
        />
      </div>
      <ul className={styles.list} aria-label={t.layers.title}>
        {[...doc.layers].reverse().map((layer) => (
          <LayerRow
            key={layer.id}
            session={session}
            layer={layer}
            active={layer.id === active.id}
          />
        ))}
      </ul>
      <div className={styles.footer}>
        <IconButton
          icon={Plus}
          label={t.layers.add}
          size="sm"
          onClick={edit.addLayer}
          disabled={!enabled('newLayer')}
        />
        <IconButton
          icon={Copy}
          label={t.layers.duplicate}
          size="sm"
          onClick={edit.duplicateLayer}
          disabled={!enabled('duplicateLayer')}
        />
        <IconButton
          icon={Merge}
          label={t.layers.mergeDown}
          size="sm"
          onClick={edit.mergeDown}
          disabled={!enabled('mergeDown')}
        />
        <IconButton
          icon={ArrowUp}
          label={t.layers.up}
          size="sm"
          onClick={edit.moveLayerUp}
          disabled={!enabled('moveLayerUp')}
        />
        <IconButton
          icon={ArrowDown}
          label={t.layers.down}
          size="sm"
          onClick={edit.moveLayerDown}
          disabled={!enabled('moveLayerDown')}
        />
        <span className={styles.spacer} />
        <IconButton
          icon={Trash2}
          label={t.layers.remove}
          size="sm"
          onClick={edit.deleteLayer}
          disabled={!enabled('deleteLayer')}
        />
      </div>
    </section>
  );
}
