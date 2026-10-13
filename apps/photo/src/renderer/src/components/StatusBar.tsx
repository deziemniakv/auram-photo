import { useEditor } from '../editor/store';
import { useT } from '../i18n';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const t = useT();
  const session = useEditor((s) => s.session);
  const zoom = useEditor((s) => s.zoom);
  const cursor = useEditor((s) => s.cursor);
  const busy = useEditor((s) => s.busy);
  const edited = useEditor((s) => s.edited);
  // The document size changes with image size, canvas size, crop and rotation.
  useEditor((s) => s.layersRevision);
  const busyText =
    busy &&
    {
      opening: t.status.opening,
      saving: t.status.saving,
      exporting: t.status.exporting,
      processing: t.status.processing,
    }[busy];

  return (
    <footer className={styles.status} aria-live="polite">
      {session && (
        <>
          <span>
            {t.status.zoom} {Math.round(zoom * 1000) / 10}%
          </span>
          <span>{t.status.size(session.doc.width, session.doc.height)}</span>
          <span>{cursor ? t.status.position(cursor.x, cursor.y) : ''}</span>
        </>
      )}
      <span className={styles.spacer} />
      {busyText && <span role="status">{busyText}</span>}
      {session && edited && !busy && <span className={styles.edited}>{t.status.edited}</span>}
    </footer>
  );
}
