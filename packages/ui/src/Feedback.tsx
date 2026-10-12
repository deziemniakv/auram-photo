import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { cx } from './cx';
import styles from './Feedback.module.css';

export interface SectionHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** `page` renders the top-level heading of a view; `section` a subsection label. */
  level?: 'page' | 'section';
  id?: string;
}

export function SectionHeader({
  title,
  description,
  actions,
  level = 'section',
  id,
}: SectionHeaderProps) {
  const Heading = level === 'page' ? 'h1' : 'h2';
  return (
    <header className={styles.sectionHeader}>
      <div className={styles.sectionTitleGroup}>
        <Heading id={id} className={cx(styles.sectionTitle, level === 'page' && styles.page)}>
          {title}
        </Heading>
        {description && <p className={styles.sectionDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.sectionActions}>{actions}</div>}
    </header>
  );
}

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.panel, className)} {...rest} />;
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function StatusTag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx(styles.tag, styles[tone])}>{children}</span>;
}

export interface ProgressBarProps {
  /** 0..1, or null for an indeterminate operation. */
  value: number | null;
  label: string;
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = value === null ? null : Math.min(1, Math.max(0, value));
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
    >
      <div
        className={cx(styles.progressFill, clamped === null && styles.progressIndeterminate)}
        style={clamped === null ? undefined : { width: `${clamped * 100}%` }}
      />
    </div>
  );
}

interface StateProps {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  compact,
}: StateProps & { icon: LucideIcon }) {
  return (
    <div className={cx(styles.state, compact && styles.compact)}>
      <Icon className={styles.stateIcon} aria-hidden strokeWidth={1.5} />
      <p className={styles.stateTitle}>{title}</p>
      {children && <div className={styles.stateBody}>{children}</div>}
      {actions && <div className={styles.stateActions}>{actions}</div>}
    </div>
  );
}

export function ErrorState({ title, children, actions, compact }: StateProps) {
  return (
    <div className={cx(styles.state, styles.error, compact && styles.compact)} role="alert">
      <AlertTriangle className={styles.stateIcon} aria-hidden strokeWidth={1.5} />
      <p className={styles.stateTitle}>{title}</p>
      {children && <div className={styles.stateBody}>{children}</div>}
      {actions && <div className={styles.stateActions}>{actions}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <ProgressBar value={null} label={label} />
      <span>{label}</span>
    </div>
  );
}
