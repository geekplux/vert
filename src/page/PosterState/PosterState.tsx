import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, Ref } from 'react';
import {
  Button,
  Checkbox,
  POSTER_SIZES,
  SizePicker,
  Slider,
  StylePicker,
  TextField,
} from '../../components';
import { PosterPreview } from '../../poster/PosterPreview';
import { posterSizeById } from '../../poster/sizes';
import { POSTER_STYLES } from '../../poster/styles';
import type { PosterStyleId, PosterStyleOption } from '../../poster/styles';
import { TrailSignPoster } from '../../poster/TrailSignPoster';
import { posterContentFromRun } from '../../poster/types';
import { HIDE_ENDS } from '../state';
import type {
  ExportingScreen,
  PosterScreen,
  PosterStat,
  PosterTextField,
  Prefs,
  PrefsEvent,
  ScreenEvent,
} from '../state';
import { PageShell } from '../PageShell/PageShell';
import type { Run } from '../types';
import sampleTerrain from '../UploadState/sample-terrain.svg';
import { useMediaQuery } from '../ViewState/useMediaQuery';
import { buildExportJob, defaultExporter } from './exporter';
import type { ExportFormat, Exporter } from './exporter';
import { ExportNotice, ExportProgress } from './ExportProgress';
import { PendingStylePoster } from './PendingStylePoster';
import { exportAnnouncement, offersPdf, pngButtonLabel } from './posterCopy';
import { useExport } from './useExport';
import styles from './PosterState.module.css';

/** The events Poster mode sends: poster settings, and the poster / exporting screen events. */
export type PosterStateAction = PrefsEvent | ScreenEvent<'poster'> | ScreenEvent<'exporting'>;

export interface PosterStateProps {
  run: Run;
  /** `poster`, or `exporting`: Poster mode with the export overlay under the Download button. */
  screen: PosterScreen | ExportingScreen;
  prefs: Prefs;
  dispatch: Dispatch<PosterStateAction>;
  /** The screen's h1; the page focuses it when Poster mode opens (DECISIONS "Focus"). */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Renders and saves the file. Default: `defaultExporter` (exporter.ts). */
  exporter?: Exporter;
}

/** Poster mode's preview box (canvas PosterMode frame): 600 × 800 at most. */
const PREVIEW_MAX = { width: 600, height: 800 } as const;

/** Side by side at ≥ 900px (PageShell): the page is one viewport tall and the aside scrolls. */
const DESKTOP_QUERY = '(min-width: 900px)';

const TEXT_FIELDS: readonly { field: PosterTextField; label: string; maxLength: number }[] = [
  { field: 'title', label: 'Title', maxLength: 40 },
  { field: 'subtitle', label: 'Subtitle', maxLength: 60 },
  { field: 'signature', label: 'Signature', maxLength: 40 },
];

const STATS: readonly { stat: PosterStat; label: string }[] = [
  { stat: 'distance', label: 'Distance' },
  { stat: 'vert', label: 'Vert' },
  { stat: 'time', label: 'Time' },
  { stat: 'highPoint', label: 'High point' },
];

function posterStyleById(id: PosterStyleId): PosterStyleOption {
  const style = POSTER_STYLES.find((option) => option.id === id);
  if (!style) throw new RangeError(`Unknown poster style: ${id}`);
  return style;
}

const formatMetres = (value: number) => `${String(value)} m`;
const metresText = (value: number) => `${String(value)} metres`;

/**
 * Poster mode (DESIGN-SPEC §3 "03 Poster mode", canvas PosterMode frame). Aside: style, size,
 * text, stats and hide-ends, then the sticky Download block. Main: the live poster preview on the
 * grey stage. Download runs `exporter`; while it runs (`exporting`, DESIGN-SPEC §3 "04 Exporting")
 * the progress shows under the Download button and every control that could change the output is
 * disabled. Phase 2: the figure is the sample terrain illustration and the exporter is simulated
 * (phase 3 renders the terrain and the file).
 */
