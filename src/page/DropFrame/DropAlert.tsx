import styles from './DropAlert.module.css';

export interface DropAlertProps {
  /** Why the dropped file was not opened: `pickGpxFile`'s words (a wrong extension, too large). */
  message: string;
  /** Dismiss pressed: the page removes the alert. */
  onDismiss: () => void;
}

/**
 * The bar under the header that says why a file dropped on View or Poster mode was not opened
 * (DECISIONS "A wrong file dropped on a run stays on the run"). In flow, so it covers nothing:
 * not the terrain, not Poster mode's sticky Download block. The message is the alert (Dismiss
 * sits beside it, not in it), announced when it mounts: mount the component with a new `key` for
 * each message, so a second wrong file is announced too.
 */
export function DropAlert({ message, onDismiss }: DropAlertProps) {
  return (
    <div className={styles.alert}>
      <p role="alert" className={styles.message}>
        <svg
          className={styles.icon}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        {message}
      </p>
      <button type="button" className={styles.dismiss} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
