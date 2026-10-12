import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, FolderSearch, History, X } from 'lucide-react';
import { Button, EmptyState, IconButton, SectionHeader } from '@auram/ui';
import type { RecentFile } from '../../../shared/ipc';
import { openRecent, openWithDialog } from '../editor/actions';
import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import { call } from '../lib/api';
import { BrandMark } from './BrandMark';
import styles from './StartScreen.module.css';

export function StartScreen() {
  const t = useT();
  const [recent, setRecent] = useState<RecentFile[] | null>(null);
  const load = useCallback(() => {
    call((api) => api.files.recent()).then(setRecent, () => setRecent([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className={styles.start}>
      <section className={styles.intro} aria-labelledby="start-title">
        <BrandMark height={56} decorative />
        <h1 id="start-title" className={styles.title}>
          {t.start.title}
        </h1>
        <p className={styles.subtitle}>{t.start.subtitle}</p>
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon={FilePlus2}
            onClick={() => useEditor.setState({ dialog: { type: 'new' } })}
          >
            {t.start.newImage}
          </Button>
          <Button icon={FolderOpen} onClick={() => void openWithDialog()}>
            {t.start.open}
          </Button>
        </div>
      </section>
      <section className={styles.recent} aria-labelledby="start-recent">
        <SectionHeader id="start-recent" title={t.start.recent} />
        {recent && recent.length === 0 && (
          <EmptyState icon={History} title={t.start.recent} compact>
            {t.start.noRecent}
          </EmptyState>
        )}
        {recent && recent.length > 0 && (
          <ul className={styles.list}>
            {recent.map((file) => (
              <li key={file.path} className={styles.item}>
                <button
                  type="button"
                  className={styles.open}
                  disabled={!file.exists}
                  onClick={() => void openRecent(file.path)}
                  title={file.path}
                >
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.path}>
                    {file.exists
                      ? file.kind === 'project'
                        ? t.start.project
                        : t.start.image
                      : t.start.missing}{' '}
                    · {file.path}
                  </span>
                </button>
                {file.exists && (
                  <IconButton
                    icon={FolderSearch}
                    size="sm"
                    label={t.start.reveal}
                    onClick={() => void call((api) => api.files.reveal(file.path)).catch(() => {})}
                  />
                )}
                <IconButton
                  icon={X}
                  size="sm"
                  label={t.start.removeRecent}
                  onClick={() =>
                    void call((api) => api.files.removeRecent(file.path)).then(setRecent, () => {})
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
