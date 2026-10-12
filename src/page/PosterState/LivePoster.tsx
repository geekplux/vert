import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { trimTrack } from '../../gpx/trim';
import {
  NIGHT_RIDGE_ROWS,
  figureFrameBounds,
  nightRidgeFigureData,
  padBounds,
  quadBounds,
  ridgeBounds,
  surveyQuadFigureData,
  trackBounds,
} from '../../poster/figures';
import { posterLayout } from '../../poster/layout';
import { NightRidgePoster } from '../../poster/NightRidgePoster';
import type { NightRidgeBox } from '../../poster/NightRidgePoster';
import type { PosterSize } from '../../poster/sizes';
import { NIGHT_RIDGE_PALETTE, POSTER_STYLES, SURVEY_QUAD_PALETTE } from '../../poster/styles';
import type { PosterStyleId } from '../../poster/styles';
import { SurveyQuadPoster } from '../../poster/SurveyQuadPoster';
import { TrailSignPoster } from '../../poster/TrailSignPoster';
import type { FigureBoxSize } from '../../poster/TrailSignPoster';
import type { TerrainFigureScene } from '../../poster/terrainFigure';
import type { PosterContent } from '../../poster/types';
import type { Bounds } from '../../lib/geo';
import type { ViewCamera } from '../../terrain/camera';
import { HeightfieldTooLargeError } from '../../terrain/heightfield';
import { TERRAIN_TOO_LARGE_ERROR } from '../hooks';
import type { LoadFigureTerrain } from '../hooks';
import type { Prefs } from '../state';
import type { Run, RunTrack, Terrain } from '../types';
import type { FigureHeightfieldState } from './figureHooks';
import {
  useDebounced,
  useFigureHeightfield,
  usePosterFonts,
  useTerrainFigure,
} from './figureHooks';
import { styleTitle } from './posterCopy';
import styles from './PosterState.module.css';

export interface LivePosterProps {
  run: Run;
  prefs: Prefs;
  size: PosterSize;
  /** The poster's text and stats (`posterContentFromRun`). */
  content: PosterContent;
  /** The run's terrain (`useTerrain()`): style A's figure is drawn from it. */
  terrain: Terrain;
  /** Builds the B and E figures' own height grids. */
  loadFigureTerrain: LoadFigureTerrain;
  /** Output px per logical px for raster figures (the preview's scale × device pixel ratio). */
  pixelScale: number;
  /**
   * Set when the poster is rendered for export (`posterExporter.ts`), to the export scale
   * (`posterLayout(size).scale`): Night Ridge and Survey Quad sample their lines for it
   * (`detailScale`) and lay out for the box at once (no debounce), the fonts are already loaded
   * (no loading card), and style A draws no figure of its own: the exporter composites the
   * terrain over the figure slot, tile by tile, from the scene `onFigureStatus` reports.
   */
  exportScale?: number;
  /**
   * The figure's state, whenever it changes: the exporter waits for `ready`; Poster mode offers
   * Try again on an `error`.
   */
  onFigureStatus?: (status: PosterFigureStatus) => void;
  /**
   * Raised to ask for a failed figure grid again (Try again, Download): the B and E grids, and
   * style A's own grid with the ends hidden. Style A's View grid is retried by the run's terrain
   * (`useRetryTerrain()`), see {@link usesViewTerrain}.
   */
  figureAttempt?: number;
}

/**
 * Where an exported poster's figure is: `loading` (its height grid is on its way, or it is being
 * laid out), `ready` (B and E: drawn into the poster; A: `scene` is what the exporter renders),
 * or `error` (its terrain could not be built).
 */
export type PosterFigureStatus =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      /** Style A: what the exporter's terrain layer draws. */
      readonly scene?: TerrainFigureScene;
      /** B and E: the figure drawn (a new one means the poster was laid out again). */
      readonly figure?: unknown;
    }
  | {
      readonly status: 'error';
      /** The area is too large to fetch tiles for (`HeightfieldTooLargeError`): no retry helps. */
      readonly tooLarge?: boolean;
    };

const FIGURE_LOADING: PosterFigureStatus = { status: 'loading' };
const FIGURE_ERROR: PosterFigureStatus = { status: 'error' };
const FIGURE_TOO_LARGE: PosterFigureStatus = { status: 'error', tooLarge: true };

/** Reports `status` (memoized by the caller) to `onFigureStatus` whenever it changes. */
function useReportFigure(
  onFigureStatus: ((status: PosterFigureStatus) => void) | undefined,
  status: PosterFigureStatus,
) {
  useEffect(() => {
    onFigureStatus?.(status);
  }, [onFigureStatus, status]);
}

