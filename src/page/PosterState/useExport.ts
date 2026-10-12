import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { flushSync } from 'react-dom';
import type { ScreenEvent } from '../state';
import { exportErrorMessage } from './exporter';
import type { ExportJob, Exporter } from './exporter';
import { ANNOUNCE_MILESTONES_AFTER_MS } from './posterCopy';

/**
 * Runs exports with `exporter` and drives the state machine: `start` sends EXPORT_STARTED, then
 * forwards the exporter's `{ done, total, stage? }` reports as EXPORT_PROGRESS and ends with EXPORT_DONE
 * or EXPORT_FAILED; `cancel` aborts the exporter and sends EXPORT_CANCELLED. Nothing the exporter
 * does after an abort reaches the state machine. Unmounting aborts a running export.
 *
 * `cancelled` is true after a Cancel until the next export (the status region says so; the state
 * machine keeps no notice for it). `slow` turns true once the running export has taken
 * {@link ANNOUNCE_MILESTONES_AFTER_MS}, and false when the next one starts: only then does the
 * status region announce progress milestones (most exports end sooner, with just start and outcome).
 */
export function useExport(
  exporter: Exporter,
  dispatch: Dispatch<ScreenEvent<'poster'> | ScreenEvent<'exporting'>>,
): { start: (job: ExportJob) => void; cancel: () => void; cancelled: boolean; slow: boolean } {
  const controllerRef = useRef<AbortController | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cancelled, setCancelled] = useState(false);
  const [slow, setSlow] = useState(false);

  const stopSlowTimer = useCallback(() => {
    clearTimeout(slowTimerRef.current);
    slowTimerRef.current = undefined;
  }, []);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      clearTimeout(slowTimerRef.current);
    },
    [],
  );

  const start = useCallback(
    (job: ExportJob) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      setCancelled(false);
      setSlow(false);
      stopSlowTimer();
      slowTimerRef.current = setTimeout(() => {
        if (controllerRef.current === controller) setSlow(true);
      }, ANNOUNCE_MILESTONES_AFTER_MS);
      dispatch({ type: 'EXPORT_STARTED', fileName: job.fileName });

      const settle = () => {
        if (controllerRef.current !== controller) return;
        controllerRef.current = null;
        stopSlowTimer();
      };
      let run: Promise<{ fileName: string }>;
      try {
        run = exporter(
          job,
          ({ done, total, stage }) => {
            if (signal.aborted) return;
            // Committed at once, so the label is in the DOM before the exporter waits for the
            // next paint (otherwise React may commit it after that frame, and a long tile that
            // follows hides it: "tile 5 of 8" was skipped).
            flushSync(() => {
              dispatch({ type: 'EXPORT_PROGRESS', done, total, ...(stage ? { stage } : {}) });
            });
          },
          signal,
        );
      } catch (error) {
        run = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      run.then(
        (result) => {
          if (signal.aborted) return;
          settle();
          dispatch({ type: 'EXPORT_DONE', fileName: result.fileName });
        },
        (error: unknown) => {
          if (signal.aborted) return;
          settle();
          dispatch({ type: 'EXPORT_FAILED', message: exportErrorMessage(error) });
        },
      );
    },
    [exporter, dispatch, stopSlowTimer],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    stopSlowTimer();
    setCancelled(true);
    dispatch({ type: 'EXPORT_CANCELLED' });
  }, [dispatch, stopSlowTimer]);

  return { start, cancel, cancelled, slow };
}
