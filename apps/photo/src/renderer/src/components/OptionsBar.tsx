import {
  RESAMPLE_METHODS,
  type BrushSettings,
  type ResampleMethod,
  type SelectionMode,
} from '@auram/photo-engine';
import { Button, Select } from '@auram/ui';
import {
  applyCrop,
  cancelTransform,
  commitTransform,
  currentCrop,
  currentTransform,
  setCropRect,
} from '../editor/geometry';
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

function TransformOptions() {
  const t = useT();
  useEditor((s) => s.geometryRevision);
  const method = useEditor((s) => s.transformMethod);
  const busy = useEditor((s) => s.busy);
  const matrix = currentTransform()?.matrix;
  if (!matrix) return null;
  const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
  // Width and height follow the box edges; a negative determinant means it was flipped.
  const flip = matrix.a * matrix.d - matrix.b * matrix.c < 0 ? -1 : 1;
  const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return (
    <>
      <span className={styles.readout}>
        {t.options.width} {percent(Math.hypot(matrix.a, matrix.b))}
      </span>
      <span className={styles.readout}>
        {t.options.height} {percent(flip * Math.hypot(matrix.c, matrix.d))}
      </span>
      <span className={styles.readout}>
        {t.options.angle} {Math.round(angle * 10) / 10}°
      </span>
      <Select<ResampleMethod>
        aria-label={t.options.interpolation}
        title={t.options.interpolation}
        value={method}
        options={RESAMPLE_METHODS.map((value) => ({ value, label: t.resample[value] }))}
        onChange={(transformMethod) => useEditor.setState({ transformMethod })}
      />
      <span className={styles.hint} title={t.options.transformHint}>
        {t.options.transformHint}
      </span>
      <span className={styles.actions}>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={cancelTransform}>
          {t.common.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          busy={busy === 'processing'}
          disabled={busy !== null}
          onClick={() => void commitTransform()}
        >
          {t.options.apply}
        </Button>
      </span>
    </>
  );
}

function CropOptions() {
  const t = useT();
  useEditor((s) => s.geometryRevision);
  const busy = useEditor((s) => s.busy);
  const rect = currentCrop();
  return (
    <>
      {rect && (
        <span className={styles.readout}>{t.options.cropSize(rect.width, rect.height)}</span>
      )}
      <span className={styles.hint}>{t.options.cropHint}</span>
      <span className={styles.actions}>
        <Button size="sm" variant="ghost" disabled={!rect} onClick={() => setCropRect(null)}>
          {t.common.cancel}
        </Button>
        <Button size="sm" variant="primary" disabled={!rect || busy !== null} onClick={applyCrop}>
          {t.options.apply}
        </Button>
      </span>
    </>
  );
}

export function OptionsBar() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const marqueeMode = useEditor((s) => s.marqueeMode);
  const sampleMerged = useEditor((s) => s.sampleMerged);
  const transforming = useEditor((s) => s.transforming);

  if (transforming) {
    return (
      <div className={styles.bar} role="toolbar" aria-label={t.options.label}>
        <span className={styles.toolName}>{t.menu.freeTransform}</span>
        <TransformOptions />
      </div>
    );
  }

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
      {tool === 'crop' && <CropOptions />}
      {tool === 'move' && <span className={styles.hint}>{t.options.moveHint}</span>}
      {tool === 'hand' && <span className={styles.hint}>{t.options.handHint}</span>}
      {tool === 'zoom' && <span className={styles.hint}>{t.options.zoomHint}</span>}
    </div>
  );
}