/**
 * B and E: ready once their own grid is in and the figure is laid out from it; an error says
 * whether the area is too large to fetch (Poster mode offers no Try again then).
 */
function useSvgFigureStatus(grid: FigureHeightfieldState, figure: unknown): PosterFigureStatus {
  const tooLarge = grid.status === 'error' && grid.error instanceof HeightfieldTooLargeError;
  return useMemo(
    () =>
      grid.status === 'error'
        ? tooLarge
          ? FIGURE_TOO_LARGE
          : FIGURE_ERROR
        : grid.status === 'ready' && figure
          ? { status: 'ready', figure }
          : FIGURE_LOADING,
    [grid.status, tooLarge, figure],
  );
}

/**
 * The style A figure's own height-grid bounds: with the ends hidden, the drawn route's bounds
 * padded as the View's (the View's grid frames the whole run, start and finish included); null
 * to use the View's grid.
 */
export function trailSignOwnBounds(drawnTrack: RunTrack | null, hideEnds: number): Bounds | null {
  const drawn = hideEnds > 0 && drawnTrack ? trackBounds(drawnTrack) : null;
  return drawn ? padBounds(drawn) : null;
}

/**
 * Whether the poster's figure is drawn from the View's grid (`useTerrain()`): style A with the
 * whole route drawn. Every other figure has a grid of its own (`useFigureHeightfield`).
 */
export function usesViewTerrain(track: RunTrack, style: PosterStyleId, hideEnds: number): boolean {
  if (style !== 'A') return false;
  if (hideEnds <= 0) return true;
  return trailSignOwnBounds(trimTrack(track, hideEnds), hideEnds) === null;
}

/** In the figure box while the terrain loads: a quiet line in the poster's own ink. */
export const FIGURE_LOADING_TEXT = 'Drawing the terrain…';
/** In the figure box when the terrain cannot be drawn. */
export const FIGURE_ERROR_TEXT = 'The terrain couldn’t be drawn.';

/**
 * The poster in the chosen style with its live figure (DESIGN-SPEC §3 "the poster preview …
 * live"): style A's three.js terrain from the View's camera, Night Ridge's ridgelines and Survey
 * Quad's contour map from height grids built for their figure boxes. Every style draws the route
 * without its hidden ends (`trimTrack(run.track, hideEnds)`): the line and its start / finish
 * markers begin and end that far in, and the figure is framed on what is drawn
 * (`figureFrameBounds`; style A then builds its own height grid for it), so neither the line nor
 * the margin around it shows where the run starts. The stats and the elevation strip keep the
 * whole run.
 */
export function LivePoster(props: LivePosterProps) {
  const { run, prefs } = props;
  const { hideEnds } = prefs.poster;
  // null when nothing would be left: the route is not drawn at all.
  const drawnTrack = useMemo(() => trimTrack(run.track, hideEnds), [run.track, hideEnds]);
  const frame = useMemo(
    () => figureFrameBounds(run.bounds, drawnTrack, hideEnds),
    [run.bounds, drawnTrack, hideEnds],
  );
  const live = { ...props, drawnTrack, frame };
  switch (prefs.poster.style) {
    case 'A':
      return <TrailSignLive {...live} />;
    case 'B':
      return <NightRidgeLive {...live} />;
    case 'E':
      return <SurveyQuadLive {...live} />;
  }
}

type LiveProps = LivePosterProps & {
  drawnTrack: RunTrack | null;
  /** The bounds the figure is framed on (`figureFrameBounds`). */
  frame: Bounds;
};

/** The figure note's colour per style: the ink each figure's own background carries. */
const NOTE_COLOR: Readonly<Record<PosterStyleId, string>> = {
  A: POSTER_STYLES[0]?.ink ?? 'currentColor',
  B: NIGHT_RIDGE_PALETTE.body,
  E: SURVEY_QUAD_PALETTE.ink,
};

function FigureNote({ text, style }: { text: string; style: PosterStyleId }) {
  return (
    <span
      className={styles.figureNote}
      style={{ color: NOTE_COLOR[style] }}
      data-figure="placeholder"
    >
      {text}
    </span>
  );
}

/**
 * Puts the renderer's canvas in the figure box (React leaves the box's children alone). The
 * camera it was drawn from is on `data-camera` (degrees and zoom), for checks.
 */
