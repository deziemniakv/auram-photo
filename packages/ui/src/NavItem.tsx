import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import styles from './NavItem.module.css';

export interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onSelect: () => void;
  /** Small count shown at the end of the item, e.g. pending updates. */
  badge?: number;
  badgeLabel?: string;
}

export function NavItem({ icon: Icon, label, active, onSelect, badge, badgeLabel }: NavItemProps) {
  return (
    <button
      type="button"
      className={cx(styles.item, active && styles.active)}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
    >
      <Icon className={styles.icon} aria-hidden strokeWidth={1.75} />
      <span className={styles.label}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={styles.badge} aria-label={badgeLabel}>
          {badge}
        </span>
      )}
    </button>
  );
}
