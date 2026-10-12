import { useState } from 'react';
import { ArrowLeftRight, RotateCcw } from 'lucide-react';
import { parseHex, toHex, type Rgba } from '@auram/photo-engine';
import { IconButton, TextInput } from '@auram/ui';
import { resetColors, swapColors } from '../editor/actions';
import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import styles from './Panels.module.css';

function ColorRow({ which }: { which: 'primary' | 'secondary' }) {
  const t = useT();
  const color = useEditor((s) => s[which]);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? toHex(color);
  const invalid = draft !== null && parseHex(draft) === null;

  const set = (next: Rgba) => useEditor.setState({ [which]: next });
  const label = which === 'primary' ? t.colors.primary : t.colors.secondary;
  const commit = () => {
    const parsed = parseHex(text);
    if (!parsed) return;
    set({ ...parsed, a: 255 });
    setDraft(null);
  };

  return (
    <div className={styles.colorRow}>
      <input
        type="color"
        className={styles.colorInput}
        aria-label={label}
        value={toHex(color)}
        onChange={(event) => {
          const parsed = parseHex(event.target.value);
          if (parsed) set(parsed);
        }}
      />
      <TextInput
        className={styles.hex}
        aria-label={`${label} ${t.colors.hex}`}
        aria-invalid={invalid}
        title={invalid ? t.colors.invalidHex : undefined}
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          event.stopPropagation();
        }}
      />
      <span className={styles.colorLabel}>{label}</span>
    </div>
  );
}

export function ColorPanel() {
  const t = useT();
  return (
    <section className={styles.panel} aria-labelledby="panel-color">
      <h2 id="panel-color" className={styles.header}>
        {t.colors.title}
      </h2>
      <div className={styles.body}>
        <ColorRow which="primary" />
        <ColorRow which="secondary" />
        <div className={styles.colorActions}>
          <IconButton icon={ArrowLeftRight} label={t.colors.swap} size="sm" onClick={swapColors} />
          <IconButton icon={RotateCcw} label={t.colors.reset} size="sm" onClick={resetColors} />
        </div>
      </div>
    </section>
  );
}
