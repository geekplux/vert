import { useLayoutEffect, useRef, useState } from 'react';
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
import { PendingStylePoster } from './PendingStylePoster';
import { PLACEHOLDER_EXPORT_TILES, offersPdf, pngButtonLabel, posterFileName } from './posterCopy';
import styles from './PosterState.module.css';

/** The events Poster mode sends: poster settings, and the poster / exporting screen events. */
export type PosterStateAction = PrefsEvent | ScreenEvent<'poster'> | ScreenEvent<'exporting'>;

export interface PosterStateProps {
  run: Run;
  /** `poster`, or `exporting` (the overlay on poster mode; phase 2 task f draws it). */
  screen: PosterScreen | ExportingScreen;
  prefs: Prefs;
  dispatch: Dispatch<PosterStateAction>;
  /** The screen's h1; the page focuses it when Poster mode opens (DECISIONS "Focus"). */
  headingRef?: Ref<HTMLHeadingElement>;
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
 * grey stage. Phase 2: the figure is the sample terrain illustration and Download only starts the
 * state machine's export (phase 3 renders the terrain and the file).
 */
export function PosterState({ run, screen, prefs, dispatch, headingRef }: PosterStateProps) {
  const { poster } = prefs;
  const size = posterSizeById(poster.size);
  const style = posterStyleById(poster.style);
  const content = posterContentFromRun(run, prefs);
  const [stageRef, stageHeight] = useStageHeight();

  const download = (extension: 'png' | 'pdf') => {
    dispatch({
      type: 'EXPORT_STARTED',
      total: PLACEHOLDER_EXPORT_TILES,
      fileName: posterFileName(content.title, size.id, extension),
    });
  };

  const aside = (
    <>
      <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
        Make a poster
      </h1>

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

      <div className={styles.downloads}>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            download('png');
          }}
        >
          {pngButtonLabel(size)}
        </Button>
        {offersPdf(size) ? (
          <Button
            variant="secondary"
            onClick={() => {
              download('pdf');
            }}
          >
            Download PDF for print
          </Button>
        ) : (
          <p className={styles.note}>PDF is offered for the print sizes, 18 × 24 in and A3.</p>
        )}
        <p className={styles.note}>
          Rendered in your browser in tiles. Large sizes take a few seconds.
        </p>
        {screen.name === 'exporting' ? (
          // PHASE 2 PLACEHOLDER: task f replaces this with the export overlay (progress, Cancel).
          <div className={styles.exporting}>
            <p className={styles.note} role="status">
              Exporting {screen.fileName}. Placeholder: the export overlay is built in a later task.
            </p>
            <Button
              variant="quiet"
              onClick={() => {
                dispatch({ type: 'EXPORT_CANCELLED' });
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}
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
