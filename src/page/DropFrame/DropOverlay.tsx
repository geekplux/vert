import { DropFrame } from './DropFrame';
import styles from './DropFrame.module.css';

export interface DropOverlayProps {
  /** The current run's name: the pill says the dropped file replaces it. */
  routeName: string;
}

/** What the page's status region says while the overlay is up: the pill's words. */
export function dropOverlayAnnouncement(routeName: string): string {
  return `Drop to open a new run. Replaces ${routeName}.`;
}

/**
 * What View and Poster mode draw while a file is dragged over them (canvas ViewDropV2): a light
 * wash over the page, the viewport frame, and a centred pill "Drop to open a new run" /
 * "REPLACES <ROUTE NAME>". Nothing takes pointer events. All of it is hidden from assistive tech:
 * the page announces the same words through its always-present status region
 * (`dropOverlayAnnouncement`). Render it only while dragging.
 */
export function DropOverlay({ routeName }: DropOverlayProps) {
  return (
    <>
      <div className={styles.wash} aria-hidden="true" data-testid="drop-wash" />
      <DropFrame />
      <div className={styles.pill} aria-hidden="true">
        <span className={styles.pillTitle}>
          <svg
            className={styles.pillIcon}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 16V4M6 10l6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
          Drop to open a new run
        </span>{' '}
        {/* Uppercase by CSS; the text keeps the name as typed. */}
        <span className={styles.pillSub}>Replaces {routeName}</span>
      </div>
    </>
  );
}
