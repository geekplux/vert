/**
 * Run-derived values that must degrade when the GPX lacks data. A planned route (and many course
 * files) has no timestamps, so `Run.startTime` is `NaN` and there is no pace; every call site goes
 * through these helpers instead of calling `formatDateLine` or reading the track directly.
 */
import { paceAt } from '../gpx/stats';
import { formatDateLine } from '../lib/format';
import type { Run } from './types';

/**
 * The run's local date line, "SAT · 2026-10-03", or `''` when the file has no time at all
 * (`formatDateLine` throws on an invalid date; its contract stays as it is).
 */
export function runDateLine(run: Pick<Run, 'startTime' | 'lonForOffset'>): string {
  return Number.isFinite(run.startTime)
    ? formatDateLine(new Date(run.startTime), run.lonForOffset)
    : '';
}

/**
 * Pace at `d` metres along the run, seconds per km, from the track's timestamps (over 200 m around
 * `d`); `null` for a run without times or where the pace is not meaningful (no time passed).
 */
export function runPaceAt(run: Pick<Run, 'hasTime' | 'track'>, d: number): number | null {
  if (!run.hasTime) return null;
  const pace = paceAt(run.track, d);
  return pace !== null && Number.isFinite(pace) && pace > 0 ? pace : null;
}
