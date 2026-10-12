/**
 * The run and terrain the page renders, behind typed hooks.
 *
 * `RunProvider` owns the loaded run. The page asks it to load a file or the sample
 * (`useRunChooser`, which also drives the state machine), and every component reads the result with
 * `useRun()` / `useTerrain()`.
 *
 * PHASE 2 PLACEHOLDER: loading any file or the sample yields `SAMPLE_RUN` after a short simulated
 * delay, so the busy state is visible. Phase 3 replaces `placeholderLoadRun` (parse the GPX in a
 * Web Worker) and the terrain value (fetch tiles, build the mesh); the hooks' signatures and their
 * callers stay as they are.
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
 * Phase 2: every choice yields the sample run. Phase 3 replaces this with
 * `(source: RunSource) => Promise<Run>`, parsing `source.file` in a Web Worker.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- phase 3 reads `source.file`
function placeholderLoadRun(_source: RunSource): Run {
  return SAMPLE_RUN;
}

const IDLE_TERRAIN: Terrain = { status: 'idle', placeholder: true };
const READY_TERRAIN: Terrain = { status: 'ready', placeholder: true };

interface RunContextValue {
  readonly run: Run | null;
  readonly terrain: Terrain;
  /**
   * Load a run and make it the current one. Resolves with the run, or with `null` when a later
   * `load` or `clear` superseded this one (the caller then does nothing). Phase 3: rejects with an
   * `Error` whose message is fit to show when the file cannot be read.
   */
  readonly load: (source: RunSource) => Promise<Run | null>;
  /** Forget the current run and cancel a pending load. */
  readonly clear: () => void;
}

const RunContext = createContext<RunContextValue | null>(null);

export interface RunProviderProps {
  children?: ReactNode;
  /** A run that is already loaded, for stories and tests that start in View or Poster mode. */
  initialRun?: Run | null;
  /** Timer for the simulated reading delay. Tests pass `immediateSchedule`. */
  schedule?: Schedule;
  /** Simulated reading delay, ms. */
  delayMs?: number;
}

export function RunProvider({
  children,
  initialRun = null,
  schedule = timeoutSchedule,
  delayMs = PLACEHOLDER_DELAY_MS,
}: RunProviderProps) {
  const [run, setRun] = useState<Run | null>(initialRun);
  const pending = useRef<(() => void) | null>(null);

  const cancelPending = useCallback(() => {
    const cancel = pending.current;
    pending.current = null;
    cancel?.();
  }, []);

  const load = useCallback(
    (source: RunSource) =>
      new Promise<Run | null>((resolve) => {
        cancelPending();
        let settled = false;
        let cancelTimer: () => void = () => undefined;
        const cancel = () => {
          if (settled) return;
          settled = true;
          cancelTimer();
          resolve(null);
        };
        pending.current = cancel;
        cancelTimer = schedule(() => {
          if (settled) return;
          settled = true;
          if (pending.current === cancel) pending.current = null;
          const next = placeholderLoadRun(source);
          setRun(next);
          resolve(next);
        }, delayMs);
      }),
    [cancelPending, schedule, delayMs],
  );

  const clear = useCallback(() => {
    cancelPending();
    setRun(null);
  }, [cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  const value = useMemo<RunContextValue>(
    () => ({ run, terrain: run ? READY_TERRAIN : IDLE_TERRAIN, load, clear }),
    [run, load, clear],
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

const FALLBACK_ERROR = 'This file could not be read as a GPX track.';

/**
 * What the Upload screen calls when the user picks a file or the sample: tells the state machine
 * (`FILE_CHOSEN` / `SAMPLE_CHOSEN`), loads the run, then sends `RUN_LOADED` (seeding the poster's
 * title and subtitle) or `LOAD_FAILED`. A superseded load sends nothing.
 */
export function useRunChooser(dispatch: Dispatch<PageAction>): {
  chooseFile: (file: File) => void;
  chooseSample: () => void;
} {
  const { load } = useRunContext('useRunChooser');

  return useMemo(() => {
    const settle = (loading: Promise<Run | null>) => {
      loading.then(
        (run) => {
          if (run) dispatch({ type: 'RUN_LOADED', runId: run.id, posterText: posterTextFor(run) });
        },
        (error: unknown) => {
          const message = error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
          dispatch({ type: 'LOAD_FAILED', message });
        },
      );
    };
    return {
      chooseFile: (file: File) => {
        dispatch({ type: 'FILE_CHOSEN', fileName: file.name });
        settle(load({ kind: 'file', file }));
      },
      chooseSample: () => {
        dispatch({ type: 'SAMPLE_CHOSEN' });
        settle(load({ kind: 'sample' }));
      },
    };
  }, [dispatch, load]);
}
