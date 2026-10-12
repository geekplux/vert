import type { ReactNode } from 'react';
import { Wordmark } from '../../components';
import styles from './AppHeader.module.css';

/** Which page state the header belongs to; it picks the tagline (DECISIONS.md "Taglines"). */
export type AppHeaderState =
  | { state: 'upload' }
  | { state: 'view' }
  | {
      state: 'poster';
      /** The route name as shown in the run; capitalised here. */
      routeName: string;
    };

export type AppHeaderProps = AppHeaderState & {
  /** State-specific controls on the right: `UploadNav`, `ViewNav` or `PosterNav`. */
  children?: ReactNode;
};

export function headerTagline(props: AppHeaderState): string {
  switch (props.state) {
    case 'upload':
      return 'DROP A GPX. GET A POSTER.';
    case 'view':
      return 'TRAIL RUNS AS TERRAIN';
    case 'poster':
      return `POSTER · ${props.routeName.toUpperCase()}`;
  }
}

/**
 * The page header (DESIGN-SPEC §3): wordmark and tagline on the left, the state's controls on the
 * right. Wraps onto two rows on narrow screens. The wordmark is not a link: there is no routing.
 */
export function AppHeader({ children, ...state }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <Wordmark className={styles.wordmark} tagline={headerTagline(state)} />
      {children}
    </header>
  );
}
