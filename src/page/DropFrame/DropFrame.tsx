import styles from './DropFrame.module.css';

/**
 * A frame drawn just inside the viewport while a file is dragged over the page, saying "drop
 * anywhere" without covering anything. Decorative: the Dropzone (Upload) or the overlay's pill
 * (View, Poster mode) says the same thing in words, and the frame never takes pointer events, so
 * the drop lands on whatever is under it. Render it only while `useWindowFileDrop().dragOver`.
 */
export function DropFrame() {
  return <div className={styles.frame} aria-hidden="true" data-testid="drop-frame" />;
}
