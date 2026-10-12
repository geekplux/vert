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
  /** Into Poster mode. A state change, not navigation, so a button (DECISIONS.md "Button"). */
  onMakePoster: () => void;
}

/** View-state header controls (Main frame): units, New file, Make a poster. */
export function ViewNav({ units, onUnitsChange, onNewFile, onMakePoster }: ViewNavProps) {
  return (
    <div className={styles.nav}>
      <Segmented label="Units" options={UNIT_OPTIONS} value={units} onChange={onUnitsChange} />
      <Button variant="secondary" onClick={onNewFile}>
        New file
      </Button>
      <Button variant="primary" onClick={onMakePoster}>
        Make a poster
      </Button>
    </div>
  );
}
