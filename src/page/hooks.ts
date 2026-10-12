/**
 * The run and terrain the page renders, behind typed hooks.
 *
 * `RunProvider` owns the loaded run. The page asks it to load a file or the sample
 * (`useRunChooser`, which also drives the state machine), and every component reads the result with
 * `useRun()` / `useTerrain()`.
 *
 * The loader is injectable (`RunProvider`'s `loadRun`). The default is `realLoadRun`
 * (`src/gpx/loadRun.ts`: the GPX parsed in a Web Worker). `placeholderLoadRun` yields `SAMPLE_RUN`
 * for any source after a simulated delay; tests and stories get it by passing `schedule` or
 * `delayMs` (or `loadRun={placeholderLoadRun(...)}`).
 *
 * The terrain: as soon as a run is the current one, `RunProvider` builds its height grid
 * (`loadTerrain`, by default `buildHeightfield(run.bounds)`: elevation tiles from `/tiles/z/x/y`),
 * without waiting for the View to mount. A new run, New file or unmounting aborts the build.
 * `useTerrain()` reports `loading`, `ready` (with any tiles that failed and were filled in) or
 * `error` (with a message); `useRetryTerrain()` builds it again.
 *
 * A run whose GPX has no elevations gets them from that grid as soon as it is ready
 * (`withTerrainElevation`): `useRun()` then returns the run with its profile, vert, high point and
 * climbs filled in and `elevationSource: 'terrain'`, in the same render that reports the terrain
 * `ready`, so the View never draws the route twice. Before that the elevation figures stay unknown
 * (`NaN`, shown as "–"). If the terrain fails, a file mostly recorded but with long gaps has them
 * interpolated (`withInterpolatedGaps`, `elevationSource: 'interpolated'`); any other stays unknown.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo } from 'react';
import { useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { tilesForBounds } from '../lib/geo';
import type { Bounds } from '../lib/geo';
import {
  HeightfieldError,
  HeightfieldTooLargeError,
  buildHeightfield,
  elevationAt,
} from '../terrain/heightfield';
import type { Heightfield } from '../terrain/heightfield';
import { isAbortError } from '../terrain/tiles';
import { PERF_MARKS, perfMark } from './perfMarks';
import { SAMPLE_RUN } from './sample';
import { posterTextFor } from './state';
import type { PageAction } from './state';
import { preloadTerrainView } from './terrainChunk';
import type { Run, Terrain } from './types';
import { GENERIC_LOAD_ERROR, RunLoadError } from './errors';
import { realLoadRun } from '../gpx/loadRun';
import { withInterpolatedGaps, withTerrainElevation } from '../gpx/terrainElevation';

/** What to load: a file the user chose, or the built-in sample run. */
export type RunSource =
  { readonly kind: 'file'; readonly file: File } | { readonly kind: 'sample' };

/**
 * Turns a source into a run. Rejects with a `RunLoadError` (its message is shown to the user) when
 * the file cannot be used; any other rejection shows a generic message. `signal` aborts when the
 * load is superseded or cancelled; the loader should stop work then (its result is ignored anyway).
 */
export type LoadRun = (source: RunSource, signal: AbortSignal) => Promise<Run>;

export { GENERIC_LOAD_ERROR, RunLoadError } from './errors';

/** Runs `callback` after `delayMs`; returns a function that cancels it if it has not run. */
export type Schedule = (callback: () => void, delayMs: number) => () => void;

/** The real clock: `setTimeout`. */
export const timeoutSchedule: Schedule = (callback, delayMs) => {
  const id = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(id);
  };
};

/** No delay at all: the callback runs synchronously. For tests. */
export const immediateSchedule: Schedule = (callback) => {
  callback();
  return () => undefined;
};

/** Simulated reading time for the placeholder loader, ms. */
export const PLACEHOLDER_DELAY_MS = 300;

/**
 * The placeholder loader: every source yields the sample run after `delayMs` on `schedule`.
 * Aborting cancels the timer and rejects with the signal's reason. For tests and stories; the app
 * uses `realLoadRun`.
 */
export function placeholderLoadRun(
  schedule: Schedule = timeoutSchedule,
  delayMs: number = PLACEHOLDER_DELAY_MS,
): LoadRun {
  return (_source, signal) =>
    new Promise<Run>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      let cancelTimer: () => void = () => undefined;
      const onAbort = () => {
        cancelTimer();
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      cancelTimer = schedule(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(SAMPLE_RUN);
      }, delayMs);
    });
}

