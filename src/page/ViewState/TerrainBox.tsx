import {
  Component,
  Suspense,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ReactNode, Ref, RefObject } from 'react';
import { Button, Marker } from '../../components';
import type { ViewCamera } from '../../terrain/camera';
import type { Heightfield } from '../../terrain/heightfield';
import type { ScreenRect } from '../../terrain/stage';
import type { TerrainViewHandle } from '../../terrain/TerrainView';
import { TERRAIN_TOO_LARGE_ERROR } from '../hooks';
import { PERF_MARKS, perfMark } from '../perfMarks';
import { TerrainChunkError, createLazyTerrainView } from '../terrainChunk';
import type { RunTrack, Terrain } from '../types';
import styles from './TerrainBox.module.css';
import { isLoop } from './viewCopy';

/** Shown in the box while the tiles or the terrain code load, until the first frame is drawn. */
export const TERRAIN_LOADING_TEXT = 'Loading terrain…';

/** The browser has no usable WebGL (or the view crashed while drawing). */
export const TERRAIN_DRAW_ERROR =
  "This browser couldn't draw the 3D terrain. Your stats and profile are all here.";

/** The terrain view's code (its own chunk) did not download. */
export const TERRAIN_CHUNK_ERROR =
  "Vert couldn't load the 3D view. Check your connection and try again.";

/** Read out (politely, not shown) when the terrain is back after Try again. */
export const TERRAIN_RECOVERED_TEXT = 'Terrain loaded.';

/** One Rotate view press: an eighth of a turn. */
export const ROTATE_STEP = Math.PI / 4;

/** Gap the stage keeps between an overlay and the model is its own (12 px); see `TerrainView`. */
const NO_OVERLAYS: readonly ScreenRect[] = [];

export interface TerrainBoxProps {
  /** `useTerrain()`: loading, ready with the height grid, or an error message. */
  terrain: Terrain;
  /** Builds the terrain again (`useRetryTerrain()`), for "Try again". */
  onRetry: () => void;
  /** The run's points, draped on the terrain with ○ start and ▲ summit. */
  track: RunTrack;
  /** Scrub position, metres along the route (shared with the elevation profile). */
  scrub: number;
  /** Vertical exaggeration, 1–3 (the slider). */
  exaggeration: number;
  /** The canvas's accessible name (`terrainLabel`). */
  ariaLabel: string;
  /** Legend's summit entry, e.g. "Summit 1,267 m"; `null` when the run has no summit (no ▲). */
  summit: string | null;
  /** Legend's exaggeration entry, e.g. "Vertical ×1.6". */
  exaggerationLabel: string;
  /** Whether the flat (top-down) map is showing; the Flat map button's pressed state. */
  flat: boolean;
  /** Where the terrain's camera starts, with no intro (see `TerrainView`); default the intro. */
  initialCamera?: ViewCamera;
  onToggleFlat: () => void;
  /**
   * Below 600px (DECISIONS "Terrain overlays"): the legend chip and the buttons move out of the box
   * into a row under it, so nothing covers the model on a phone.
   */
  overlaysBelow: boolean;
  /**
   * Reads the terrain's camera as the user left it, for "Make a poster" (null until the terrain
   * view has loaded).
   */
  cameraRef?: Ref<TerrainCameraSource>;
}

/** What the page reads from the View's terrain when it opens Poster mode. */
export interface TerrainCameraSource {
  camera(): ViewCamera | null;
}

/**
 * The terrain's frame in the View state (Main frame): a `--surface` panel with the live
 * `TerrainView` (lazy-loaded, its own chunk), the legend chip top-left and the Rotate / Flat map
 * buttons bottom-right over it. While the tiles or the code load it says "Loading terrain…"; on an
 * error it shows the message and "Try again". If some tiles failed (filled from neighbours), a mono
 * line under the box says so.
 *
 * Tab order: the terrain (arrow keys orbit), then Rotate view, then Flat map, at every width. Below
 * 600px the chip (plain text) and the buttons sit in a row under the box, chip first, so the order
 * stays the same as when they overlay it. Until the terrain is drawn (loading, error, no WebGL)
 * Rotate view and Flat map stay in the Tab order but are `aria-disabled`, described by the status
 * text that says why.
 *
 * Focus ring: the box draws the terrain's ring (its own outline is outside its rounded clip, which
 * would cut the view's). After "Try again", focus follows the terrain: the loading text, then the
 * terrain once drawn (with a polite "Terrain loaded."), or Try again if it failed again.
 */
