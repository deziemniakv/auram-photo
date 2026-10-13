import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  RESAMPLE_METHODS,
  WHITE,
  toHex,
  type Anchor,
  type Background,
  type ResampleMethod,
} from '@auram/photo-engine';
import { Button, Dialog, Field, Select, TextInput } from '@auram/ui';
import type { ExportFormat } from '../../../shared/ipc';
import {
  exportImage,
  maxDocumentSize,
  newDocument,
  resizeCanvas,
  resizeImage,
} from '../editor/actions';
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

/** Parses a size field; returns NaN unless it is a whole number. */
const parseSize = (value: string) => (/^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN);
const validSize = (w: number, h: number, max: number) =>
  Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= max && h <= max;

function SizeFields({
  width,
  height,
  onWidth,
  onHeight,
}: {
  width: string;
  height: string;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
}) {
  const t = useT();
  return (
    <div className={styles.pair}>
      <Field label={`${t.imageSizeDialog.width} (${t.common.pixels})`}>
        {({ controlId }) => (
          <TextInput
            id={controlId}
            inputMode="numeric"
            value={width}
            autoFocus
            onChange={(event) => onWidth(event.target.value)}
          />
        )}
      </Field>
      <Field label={`${t.imageSizeDialog.height} (${t.common.pixels})`}>
        {({ controlId }) => (
          <TextInput
            id={controlId}
            inputMode="numeric"
            value={height}
            onChange={(event) => onHeight(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

function ImageSizeDialog() {
  const t = useT();
  const session = useEditor((s) => s.session);
  const doc = session!.doc;
  const [width, setWidth] = useState(String(doc.width));
  const [height, setHeight] = useState(String(doc.height));
  const [keep, setKeep] = useState(true);
  const [method, setMethod] = useState<ResampleMethod>('bicubic');
  const max = maxDocumentSize();
  const w = parseSize(width);
  const h = parseSize(height);
  const valid = validSize(w, h, max);
  const proportional = (value: number, from: number, to: number) =>
    String(Math.max(1, Math.round((value * to) / from)));

  const submit = () => {
    if (!valid) return;
    close();
    void resizeImage(w, h, method);
  };

  return (
    <Dialog
      open
      title={t.imageSizeDialog.title}
      onClose={close}
      closeLabel={t.common.close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {t.imageSizeDialog.resize}
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
        <p className={styles.hint}>{t.imageSizeDialog.current(doc.width, doc.height)}</p>
        <SizeFields
          width={width}
          height={height}
          onWidth={(value) => {
            setWidth(value);
            const next = parseSize(value);
            if (keep && next >= 1) setHeight(proportional(next, doc.width, doc.height));
          }}
          onHeight={(value) => {
            setHeight(value);
            const next = parseSize(value);
            if (keep && next >= 1) setWidth(proportional(next, doc.height, doc.width));
          }}
        />
        <label className={styles.radio}>
          <input
            type="checkbox"
            checked={keep}
            onChange={(event) => setKeep(event.target.checked)}
          />
          {t.imageSizeDialog.keepProportions}
        </label>
        <Field label={t.imageSizeDialog.resample}>
          {({ controlId }) => (
            <Select<ResampleMethod>
              id={controlId}
              value={method}
              options={RESAMPLE_METHODS.map((value) => ({ value, label: t.resample[value] }))}
              onChange={setMethod}
            />
          )}
        </Field>
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

const ANCHORS: Array<{ key: string; anchor: Anchor }> = [
  { key: 'top-left', anchor: { x: 0, y: 0 } },
  { key: 'top', anchor: { x: 0.5, y: 0 } },
  { key: 'top-right', anchor: { x: 1, y: 0 } },
  { key: 'left', anchor: { x: 0, y: 0.5 } },
  { key: 'center', anchor: { x: 0.5, y: 0.5 } },
  { key: 'right', anchor: { x: 1, y: 0.5 } },
  { key: 'bottom-left', anchor: { x: 0, y: 1 } },
  { key: 'bottom', anchor: { x: 0.5, y: 1 } },
  { key: 'bottom-right', anchor: { x: 1, y: 1 } },
];

function CanvasSizeDialog() {
  const t = useT();
  const session = useEditor((s) => s.session);
  const secondary = useEditor((s) => s.secondary);
  const doc = session!.doc;
  const [width, setWidth] = useState(String(doc.width));
  const [height, setHeight] = useState(String(doc.height));
  const [anchor, setAnchor] = useState('center');
  const [fill, setFill] = useState<'transparent' | 'white' | 'secondary'>('transparent');
  const max = maxDocumentSize();
  const w = parseSize(width);
  const h = parseSize(height);
  const valid = validSize(w, h, max);

  const submit = () => {
    if (!valid) return;
    close();
    const color = fill === 'white' ? WHITE : fill === 'secondary' ? secondary : null;
    resizeCanvas(w, h, ANCHORS.find((entry) => entry.key === anchor)!.anchor, color);
  };

  return (
    <Dialog
      open
      title={t.canvasSizeDialog.title}
      onClose={close}
      closeLabel={t.common.close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {t.canvasSizeDialog.resize}
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
        <p className={styles.hint}>{t.imageSizeDialog.current(doc.width, doc.height)}</p>
        <SizeFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
        <fieldset className={styles.fieldset}>
          <legend className={styles.hint}>{t.canvasSizeDialog.anchor}</legend>
          <div className={styles.anchors} role="group" aria-label={t.canvasSizeDialog.anchor}>
            {ANCHORS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={styles.anchor}
                aria-pressed={anchor === entry.key}
                aria-label={t.canvasSizeDialog.anchors[entry.key as 'center']}
                title={t.canvasSizeDialog.anchors[entry.key as 'center']}
                onClick={() => setAnchor(entry.key)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.hint}>{t.canvasSizeDialog.fill}</legend>
          <div className={styles.radios}>
            {(
              [
                ['transparent', t.canvasSizeDialog.fillTransparent],
                ['white', t.canvasSizeDialog.fillWhite],
                ['secondary', `${t.canvasSizeDialog.fillSecondary} ${toHex(secondary)}`],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={styles.radio}>
                <input
                  type="radio"
                  name="canvas-fill"
                  checked={fill === value}
                  onChange={() => setFill(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {!valid ? (
          <p className={styles.error} role="alert">
            {t.newDialog.sizeError(max)}
          </p>
        ) : (
          (w < doc.width || h < doc.height) && (
            <p className={styles.hint}>{t.canvasSizeDialog.shrinkWarning}</p>
          )
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
    case 'image-size':
      return <ImageSizeDialog />;
    case 'canvas-size':
      return <CanvasSizeDialog />;
    case 'unsaved':
      return <UnsavedDialog name={dialog.name} resolve={dialog.resolve} />;
  }
}
