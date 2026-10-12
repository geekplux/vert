import { useId } from 'react';
import type { PosterStyleId, PosterStyleOption, PosterStyleTerrain } from '../../poster/styles';
import styles from './StylePicker.module.css';

// The style list and palettes live in src/poster/styles.ts; re-exported here for existing imports.
export { POSTER_STYLES } from '../../poster/styles';
export type { PosterStyleId, PosterStyleOption, PosterStyleTerrain } from '../../poster/styles';

export interface StylePickerProps<Id extends string = PosterStyleId> {
  styles: readonly PosterStyleOption<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** Accessible name of the radio group, e.g. "Style". */
  label: string;
  /** Shared `name` of the radio inputs; generated when omitted. */
  name?: string;
}

/** Ridge rows across the grid, front rows lower: the oblique Trail Sign terrain. */
const ROWS = [17, 20.5, 24, 27.5, 31, 34.5].map(
  (y) => `M2 ${String(y + 1)} Q8 ${String(y - 3)} 15 ${String(y)} T28 ${String(y - 1)}`,
);

/** Jagged ridge silhouettes stacked back to front: Night Ridge. */
const PEAKS = [
  'M0 19 L5 14 L8 16 L13 8 L17 14 L21 11 L25 16 L30 13',
  'M0 25 L4 22 L9 24 L14 17 L18 22 L23 19 L30 23',
  'M0 31 L6 27 L10 29 L16 24 L21 28 L25 26 L30 29',
];

function TerrainHint({ terrain }: { terrain: PosterStyleTerrain }) {
  const lines = { fill: 'none', stroke: terrain.line, strokeLinejoin: 'round' } as const;
  const route = {
    fill: 'none',
    stroke: terrain.route,
    strokeWidth: 1.1,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;

  return (
    <svg className={styles.hint} viewBox="0 0 30 40" aria-hidden="true" focusable="false">
      {terrain.kind === 'rows' && (
        <>
          {ROWS.map((d) => (
            <path key={d} d={d} {...lines} strokeWidth={0.45} />
          ))}
          <path d="M7 34 C11 29 9 25 14 22.5 S21 18 23 15" {...route} />
        </>
      )}
      {terrain.kind === 'peaks' && (
        <>
          {PEAKS.map((d) => (
            <path key={d} d={d} {...lines} strokeWidth={0.6} />
          ))}
          <path d="M6 35 L11 30 L16 31 L20 25" {...route} />
        </>
      )}
      {terrain.kind === 'contours' && (
        <>
          <g transform="rotate(-18 15 21)" {...lines} strokeWidth={0.5}>
            <ellipse cx="15" cy="21" rx="12" ry="9" />
            <ellipse cx="15.5" cy="20.5" rx="8.5" ry="6.4" />
            <ellipse cx="16" cy="20" rx="5.2" ry="3.9" />
            <ellipse cx="16.4" cy="19.6" rx="2.2" ry="1.6" />
          </g>
          <path d="M4 35 C9 31 11 27 14 23 S21 13 26 8" {...route} strokeDasharray="1.8 1.4" />
        </>
      )}
    </svg>
  );
}

/**
 * Poster style chooser (DESIGN-SPEC §2, canvas frame "03 Poster mode", STYLE). Native radios,
 * visually hidden, in a `radiogroup`: one tab stop, arrow keys move the selection. The selected
 * option has a 2px ink swatch border and a 600-weight name as well as the radio's checked state.
 */
export function StylePicker<Id extends string = PosterStyleId>({
  styles: options,
  value,
  onChange,
  label,
  name,
}: StylePickerProps<Id>) {
  const generatedName = useId();
  const groupName = name ?? generatedName;

  return (
    <div role="radiogroup" aria-label={label} className={styles.group}>
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <label key={option.id} className={styles.option}>
            <input
              type="radio"
              className={styles.input}
              name={groupName}
              value={option.id}
              checked={checked}
              onChange={() => {
                onChange(option.id);
              }}
            />
            <span className={styles.swatch} style={{ background: option.paper }}>
              <TerrainHint terrain={option.terrain} />
            </span>
            <span className={styles.name}>{option.name}</span>
          </label>
        );
      })}
    </div>
  );
}