export function PosterState({
  run,
  screen,
  prefs,
  dispatch,
  headingRef,
  exporter = defaultExporter,
}: PosterStateProps) {
  const { poster } = prefs;
  const size = posterSizeById(poster.size);
  const style = posterStyleById(poster.style);
  const content = posterContentFromRun(run, prefs);
  const [stageRef, stageHeight] = useStageHeight();
  const exporting = screen.name === 'exporting';
  const { start, cancel, cancelled } = useExport(exporter, dispatch);
  const { labelRef, pngRef, pdfRef, rememberStarter } = useExportFocus(screen.name);
  const busyNoteId = useId();

  const download = (format: ExportFormat) => {
    rememberStarter(format);
    start(buildExportJob(run, prefs, format));
  };

  const aside = (
    <>
      <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
        Make a poster
      </h1>

      {/* Disabled while exporting, so the output cannot change mid-render. */}
      <fieldset className={styles.controls} disabled={exporting}>
        <div className={styles.section}>
          <h2 className={styles.label}>Style</h2>
          <StylePicker
            label="Style"
            styles={POSTER_STYLES}
            value={poster.style}
            onChange={(id) => {
              dispatch({ type: 'SET_POSTER_STYLE', style: id });
            }}
          />
        </div>

        <div className={styles.section}>
          <h2 className={styles.label}>Size</h2>
          <SizePicker
            label="Size"
            sizes={POSTER_SIZES}
            value={poster.size}
            onChange={(id) => {
              dispatch({ type: 'SET_POSTER_SIZE', size: id });
            }}
          />
        </div>

        <div className={[styles.section, styles.textSection].join(' ')}>
          <h2 className={styles.label}>Text</h2>
          {TEXT_FIELDS.map(({ field, label, maxLength }) => (
            <TextField
              key={field}
              label={label}
              maxLength={maxLength}
              value={poster[field]}
              // An empty title prints the route name; the placeholder says so.
              placeholder={field === 'title' ? run.name : undefined}
              onChange={(value) => {
                dispatch({ type: 'SET_POSTER_TEXT', field, value });
              }}
            />
          ))}
        </div>

        <div className={styles.section}>
          <h2 className={styles.label}>Stats · privacy</h2>
          <div className={styles.stats}>
            {STATS.map(({ stat, label }) => (
              <Checkbox
                key={stat}
                label={label}
                checked={poster.stats[stat]}
                onChange={(shown) => {
                  dispatch({ type: 'SET_POSTER_STAT', stat, shown });
                }}
              />
            ))}
          </div>
          <Slider
            label="Hide start and end"
            min={HIDE_ENDS.min}
            max={HIDE_ENDS.max}
            step={HIDE_ENDS.step}
            value={poster.hideEnds}
            format={formatMetres}
            valueText={metresText}
            onChange={(metres) => {
              dispatch({ type: 'SET_HIDE_ENDS', metres });
            }}
          />
        </div>
      </fieldset>

      <div className={styles.downloads}>
        <Button
          ref={pngRef}
          variant="primary"
          size="lg"
          disabled={exporting}
          aria-describedby={exporting ? busyNoteId : undefined}
          onClick={() => {
            download('png');
          }}
        >
          {pngButtonLabel(size)}
        </Button>
        {offersPdf(size) ? (
          <Button
            ref={pdfRef}
            variant="secondary"
            disabled={exporting}
            aria-describedby={exporting ? busyNoteId : undefined}
            onClick={() => {
              download('pdf');
            }}
          >
            Download PDF for print
          </Button>
        ) : (
          <p className={styles.note}>PDF is offered for the print sizes, 18 × 24 in and A3.</p>
        )}
        {screen.name === 'exporting' ? (
          <ExportProgress progress={screen.progress} labelRef={labelRef} onCancel={cancel} />
        ) : screen.notice ? (
          <ExportNotice notice={screen.notice} />
        ) : null}
        <p className={styles.note}>
          Rendered in your browser in tiles. Large sizes take a few seconds.
        </p>
        <span id={busyNoteId} hidden>
          Unavailable while the poster exports.
        </span>
        {/* Polite announcements: on start, at each quarter, and when the export ends. */}
        <p role="status" className={styles.status}>
          {statusText(screen, cancelled)}
        </p>
      </div>
    </>
  );

  return (
    <PageShell asideLabel="Poster settings" asideWidth="poster" aside={aside}>
      <div ref={stageRef} className={styles.stage}>
        <PosterPreview
          size={size}
          maxWidth={PREVIEW_MAX.width}
          maxHeight={Math.min(PREVIEW_MAX.height, stageHeight ?? PREVIEW_MAX.height)}
        >
          {style.id === 'A' ? (
            <TrailSignPoster
              content={content}
              size={size}
              // PHASE 3: the live terrain render replaces the sample illustration.
              figure={<img src={sampleTerrain} alt="" />}
              onFigureBox={() => undefined /* PHASE 3: the terrain renders at this box. */}
            />
          ) : (
            <PendingStylePoster style={style} size={size} />
          )}
        </PosterPreview>
      </div>
    </PageShell>
  );
}

/** The status region's text: the export's milestones, then how it ended. */
function statusText(screen: PosterScreen | ExportingScreen, cancelled: boolean): string {
  if (screen.name === 'exporting') return exportAnnouncement(screen.progress, screen.fileName);
  if (screen.notice?.kind === 'saved') return `Saved ${screen.notice.fileName}.`;
  if (screen.notice?.kind === 'failed') return screen.notice.message;
  return cancelled ? 'Export cancelled.' : '';
}

/**
 * DECISIONS "Focus": when an export starts, focus moves to the progress label; when it ends
 * (Cancel, done or failed), back to the Download button that started it.
 */
function useExportFocus(screenName: 'poster' | 'exporting') {
  const labelRef = useRef<HTMLParagraphElement>(null);
  const pngRef = useRef<HTMLButtonElement>(null);
  const pdfRef = useRef<HTMLButtonElement>(null);
  const startedBy = useRef<ExportFormat>('png');
  const previous = useRef(screenName);

  useEffect(() => {
    if (previous.current === screenName) return;
    previous.current = screenName;
    if (screenName === 'exporting') {
      labelRef.current?.focus();
    } else {
      (startedBy.current === 'pdf' && pdfRef.current ? pdfRef : pngRef).current?.focus();
    }
  }, [screenName]);

  const rememberStarter = useCallback((format: ExportFormat) => {
    startedBy.current = format;
  }, []);

  return { labelRef, pngRef, pdfRef, rememberStarter };
}

/**
 * The stage's height at desktop widths, where the page is one viewport tall and the preview must
 * fit it (1440 × 900 leaves less than 800px). `null` below 900px, where the stage is as tall as
 * the preview and only its width limits it (PosterPreview fits the container's width itself).
 */
function useStageHeight(): [Ref<HTMLDivElement>, number | null] {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const stage = ref.current;
    if (!desktop || !stage || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (stage.clientHeight > 0) setHeight(stage.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }, [desktop]);

  return [ref, desktop ? height : null];
}
