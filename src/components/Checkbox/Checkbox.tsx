import type { ComponentPropsWithRef } from 'react';
import styles from './Checkbox.module.css';

/**
 * Native `<input>` props (including `ref`, which reaches the input) plus the row's own. `className`
 * and `style` land on the `<input>`, as they always have; use `rowClassName` to style the label row.
 */
export interface CheckboxProps extends Omit<
  ComponentPropsWithRef<'input'>,
  'type' | 'checked' | 'defaultChecked' | 'onChange' | 'children'
> {
  /** Visible text; it is also the checkbox's accessible name. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Extra class for the `<label>` row (layout, spacing). `className` styles the input itself. */
  rowClassName?: string;
}

function classNames(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/**
 * Native checkbox in a 44px-tall label row; the whole row is the click target. Controlled: the
 * parent owns `checked` and updates it from `onChange`. `ref` is a plain prop (React 19) and is
 * forwarded to the input with the rest of the native props.
 */
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  className,
  rowClassName,
  ...rest
}: CheckboxProps) {
  return (
    <label className={classNames(styles.row, disabled && styles.disabled, rowClassName)}>
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
