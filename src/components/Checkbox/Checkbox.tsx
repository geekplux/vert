import type { InputHTMLAttributes } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'defaultChecked' | 'onChange' | 'children'
> {
  /** Visible text; it is also the checkbox's accessible name. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function classNames(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/**
 * Native checkbox in a 44px-tall label row; the whole row is the click target. Controlled: the
 * parent owns `checked` and updates it from `onChange`.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <label className={classNames(styles.row, disabled && styles.disabled)}>
      <input
        {...rest}
        type="checkbox"
        className={classNames(styles.input, className)}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          // Browsers never toggle a disabled box, but a synthetic click can; never report it.
          if (disabled) return;
          onChange(event.currentTarget.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}
