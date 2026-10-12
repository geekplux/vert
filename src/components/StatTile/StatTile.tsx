import styles from './StatTile.module.css';

const grouped = new Intl.NumberFormat('en-US');

function formatGrouped(value: number): string {
  return grouped.format(value);
}

export interface StatTileProps {
  /** Short name of the stat, shown uppercase above the value ("Distance"). */
  label: string;
  value: number;
  /** Shown after the value, separated by a space ("km"). Omit for unitless stats like moving time. */
  unit?: string;
  /** Colours the value `--route` and its unit `--route-text`. Used for Vert only. */
  emphasis?: boolean;
  /** Turns the value into display text. Defaults to en-US digit grouping (1070 → "1,070"). */
  format?: (value: number) => string;
}

/**
 * One stat as a term/description pair. Render it inside a `StatGrid` (a `<dl>`): a `<dt>` outside a
 * `<dl>` is invalid HTML.
 */
export function StatTile({
  label,
  value,
  unit,
  emphasis = false,
  format = formatGrouped,
}: StatTileProps) {
  return (
    <div className={styles.tile} data-emphasis={emphasis ? 'true' : 'false'}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>
        {format(value)}
        {unit ? <span className={styles.unit}> {unit}</span> : null}
      </dd>
    </div>
  );
}
