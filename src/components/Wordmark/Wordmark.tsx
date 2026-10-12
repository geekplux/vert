import styles from './Wordmark.module.css';

export interface WordmarkProps {
  /** Mono line beside the name, rendered as given (the taglines are written in capitals). */
  tagline?: string;
  className?: string;
}

/**
 * The "VERT" wordmark with an optional tagline. Not a heading: the page's h1 is the content title.
 * The name is written "Vert" in the DOM and capitalised in CSS, so screen readers say the word
 * instead of spelling out the letters. Non-interactive; the page may wrap it in a link.
 */
export function Wordmark({ tagline, className }: WordmarkProps) {
  const rootClass = [styles.root, className].filter(Boolean).join(' ');
  return (
    <div className={rootClass}>
      <span className={styles.name}>Vert</span>
      {tagline ? <span className={styles.tagline}>{tagline}</span> : null}
    </div>
  );
}
