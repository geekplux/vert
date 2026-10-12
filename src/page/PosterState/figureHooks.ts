/**
 * What Poster mode needs to draw the live figures: style A's three.js terrain render (debounced,
 * at the preview's scale), the Night Ridge and Survey Quad figures' own height grids (built for
 * the box each poster reports, cached by bounds), and the B / E poster fonts.
 */
import { useEffect, useRef, useState } from 'react';
import type { Bounds } from '../../lib/geo';
import { loadPosterFonts } from '../../poster/fonts';
import type { PosterStyleId } from '../../poster/styles';
import { loadTerrainFigure, releaseLoadedTerrainFigure } from '../../poster/terrainFigureChunk';
import type { FigureBoxSize } from '../../poster/TrailSignPoster';
import type { ViewCamera } from '../../terrain/camera';
import type { Heightfield } from '../../terrain/heightfield';
import { isAbortError } from '../../terrain/tiles';
import type { LoadFigureTerrain } from '../hooks';
import { PERF_MEASURES, perfMeasure } from '../perfMarks';
import type { RunTrack } from '../types';

/** Figure re-renders wait this long for the inputs to settle (slider drags, typing), ms. */
export const FIGURE_DEBOUNCE_MS = 150;

/**
 * `value`, updated only once it has stayed the same (by `key`) for `delayMs`. The first value with
 * a non-empty key comes through at once (nothing to keep showing until it settles).
 */
