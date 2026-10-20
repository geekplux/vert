import { Button, Segmented } from '../../components';
import type { Units } from '../../lib/format';
import styles from './ViewNav.module.css';

const UNIT_OPTIONS = [
  { value: 'metric', label: 'km' },
  { value: 'imperial', label: 'mi' },
] as const satisfies readonly { value: Units; label: string }[];

export interface ViewNavProps {
  units: Units;
  onUnitsChange: (units: Units) => void;
  /** Back to the Upload state. */
  onNewFile: () => void;
  /**
   * Into Poster mode. A state change, not navigation, so a button (DECISIONS.md "Button"). Left
   * out for a scene opened from a link, which cannot make a poster: no button then.
   */
  onMakePoster?: () => void;
}

/** View-state header controls (Main frame): units, New file, Make a poster (for a run). */
export function ViewNav({ units, onUnitsChange, onNewFile, onMakePoster }: ViewNavProps) {
  return (
    <div className={styles.nav}>
      <Segmented label="Units" options={UNIT_OPTIONS} value={units} onChange={onUnitsChange} />
      <Button variant="secondary" onClick={onNewFile}>
        New file
      </Button>
      {onMakePoster ? (
        <Button variant="primary" onClick={onMakePoster}>
          Make a poster
        </Button>
      ) : null}
    </div>
  );
}
