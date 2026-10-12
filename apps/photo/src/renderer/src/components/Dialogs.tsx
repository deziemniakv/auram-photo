import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toHex, type Background } from '@auram/photo-engine';
import { Button, Dialog, Field, Select, TextInput } from '@auram/ui';
import type { ExportFormat } from '../../../shared/ipc';
import { exportImage, maxDocumentSize, newDocument } from '../editor/actions';
import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import { call } from '../lib/api';
import { BrandMark } from './BrandMark';
import { Slider } from './Slider';
import styles from './Dialogs.module.css';

const close = () => useEditor.setState({ dialog: null });

type Preset = 'custom' | 'hd' | 'square' | 'uhd' | 'a4';
const PRESET_SIZES: Record<Exclude<Preset, 'custom'>, [number, number]> = {
  hd: [1920, 1080],
  square: [2048, 2048],
  uhd: [3840, 2160],
  a4: [2480, 3508],
};

function NewImageDialog() {
  const t = useT();
  const primary = useEditor((s) => s.primary);
  const [preset, setPreset] = useState<Preset>('hd');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [background, setBackground] = useState<'white' | 'transparent' | 'primary'>('white');
  const max = maxDocumentSize();
  const w = Number(width);
  const h = Number(height);
  const valid =
    Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= max && h <= max;

  const submit = () => {
    if (!valid) return;
    const bg: Background = background === 'primary' ? primary : background;
    close();
    void newDocument(w, h, bg);
  };

  return (
    <Dialog
      open
      title={t.newDialog.title}
      onClose={close}
      closeLabel={t.common.close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {t.common.create}
          </Button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t.newDialog.preset}>
          {({ controlId }) => (
            <Select<Preset>
              id={controlId}
              value={preset}
              options={(['custom', 'hd', 'square', 'uhd', 'a4'] as const).map((value) => ({
                value,
                label: t.newDialog.presets[value],
              }))}
              onChange={(value) => {
                setPreset(value);
                if (value !== 'custom') {
                  setWidth(String(PRESET_SIZES[value][0]));
                  setHeight(String(PRESET_SIZES[value][1]));
                }
              }}
            />
          )}
        </Field>
        <div className={styles.pair}>
          <Field label={`${t.newDialog.width} (${t.common.pixels})`}>
            {({ controlId }) => (
              <TextInput
                id={controlId}
                inputMode="numeric"
                value={width}
                autoFocus
                onChange={(event) => {
                  setWidth(event.target.value);
                  setPreset('custom');
                }}
              />
            )}
          </Field>
          <Field label={`${t.newDialog.height} (${t.common.pixels})`}>
            {({ controlId }) => (
              <TextInput
                id={controlId}
                inputMode="numeric"
                value={height}
                onChange={(event) => {
                  setHeight(event.target.value);
                  setPreset('custom');
                }}
              />
            )}
          </Field>
        </div>
        <fieldset className={styles.fieldset}>
          <legend className={styles.hint}>{t.newDialog.background}</legend>
          <div className={styles.radios}>
            {(['white', 'transparent', 'primary'] as const).map((value) => (
              <label key={value} className={styles.radio}>
                <input
                  type="radio"
                  name="background"
                  checked={background === value}
                  onChange={() => setBackground(value)}
                />
                {value === 'primary'
                  ? `${t.newDialog.primaryColor} ${toHex(primary)}`
                  : t.newDialog[value]}
              </label>
            ))}
          </div>
        </fieldset>
        {valid ? (
          <p className={styles.hint}>
            {t.newDialog.memory(((w * h * 4) / 1024 / 1024).toFixed(1))}
          </p>
        ) : (
          <p className={styles.error} role="alert">
            {t.newDialog.sizeError(max)}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function ExportDialog() {
  const t = useT();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(90);
  const hint = {
    png: t.exportDialog.pngHint,
    jpeg: t.exportDialog.jpegHint,
    webp: t.exportDialog.webpHint,
  }[format];
  return (
    <Dialog
      open
      title={t.exportDialog.title}
      onClose={close}
      closeLabel={t.common.close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close();
              void exportImage(format, quality / 100);
            }}
          >
            {t.exportDialog.export}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label={t.exportDialog.format} description={hint}>
          {({ controlId, describedBy }) => (
            <Select<ExportFormat>
              id={controlId}
              aria-describedby={describedBy}
              value={format}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'webp', label: 'WebP' },
              ]}
              onChange={setFormat}
            />
          )}
        </Field>
        {format !== 'png' && (
          <Slider
            label={t.exportDialog.quality}
            value={quality}
            min={10}
            max={100}
            unit="%"
            onChange={setQuality}
          />
        )}
      </div>
    </Dialog>
  );
}

function UnsavedDialog({
  name,
  resolve,
}: {
  name: string;
  resolve: (choice: 'save' | 'discard' | 'cancel') => void;
}) {
  const t = useT();
  return (
    <Dialog
      open
      title={t.unsaved.title}
      onClose={() => resolve('cancel')}
      closeLabel={t.common.close}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolve('cancel')}>
            {t.common.cancel}
          </Button>
          <Button variant="danger" onClick={() => resolve('discard')}>
            {t.unsaved.discard}
          </Button>
          <Button variant="primary" autoFocus onClick={() => resolve('save')}>
            {t.unsaved.save}
          </Button>
        </>
      }
    >
      {t.unsaved.body(name)}
    </Dialog>
  );
}

function AboutDialog() {
  const t = useT();
  const info = useEditor((s) => s.info);
  if (!info) return null;
  return (
    <Dialog
      open
      title={t.about.title}
      onClose={close}
      closeLabel={t.common.close}
      footer={<Button onClick={close}>{t.common.close}</Button>}
    >
      <div className={styles.aboutHead}>
        <BrandMark height={40} decorative={false} />
        <strong>{info.name}</strong>
      </div>
      <dl className={styles.facts}>
        <dt>{t.about.version}</dt>
        <dd>{info.version}</dd>
        <dt>{t.about.runtime}</dt>
        <dd>
          {info.platform}-{info.arch}
        </dd>
        <dt>{t.about.launcherLabel}</dt>
        <dd>
          {info.launcherVersion
            ? `${t.about.launcher} ${info.launcherVersion}`
            : t.about.standalone}
        </dd>
        <dt>{t.about.licenseLabel}</dt>
        <dd>{t.about.license}</dd>
      </dl>
      <p className={styles.links}>
        <Button
          variant="ghost"
          size="sm"
          icon={ExternalLink}
          onClick={() =>
            void call((api) => api.app.openExternal(info.repositoryUrl)).catch(() => {})
          }
        >
          {t.about.sourceCode}
        </Button>
      </p>
    </Dialog>
  );
}

export function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'new':
      return <NewImageDialog />;
    case 'export':
      return <ExportDialog />;
    case 'about':
      return <AboutDialog />;
    case 'unsaved':
      return <UnsavedDialog name={dialog.name} resolve={dialog.resolve} />;
  }
}
