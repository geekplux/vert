import { useId } from 'react';
import styles from './TextField.module.css';

/** The counter appears once the value is at least this share of `maxLength`. */
const COUNTER_THRESHOLD = 0.8;

export interface TextFieldProps {
  /** Visible label above the input; also its accessible name. */
  label: string;
  /**
   * Controlled value. `maxLength` only stops typing and pasting; a longer value passed in here is
   * shown in full, not truncated, so the page must clamp programmatic values itself.
   */
  value: string;
  /** Called with the new string on every edit. */
  onChange: (value: string) => void;
  /** Enforced natively; a counter shows once the value reaches 80% of it. */
  maxLength: number;
  placeholder?: string;
  id?: string;
  name?: string;
  /** Optional help text under the input, linked with `aria-describedby`. */
  hint?: string;
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  id,
  name,
  hint,
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const hintId = `${inputId}-hint`;
  const counterId = `${inputId}-counter`;

  const length = value.length;
  const showCounter = length >= maxLength * COUNTER_THRESHOLD;
  const atLimit = length >= maxLength;

  const describedBy =
    [hint ? hintId : null, showCounter ? counterId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        className={styles.input}
        id={inputId}
        name={name}
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint || showCounter ? (
        <div className={styles.footer}>
          {hint ? (
            <p className={styles.hint} id={hintId}>
              {hint}
            </p>
          ) : null}
          {showCounter ? (
            <p className={styles.counter} id={counterId}>
              {length} / {maxLength}
              <span className={styles.srOnly}> characters</span>
              {atLimit ? ' · limit reached' : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
