import { useId, useState } from 'react';
import styles from './Slider.module.css';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  /** Called once when a drag or edit is finished. */
  onCommit?: (value: number) => void;
}

/** Range slider with a synchronised numeric field. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  onCommit,
}: SliderProps) {
  const id = useId();
  // While the number field is being edited it shows the draft; otherwise the value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  const commitText = () => {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) {
      const next = clamp(parsed);
      onChange(next);
      onCommit?.(next);
    }
    setDraft(null);
  };

  return (
    <div className={styles.slider}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
      />
      <input
        className={styles.number}
        aria-label={label}
        inputMode="numeric"
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitText();
          event.stopPropagation();
        }}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
    </div>
  );
}
