import type { ReactNode } from 'react';
import styles from './UploadLayout.module.css';

export interface UploadLayoutProps {
  /** Left column: h1, intro, Dropzone, note. First in reading order. */
  left: ReactNode;
  /** Right column: the sample preview. Below the left column on narrow screens. */
  right: ReactNode;
}

/**
 * The Upload state's body (Upload frame): the page's one `<main>`, two equal columns at ≥ 900px,
 * one column below. Used instead of `PageShell`, which has an aside.
 */
export function UploadLayout({ left, right }: UploadLayoutProps) {
  return (
    <main className={styles.layout}>
      <div className={styles.column}>{left}</div>
      <div className={styles.column}>{right}</div>
    </main>
  );
}