/**
 * Builds the height grid under a run. Rejects with an `AbortError` when `signal` aborts (a new run,
 * New file), with `HeightfieldError` when no elevation tile loads, and with
 * `HeightfieldTooLargeError` when the route is too large to fetch tiles for.
 */
export type LoadTerrain = (run: Run, signal: AbortSignal) => Promise<Heightfield>;

/** The app's terrain loader: the run's bounds (+15%) from same-origin Terrarium tiles. */
export const realLoadTerrain: LoadTerrain = (run, signal) =>
  buildHeightfield(run.bounds, { signal });

/**
 * A terrain loader that never settles (it only honours the abort): the terrain stays `loading`.
 * Placeholder mode's default, so tests that do not care about the terrain make no tile requests.
 */
export const pendingLoadTerrain: LoadTerrain = (_run, signal) =>
  new Promise<Heightfield>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/**
 * Builds a height grid for exactly `bounds` (no padding): the Night Ridge and Survey Quad posters
 * lay their own figures out and ask for the area their figure box needs (`ridgeBounds`,
 * `quadBounds`). Rejects with an `AbortError` when `signal` aborts.
 */
export type LoadFigureTerrain = (bounds: Bounds, signal: AbortSignal) => Promise<Heightfield>;

/** The app's figure terrain loader: same-origin Terrarium tiles for `bounds`, unpadded. */
export const realLoadFigureTerrain: LoadFigureTerrain = (bounds, signal) =>
  buildHeightfield(bounds, { padding: 0, signal });

/** A figure terrain loader that never settles (placeholder mode: no tile requests). */
export const pendingLoadFigureTerrain: LoadFigureTerrain = (_bounds, signal) =>
  new Promise<Heightfield>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/** No elevation tile came through: offline, or the tile server is down. */
export const TERRAIN_OFFLINE_ERROR =
  "The terrain couldn't load: no elevation data came through. Check your connection and try again.";

/** Every elevation tile arrived but this browser could not decode any of them. */
export const TERRAIN_DECODE_ERROR =
  "The terrain couldn't load: the elevation data arrived, but this browser couldn't read it. Reload the page and try again.";

/** The route spans more than the tiles the app can fetch (even at the lowest served zoom). */
export const TERRAIN_TOO_LARGE_ERROR = 'This route covers too much ground to draw its terrain.';

/** Anything else that stopped the grid from being built. */
export const TERRAIN_GENERIC_ERROR = "The terrain couldn't be built for this run.";

function terrainErrorMessage(error: unknown): string {
  if (error instanceof HeightfieldTooLargeError) return TERRAIN_TOO_LARGE_ERROR;
  if (error instanceof HeightfieldError && error.kind === 'decode') return TERRAIN_DECODE_ERROR;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return offline || error instanceof HeightfieldError || error instanceof TypeError
    ? TERRAIN_OFFLINE_ERROR
    : TERRAIN_GENERIC_ERROR;
}

const IDLE_TERRAIN: Terrain = { status: 'idle' };
const LOADING_TERRAIN: Terrain = { status: 'loading' };

/** A settled terrain build, for one run and one attempt (Try again starts a new attempt). */
interface TerrainResult {
  readonly run: Run;
  readonly attempt: number;
  readonly terrain: Terrain;
}

interface RunContextValue {
  readonly run: Run | null;
  readonly terrain: Terrain;
  /** Build the current run's terrain again (after an error). */
  readonly retryTerrain: () => void;
  /**
   * Load a run and make it the current one. Resolves with the run, or with `null` when a later
   * `load` or `clear` superseded this one (the caller then does nothing). Rejects with the loader's
   * error when the file cannot be read.
   */
  readonly load: (source: RunSource) => Promise<Run | null>;
  /** Forget the current run and cancel a pending load. */
  readonly clear: () => void;
  /** Whether a load is in flight right now (read at call time, not render time). */
  readonly isLoading: () => boolean;
  /** Builds a height grid for a poster figure's own bounds. */
  readonly loadFigureTerrain: LoadFigureTerrain;
}

const RunContext = createContext<RunContextValue | null>(null);

