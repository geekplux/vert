import type { Ref } from 'react';
import styles from './UploadNav.module.css';

export const GITHUB_URL = 'https://github.com/geekplux';

export interface UploadNavProps {
  /** Opens the About dialog (DECISIONS.md "Page"). */
  onAbout: () => void;
  /** The About button, so the dialog can return focus to it when it closes. */
  aboutRef?: Ref<HTMLButtonElement>;
}

/** Upload-state header links: About (opens a dialog, so a button) and GitHub (a real link). */
export function UploadNav({ onAbout, aboutRef }: UploadNavProps) {
  return (
    <nav aria-label="Site" className={styles.nav}>
      <button ref={aboutRef} type="button" className={styles.link} onClick={onAbout}>
        About
      </button>
      <a className={styles.link} href={GITHUB_URL}>
        GitHub
      </a>
    </nav>
  );
}
