import type { Ref } from 'react';
import { Dropzone } from '../../components';
import { formatDistance, formatElevation } from '../../lib/format';
import type { Units } from '../../lib/format';
import { UploadLayout } from '../PageShell/UploadLayout';
import { SAMPLE_RUN } from '../sample';
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
  /** "try a sample run" (`useRunChooser().chooseSample`). */
  onSample: () => void;
  /** The h1; the page focuses it when Upload opens again (DECISIONS "Focus on screen changes"). */
  headingRef?: Ref<HTMLHeadingElement>;
}

/** "SAMPLE · 21.5 km · +1,092 m", from the sample run's data (not the canvas copy). */
export function sampleChipText(units: Units): string {
  const distance = formatDistance(SAMPLE_RUN.distance, units).text;
  const vert = formatElevation(SAMPLE_RUN.vert, units, { signed: true }).text;
  return `SAMPLE · ${distance} · ${vert}`;
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
 * The Upload state (DESIGN-SPEC §3 "01 Upload", canvas Upload frame): headline, intro, Dropzone
 * and note on the left; the sample terrain preview with its data chip on the right.
 */
export function UploadState({ screen, units, onFile, onSample, headingRef }: UploadStateProps) {
  const { busy, error } = screen;
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
            onFile={onFile}
            onSample={onSample}
            busy={busy.kind !== 'idle'}
            fileName={busy.kind === 'reading' ? busy.fileName : undefined}
            error={error ?? undefined}
          />
          <p className={styles.note}>
            GPX only in v1 · up to 20 MB · exported from Strava, Garmin, Coros, Suunto
          </p>
          {/*
           * The Dropzone's title changes while busy, but its aria-busy can keep screen readers from
           * announcing that (DECISIONS.md), so the page says it here. Always rendered, so the
           * region exists before its text changes.
           */}
          <p role="status" className={styles.visuallyHidden}>
            {busyAnnouncement(busy)}
          </p>
        </div>
      }
      right={
        <div className={styles.preview}>
          <img
            className={styles.image}
            src={sampleTerrain}
            alt="Example: the sample trail run drawn as terrain, an orange loop over ridge lines"
          />
          <p className={styles.chip}>{sampleChipText(units)}</p>
        </div>
      }
    />
  );
}
