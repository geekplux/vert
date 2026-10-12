/**
 * A simulated exporter for stories and tests: the Exporting overlay exercised end to end without
 * a canvas. After one interval ("Preparing…") it reports 12 tiles to render,
 * then finishes one tile every `intervalMs` and resolves with the job's file name. It renders
 * nothing and never downloads a file.
 *
 * The app uses the real one, `posterExporter.ts` (same `Exporter` signature; see `exporter.ts`).
 */
import { timeoutSchedule } from '../hooks';
import type { Schedule } from '../hooks';
import type { Exporter } from './exporter';

/** Simulated time per step (preparing, then each tile), ms. */
export const SIMULATED_TILE_MS = 150;

/** Tiles the simulation pretends to render. */
export const SIMULATED_TILES = 12;

/** An `Exporter` that pretends to render `tiles` tiles, one per `intervalMs` on `schedule`. */
export function createSimulatedExporter(
  schedule: Schedule = timeoutSchedule,
  intervalMs: number = SIMULATED_TILE_MS,
  tiles: number = SIMULATED_TILES,
): Exporter {
  return (job, onProgress, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      let done = 0;
      let cancelTimer: () => void = () => undefined;
      const onAbort = () => {
        cancelTimer();
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const tick = () => {
        if (signal.aborted) return;
        done += 1;
        onProgress({ done, total: tiles });
        if (done >= tiles) {
          signal.removeEventListener('abort', onAbort);
          resolve({ fileName: job.fileName });
          return;
        }
        cancelTimer = schedule(tick, intervalMs);
      };
      const prepared = () => {
        if (signal.aborted) return;
        onProgress({ done: 0, total: tiles });
        cancelTimer = schedule(tick, intervalMs);
      };
      cancelTimer = schedule(prepared, intervalMs);
    });
}

/** The simulated exporter on the real clock (150 ms a step). */
export const simulateExport: Exporter = createSimulatedExporter();
