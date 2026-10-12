import { useId, type ChangeEvent } from 'react';
import styles from './SizePicker.module.css';

/** One poster output size. `width` and `height` are the export's pixel targets (DESIGN-SPEC §4). */
export interface PosterSize<Id extends string = string> {
  id: Id;
  /** Shown on the first line, e.g. "18 × 24 in". */
  name: string;
  use: 'print' | 'social' | 'story';
  width: number;
  height: number;
}

/**
 * The four poster sizes, in display order. Print sizes are 300 dpi.
 * This constant moves to src/poster once the poster module exists.
 */
export const POSTER_SIZES = [
  { id: '18x24', name: '18 × 24 in', use: 'print', width: 5400, height: 7200 },
  { id: 'a3', name: 'A3', use: 'print', width: 3508, height: 4961 },
  { id: '4x5', name: '4 : 5', use: 'social', width: 1080, height: 1350 },
  { id: '9x16', name: '9 : 16', use: 'story', width: 1080, height: 1920 },
] as const satisfies readonly PosterSize[];

export type PosterSizeId = (typeof POSTER_SIZES)[number]['id'];

/** The sub-line: "print · 5400 × 7200". */
export function sizeDetail(size: PosterSize): string {
  return `${size.use} · ${String(size.width)} × ${String(size.height)}`;
}

export interface SizePickerProps<Id extends string = string> {
  sizes: readonly PosterSize<Id>[];
  /** Id of the selected size. */
  value: Id;
  onChange: (id: Id) => void;
  /** Accessible name of the group, e.g. "Size". The page shows its own visible section label. */
  label: string;
  /** Radio group name; generated when omitted. */
  name?: string;
  className?: string;
}

/**
 * A 2×2 grid of poster sizes built from native radio inputs (DECISIONS.md): one tab stop, arrow keys
 * move the selection, and the checked radio drives the filled look.
 */
export function SizePicker<Id extends string = string>({
  sizes,
  value,
  onChange,
  label,
  name,
  className,
}: SizePickerProps<Id>) {
  const baseId = useId();
  const groupName = name ?? `size-${baseId}`;
  const rootClass = [styles.grid, className].filter(Boolean).join(' ');

  return (
    <div role="radiogroup" aria-label={label} className={rootClass}>
      {sizes.map((size) => {
        const inputId = `${baseId}-${size.id}`;
        const detail = sizeDetail(size);
        return (
          <div key={size.id} className={styles.option}>
            <input
              type="radio"
              id={inputId}
              className={styles.input}
              name={groupName}
              value={size.id}
              checked={size.id === value}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (event.target.checked) onChange(size.id);
              }}
            />
            {/* As in the canvas: one 14px Archivo line box, the name, a line break, then the mono
                sub-line as an inline span, so each sub-line line takes the Archivo line height.
                The label names the radio; the hidden comma separates the two parts when read. */}
            <label htmlFor={inputId} className={styles.card}>
              <span className={styles.text}>
                {size.name}
                <span className={styles.hidden}>, </span>
                <br />
                <span className={styles.detail}>{detail}</span>
              </span>
            </label>
          </div>
        );
      })}
    </div>
  );
}
