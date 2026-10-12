/**
 * The run and terrain the page renders, behind typed hooks.
 *
 * `RunProvider` owns the loaded run. The page asks it to load a file or the sample
 * (`useRunChooser`, which also drives the state machine), and every component reads the result with
 * `useRun()` / `useTerrain()`.
 *
 * The loader is injectable (`RunProvider`'s `loadRun`). PHASE 2 PLACEHOLDER: the default yields
 * `SAMPLE_RUN` for any file or the sample after a short simulated delay, so the busy state is
 * visible. Phase 3 replaces the default (parse the GPX in a Web Worker) and the terrain value (fetch
 * tiles, build the mesh); the hooks' signatures and their callers stay as they are.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo } from 'react';
import { useRef, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { SAMPLE_RUN } from './sample';
import { posterTextFor } from './state';
import type { PageAction } from './state';
import type { Run, Terrain } from './types';

/** What to load: a file the user chose, or the built-in sample run. */
export type RunSource =
  { readonly kind: 'file'; readonly file: File } | { readonly kind: 'sample' };

/**
 * Turns a source into a run. Rejects with a `RunLoadError` (its message is shown to the user) when
 * the file cannot be used; any other rejection shows a generic message. `signal` aborts when the
 * load is superseded or cancelled; the loader should stop work then (its result is ignored anyway).
 */
export type LoadRun = (source: RunSource, signal: AbortSignal) => Promise<Run>;

/** A load failure whose message is fit to show on the Upload screen, e.g. "No track in this file." */
export class RunLoadError extends Error {
  override name = 'RunLoadError';
}

/** Shown when a load fails with anything other than a `RunLoadError`. */
export const GENERIC_LOAD_ERROR = "Vert couldn't read this file.";

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
 * Phase 2's loader: every source yields the sample run after `delayMs` on `schedule`. Aborting
 * cancels the timer and rejects with the signal's reason. Phase 3 replaces it as the default.
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

const IDLE_TERRAIN: Terrain = { status: 'idle', placeholder: true };
const READY_TERRAIN: Terrain = { status: 'ready', placeholder: true };

interface RunContextValue {
  readonly run: Run | null;
  readonly terrain: Terrain;
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
}

const RunContext = createContext<RunContextValue | null>(null);

export interface RunProviderProps {
  children?: ReactNode;
  /** A run that is already loaded, for stories and tests that start in View or Poster mode. */
  initialRun?: Run | null;
  /** Turns a file or the sample into a run. Defaults to the phase 2 placeholder. */
  loadRun?: LoadRun;
  /** Timer for the placeholder's simulated reading delay. Tests pass `immediateSchedule`. */
  schedule?: Schedule;
  /** The placeholder's simulated reading delay, ms. */
  delayMs?: number;
}

export function RunProvider({
  children,
  initialRun = null,
  loadRun,
  schedule = timeoutSchedule,
  delayMs = PLACEHOLDER_DELAY_MS,
}: RunProviderProps) {
  const [run, setRun] = useState<Run | null>(initialRun);
  const pending = useRef<AbortController | null>(null);
  const placeholder = useMemo(() => placeholderLoadRun(schedule, delayMs), [schedule, delayMs]);
  const loader = loadRun ?? placeholder;

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
    () => ({ run, terrain: run ? READY_TERRAIN : IDLE_TERRAIN, load, clear, isLoading }),
    [run, load, clear, isLoading],
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

/** The terrain under the loaded run (phase 2: a placeholder, `ready` once a run has loaded). */
export function useTerrain(): Terrain {
  return useRunContext('useTerrain').terrain;
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
 * - `chooseFile` / `chooseSample` tell the state machine (`FILE_CHOSEN` / `SAMPLE_CHOSEN`), load
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
        dispatch({ type: 'FILE_CHOSEN', fileName: file.name });
        settle(load({ kind: 'file', file }));
      },
      chooseSample: () => {
        if (isLoading()) return;
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
