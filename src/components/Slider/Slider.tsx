import { useId, type ChangeEvent, type CSSProperties } from 'react';
import styles from './Slider.module.css';

export interface SliderProps {
  /** Visible name, also the input's accessible name. */
  label: string;
  min: number;
  max: number;
  step: number;
  /** Controlled value. */
  value: number;
  /** Visible value text, e.g. `(v) => v.toFixed(1) + '×'`. */
  format: (value: number) => string;
  /** Fires on every input event while the thumb moves. */
  onChange: (value: number) => void;
  /** Spoken value (`aria-valuetext`) when `format` is too terse, e.g. "200 metres" for "200 m". */
  valueText?: (value: number) => string;
  /** Input id; generated when omitted. */
  id?: string;
  disabled?: boolean;
  /** Help text under the slider, linked with `aria-describedby`. */
  hint?: string;
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
  valueText,
  id,
  disabled = false,
  hint,
}: SliderProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const formatted = format(value);
  // Where the thumb sits, 0 at min to 1 at max; the track's filled part ends under its centre.
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const fill = { '--slider-fill': String(fraction) } as CSSProperties;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.currentTarget.value));
  };

  return (
    <div className={styles.slider} data-disabled={disabled || undefined}>
      <div className={styles.control}>
        <label htmlFor={inputId} className={styles.label}>
          <span className={styles.name}>{label}</span>
          <span className={styles.value} aria-hidden="true">
            {formatted}
          </span>
        </label>
        <input
          id={inputId}
          className={styles.input}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={valueText ? valueText(value) : formatted}
          aria-describedby={hint ? hintId : undefined}
          style={fill}
          onChange={handleChange}
        />
      </div>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
