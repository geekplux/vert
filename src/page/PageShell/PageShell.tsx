import type { ReactNode } from 'react';
import styles from './PageShell.module.css';

export interface PageShellProps {
  /** Accessible name of the `<aside>` landmark, e.g. "Run details" or "Poster settings". */
  asideLabel: string;
  aside: ReactNode;
  /** Content of the page's one `<main>`. */
  children: ReactNode;
  /**
   * Which frame's aside: `view` (Main frame: `flex: 1 1 300px; max-width: 360px`, so ≈300px at
   * 1440) or `poster` (PosterMode frame: fixed 380px, scrolls on its own). Default `view`.
   */
  asideWidth?: 'view' | 'poster';
}

/**
 * The body below the header (DESIGN-SPEC §3): aside beside main at ≥ 900px with a 1px rule between,
 * main above aside below 900px, one column with 16px gutters on phones.
 *
 * DOM order is aside, then main: at desktop widths the aside is the left column and holds the
 * route's h1 and the text alternative to the terrain, so reading and Tab order match what you see.
 * Below 900px CSS `order` lifts main above the aside; Tab order stays aside → main there. Each
 * region is a contiguous, labelled landmark, so focus never interleaves between them.
 */
export function PageShell({ asideLabel, aside, children, asideWidth = 'view' }: PageShellProps) {
  return (
    <div className={[styles.shell, styles[asideWidth]].filter(Boolean).join(' ')}>
      <aside aria-label={asideLabel} className={styles.aside}>
        {aside}
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