function FigureCanvas({
  canvas,
  version,
  camera,
}: {
  canvas: HTMLCanvasElement;
  version: number;
  camera: ViewCamera;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const mount = ref.current;
    if (mount && canvas.parentNode !== mount) mount.replaceChildren(canvas);
  }, [canvas]);
  const degrees = (radians: number) => ((radians * 180) / Math.PI).toFixed(1);
  return (
    <div
      ref={ref}
      className={styles.figureCanvas}
      data-figure="terrain"
      data-version={version}
      data-camera={`${camera.view} ${degrees(camera.azimuth)} ${degrees(camera.polar)} ${camera.zoom.toFixed(3)}`}
    />
  );
}

function TrailSignLive(props: LiveProps) {
  const { content, size, terrain, prefs, drawnTrack, pixelScale, loadFigureTerrain } = props;
  const { exportScale, onFigureStatus, figureAttempt } = props;
  const exporting = exportScale !== undefined;
  const [box, setBox] = useState<FigureBoxSize | null>(null);
  // With the ends hidden, a grid of its own around the drawn route (padded as the View's); the
  // View's grid frames the whole run, start and finish included.
  const hideEnds = prefs.poster.hideEnds;
  const ownBounds = useMemo(() => trailSignOwnBounds(drawnTrack, hideEnds), [hideEnds, drawnTrack]);
  const own = useFigureHeightfield(ownBounds, loadFigureTerrain, figureAttempt);
  const heightfield = ownBounds
    ? own.status === 'ready'
      ? own.heightfield
      : null
    : terrain.status === 'ready'
      ? terrain.heightfield
      : null;
  const gridError = ownBounds ? own.status === 'error' : terrain.status === 'error';
  const tooLarge = ownBounds
    ? own.status === 'error' && own.error instanceof HeightfieldTooLargeError
    : terrain.status === 'error' && terrain.error === TERRAIN_TOO_LARGE_ERROR;
  const figure = useTerrainFigure({
    // Exporting: the exporter draws the figure at the export scale; no preview render.
    heightfield: exporting ? null : heightfield,
    track: drawnTrack,
    camera: prefs.poster.camera,
    exaggeration: prefs.exaggeration,
    box,
    pixelScale,
  });
  const { camera } = prefs.poster;
  const { exaggeration } = prefs;
  const scene = useMemo(
    () => (heightfield ? { heightfield, track: drawnTrack, camera, exaggeration } : null),
    [heightfield, drawnTrack, camera, exaggeration],
  );
  const status = useMemo<PosterFigureStatus>(
    () =>
      gridError
        ? tooLarge
          ? FIGURE_TOO_LARGE
          : FIGURE_ERROR
        : scene
          ? { status: 'ready', scene }
          : FIGURE_LOADING,
    [gridError, tooLarge, scene],
  );
  useReportFigure(onFigureStatus, status);
  const failed = gridError || figure.status === 'error';
  const node = failed ? (
    <FigureNote text={FIGURE_ERROR_TEXT} style="A" />
  ) : figure.status === 'ready' ? (
    <FigureCanvas canvas={figure.canvas} version={figure.version} camera={prefs.poster.camera} />
  ) : (
    <FigureNote text={FIGURE_LOADING_TEXT} style="A" />
  );
  return (
    <TrailSignPoster
      content={content}
      size={size}
      figure={node}
      onFigureBox={setBox}
      figureFailed={failed}
    />
  );
}

/** The text the poster draws, so the font loader fetches every unicode-range subset it needs. */
function posterText(content: PosterContent): string {
  return [content.title, content.subtitle, content.signature, content.date].join(' ');
}

/** Rounds a length to 10 px, so small relayouts do not rebuild a figure's height grid. */
const round10 = (value: number) => Math.round(value / 10) * 10;

const boxKey = (box: FigureBoxSize | NightRidgeBox | null) =>
  box
    ? [
        box.width,
        box.height,
        ...('keepOut' in box ? box.keepOut : []).flatMap((r) => [r.x, r.y, r.width, r.height]),
      ]
        .map((v) => v.toFixed(1))
        .join(',')
    : '';

