import type { MouseEvent, ReactNode } from 'react';
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
  /**
   * A plain click on the wordmark (a link to "/"). The page goes to Upload, or on Upload returns
   * to its top. Without it the wordmark is plain text (stories of the header alone).
   */
  onHome?: () => void;
  /** The wordmark stays a focusable link but a plain click does nothing (during an export). */
  homeDisabled?: boolean;
};

/** The link the wordmark points to, and its accessible name (it starts with the visible word). */
export const HOME_HREF = '/';
export const HOME_LABEL = 'Vert, home';

/**
 * True for a click the page should handle itself: the primary button with no modifier key.
 * Cmd/Ctrl/Shift/Alt-clicks and other buttons are left to the browser (open "/" in a new tab or
 * window), as for any link.
 */
export function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

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
 * right. Wraps onto two rows on narrow screens. With `onHome` the wordmark's name is a real link
 * to "/" (there is no routing: a plain click is handled in the page, a modified one opens a tab).
 */
export function AppHeader({ children, onHome, homeDisabled = false, ...state }: AppHeaderProps) {
  const link = onHome
    ? {
        href: HOME_HREF,
        label: HOME_LABEL,
        disabled: homeDisabled,
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          if (!homeDisabled) onHome();
        },
      }
    : undefined;
  return (
    <header className={styles.header}>
      <Wordmark className={styles.wordmark} tagline={headerTagline(state)} link={link} />
      {children}
    </header>
  );
}