export function TerrainBox({
  terrain,
  onRetry,
  track,
  scrub,
  exaggeration,
  ariaLabel,
  summit,
  exaggerationLabel,
  flat,
  initialCamera,
  onToggleFlat,
  overlaysBelow,
  cameraRef,
}: TerrainBoxProps) {
  const viewRef = useRef<TerrainViewHandle>(null);
  useImperativeHandle(cameraRef, () => ({ camera: () => viewRef.current?.camera() ?? null }), []);
  const boxRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLParagraphElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const overlays = useOverlayRects(overlaysBelow, boxRef, legendRef, controlsRef);

  // The lazy component and the error boundary are remade on "Try again" after a render failure
  // (React.lazy keeps a failed import for good).
  const [LazyTerrainView, setLazyTerrainView] = useState(createLazyTerrainView);
  const [viewError, setViewError] = useState<string | null>(null);
  const [boundaryKey, setBoundaryKey] = useState(0);
  // The view mounts with the View, before the tiles are in (heightfield null draws nothing), so
  // its chunk and WebGL context load in parallel with the tiles and a ready grid is just a prop.
  // Which height grid has its first frame on screen: until then the loading text stays up.
  const [drawn, setDrawn] = useState<Heightfield | null>(null);

  const heightfield = terrain.status === 'ready' ? terrain.heightfield : null;
  const error = viewError ?? (terrain.status === 'error' ? terrain.error : null);
  const loading = !error && (heightfield === null || drawn !== heightfield);
  // A route too large to fetch tiles for fails the same way every time: no Try again.
  const retryable = viewError !== null || error !== TERRAIN_TOO_LARGE_ERROR;
  const ready = !error && !loading;

  // After Try again, focus follows the terrain instead of dropping to the page (the button goes):
  // the loading text, then the terrain once drawn, or Try again if it failed again.
  const [retries, setRetries] = useState(0);
  const focusFollows = useRef(false);
  useEffect(() => {
    if (!focusFollows.current) return;
    if (error) {
      retryRef.current?.focus();
      focusFollows.current = false;
    } else if (loading) {
      statusRef.current?.focus();
    } else {
      viewRef.current?.focus();
      focusFollows.current = false;
    }
  }, [retries, error, loading]);
  // Read out (the status is a polite live region) once a retry has drawn the terrain.
  const announcement = ready && retries > 0 ? TERRAIN_RECOVERED_TEXT : '';

  const retry = () => {
    focusFollows.current = true;
    setRetries((count) => count + 1);
    if (viewError) {
      setViewError(null);
      setDrawn(null);
      setLazyTerrainView(() => createLazyTerrainView());
      setBoundaryKey((key) => key + 1);
    }
    if (terrain.status === 'error') onRetry();
  };

  const loop = isLoop(track);

  const legend = (
    // The markers are drawn shapes; the words next to them carry the meaning.
    <p ref={legendRef} className={styles.legend}>
      {loop ? (
        <span className={styles.entry}>
          <Marker kind="start" size={12} />
          Start / finish
        </span>
      ) : (
        <>
          <span className={styles.entry}>
            <Marker kind="start" size={12} />
            Start
          </span>
          <span className={styles.entry}>
            <Marker kind="finish" size={12} />
            Finish
          </span>
        </>
      )}
      {summit !== null && (
        <span className={styles.entry}>
          <Marker kind="summit" size={12} />
          {summit}
        </span>
      )}
      <span className={styles.entry}>{exaggerationLabel}</span>
    </p>
  );

  // Not ready: still focusable and named, but inert, and described by the status text (why).
  const unavailable = ready
    ? {}
    : ({ 'aria-disabled': true, 'aria-describedby': statusId } as const);

  const controls = (
    <div ref={controlsRef} className={styles.controls}>
      <Button
        variant="icon"
        aria-label="Rotate view"
        {...unavailable}
        onClick={() => {
          if (ready) viewRef.current?.rotateBy(ROTATE_STEP);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
          focusable="false"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </svg>
      </Button>
      <Button
        variant="icon"
        aria-label="Flat map"
        aria-pressed={flat}
        {...unavailable}
        onClick={() => {
          if (ready) onToggleFlat();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
          <path d="M9 3v15M15 6v15" />
        </svg>
      </Button>
    </div>
  );

  const failed = terrain.status === 'ready' ? terrain.failedTiles.length : 0;

  return (
    <div className={[styles.frame, overlaysBelow && styles.below].filter(Boolean).join(' ')}>
      <div ref={boxRef} className={styles.box}>
        <div className={styles.content}>
          {error ? null : (
            <ViewBoundary
              key={boundaryKey}
              onError={(caught) => {
                setViewError(
                  caught instanceof TerrainChunkError ? TERRAIN_CHUNK_ERROR : TERRAIN_DRAW_ERROR,
                );
              }}
            >
              <Suspense fallback={null}>
                <LazyTerrainView
                  ref={viewRef}
                  className={styles.terrain}
                  heightfield={heightfield}
                  exaggeration={exaggeration}
                  view={flat ? 'flat' : 'oblique'}
                  initialCamera={initialCamera}
                  track={track}
                  scrub={scrub}
                  overlays={overlays}
                  ariaLabel={ariaLabel}
                  onReady={() => {
                    if (!heightfield) return;
                    perfMark(PERF_MARKS.firstFrame);
                    setDrawn(heightfield);
                  }}
                />
              </Suspense>
            </ViewBoundary>
          )}
          {/*
           * One polite live region for the loading text and the error, so changes are read out.
           * Focusable from script only: focus waits here after Try again while the terrain loads.
           */}
          <div className={styles.status}>
            <p
              ref={statusRef}
              id={statusId}
              className={error ? styles.error : styles.loading}
              role="status"
              tabIndex={-1}
            >
              {error ?? (loading ? TERRAIN_LOADING_TEXT : '')}
              {announcement ? <span className={styles.visuallyHidden}>{announcement}</span> : null}
            </p>
            {error && retryable ? (
              <Button ref={retryRef} variant="quiet" className={styles.retry} onClick={retry}>
                Try again
              </Button>
            ) : null}
          </div>
        </div>
        {overlaysBelow ? null : legend}
        {overlaysBelow ? null : controls}
      </div>
      {overlaysBelow ? (
        <div className={styles.overlayRow}>
          {legend}
          {controls}
        </div>
      ) : null}
      {failed > 0 && terrain.status === 'ready' ? (
        <p className={styles.note}>{failedTilesText(failed, terrain.totalTiles)}</p>
      ) : null}
    </div>
  );
}

/** "2 of 12 elevation tiles didn't load; that part of the terrain is filled in from around it." */
export function failedTilesText(failed: number, total: number): string {
  const tiles = total === 1 ? 'tile' : 'tiles';
  return (
    `${String(failed)} of ${String(total)} elevation ${tiles} didn't load; ` +
    'that part of the terrain is filled in from around it.'
  );
}

/**
 * The overlays' rectangles on the box (TerrainView `overlays`), CSS px from its top-left corner:
 * the legend chip (its height grows when it wraps) and the buttons. The stage keeps the model 12px
 * clear of each and lets it fill the rest of the box. Below 600px the overlays are under the box,
 * so there are none.
 */
function useOverlayRects(
  overlaysBelow: boolean,
  boxRef: RefObject<HTMLDivElement | null>,
  legendRef: RefObject<HTMLParagraphElement | null>,
  controlsRef: RefObject<HTMLDivElement | null>,
): readonly ScreenRect[] {
  const [measured, setMeasured] = useState<readonly ScreenRect[]>(NO_OVERLAYS);
  useEffect(() => {
    const box = boxRef.current;
    const legend = legendRef.current;
    const controls = controlsRef.current;
    if (overlaysBelow || !box || !legend || !controls) return undefined;
    // Rounded outward to whole pixels, so sub-pixel layout never lets the model creep closer.
    const rectOf = (element: HTMLElement): ScreenRect => {
      const x = Math.floor(element.offsetLeft);
      const y = Math.floor(element.offsetTop);
      return {
        x,
        y,
        width: Math.ceil(element.offsetLeft + element.offsetWidth) - x,
        height: Math.ceil(element.offsetTop + element.offsetHeight) - y,
      };
    };
    const measure = () => {
      const next = [rectOf(legend), rectOf(controls)];
      setMeasured((previous) =>
        previous.length === next.length &&
        previous.every((rect, k) => {
          const now = next[k];
          return (
            rect.x === now?.x &&
            rect.y === now.y &&
            rect.width === now.width &&
            rect.height === now.height
          );
        })
          ? previous
          : next,
      );
    };
    const frame = requestAnimationFrame(measure);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(measure);
      observer.observe(box);
      observer.observe(legend);
      observer.observe(controls);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [overlaysBelow, boxRef, legendRef, controlsRef]);
  return overlaysBelow ? NO_OVERLAYS : measured;
}

interface ViewBoundaryProps {
  children: ReactNode;
  onError: (error: unknown) => void;
}

/**
 * Catches a failure to load the terrain chunk (offline) or to draw (no WebGL), so the rest of the
 * View keeps working; the box then shows the error and "Try again".
 */
class ViewBoundary extends Component<ViewBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
