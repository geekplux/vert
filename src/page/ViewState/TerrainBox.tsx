import type { ReactNode } from 'react';
import { Button, Marker } from '../../components';
import styles from './TerrainBox.module.css';

export interface TerrainBoxProps {
  /** The terrain itself. Phase 2: the sample illustration; phase 3: `TerrainView`. */
  children: ReactNode;
  /** Legend's summit entry, e.g. "Summit 1,267 m". */
  summit: string;
  /** Legend's exaggeration entry, e.g. "Vertical ×1.6". */
  exaggeration: string;
  /** Whether the flat (top-down) map is showing; the Flat map button's pressed state. */
  flat: boolean;
  /** "Rotate view". PHASE 3 turns the camera. */
  onRotate: () => void;
  /** "Flat map". PHASE 3 switches between the 3D and top-down views. */
  onToggleFlat: () => void;
}

/**
 * The terrain's frame in the View state (Main frame): a `--surface` panel with the legend chip
 * top-left and the Rotate / Flat map buttons bottom-right over the content.
 */
export function TerrainBox({
  children,
  summit,
  exaggeration,
  flat,
  onRotate,
  onToggleFlat,
}: TerrainBoxProps) {
  return (
    <div className={styles.box}>
      <div className={styles.content}>{children}</div>
      {/* The markers are drawn shapes; the words next to them carry the meaning. */}
      <p className={styles.legend}>
        <span className={styles.entry}>
          <Marker kind="start" size={12} />
          Start / finish
        </span>
        <span className={styles.entry}>
          <Marker kind="summit" size={12} />
          {summit}
        </span>
        <span className={styles.entry}>{exaggeration}</span>
      </p>
      <div className={styles.controls}>
        <Button variant="icon" aria-label="Rotate view" onClick={onRotate}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
          </svg>
        </Button>
        <Button variant="icon" aria-label="Flat map" aria-pressed={flat} onClick={onToggleFlat}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
          >
            <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