export interface RunProviderProps {
  children?: ReactNode;
  /** A run that is already loaded, for stories and tests that start in View or Poster mode. */
  initialRun?: Run | null;
  /**
   * Turns a file or the sample into a run. Defaults to `realLoadRun` (the GPX parsed in a Web
   * Worker), or to the placeholder when `schedule` or `delayMs` is given.
   */
  loadRun?: LoadRun;
  /**
   * Timer for the placeholder's simulated reading delay. Passing it (tests pass
   * `immediateSchedule`) selects `placeholderLoadRun` unless `loadRun` is given.
   */
  schedule?: Schedule;
  /** The placeholder's simulated reading delay, ms. Passing it also selects the placeholder. */
  delayMs?: number;
  /**
   * Builds the current run's height grid. Defaults to `realLoadTerrain` (elevation tiles), or, in
   * placeholder mode (`schedule` / `delayMs` given), to `pendingLoadTerrain` (stays loading).
   */
  loadTerrain?: LoadTerrain;
  /**
   * Builds the Night Ridge and Survey Quad figures' height grids. Defaults to
   * `realLoadFigureTerrain`, or in placeholder mode to `pendingLoadFigureTerrain` (stays loading).
   */
  loadFigureTerrain?: LoadFigureTerrain;
}

export function RunProvider({
  children,
  initialRun = null,
  loadRun,
  schedule,
  delayMs,
  loadTerrain,
  loadFigureTerrain,
}: RunProviderProps) {
  // The run as loaded; `run` below is this one with terrain elevations when the file had none.
  const [loadedRun, setRun] = useState<Run | null>(initialRun);
  const pending = useRef<AbortController | null>(null);
  const usePlaceholder = schedule !== undefined || delayMs !== undefined;
  const placeholder = useMemo(
    () => placeholderLoadRun(schedule ?? timeoutSchedule, delayMs ?? PLACEHOLDER_DELAY_MS),
    [schedule, delayMs],
  );
  const loader = loadRun ?? (usePlaceholder ? placeholder : realLoadRun);
  const terrainLoader = loadTerrain ?? (usePlaceholder ? pendingLoadTerrain : realLoadTerrain);
  const figureTerrainLoader =
    loadFigureTerrain ?? (usePlaceholder ? pendingLoadFigureTerrain : realLoadFigureTerrain);

  // The terrain follows the run: built as soon as a run is current, aborted when it changes.
  const [attempt, setAttempt] = useState(0);
  const [terrainResult, setTerrainResult] = useState<TerrainResult | null>(null);
  useEffect(() => {
    if (!loadedRun) return undefined;
    const run = loadedRun;
    const controller = new AbortController();
    const { signal } = controller;
    const settle = (terrain: Terrain) => {
      if (!signal.aborted) setTerrainResult({ run, attempt, terrain });
    };
    let building: Promise<Heightfield>;
    try {
      building = terrainLoader(run, signal);
    } catch (error: unknown) {
      building = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    building.then(
      (heightfield) => {
        if (signal.aborted) return;
        perfMark(PERF_MARKS.heightfield);
        settle({
          status: 'ready',
          heightfield,
          failedTiles: heightfield.failedTiles,
          totalTiles: tilesForBounds(heightfield.bounds, heightfield.zoom).length,
        });
      },
      (error: unknown) => {
        if (signal.aborted || isAbortError(error)) return;
        settle({ status: 'error', error: terrainErrorMessage(error) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [loadedRun, attempt, terrainLoader]);

  const terrain: Terrain = !loadedRun
    ? IDLE_TERRAIN
    : terrainResult?.run === loadedRun && terrainResult.attempt === attempt
      ? terrainResult.terrain
      : LOADING_TERRAIN;

  // No <ele> in the file, or long gaps: sample the elevations from the terrain grid once it is
  // ready (O(n)). If it fails, a mostly recorded file has its gaps interpolated instead.
  const run = useMemo(() => {
    if (!loadedRun || loadedRun.hasElevation) return loadedRun;
    if (terrain.status === 'ready') {
      return withTerrainElevation(loadedRun, (lon, lat) =>
        elevationAt(terrain.heightfield, lon, lat),
      );
    }
    return terrain.status === 'error' ? withInterpolatedGaps(loadedRun) : loadedRun;
  }, [loadedRun, terrain]);

  const retryTerrain = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const cancelPending = useCallback(() => {
    const controller = pending.current;
    pending.current = null;
    controller?.abort();
  }, []);

  const load = useCallback(
    (source: RunSource) =>
      new Promise<Run | null>((resolve, reject) => {
        cancelPending();
        const controller = new AbortController();
        const { signal } = controller;
        pending.current = controller;
        // Superseded or cancelled: settle at once, whether or not the loader honours the signal.
        signal.addEventListener('abort', () => {
          resolve(null);
        });

        let loading: Promise<Run>;
        try {
          loading = loader(source, signal);
        } catch (error: unknown) {
          loading = Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        loading.then(
          (next) => {
            if (signal.aborted) return;
            pending.current = null;
            perfMark(PERF_MARKS.parsed);
            setRun(next);
            resolve(next);
          },
          (error: unknown) => {
            if (signal.aborted) return;
            pending.current = null;
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }),
    [cancelPending, loader],
  );

  const clear = useCallback(() => {
    cancelPending();
    setRun(null);
  }, [cancelPending]);

  const isLoading = useCallback(() => pending.current !== null, []);

  useEffect(() => cancelPending, [cancelPending]);

  const value = useMemo<RunContextValue>(
    () => ({
      run,
      terrain,
      retryTerrain,
      load,
      clear,
      isLoading,
      loadFigureTerrain: figureTerrainLoader,
    }),
    [run, terrain, retryTerrain, load, clear, isLoading, figureTerrainLoader],
  );
  return createElement(RunContext, { value }, children);
}

function useRunContext(hook: string): RunContextValue {
  const context = useContext(RunContext);
  if (!context) throw new Error(`${hook} must be used inside <RunProvider>`);
  return context;
}

/** The loaded run, or `null` before one has loaded. */
export function useRun(): Run | null {
  return useRunContext('useRun').run;
}

/** The terrain under the loaded run: idle without a run, then loading, ready or error. */
export function useTerrain(): Terrain {
  return useRunContext('useTerrain').terrain;
}

/** Builds the current run's terrain again (the View's "Try again" after an error). */
export function useRetryTerrain(): () => void {
  return useRunContext('useRetryTerrain').retryTerrain;
}

/** Builds a height grid for a poster figure's bounds (Night Ridge, Survey Quad). */
export function useFigureTerrainLoader(): LoadFigureTerrain {
  return useRunContext('useFigureTerrainLoader').loadFigureTerrain;
}

/** Low-level access to `load` and `clear`. The page normally uses `useRunChooser`. */
export function useRunLoader(): Pick<RunContextValue, 'load' | 'clear'> {
  const { load, clear } = useRunContext('useRunLoader');
  return useMemo(() => ({ load, clear }), [load, clear]);
}

/** The message the Upload screen shows for a failed load. */
function loadErrorMessage(error: unknown): string {
  return error instanceof RunLoadError && error.message ? error.message : GENERIC_LOAD_ERROR;
}

/**
 * What the page calls when the user picks a file or the sample, or asks for a new file.
 *
 * - `chooseFile` / `chooseSample` start fetching the terrain view's code (its own chunk), tell the
 *   state machine (`FILE_CHOSEN` / `SAMPLE_CHOSEN`), load
 *   the run, then send `RUN_LOADED` (seeding the poster's title and subtitle) or `LOAD_FAILED`.
 *   While a load is in flight a second choice is ignored, as the state machine ignores it.
 * - `newFile` sends `NEW_FILE` and forgets the run, so `useRun()` is `null` and the terrain idle.
 *   It does nothing while a load is in flight (Upload ignores `NEW_FILE`). Offer it only where the
 *   state machine accepts `NEW_FILE` (View, Poster mode), not during an export.
 */
export function useRunChooser(dispatch: Dispatch<PageAction>): {
  chooseFile: (file: File) => void;
  chooseSample: () => void;
  newFile: () => void;
} {
  const { load, clear, isLoading } = useRunContext('useRunChooser');

  return useMemo(() => {
    const settle = (loading: Promise<Run | null>) => {
      loading.then(
        (run) => {
          if (run) dispatch({ type: 'RUN_LOADED', runId: run.id, posterText: posterTextFor(run) });
        },
        (error: unknown) => {
          dispatch({ type: 'LOAD_FAILED', message: loadErrorMessage(error) });
        },
      );
    };
    return {
      chooseFile: (file: File) => {
        if (isLoading()) return;
        perfMark(PERF_MARKS.chosen);
        preloadTerrainView();
        dispatch({ type: 'FILE_CHOSEN', fileName: file.name });
        settle(load({ kind: 'file', file }));
      },
      chooseSample: () => {
        if (isLoading()) return;
        perfMark(PERF_MARKS.chosen);
        preloadTerrainView();
        dispatch({ type: 'SAMPLE_CHOSEN' });
        settle(load({ kind: 'sample' }));
      },
      newFile: () => {
        if (isLoading()) return;
        dispatch({ type: 'NEW_FILE' });
        clear();
      },
    };
  }, [dispatch, load, clear, isLoading]);
}
