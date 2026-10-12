import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { posterLayout } from '../../poster/layout';
import { posterSizeById } from '../../poster/sizes';
import type { PosterSize } from '../../poster/sizes';
import { POSTER_STYLES } from '../../poster/styles';
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
import { realLoadFigureTerrain } from '../hooks';
import type { LoadFigureTerrain } from '../hooks';
import { PageShell } from '../PageShell/PageShell';
import type { Run, Terrain } from '../types';
import { useMediaQuery } from '../ViewState/useMediaQuery';
import { buildExportJob, defaultExporter } from './exporter';
import type { ExportFormat, Exporter } from './exporter';
import { ExportNotice, ExportProgress } from './ExportProgress';
import { useReleaseTerrainFigure } from './figureHooks';
import { FigureRetryRow, RETRY_ROW_PX, RETRY_SIDE_MIN_PX, useFigureRetry } from './FigureRetry';
import type { RetrySide } from './FigureRetry';
import { LivePoster, usesViewTerrain } from './LivePoster';
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
  /**
   * The run's terrain (`useTerrain()`): style A's figure is drawn from its height grid. Default
   * idle (the figure shows its loading note).
   */
  terrain?: Terrain;
  /** Builds the Night Ridge and Survey Quad figures' height grids (`useFigureTerrainLoader()`). */
  loadFigureTerrain?: LoadFigureTerrain;
  /**
   * Builds the run's terrain again (`useRetryTerrain()`): Try again and Download use it when style
   * A's figure is drawn from that grid and it failed. Without it that figure offers no Try again.
   */
  onRetryTerrain?: () => void;
}

const IDLE_TERRAIN: Terrain = { status: 'idle' };

/** Raster figures are drawn at most at this many device px per CSS px. */
const MAX_PIXEL_RATIO = 2;

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

const formatMetres = (value: number) => `${String(value)} m`;
const metresText = (value: number) => `${String(value)} metres`;

/**
 * Poster mode (DESIGN-SPEC §3 "03 Poster mode", canvas PosterMode frame). Aside: style, size,
 * text, stats and hide-ends, then the sticky Download block. Main: the live poster preview on the
 * grey stage. Download runs `exporter`; while it runs (`exporting`, DESIGN-SPEC §3 "04 Exporting")
 * the progress shows under the Download button and every control that could change the output is
 * disabled. The preview is live (`LivePoster`): the terrain figure follows the camera the View
 * was left at, the exaggeration and the hidden ends, re-rendered as they change.
 */
export function PosterState({
  run,
  screen,
  prefs,
  dispatch,
  headingRef,
  exporter = defaultExporter,
  terrain = IDLE_TERRAIN,
  loadFigureTerrain = realLoadFigureTerrain,
  onRetryTerrain,
}: PosterStateProps) {
  const { poster } = prefs;
  const size = posterSizeById(poster.size);
  const content = posterContentFromRun(run, prefs);
  const [stageRef, stage] = useStageSize();
  const exporting = screen.name === 'exporting';
  const { start, cancel, cancelled, slow } = useExport(exporter, dispatch);
  const { labelRef, pngRef, pdfRef, rememberStarter } = useExportFocus(screen.name);
  const fromViewTerrain = useMemo(
    () => usesViewTerrain(run.track, poster.style, poster.hideEnds),
    [run.track, poster.style, poster.hideEnds],
  );
  const figureRetry = useFigureRetry(poster.style, fromViewTerrain, onRetryTerrain);
  // When the Try again row goes with focus in it: Download PNG, or while it is disabled (an
  // export runs) the export's progress label, where Download put focus.
  const focusAfterRetry = useCallback(() => {
    const png = pngRef.current;
    if (png && !png.disabled) png.focus();
    else labelRef.current?.focus();
  }, [pngRef, labelRef]);
  const retryPlace = retryPlacement(size, stage, figureRetry.row !== null);
  const busyNoteId = useId();
  const [previewScale, setPreviewScale] = useState(1);
  const pixelScale = figurePixelScale(previewScale);
  useReleaseTerrainFigure();

  const download = (format: ExportFormat) => {
    rememberStarter(format);
    start(buildExportJob(run, prefs, format, { terrain, loadFigureTerrain }));
    // A failed preview figure asks again too, through the same loader, so that it shows what the
    // file shows; free when the export's grid is cached, never waited for by the export.
    figureRetry.retryQuietly();
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
          {statusText(screen, cancelled, slow)}
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
          maxHeight={retryPlace.maxHeight}
          onScale={setPreviewScale}
        >
          <LivePoster
            run={run}
            prefs={prefs}
            size={size}
            content={content}
            terrain={terrain}
            loadFigureTerrain={loadFigureTerrain}
            pixelScale={pixelScale}
            onFigureStatus={figureRetry.onFigureStatus}
            figureAttempt={figureRetry.attempt}
          />
        </PosterPreview>
        <FigureRetryRow retry={figureRetry} focusAfter={focusAfterRetry} side={retryPlace.side} />
      </div>
    </PageShell>
  );
}

