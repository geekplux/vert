import styles from './UploadNav.module.css';

export const GITHUB_URL = 'https://github.com/geekplux';

export interface UploadNavProps {
  /** Opens the About dialog (DECISIONS.md "Page"). */
  onAbout: () => void;
}

/** Upload-state header links: About (opens a dialog, so a button) and GitHub (a real link). */
export function UploadNav({ onAbout }: UploadNavProps) {
  return (
    <nav aria-label="Site" className={styles.nav}>
      <button type="button" className={styles.link} onClick={onAbout}>
        About
      </button>
      <a className={styles.link} href={GITHUB_URL}>
        GitHub
      </a>
    </nav>
  );
}