export function useDebounced<T>(value: T, key: string, delayMs: number = FIGURE_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState({ value, key });
  const immediate = settled.key === '';
  useEffect(() => {
    if (key === settled.key) return undefined;
    if (immediate) {
      setSettled({ value, key });
      return undefined;
    }
    const timer = setTimeout(() => {
      setSettled({ value, key });
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, key, settled.key, immediate, delayMs]);
  return settled.key === key || immediate ? value : settled.value;
}

// ---------------------------------------------------------------------------------------------
// A · Trail Sign: the three.js terrain figure
// ---------------------------------------------------------------------------------------------

export interface TerrainFigureRequest {
  /** The run's height grid (`useTerrain()`); null while it loads. */
  readonly heightfield: Heightfield | null;
  /** The route as drawn (hidden ends cut off), or none. */
  readonly track: RunTrack | null;
  readonly camera: ViewCamera;
  readonly exaggeration: number;
  /** The figure box, logical px (`onFigureBox`); null until laid out. */
  readonly box: FigureBoxSize | null;
  /** Output px per logical px (the preview's scale × the device pixel ratio). */
  readonly pixelScale: number;
}

export type TerrainFigureState =
  | { readonly status: 'waiting' }
  | { readonly status: 'ready'; readonly canvas: HTMLCanvasElement; readonly version: number }
  | { readonly status: 'error' };

/**
 * Style A's live terrain figure: rendered into one canvas, again (after {@link FIGURE_DEBOUNCE_MS})
 * whenever the box, scale, exaggeration, hidden ends, camera, run or heightfield change. The
 * renderer (three.js) is loaded on first use. `waiting` until the first render, `error` when the
 * renderer cannot load or draw (no WebGL).
 */
export function useTerrainFigure(request: TerrainFigureRequest): TerrainFigureState {
  const { heightfield, track, camera, exaggeration, box, pixelScale } = request;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<TerrainFigureState>({ status: 'waiting' });
  const width = box?.width ?? 0;
  const height = box?.height ?? 0;

  useEffect(() => {
    if (!heightfield || width <= 0 || height <= 0) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      loadTerrainFigure().then(
        (module) => {
          if (!live) return;
          try {
            canvasRef.current ??= document.createElement('canvas');
            const start = performance.now();
            const canvas = module.renderTerrainFigure(
              { heightfield, track, camera, exaggeration, width, height, pixelScale },
              canvasRef.current,
            );
            perfMeasure(PERF_MEASURES.posterFigure, start, {
              width: canvas.width,
              height: canvas.height,
            });
            setState((previous) => ({
              status: 'ready',
              canvas,
              version: previous.status === 'ready' ? previous.version + 1 : 1,
            }));
          } catch (error: unknown) {
            console.error(error);
            setState({ status: 'error' });
          }
        },
        (error: unknown) => {
          console.error(error);
          if (live) setState({ status: 'error' });
        },
      );
    }, FIGURE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [heightfield, track, camera, exaggeration, width, height, pixelScale]);

  // No grid (a new run's still loading): never show the last run's figure.
  return heightfield ? state : WAITING;
}

const WAITING: TerrainFigureState = { status: 'waiting' };

/** Frees the figure renderer's WebGL context when the component (Poster mode) unmounts. */
export function useReleaseTerrainFigure(): void {
  useEffect(
    () => () => {
      releaseLoadedTerrainFigure();
    },
    [],
  );
}

// ---------------------------------------------------------------------------------------------
// B · Night Ridge, E · Survey Quad: their own height grids
// ---------------------------------------------------------------------------------------------

/** Most grids kept per loader (about 1 MB each). */
const FIGURE_CACHE_SIZE = 12;

const figureCaches = new WeakMap<LoadFigureTerrain, Map<string, Promise<Heightfield>>>();

/** Bounds to 5 decimals (≈ 1 m): equal keys build the same grid. */
export function boundsKey(bounds: Bounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((v) => v.toFixed(5)).join(',');
}

/** The grid for `bounds` from `load`, built once per bounds (the last few are kept). */
function figureHeightfield(load: LoadFigureTerrain, bounds: Bounds): Promise<Heightfield> {
  let cache = figureCaches.get(load);
  if (!cache) {
    cache = new Map();
    figureCaches.set(load, cache);
  }
  const key = boundsKey(bounds);
  let promise = cache.get(key);
  if (promise) {
    // Most recently used last.
    cache.delete(key);
  } else {
    // Built to completion even if the box moves on: the grid is cached for when it comes back.
    // A failed grid is evicted (never cached), so the next ask (Try again) builds afresh; the
    // tiles' own timeouts (`TILE_TIMEOUT_MS`) keep a build from hanging for ever.
    const building = load(bounds, new AbortController().signal);
    promise = building;
    building.catch(() => {
      if (cache.get(key) === building) cache.delete(key);
    });
  }
  cache.set(key, promise);
  while (cache.size > FIGURE_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return promise;
}

export type FigureHeightfieldState =
  | { readonly status: 'loading'; readonly heightfield: Heightfield | null }
  | { readonly status: 'ready'; readonly heightfield: Heightfield }
  | { readonly status: 'error'; readonly heightfield: null; readonly error: unknown };

/**
 * The height grid for a poster figure's `bounds` (null until the poster has reported its box).
 * While a new one builds, the last grid stays (so the figure does not blink between boxes). A
 * failure carries the loader's error (`HeightfieldTooLargeError` for an area too large to fetch).
 * A new `attempt` asks again after a failure: a failed grid is not cached, so the loader runs
 * again, unless a build for the same bounds (an export's) is already on its way or done, which
 * is shared. The state is `loading` until that settles.
 */
export function useFigureHeightfield(
  bounds: Bounds | null,
  load: LoadFigureTerrain,
  attempt = 0,
): FigureHeightfieldState {
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    heightfield: Heightfield | null;
    failed: boolean;
    error?: unknown;
  }>({ key: '', attempt, heightfield: null, failed: false });
  const key = bounds ? boundsKey(bounds) : '';

  useEffect(() => {
    if (!bounds) return undefined;
    let live = true;
    figureHeightfield(load, bounds).then(
      (heightfield) => {
        if (live) setState({ key, attempt, heightfield, failed: false });
      },
      (error: unknown) => {
        if (!live || isAbortError(error)) return;
        setState((previous) => ({
          key,
          attempt,
          heightfield: previous.heightfield,
          failed: true,
          error,
        }));
      },
    );
    return () => {
      live = false;
    };
    // `bounds` is memoized by the caller; `key` keeps equal bounds from rebuilding anyway.
  }, [bounds, key, load, attempt]);

  if (state.key === key && state.heightfield && !state.failed) {
    return { status: 'ready', heightfield: state.heightfield };
  }
  if (state.key === key && state.failed && state.attempt === attempt) {
    return { status: 'error', heightfield: null, error: state.error };
  }
  return { status: 'loading', heightfield: state.heightfield };
}

// ---------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------

/**
 * Loads the faces `style` draws with (`loadPosterFonts`, for the poster's `text`) and reports
 * whether they have loaded at least once for this style: the poster shows only then, so it never
 * lays out in a fallback face. Later text (a new character) loads its subset without hiding it.
 */
export function usePosterFonts(style: PosterStyleId, text: string, subtitle: boolean): boolean {
  const [loaded, setLoaded] = useState<ReadonlySet<PosterStyleId>>(() => new Set());
  useEffect(() => {
    let live = true;
    loadPosterFonts(style, text, { subtitle }).then(
      () => {
        if (live)
          setLoaded((previous) => (previous.has(style) ? previous : new Set(previous).add(style)));
      },
      () => {
        // A face that fails still lets the poster show, in the fallback stack.
        if (live)
          setLoaded((previous) => (previous.has(style) ? previous : new Set(previous).add(style)));
      },
    );
    return () => {
      live = false;
    };
  }, [style, text, subtitle]);
  return loaded.has(style);
}
