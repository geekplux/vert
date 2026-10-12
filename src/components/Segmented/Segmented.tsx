import { useId } from 'react';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  /** Must be one of the options' values: `T` is inferred from `options` only. */
  value: NoInfer<T>;
  onChange: (value: NoInfer<T>) => void;
  /** Accessible name of the group, e.g. "Units". Not shown. */
  label: string;
  /** Radio group name. Generated when omitted. */
  name?: string;
}

/**
 * A row of mutually exclusive options (km / mi). Native radio inputs, visually hidden, so arrow
 * keys move the selection and Tab enters and leaves the group as one stop.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  name,
}: SegmentedProps<T>) {
  const generatedName = useId();
  const groupName = name ?? generatedName;

  return (
    <div role="radiogroup" aria-label={label} className={styles.group}>
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.input}
            name={groupName}
            value={option.value}
            checked={option.value === value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
