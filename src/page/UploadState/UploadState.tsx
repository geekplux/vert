import { Fragment, useId } from 'react';
import type { Ref } from 'react';
import { Dropzone } from '../../components';
import type { DropzoneHandle } from '../../components';
import { formatDistance, formatElevation } from '../../lib/format';
import type { Units } from '../../lib/format';
import { UploadLayout } from '../PageShell/UploadLayout';
import { SAMPLE_TOTALS } from '../sample';
import type { UploadBusy, UploadScreen } from '../state';
import nightRidge from './posters/night-ridge.webp';
import surveyQuad from './posters/survey-quad.webp';
import trailSign from './posters/trail-sign.webp';
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

/**
 * The poster styles band's three examples: the sample run at default settings, 18 × 24 in, from
 * Poster mode's preview (`pnpm posters`, scripts/capture-posters.mjs, writes the images).
 */
export const POSTER_EXAMPLES = [
  {
    src: trailSign,
    name: 'A · Trail Sign',
    description: 'Oblique 3D terrain',
    alt: 'The sample run as a Trail Sign poster: large condensed title, oblique 3D terrain with an orange route, a stats row and a solid elevation silhouette.',
  },
  {
    src: nightRidge,
    name: 'B · Night Ridge',
    description: 'Ridge lines at night',
    alt: 'The sample run as a Night Ridge poster: dark navy paper, pale blue ridge lines, a glowing amber route and a sunrise marker on the profile.',
  },
  {
    src: surveyQuad,
    name: 'E · Survey Quad',
    description: 'Topographic contours',
    alt: 'The sample run as a Survey Quad poster: a framed top-down contour map in brown with a dashed route, a legend and a scale bar.',
  },
] as const;

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
 * and note on the left; the sample preview, a button with its data chip, on the right; under them,
 * the poster styles band (three example posters, static). The page
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
  const stylesHeadingId = useId();
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
      below={
        // Static: three examples, no controls (DESIGN-SPEC §3 "01 Upload").
        <section className={styles.styles} aria-labelledby={stylesHeadingId}>
          <p className={styles.eyebrow}>Poster styles</p>
          <h2 id={stylesHeadingId} className={styles.stylesTitle}>
            Three posters from one run.
          </h2>
          <p className={styles.stylesLede}>
            Made from the sample run. Yours render in your browser, up to 18 × 24 in at 300 dpi.
          </p>
          <div className={styles.posters}>
            {POSTER_EXAMPLES.map((poster) => (
              <figure key={poster.name} className={styles.poster}>
                <img
                  className={styles.posterImage}
                  src={poster.src}
                  alt={poster.alt}
                  width={600}
                  height={800}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption className={styles.caption}>
                  <span className={styles.posterName}>{poster.name}</span>
                  <span className={styles.posterDescription}>{poster.description}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      }
    />
  );
}
