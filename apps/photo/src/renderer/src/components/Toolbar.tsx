import {
  Circle,
  Eraser,
  Hand,
  Move,
  Paintbrush,
  Pipette,
  Square,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { toHex } from '@auram/photo-engine';
import { swapColors } from '../editor/actions';
import { useEditor, type ToolId } from '../editor/store';
import { useT } from '../i18n';
import styles from './Toolbar.module.css';

const TOOLS: Array<{ id: ToolId; icon: LucideIcon; key: string } | '-'> = [
  { id: 'move', icon: Move, key: 'V' },
  { id: 'marquee-rect', icon: Square, key: 'M' },
  { id: 'marquee-ellipse', icon: Circle, key: 'M' },
  '-',
  { id: 'brush', icon: Paintbrush, key: 'B' },
  { id: 'eraser', icon: Eraser, key: 'E' },
  { id: 'eyedropper', icon: Pipette, key: 'I' },
  '-',
  { id: 'hand', icon: Hand, key: 'H' },
  { id: 'zoom', icon: ZoomIn, key: 'Z' },
];

export function Toolbar() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label={t.tools.label}
      aria-orientation="vertical"
    >
      {TOOLS.map((entry, index) =>
        entry === '-' ? (
          <span key={`d${index}`} className={styles.divider} aria-hidden />
        ) : (
          <button
            key={entry.id}
            type="button"
            className={styles.tool}
            aria-pressed={tool === entry.id}
            aria-label={`${t.tools[entry.id]} (${entry.key})`}
            title={`${t.tools[entry.id]} (${entry.key})`}
            onClick={() => useEditor.setState({ tool: entry.id })}
          >
            <entry.icon aria-hidden strokeWidth={1.5} />
          </button>
        ),
      )}
      <div className={styles.swatches}>
        <button
          type="button"
          className={`${styles.swatch} ${styles.primary}`}
          style={{ background: toHex(primary) }}
          aria-label={`${t.colors.primary} ${toHex(primary)}`}
          title={t.colors.swap}
          onClick={swapColors}
        />
        <button
          type="button"
          className={`${styles.swatch} ${styles.secondary}`}
          style={{ background: toHex(secondary) }}
          aria-label={`${t.colors.secondary} ${toHex(secondary)}`}
          title={t.colors.swap}
          onClick={swapColors}
        />
      </div>
    </div>
  );
}
