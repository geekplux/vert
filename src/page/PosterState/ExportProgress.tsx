import { useId } from 'react';
import type { Ref } from 'react';
import { Button } from '../../components';
import type { PosterNotice } from '../state';
import { exportTileLabel, exportValueText } from './posterCopy';
import type { ExportProgressValue } from './posterCopy';
import styles from './ExportProgress.module.css';

export interface ExportProgressProps {
  /** Tiles rendered so far out of the total; `total` null until the exporter reports it. */
  progress: ExportProgressValue;
  /** The label; Poster mode focuses it when the export starts (DECISIONS "Focus"). */
  labelRef?: Ref<HTMLParagraphElement>;
  onCancel: () => void;
}

/**
 * DESIGN-SPEC §3 "04 Exporting": under the Download button, a 6px progress bar (`--ink` over
 * `--rule`), the label "Rendering tile 4 of 12" and a Quiet Cancel. The label is not a live region
 * (it changes every tile); Poster mode's status region announces the export at quarter steps.
 * Until the exporter reports its tile count the bar is indeterminate and the label "Preparing…".
 */
export function ExportProgress({ progress, labelRef, onCancel }: ExportProgressProps) {
  const labelId = useId();
  return (
    <div className={styles.root}>
      <progress
        className={styles.bar}
        // No value: indeterminate while the total is unknown.
        max={progress.total ?? undefined}
        value={progress.total === null ? undefined : progress.done}
        aria-labelledby={labelId}
        aria-valuetext={exportValueText(progress)}
      />
      <div className={styles.row}>
        <p ref={labelRef} id={labelId} tabIndex={-1} className={styles.label}>
          {exportTileLabel(progress)}
        </p>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * How the last export ended, under the Download button: "✓ Saved <file>" or "⚠ <error>". The
 * glyph and the words say which, not colour alone (the error is also `--route-text`).
 */
export function ExportNotice({ notice }: { notice: PosterNotice }) {
  const failed = notice.kind === 'failed';
  return (
    <p className={[styles.notice, failed && styles.failed].filter(Boolean).join(' ')}>
      <svg
        className={styles.glyph}
        viewBox="0 0 12 12"
        width="12"
        height="12"
        aria-hidden="true"
        focusable="false"
      >
        {failed ? (
          <>
            <path d="M6 1.5 11 10.5H1Z" />
            <path d="M6 5v2.4M6 9h.01" />
          </>
        ) : (
          <polyline points="2,6.5 5,9.5 10,3" />
        )}
      </svg>
      <span className={styles.text}>{failed ? notice.message : `Saved ${notice.fileName}`}</span>
    </p>
  );
}
