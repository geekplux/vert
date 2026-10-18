import { Fragment, useId } from 'react';
import type { Ref } from 'react';
import { Dropzone } from '../../components';
import type { DropzoneHandle } from '../../components';
import { formatDistance, formatElevation } from '../../lib/format';
import type { Units } from '../../lib/format';
import { UploadLayout } from '../PageShell/UploadLayout';
import { SAMPLE_TOTALS } from '../sample';
import type { UploadBusy, UploadScreen } from '../state';
import sampleTerrain from './sample-terrain.svg';
import styles from './UploadState.module.css';

export interface UploadStateProps {
  /** The Upload screen from the state machine: busy sub-state and error. */
  screen: UploadScreen;
  /** Display units for the sample chip (the user's preference). */
  units: Units;
  /** A file passed the Dropzone's checks (`useRunChooser().chooseFile`). */
  onFile: (file: File) => void;
  /** "Try the sample run" or the sample preview (`useRunChooser().chooseSample`). */
  onSample: () => void;
  /** The h1; the page focuses it when Upload opens again (DECISIONS "Focus on screen changes"). */
  headingRef?: Ref<HTMLHeadingElement>;
  /** A file is dragged over the page (`useWindowFileDrop`, in Page): the Dropzone shows it. */
  dragOver?: boolean;
  /** The Dropzone's handle: the page hands it files dropped elsewhere (`takeFiles`). */
  dropzoneRef?: Ref<DropzoneHandle>;
}

/**
 * "TRY THE SAMPLE RUN · 21.5 km · +1,102 m": the loaded sample's own figures (`SAMPLE_TOTALS`,
 * checked against the parsed GPX), so the chip matches the View. Also the preview button's name.
 */
export function sampleChipText(units: Units): string {
  const distance = formatDistance(SAMPLE_TOTALS.distance, units).text;
  const vert = formatElevation(SAMPLE_TOTALS.vert, units, { signed: true }).text;
  return `TRY THE SAMPLE RUN · ${distance} · ${vert}`;
}

/** What the polite live region says while the page reads a file or the sample. */
export function busyAnnouncement(busy: UploadBusy): string {
  switch (busy.kind) {
    case 'idle':
      return '';
    case 'reading':
      return `Reading ${busy.fileName}…`;
    case 'sample':
      return 'Loading the sample run…';
  }
}

/**
 * The Upload state (DESIGN-SPEC §3 "01 Upload", canvas UploadV2 frame): headline, intro, Dropzone
 * and note on the left; the sample preview, a button with its data chip, on the right. The page
 * owns the page-wide drop (`useWindowFileDrop`): it passes `dragOver` and hands dropped files to
 * the Dropzone through `dropzoneRef`.
 */
export function UploadState({
  screen,
  units,
  onFile,
  onSample,
  headingRef,
  dragOver = false,
  dropzoneRef,
}: UploadStateProps) {
  const { busy, error } = screen;
  const isBusy = busy.kind !== 'idle';
  const noteId = useId();
  const parts = sampleChipText(units).split(' · ');

  return (
    <UploadLayout
      left={
        <div className={styles.intro}>
          {/* The space before <br> keeps the accessible name "Your run, as terrain.". */}
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Your run, <br />
            as terrain.
          </h1>
          <p className={styles.lede}>
            Drop a GPX file. See the route on real elevation, turn it around, then make a poster.
            Nothing you upload leaves your browser.
          </p>
          <Dropzone
            ref={dropzoneRef}
            onFile={onFile}
            onSample={onSample}
            busy={isBusy}
            busyKind={busy.kind === 'sample' ? 'sample' : 'file'}
            fileName={busy.kind === 'reading' ? busy.fileName : undefined}
            error={error ?? undefined}
            dragOver={dragOver}
            describedBy={noteId}
          />
          <p id={noteId} className={styles.note}>
            GPX only · up to 20 MB · from Strava, Garmin, Coros, Suunto
          </p>
          {/*
           * The Dropzone's title changes while busy, but its aria-busy can keep screen readers
           * from announcing that (DECISIONS.md), so the page says it here. Always rendered, so
           * the region exists before its text changes.
           */}
          <p role="status" className={styles.visuallyHidden}>
            {busyAnnouncement(busy)}
          </p>
        </div>
      }
      right={
        // Named by its chip. The image is decorative: the lede says what Vert draws.
        <button type="button" className={styles.preview} disabled={isBusy} onClick={onSample}>
          <img className={styles.image} src={sampleTerrain} alt="" />
          {/* Wraps only between its parts, never inside "+1,102 m"; the arrow follows the text. */}
          <span className={styles.chip}>
            {parts.map((part, index) => (
              <Fragment key={part}>
                {index > 0 ? ' · ' : null}
                <span className={styles.nowrap}>
                  {part}
                  {index === parts.length - 1 ? (
                    <svg
                      className={styles.arrow}
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  ) : null}
                </span>
              </Fragment>
            ))}
          </span>
        </button>
      }
    />
  );
}
