import type { MouseEventHandler } from 'react';
import styles from './Wordmark.module.css';

/** Makes the name a link (the page header's "home"). The tagline stays plain text beside it. */
export interface WordmarkLink {
  href: string;
  /**
   * The link's accessible name. Start it with the visible word ("Vert, home") so speech users
   * can say what they see (WCAG 2.5.3, label in name).
   */
  label: string;
  /** The caller decides what a click does; the Wordmark only renders. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** Marks the link unavailable for now (it stays focusable); the caller ignores its clicks. */
  disabled?: boolean;
}

export interface WordmarkProps {
  /** Mono line beside the name, rendered as given (the taglines are written in capitals). */
  tagline?: string;
  /** Render the name as this link instead of plain text. */
  link?: WordmarkLink;
  className?: string;
}

/**
 * The "VERT" wordmark with an optional tagline. Not a heading: the page's h1 is the content title.
 * The name is written "Vert" in the DOM and capitalised in CSS, so screen readers say the word
 * instead of spelling out the letters. Presentational: with `link` the name is an `<a>` drawn
 * exactly like the plain name (no underline), with a 44px-tall hit area and the focus ring; what a
 * click does is up to the caller.
 */
export function Wordmark({ tagline, link, className }: WordmarkProps) {
  const rootClass = [styles.root, className].filter(Boolean).join(' ');
  return (
    <div className={rootClass}>
      {link ? (
        <a
          className={[styles.name, styles.link].join(' ')}
          href={link.href}
          aria-label={link.label}
          aria-disabled={link.disabled ? true : undefined}
          onClick={link.onClick}
        >
          Vert
        </a>
      ) : (
        <span className={styles.name}>Vert</span>
      )}
      {tagline ? <span className={styles.tagline}>{tagline}</span> : null}
    </div>
  );
}
