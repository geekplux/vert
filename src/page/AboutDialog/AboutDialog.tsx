import { useEffect, useId, useRef } from 'react';
import type { RefObject } from 'react';
import { Button } from '../../components';
import { GITHUB_URL } from '../AppHeader/UploadNav';
import styles from './AboutDialog.module.css';

export interface AboutDialogProps {
  /** Shown as a modal (`showModal()`) while true. */
  open: boolean;
  /** The dialog closed: the Close button, Esc, or `open` turning false. */
  onClose: () => void;
  /** Focused again when the dialog closes: the header's About button. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The About dialog (DECISIONS.md "Page"): what Vert is, privacy, credits. A native modal
 * `<dialog>`: the rest of the page is inert while it is open, Esc closes it, and focus moves to
 * its Close button on open and back to `returnFocusRef` on close.
 */
export function AboutDialog({ open, onClose, returnFocusRef }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Browsers differ on what showModal() focuses; the Close button is the one clear target.
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleClose() {
    // Runs after the browser's own focus restoration, so this wins (Safari does not focus a
    // clicked button, so the browser alone may restore focus to <body>).
    returnFocusRef?.current?.focus();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={handleClose}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          About Vert
        </h2>
        <p className={styles.text}>
          Vert turns one GPX file into 3D terrain, then into a poster. One run at a time, nothing
          else.
        </p>
        <section className={styles.section} aria-labelledby={`${titleId}-privacy`}>
          <h3 id={`${titleId}-privacy`} className={styles.label}>
            Privacy
          </h3>
          <p className={styles.text}>
            Your file is read in this browser. Nothing is uploaded. Only elevation tiles are
            fetched, by tile number.
          </p>
        </section>
        <section className={styles.section} aria-labelledby={`${titleId}-credits`}>
          <h3 id={`${titleId}-credits`} className={styles.label}>
            Credits
          </h3>
          <p className={styles.text}>
            Elevation: AWS Terrain Tiles / Mapzen (various sources). Sample route: © OpenStreetMap
            contributors, ODbL. Type: Archivo and IBM Plex Mono (SIL OFL).
          </p>
        </section>
        <p className={styles.text}>
          Made by{' '}
          <a className={styles.link} href={GITHUB_URL}>
            geekplux on GitHub
          </a>
          .
        </p>
        <div className={styles.actions}>
          <Button ref={closeRef} variant="secondary" onClick={() => dialogRef.current?.close()}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
