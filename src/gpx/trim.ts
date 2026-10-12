/**
 * "Hide start and end": drop the first and last N metres of the route from what is drawn, so a
 * poster does not show where the runner lives. Only the drawn line is trimmed; the stats keep the
 * whole run.
 *
 * Distances are along the route (the track's cumulative distance). The cut points are
 * interpolated linearly between the two recorded points around them, so the drawn line starts
 * exactly N metres in. Latitude and longitude are interpolated as plain numbers, which is exact
 * enough over the few metres between consecutive points.
 */

import type { RunTrack } from '../page/types';
import type { TrackPoint } from './types';

/** Where a cut falls: between point `i` and `i + 1`, at fraction `f` of that step. */
interface Cut {
  i: number;
  f: number;
}

/**
 * The two cuts for trimming `metres` off each end, or `null` when nothing would be left (the
 * route is no longer than twice `metres`).
 */
function cutsFor(cumulative: Float64Array, metres: number): { from: Cut; to: Cut } | null {
  const n = cumulative.length;
  const total = n > 0 ? (cumulative[n - 1] ?? 0) : 0;
  // A millimetre's slack absorbs rounding in the summed distances.
  if (n < 2 || total - 2 * metres <= 1e-3) return null;
  return { from: cutAt(cumulative, metres, 'from'), to: cutAt(cumulative, total - metres, 'to') };
}

/**
 * The step a cut at distance `d` (0 < d < total) falls in. A start cut takes the step with
 * `cumulative[i] <= d < cumulative[i + 1]` (kept points follow it); an end cut the step with
 * `cumulative[i] < d <= cumulative[i + 1]` (kept points precede it). So a cut exactly on a recorded
 * point lands on it without repeating it, and zero-length steps are never chosen.
 */
function cutAt(cumulative: Float64Array, d: number, side: 'from' | 'to'): Cut {
  // Binary search for the first index whose distance passes d (start) or reaches it (end).
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = cumulative[mid] ?? 0;
    if (side === 'from' ? c > d : c >= d) hi = mid;
    else lo = mid + 1;
  }
  const i = Math.max(0, lo - 1);
  const d0 = cumulative[i] ?? 0;
  const d1 = cumulative[i + 1] ?? 0;
  return { i, f: d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 1 };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

function lerpNullable(a: number | null, b: number | null, f: number): number | null {
  return a === null || b === null ? null : lerp(a, b, f);
}

function pointAt(points: readonly TrackPoint[], { i, f }: Cut): TrackPoint {
  const a = points[i];
  const b = points[i + 1];
  // cutsFor only returns steps inside a track of two or more points.
  if (!a || !b) throw new RangeError(`No step ${String(i)} in a track of ${String(points.length)}`);
  return {
    lat: lerp(a.lat, b.lat, f),
    lon: lerp(a.lon, b.lon, f),
    ele: lerpNullable(a.ele, b.ele, f),
    time: lerpNullable(a.time, b.time, f),
  };
}

/**
 * `points` without the first and last `metres` of the route, with an interpolated point at each
 * cut. Returns a copy of `points` when `metres` is 0 or less, and an empty array when the route
 * is no longer than `2 × metres`.
 *
 * @param cumulative distance along the route to each point, metres (same length as `points`)
 */
export function trimEnds(
  points: readonly TrackPoint[],
  cumulative: Float64Array,
  metres: number,
): TrackPoint[] {
  if (!(metres > 0)) return points.slice();
  const cuts = cutsFor(cumulative, metres);
  if (!cuts) return [];
  const { from, to } = cuts;
  return [pointAt(points, from), ...points.slice(from.i + 1, to.i + 1), pointAt(points, to)];
}

/**
 * {@link trimEnds} for a run's typed-array track (`Run.track`): the same cut, with `cumulative`
 * kept as distance from the original start (so a trimmed point's distance still matches the
 * profile and the stats). Returns the track itself when `metres` is 0 or less, and `null` when
 * the route is no longer than `2 × metres`.
 */
export function trimTrack(track: RunTrack, metres: number): RunTrack | null {
  if (!(metres > 0)) return track;
  const cuts = cutsFor(track.cumulative, metres);
  if (!cuts) return null;
  const { from, to } = cuts;
  const pick = (series: Float64Array): Float64Array => {
    const out = new Float64Array(to.i - from.i + 2);
    out[0] = lerp(series[from.i] ?? 0, series[from.i + 1] ?? 0, from.f);
    out.set(series.subarray(from.i + 1, to.i + 1), 1);
    out[out.length - 1] = lerp(series[to.i] ?? 0, series[to.i + 1] ?? 0, to.f);
    return out;
  };
  return {
    lat: pick(track.lat),
    lon: pick(track.lon),
    ele: track.ele ? pick(track.ele) : null,
    cumulative: pick(track.cumulative),
    time: track.time ? pick(track.time) : null,
  };
}
