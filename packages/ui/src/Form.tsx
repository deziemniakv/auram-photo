import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';
import styles from './Form.module.css';

export interface FieldProps {
  label: string;
  description?: ReactNode;
  error?: string | null;
  /** Renders the control; receives ids to wire up labelling and descriptions. */
  children: (ids: {
    controlId: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
  className?: string;
}

export function Field({ label, description, error, children, className }: FieldProps) {
  const controlId = useId();
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
      </label>
      {children({ controlId, describedBy, invalid: Boolean(error) })}
      {description && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, type = 'text', ...rest }, ref) {
    return <input ref={ref} type={type} className={cx(styles.input, className)} {...rest} />;
  },
);

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value'
> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  ...rest
}: SelectProps<T>) {
  return (
    <div className={cx(styles.selectWrap, className)}>
      <select
        className={styles.select}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className={styles.chevron} aria-hidden strokeWidth={1.75} />
    </div>
  );
}

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'checked'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}

export function Switch({ checked, onChange, label, description, className, ...rest }: SwitchProps) {
  const id = useId();
  return (
    <label className={cx(styles.switch, className)} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.switchInput}
        checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => onChange(event.target.checked)}
        {...rest}
      />
      <span className={styles.switchText}>
        <span className={styles.label}>{label}</span>
        {description && (
          <span id={`${id}-description`} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