function NightRidgeLive(props: LiveProps) {
  const { run, content, size, prefs, drawnTrack, frame, loadFigureTerrain } = props;
  const { exportScale, onFigureStatus, figureAttempt } = props;
  const fonts = usePosterFonts('B', posterText(content), Boolean(content.subtitle));
  const [reported, setBox] = useState<NightRidgeBox | null>(null);
  // Typing the title moves the text's line boxes: lay the ridges out once it settles (the export
  // lays out for the box at once).
  const debounced = useDebounced(reported, boxKey(reported));
  const box = exportScale !== undefined ? reported : debounced;
  const kind = posterLayout(size).kind;
  const stageW = box ? round10(box.width) : 0;
  const stageH = box ? round10(box.height) : 0;
  const textBottom = box ? round10(Math.max(0, ...box.keepOut.map((r) => r.y + r.height))) : 0;
  const bounds = useMemo(
    () =>
      stageW > 0 && stageH > 0
        ? ridgeBounds(frame, {
            width: stageW,
            height: stageH,
            keepOut: [{ x: 0, y: 0, width: 1, height: textBottom }],
          })
        : null,
    [frame, stageW, stageH, textBottom],
  );
  const grid = useFigureHeightfield(bounds, loadFigureTerrain, figureAttempt);
  const data = useMemo(
    () =>
      nightRidgeFigureData(run, grid.heightfield, box, {
        exaggeration: prefs.exaggeration,
        rows: NIGHT_RIDGE_ROWS[kind],
        drawnTrack,
        ...(exportScale !== undefined ? { detailScale: exportScale } : {}),
      }),
    [run, grid.heightfield, box, prefs.exaggeration, kind, drawnTrack, exportScale],
  );
  useReportFigure(onFigureStatus, useSvgFigureStatus(grid, data.ridges));
  if (!fonts && exportScale === undefined) return <LoadingPoster style="B" size={size} />;
  return (
    <NightRidgePoster
      content={content}
      size={size}
      figureData={data}
      onFigureBox={setBox}
      figureFailed={grid.status === 'error'}
      figure={
        <FigureNote
          text={grid.status === 'error' ? FIGURE_ERROR_TEXT : FIGURE_LOADING_TEXT}
          style="B"
        />
      }
    />
  );
}

function SurveyQuadLive(props: LiveProps) {
  const { run, content, size, prefs, drawnTrack, frame, loadFigureTerrain } = props;
  const { exportScale, onFigureStatus, figureAttempt } = props;
  const fonts = usePosterFonts('E', posterText(content), Boolean(content.subtitle));
  const [reported, setBox] = useState<FigureBoxSize | null>(null);
  const debounced = useDebounced(reported, boxKey(reported));
  const box = exportScale !== undefined ? reported : debounced;
  const layout = posterLayout(size).kind;
  // The aspect to two decimals, so a sub-pixel relayout does not rebuild the height grid.
  const aspect = box && box.height > 0 ? Math.round((box.width / box.height) * 100) / 100 : null;
  const bounds = useMemo(() => (aspect ? quadBounds(frame, aspect) : null), [frame, aspect]);
  const grid = useFigureHeightfield(bounds, loadFigureTerrain, figureAttempt);
  const data = useMemo(
    () =>
      surveyQuadFigureData(run, grid.heightfield, box, {
        units: prefs.units,
        layout,
        drawnTrack,
        frame,
        // Without terrain the route is still drawn, flat on the quad it was asked for.
        flatBounds: grid.status === 'error' ? bounds : null,
        ...(exportScale !== undefined ? { detailScale: exportScale } : {}),
      }),
    [
      run,
      grid.heightfield,
      grid.status,
      bounds,
      box,
      prefs.units,
      layout,
      drawnTrack,
      frame,
      exportScale,
    ],
  );
  useReportFigure(onFigureStatus, useSvgFigureStatus(grid, data.map));
  if (!fonts && exportScale === undefined) return <LoadingPoster style="E" size={size} />;
  return (
    <SurveyQuadPoster
      content={content}
      size={size}
      figureData={data}
      onFigureBox={setBox}
      figureFailed={grid.status === 'error'}
      figure={
        <FigureNote
          text={grid.status === 'error' ? FIGURE_ERROR_TEXT : FIGURE_LOADING_TEXT}
          style="E"
        />
      }
    />
  );
}

/**
 * While a style's fonts load (a moment, from the same origin): a plain card in the style's paper
 * at the poster's size, so the preview never lays the poster out in a fallback face.
 */
function LoadingPoster({ style, size }: { style: PosterStyleId; size: PosterSize }) {
  const option = POSTER_STYLES.find((candidate) => candidate.id === style);
  const layout = posterLayout(size);
  const box: CSSProperties = {
    width: layout.width,
    height: layout.height,
    background: option?.paper,
    color: option?.ink,
  };
  return (
    <div
      role="img"
      aria-label={`${option ? styleTitle(option) : 'Poster'} preview, loading.`}
      className={styles.loadingPoster}
      style={box}
      data-style={style}
    />
  );
}
