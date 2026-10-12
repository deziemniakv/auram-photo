import type { BrushSettings, SelectionMode } from '@auram/photo-engine';
import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import { Slider } from './Slider';
import styles from './OptionsBar.module.css';

const MODES: SelectionMode[] = ['replace', 'add', 'subtract', 'intersect'];

function BrushOptions({ which }: { which: 'brush' | 'eraser' }) {
  const t = useT();
  const settings = useEditor((s) => s[which]);
  const update = (patch: Partial<BrushSettings>) =>
    useEditor.setState({ [which]: { ...settings, ...patch } });
  return (
    <>
      <Slider
        label={t.options.size}
        value={settings.size}
        min={1}
        max={1000}
        unit={t.common.pixels}
        onChange={(size) => update({ size })}
      />
      <Slider
        label={t.options.hardness}
        value={Math.round(settings.hardness * 100)}
        min={0}
        max={100}
        unit="%"
        onChange={(value) => update({ hardness: value / 100 })}
      />
      <Slider
        label={t.options.opacity}
        value={Math.round(settings.opacity * 100)}
        min={1}
        max={100}
        unit="%"
        onChange={(value) => update({ opacity: value / 100 })}
      />
    </>
  );
}

export function OptionsBar() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const marqueeMode = useEditor((s) => s.marqueeMode);
  const sampleMerged = useEditor((s) => s.sampleMerged);

  return (
    <div className={styles.bar} role="toolbar" aria-label={t.options.label}>
      <span className={styles.toolName}>{t.tools[tool]}</span>
      {(tool === 'brush' || tool === 'eraser') && <BrushOptions which={tool} />}
      {(tool === 'marquee-rect' || tool === 'marquee-ellipse') && (
        <div className={styles.segmented} role="group" aria-label={t.options.mode}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={styles.segment}
              aria-pressed={marqueeMode === mode}
              onClick={() => useEditor.setState({ marqueeMode: mode })}
            >
              {t.options.modes[mode]}
            </button>
          ))}
        </div>
      )}
      {tool === 'eyedropper' && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={sampleMerged}
            onChange={(event) => useEditor.setState({ sampleMerged: event.target.checked })}
          />
          {t.options.sampleMerged}
        </label>
      )}
      {tool === 'move' && <span className={styles.hint}>{t.options.moveHint}</span>}
      {tool === 'hand' && <span className={styles.hint}>{t.options.handHint}</span>}
      {tool === 'zoom' && <span className={styles.hint}>{t.options.zoomHint}</span>}
    </div>
  );
}