/**
 * Output px per logical px for the preview's raster figure: the preview's scale times the device
 * pixel ratio (at most 2), in steps of 1/20 so a sub-pixel resize does not re-render it, rounded
 * up so the canvas is never stretched (blurred) to fill its box.
 */
export function figurePixelScale(previewScale: number): number {
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  // The epsilon keeps an exact step (0.5 × 2 = 1) from rounding up to the next one.
  return Math.max(0.05, Math.ceil(previewScale * ratio * 20 - 1e-6) / 20);
}

/**
 * The status region's text: the export's start (and its milestones once it is `slow`), then how it
 * ended.
 */
function statusText(
  screen: PosterScreen | ExportingScreen,
  cancelled: boolean,
  slow: boolean,
): string {
  if (screen.name === 'exporting') {
    return exportAnnouncement(screen.progress, screen.fileName, slow);
  }
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
 * Where the Try again row goes so the preview keeps its size (and the poster its layout): under the
 * preview when the stage has the room (always below 900px, where the page scrolls); beside the
 * poster's bottom edge when the poster fills the stage's height and leaves enough width on its
 * side; otherwise under it, the preview giving up the row's height.
 */
function retryPlacement(
  size: PosterSize,
  stage: StageSize | null,
  shown: boolean,
): { maxHeight: number; side: RetrySide | null } {
  const maxHeight = Math.min(PREVIEW_MAX.height, stage?.height ?? PREVIEW_MAX.height);
  if (!shown || !stage) return { maxHeight, side: null };
  const layout = posterLayout(size);
  const width = Math.min(
    PREVIEW_MAX.width,
    (maxHeight * layout.width) / layout.height,
    stage.width,
  );
  const height = (width * layout.height) / layout.width;
  if (stage.height - height >= RETRY_ROW_PX) return { maxHeight, side: null };
  const room = (stage.width - width) / 2;
  if (room >= RETRY_SIDE_MIN_PX) {
    return {
      maxHeight,
      side: { right: room + width + RETRY_SIDE_GAP_PX, width: room - RETRY_SIDE_GAP_PX },
    };
  }
  return { maxHeight: maxHeight - RETRY_ROW_PX, side: null };
}

/** Between the poster and the Try again row beside it, px. */
const RETRY_SIDE_GAP_PX = 16;

interface StageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The stage's size at desktop widths, where the page is one viewport tall and the preview must
 * fit it (1440 × 900 leaves less than 800px). `null` below 900px, where the stage is as tall as
 * the preview and only its width limits it (PosterPreview fits the container's width itself).
 */
function useStageSize(): [Ref<HTMLDivElement>, StageSize | null] {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<StageSize | null>(null);

  useLayoutEffect(() => {
    const stage = ref.current;
    if (!desktop || !stage || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = stage;
      if (height > 0) {
        setSize((previous) =>
          previous?.width === width && previous.height === height ? previous : { width, height },
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }, [desktop]);

  return [ref, desktop ? size : null];
}
