import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { trimTrack } from '../../gpx/trim';
import {
  NIGHT_RIDGE_ROWS,
  nightRidgeFigureData,
  quadBounds,
  ridgeBounds,
  surveyQuadFigureData,
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
import type { PosterContent } from '../../poster/types';
import type { ViewCamera } from '../../terrain/camera';
import type { LoadFigureTerrain } from '../hooks';
import type { Prefs } from '../state';
import type { Run, RunTrack, Terrain } from '../types';
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
 * markers begin and end that far in, so the poster never shows where the run starts. The stats
 * and the elevation strip keep the whole run.
 */
export function LivePoster(props: LivePosterProps) {
  const { run, prefs } = props;
  const { hideEnds } = prefs.poster;
  // null when nothing would be left: the route is not drawn at all.
  const drawnTrack = useMemo(() => trimTrack(run.track, hideEnds), [run.track, hideEnds]);
  switch (prefs.poster.style) {
    case 'A':
      return <TrailSignLive {...props} drawnTrack={drawnTrack} />;
    case 'B':
      return <NightRidgeLive {...props} drawnTrack={drawnTrack} />;
    case 'E':
      return <SurveyQuadLive {...props} drawnTrack={drawnTrack} />;
  }
}

type LiveProps = LivePosterProps & { drawnTrack: RunTrack | null };

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

function TrailSignLive({ content, size, terrain, prefs, drawnTrack, pixelScale }: LiveProps) {
  const [box, setBox] = useState<FigureBoxSize | null>(null);
  const heightfield = terrain.status === 'ready' ? terrain.heightfield : null;
  const figure = useTerrainFigure({
    heightfield,
    track: drawnTrack,
    camera: prefs.poster.camera,
    exaggeration: prefs.exaggeration,
    box,
    pixelScale,
  });
  const node =
    terrain.status === 'error' || figure.status === 'error' ? (
      <FigureNote text={FIGURE_ERROR_TEXT} style="A" />
    ) : figure.status === 'ready' ? (
      <FigureCanvas canvas={figure.canvas} version={figure.version} camera={prefs.poster.camera} />
    ) : (
      <FigureNote text={FIGURE_LOADING_TEXT} style="A" />
    );
  return <TrailSignPoster content={content} size={size} figure={node} onFigureBox={setBox} />;
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

function NightRidgeLive({ run, content, size, prefs, drawnTrack, loadFigureTerrain }: LiveProps) {
  const fonts = usePosterFonts('B', posterText(content), Boolean(content.subtitle));
  const [reported, setBox] = useState<NightRidgeBox | null>(null);
  // Typing the title moves the text's line boxes: lay the ridges out once it settles.
  const box = useDebounced(reported, boxKey(reported));
  const kind = posterLayout(size).kind;
  const stageW = box ? round10(box.width) : 0;
  const stageH = box ? round10(box.height) : 0;
  const textBottom = box ? round10(Math.max(0, ...box.keepOut.map((r) => r.y + r.height))) : 0;
  const bounds = useMemo(
    () =>
      stageW > 0 && stageH > 0
        ? ridgeBounds(run.bounds, {
            width: stageW,
            height: stageH,
            keepOut: [{ x: 0, y: 0, width: 1, height: textBottom }],
          })
        : null,
    [run.bounds, stageW, stageH, textBottom],
  );
  const grid = useFigureHeightfield(bounds, loadFigureTerrain);
  const data = useMemo(
    () =>
      nightRidgeFigureData(run, grid.heightfield, box, {
        exaggeration: prefs.exaggeration,
        rows: NIGHT_RIDGE_ROWS[kind],
        drawnTrack,
      }),
    [run, grid.heightfield, box, prefs.exaggeration, kind, drawnTrack],
  );
  if (!fonts) return <LoadingPoster style="B" size={size} />;
  return (
    <NightRidgePoster
      content={content}
      size={size}
      figureData={data}
      onFigureBox={setBox}
      figure={
        <FigureNote
          text={grid.status === 'error' ? FIGURE_ERROR_TEXT : FIGURE_LOADING_TEXT}
          style="B"
        />
      }
    />
  );
}

function SurveyQuadLive({ run, content, size, prefs, drawnTrack, loadFigureTerrain }: LiveProps) {
  const fonts = usePosterFonts('E', posterText(content), Boolean(content.subtitle));
  const [reported, setBox] = useState<FigureBoxSize | null>(null);
  const box = useDebounced(reported, boxKey(reported));
  const layout = posterLayout(size).kind;
  // The aspect to two decimals, so a sub-pixel relayout does not rebuild the height grid.
  const aspect = box && box.height > 0 ? Math.round((box.width / box.height) * 100) / 100 : null;
  const bounds = useMemo(
    () => (aspect ? quadBounds(run.bounds, aspect) : null),
    [run.bounds, aspect],
  );
  const grid = useFigureHeightfield(bounds, loadFigureTerrain);
  const data = useMemo(
    () =>
      surveyQuadFigureData(run, grid.heightfield, box, {
        units: prefs.units,
        layout,
        drawnTrack,
      }),
    [run, grid.heightfield, box, prefs.units, layout, drawnTrack],
  );
  if (!fonts) return <LoadingPoster style="E" size={size} />;
  return (
    <SurveyQuadPoster
      content={content}
      size={size}
      figureData={data}
      onFigureBox={setBox}
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
