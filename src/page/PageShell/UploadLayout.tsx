import type { ReactNode } from 'react';
import styles from './UploadLayout.module.css';

export interface UploadLayoutProps {
  /** Left column: h1, intro, Dropzone, note. First in reading order. */
  left: ReactNode;
  /** Right column: the sample preview. Below the left column on narrow screens. */
  right: ReactNode;
  /** A full-width band after the two columns (the poster styles), under a 1px rule. */
  below?: ReactNode;
}

/**
 * The Upload state's body (Upload frame): the page's one `<main>`, two equal columns at ≥ 900px,
 * one column below. Used instead of `PageShell`, which has an aside. `below` never moves the two
 * columns: at ≥ 900px they keep filling the first screen, centred, and the band hangs under it.
 */
export function UploadLayout({ left, right, below }: UploadLayoutProps) {
  return (
    <main className={styles.layout}>
      <div className={styles.column}>{left}</div>
      <div className={styles.column}>{right}</div>
      {below ? <div className={styles.below}>{below}</div> : null}
    </main>
  );
}
