import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { IconButton } from './Button';
import { cx } from './cx';
import styles from './Toast.module.css';

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'error';
  title: string;
  body?: string;
}

const ICONS = { info: Info, success: CheckCircle2, error: AlertTriangle } as const;

export interface ToastViewportProps {
  toasts: ReadonlyArray<ToastMessage>;
  onDismiss: (id: string) => void;
  dismissLabel?: string;
}

export function ToastViewport({ toasts, onDismiss, dismissLabel = 'Dismiss' }: ToastViewportProps) {
  return (
    <ol className={styles.viewport} aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <li
            key={toast.id}
            className={cx(styles.toast, styles[toast.tone])}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon className={styles.icon} aria-hidden strokeWidth={1.75} />
            <div className={styles.text}>
              <span className={styles.title}>{toast.title}</span>
              {toast.body && <span className={styles.body}>{toast.body}</span>}
            </div>
            <IconButton
              icon={X}
              label={dismissLabel}
              size="sm"
              onClick={() => onDismiss(toast.id)}
            />
          </li>
        );
      })}
    </ol>
  );
}
