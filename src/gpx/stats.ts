/**
 * Run statistics from a parsed track: distance, moving time, ascent and descent, high and low
 * point, climbs and a resampled elevation profile. Pure and synchronous; it runs in the parse
 * worker (`worker.ts`) right after `parseGpx`, and in Node for the tests.
 *
 * The rules, in one place:
 *
 * - **Distance**: haversine sum between consecutive points ({@link haversine}, spherical Earth).
 *   Horizontal only, like a watch. Repeated positions add nothing.
 * - **Moving time**: the sum of the time steps between consecutive points, except
 *   1. a step longer than {@link MAX_GAP_S} (30 s): the watch was paused, or lost the signal, and
 *      nobody knows what happened in between. Points without a `<time>` get one interpolated
 *      along the route (below), but their steps are judged by the recorded span around them: a
 *      gap of 9 minutes between two recorded times stays a gap however many untimed points
 *      fill it, so it counts for elapsed time and never for moving time;
 *   2. a step where the runner was standing still: straight-line speed under
 *      {@link MIN_MOVING_SPEED} (0.5 m/s) across a window of at least {@link SPEED_WINDOW_S}
 *      (10 s) centred on the step (shorter only at a gap or an end of the track). Displacement
 *      over a window keeps GPS jitter while standing (a metre or two between fixes, which at a
 *      fix every second or two reads as walking pace) from counting as moving. The window blurs
 *      each stop's edges by a few seconds (at a 3 m/s pace about 4 s at each end still counts).
 *   `null` when the file has no timestamps.
 * - **Elevation**: missing `<ele>` values are filled by linear interpolation along the route
 *   (nearest value at the ends), then a 3-point median filter removes single-point spikes.
 *   Ascent and descent count the filtered series with a {@link HYSTERESIS_M} (2 m) hysteresis: a
 *   reference level starts at the first point and moves to the current elevation only once that
 *   is at least 2 m above it (the difference is ascent) or 2 m below it (descent). Wobble under
 *   2 m never counts. This is the classic watch/Strava-style rule; on the bundled sample and the
 *   three UTMB course files it lands within 1.5% of the published profile D+, where counting
 *   every metre after a 2 m reversal (a pure dead band) runs 2–3.5% high.
 *   **Unusable or patchy `<ele>`** ({@link recordedElevation}): a file whose `<ele>` values are
 *   all the same (all 0, or one value), or all within {@link MIN_ELEVATION_RANGE_M} (0.5 m) on a
 *   route of a kilometre or more, counts as having none. Gaps without `<ele>` shorter than
 *   {@link MAX_INTERPOLATED_GAP_M} (200 m, between the recorded points around them, or from the
 *   route's end) are interpolated as above; longer ones are left for the terrain. Either way the
 *   run then has `hasElevation: false` and `null` elevation figures, and `partialElevation` keeps
 *   the usable values (`NaN` where the terrain must fill) for `terrainElevation.ts`.
 * - **High and low point**: extremes of the filtered series.
 * - **Climbs**: see {@link findClimbs}. At most {@link MAX_CLIMBS} (the biggest by gain), so the
 *   list stays readable for a 100 km ultra; exactly one is marked `steepest`.
 * - **Profile**: {@link PROFILE_POINTS} evenly spaced points from 0 to the total distance,
 *   linearly interpolated from the filtered series.
 */

import { haversine } from '../lib/geo';
import type { Climb, ProfilePoint } from '../page/types';
import type { TrackPoint } from './types';

/** A time step longer than this (seconds) is a pause or a signal gap, never moving time. */
export const MAX_GAP_S = 30;
/** Below this average speed (m/s) the runner is standing still. */
export const MIN_MOVING_SPEED = 0.5;
/** Shortest window (seconds) the standing-still speed is measured over. */
export const SPEED_WINDOW_S = 10;
/** Hysteresis (metres) for ascent and descent, and the dead band of the climbs' turning points. */
export const HYSTERESIS_M = 2;
/** A climb gains at least this much (metres)… */
export const MIN_CLIMB_GAIN_M = 50;
/** …at an average grade of at least this (a fraction). */
export const MIN_CLIMB_GRADE = 0.04;
/** Rises separated by a dip smaller than this (metres) are one climb… */
export const MERGE_DIP_M = 10;
/** …or by a dip smaller than this fraction of the climb's gain so far. */
export const MERGE_DIP_FRACTION = 0.1;
/** Climbs a gain of at least this (metres) are preferred when choosing the steepest. */
export const STEEPEST_MIN_GAIN_M = 100;
/** Most climbs reported: the biggest by gain, then in route order. */
export const MAX_CLIMBS = 8;
/** Points in the resampled elevation profile. */
export const PROFILE_POINTS = 500;
/**
 * Gaps in `<ele>` spanning at least this far (metres) are filled from the terrain, not by a
 * straight line. A straight line over 200 m can hide a 20–40 m bump on a trail; under it the line
 * is within the recorder's own noise. Every-tenth-point files (≈ 40 m gaps) stay interpolated.
 */
export const MAX_INTERPOLATED_GAP_M = 200;
/**
 * `<ele>` values that all lie within this range (metres) on a route at least
 * {@link FLAT_ELEVATION_MIN_DISTANCE_M} long are not a measurement: no GPS or barometer holds its
 * altitude within half a metre over a kilometre of running (both wander by metres even standing
 * still). Some running-app exports write such series (0.00–0.38 m over 5 km, on 40% of the
 * points); they count as no usable elevation, like a constant. Half a metre, not more, so a
 * genuinely flat file smoothed by its app (a canal towpath, a track) keeps its own values.
 */
export const MIN_ELEVATION_RANGE_M = 0.5;
/** Shortest route (metres) that {@link MIN_ELEVATION_RANGE_M} applies to. */
export const FLAT_ELEVATION_MIN_DISTANCE_M = 1_000;

/** Everything {@link computeStats} works out about a track. All SI: metres, seconds, ms epoch. */
export interface RunStats {
  /** Track length, metres. */
  readonly distance: number;
  /** Distance from the first point to point `i`, metres; same length as the input. */
  readonly cumulative: Float64Array;
  /** Whether any point had an elevation. When false every elevation figure is `null`. */
  readonly hasElevation: boolean;
  /** Per-point elevation after filling gaps and the 3-point median filter, or `null`. */
  readonly elevation: Float64Array | null;
  /**
   * When some `<ele>` are usable but long gaps need the terrain: per-point elevation, unfiltered,
   * short gaps interpolated, `NaN` where the terrain must fill. `null` otherwise.
   */
  readonly partialElevation: Float64Array | null;
  /** Total ascent with the 2 m hysteresis, metres. */
  readonly ascent: number | null;
  /** Total descent with the 2 m hysteresis, metres (positive). */
  readonly descent: number | null;
  readonly highPoint: number | null;
  readonly lowPoint: number | null;
  /** Per-point timestamp (ms epoch), missing ones interpolated along the route; or `null`. */
  readonly time: Float64Array | null;
  /** Seconds spent moving (see the rules above), or `null` without timestamps. */
  readonly movingTime: number | null;
  /** Seconds from the first to the last timestamp, or `null`. */
  readonly elapsedTime: number | null;
  /** First timestamp, ms epoch, or `null`. */
  readonly startTime: number | null;
  /** Last timestamp, ms epoch, or `null`. */
  readonly endTime: number | null;
  /** Sustained climbs in route order (empty without elevation). */
  readonly climbs: Climb[];
  /** About {@link PROFILE_POINTS} `{d, ele}` points from 0 to `distance`; empty without elevation. */
  readonly profile: ProfilePoint[];
}

/** The per-point arrays {@link timeAtDistance} and {@link paceAt} need (a `RunStats` or `Run.track`). */
export interface TimedTrack {
  readonly cumulative: Float64Array;
  readonly time: Float64Array | null;
}

/** Computes every statistic Vert shows from a track's points (in recording order). */
export function computeStats(points: readonly TrackPoint[]): RunStats {
  const cumulative = cumulativeOf(points);
  const distance = cumulative.length > 0 ? (cumulative[cumulative.length - 1] ?? 0) : 0;

  const recorded = recordedElevation(points, cumulative);
  const elevation = recorded?.complete ? median3(recorded.series) : null;
  const { ascent, descent, highPoint, lowPoint, climbs, profile } = elevation
    ? elevationStats(elevation, cumulative)
    : { ...NO_ELEVATION_STATS, climbs: [], profile: [] };

  const time = filledTimes(points, cumulative);
  const startTime = time ? (time[0] ?? null) : null;
  const endTime = time ? (time[time.length - 1] ?? null) : null;
  return {
    distance,
    cumulative,
    hasElevation: elevation !== null,
    elevation,
    partialElevation: recorded && !recorded.complete ? recorded.series : null,
    ascent,
    descent,
    highPoint,
    lowPoint,
    time,
    movingTime: time ? movingTimeOf(time, points) : null,
    elapsedTime: startTime !== null && endTime !== null ? (endTime - startTime) / 1000 : null,
    startTime,
    endTime,
    climbs,
    profile,
  };
}

/** The elevation figures of {@link RunStats}. */
export type ElevationStats = Pick<
  RunStats,
  'ascent' | 'descent' | 'highPoint' | 'lowPoint' | 'climbs' | 'profile'
>;

const NO_ELEVATION_STATS = {
  ascent: null,
  descent: null,
  highPoint: null,
  lowPoint: null,
} as const;

/**
 * Ascent, descent, high and low point, climbs and the resampled profile of a per-point elevation
 * series (already filled and filtered). Used for the GPX's own `<ele>` and for elevations sampled
 * from the terrain (`terrainElevation.ts`), so both follow the same rules. O(n).
 */
export function elevationStats(elevation: Float64Array, cumulative: Float64Array): ElevationStats {
  const { ascent, descent } = elevationChange(elevation);
  let highPoint = -Infinity;
  let lowPoint = Infinity;
  for (const e of elevation) {
    if (e > highPoint) highPoint = e;
    if (e < lowPoint) lowPoint = e;
  }
  return {
    ascent,
    descent,
    highPoint,
    lowPoint,
    climbs: findClimbs(elevation, cumulative),
    profile: resampleProfile(elevation, cumulative, PROFILE_POINTS),
  };
}

// ---------------------------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------------------------

function cumulativeOf(points: readonly TrackPoint[]): Float64Array {
  const out = new Float64Array(points.length);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && (a.lat !== b.lat || a.lon !== b.lon)) total += haversine(a, b);
    out[i] = total;
  }
  return out;
}

/**
 * Index `i` and fraction `f` such that `d` lies between `cumulative[i]` and `cumulative[i + 1]`
 * (`f` in [0, 1]). `d` is clamped to the route.
 */
function locate(cumulative: Float64Array, d: number): { i: number; f: number } {
  const n = cumulative.length;
  if (n < 2 || d <= 0) return { i: 0, f: 0 };
  const total = cumulative[n - 1] ?? 0;
  if (d >= total) return { i: n - 2, f: 1 };
  let lo = 0;
  let hi = n - 1;
  // Invariant: cumulative[lo] <= d < cumulative[hi].
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] ?? 0) <= d) lo = mid;
    else hi = mid;
  }
  const d0 = cumulative[lo] ?? 0;
  const d1 = cumulative[hi] ?? 0;
  return { i: lo, f: d1 > d0 ? (d - d0) / (d1 - d0) : 0 };
}

/** Linear interpolation of a per-point series at distance `d` along the route. */
export function valueAtDistance(series: Float64Array, cumulative: Float64Array, d: number): number {
  if (series.length === 0) return NaN;
  if (series.length === 1) return series[0] ?? NaN;
  const { i, f } = locate(cumulative, d);
  const a = series[i] ?? NaN;
  const b = series[i + 1] ?? NaN;
  return a + (b - a) * f;
}

// ---------------------------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------------------------

/**
 * Fills `null` entries of `values` by linear interpolation along the route (by distance, or by
 * index where the distance does not change), holding the nearest value at either end. `null`
 * when no entry has a value.
 */
function fillGaps(
  values: readonly (number | null)[],
  cumulative: Float64Array,
): Float64Array | null {
  const n = values.length;
  const out = new Float64Array(n);
  let previous = -1; // index of the last known value
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    out[i] = v;
    if (previous === -1) {
      out.fill(v, 0, i);
    } else if (i - previous > 1) {
      const a = out[previous] ?? v;
      const d0 = cumulative[previous] ?? 0;
      const span = (cumulative[i] ?? 0) - d0;
      for (let k = previous + 1; k < i; k++) {
        const f = span > 0 ? ((cumulative[k] ?? 0) - d0) / span : (k - previous) / (i - previous);
        out[k] = a + (v - a) * f;
      }
    }
    previous = i;
  }
  if (previous === -1) return null;
  out.fill(out[previous] ?? 0, previous + 1);
  return out;
}

/**
 * The file's usable elevations per point, unfiltered: `null` when no point has an `<ele>`, every
 * `<ele>` is the same value (all 0, or a constant: no information), or, on a route of at least
 * {@link FLAT_ELEVATION_MIN_DISTANCE_M}, they all lie within {@link MIN_ELEVATION_RANGE_M} (not a
 * measurement). Otherwise gaps are filled
 * along the route ({@link fillGaps}), except gaps spanning {@link MAX_INTERPOLATED_GAP_M} or more,
 * measured between the recorded points around them (or the route's start or end), which are
 * `NaN` and make `complete` false: the terrain fills those.
 */
export function recordedElevation(
  points: readonly TrackPoint[],
  cumulative: Float64Array,
): { series: Float64Array; complete: boolean } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.ele === null) continue;
    if (p.ele < min) min = p.ele;
    if (p.ele > max) max = p.ele;
  }
  if (!Number.isFinite(min)) return null;
  // One value along a whole route (all 0, a fixed altitude, or a single <ele>) says nothing.
  if (points.length > 1 && !(max > min)) return null;
  // Nor do values within half a metre over a kilometre or more: no recorder is that steady.
  const distance = cumulative[cumulative.length - 1] ?? 0;
  if (distance >= FLAT_ELEVATION_MIN_DISTANCE_M && max - min < MIN_ELEVATION_RANGE_M) return null;
  const series = fillGaps(
    points.map((p) => p.ele),
    cumulative,
  );
  if (!series) return null;
  const n = points.length;
  let complete = true;
  let previous = -1; // the last recorded index
  for (let i = 0; i <= n; i++) {
    if (i < n && points[i]?.ele === null) continue;
    // i is recorded (or n, past the end): the points between previous and i are a gap.
    if (i - previous > 1) {
      const from = cumulative[Math.max(previous, 0)] ?? 0;
      const to = cumulative[Math.min(i, n - 1)] ?? 0;
      if (to - from >= MAX_INTERPOLATED_GAP_M) {
        series.fill(NaN, previous + 1, i);
        complete = false;
      }
    }
    previous = i;
  }
  return { series, complete };
}

/** 3-point median filter; the two end points are kept as they are. */
export function median3(values: Float64Array): Float64Array {
  const out = Float64Array.from(values);
  for (let i = 1; i < values.length - 1; i++) {
    const a = values[i - 1] ?? 0;
    const b = values[i] ?? 0;
    const c = values[i + 1] ?? 0;
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

/**
 * Indices of the alternating lows and highs of `series` once changes smaller than `threshold` are
 * ignored (a dead band): the series only "turns" after moving `threshold` away from its latest
 * extreme. A high is the first point at its height, a low the last, so a climb starts where it
 * leaves the bottom and ends where it reaches the top. Empty when the whole series stays within
 * `threshold`.
 */
export function turningPoints(series: Float64Array, threshold: number): number[] {
  const turns: number[] = [];
  const n = series.length;
  if (n === 0) return turns;
  let direction = 0; // 0 undecided, 1 rising, -1 falling
  let minIdx = 0;
  let maxIdx = 0;
  let extreme = 0; // index of the running extreme in the current direction
  for (let i = 1; i < n; i++) {
    const e = series[i] ?? 0;
    if (direction === 0) {
      if (e <= (series[minIdx] ?? 0)) minIdx = i;
      if (e > (series[maxIdx] ?? 0)) maxIdx = i;
      if (e - (series[minIdx] ?? 0) >= threshold) {
        turns.push(minIdx);
        direction = 1;
        extreme = i;
      } else if ((series[maxIdx] ?? 0) - e >= threshold) {
        turns.push(maxIdx);
        direction = -1;
        extreme = i;
      }
    } else if (direction === 1) {
      if (e > (series[extreme] ?? 0)) extreme = i;
      else if ((series[extreme] ?? 0) - e >= threshold) {
        turns.push(extreme);
        direction = -1;
        extreme = i;
      }
    } else {
      if (e <= (series[extreme] ?? 0)) extreme = i;
      else if (e - (series[extreme] ?? 0) >= threshold) {
        turns.push(extreme);
        direction = 1;
        extreme = i;
      }
    }
  }
  if (direction !== 0) turns.push(extreme);
  return turns;
}

/**
 * Ascent and descent of an elevation series with a `threshold`-metre hysteresis (default
 * {@link HYSTERESIS_M}): the reference level moves to the current elevation only once that is at
 * least `threshold` above or below it, and the move counts as ascent or descent. Exported for
 * tests and for elevations sampled from the terrain later.
 */
export function elevationChange(
  series: Float64Array,
  threshold = HYSTERESIS_M,
): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let reference = series[0] ?? 0;
  for (const e of series) {
    if (e - reference >= threshold) {
      ascent += e - reference;
      reference = e;
    } else if (reference - e >= threshold) {
      descent += reference - e;
      reference = e;
    }
  }
  return { ascent, descent };
}

/** `count` evenly spaced `{d, ele}` points from 0 to the end of the route, linearly interpolated. */
export function resampleProfile(
  series: Float64Array,
  cumulative: Float64Array,
  count = PROFILE_POINTS,
): ProfilePoint[] {
  const n = series.length;
  if (n === 0) return [];
  const total = cumulative[n - 1] ?? 0;
  if (n === 1 || total <= 0) return [{ d: 0, ele: series[0] ?? 0 }];
  const profile: ProfilePoint[] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const d = k === count - 1 ? total : (total * k) / (count - 1);
    while (i < n - 2 && (cumulative[i + 1] ?? 0) <= d) i++;
    const d0 = cumulative[i] ?? 0;
    const d1 = cumulative[i + 1] ?? 0;
    const f = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 1;
    const a = series[i] ?? 0;
    const b = series[i + 1] ?? 0;
    profile.push({ d, ele: a + (b - a) * f });
  }
  return profile;
}

// ---------------------------------------------------------------------------------------------
// Climbs
// ---------------------------------------------------------------------------------------------

interface ClimbSpan {
  /** Index of the bottom. */
  lo: number;
  /** Index of the top. */
  hi: number;
}

/**
 * Sustained climbs in a filtered elevation series.
 *
 * 1. The series is cut into rises at its turning points (2 m dead band).
 * 2. Rises are joined in route order: the next rise joins the current climb when the dip
 *    between them is under {@link MERGE_DIP_M} (10 m) or under {@link MERGE_DIP_FRACTION} (10%)
 *    of the climb's gain so far, the dip does not go below the climb's bottom, and the joined
 *    climb still averages at least {@link MIN_CLIMB_GRADE}. A rise that stays below the climb's
 *    top is absorbed without moving the top.
 * 3. A climb counts when its gain (top minus bottom) is at least {@link MIN_CLIMB_GAIN_M} (50 m)
 *    and its average grade (gain over distance) at least {@link MIN_CLIMB_GRADE} (4%).
 * 4. Long routes keep the {@link MAX_CLIMBS} biggest by gain. The steepest is the highest average
 *    grade among climbs of at least {@link STEEPEST_MIN_GAIN_M} (100 m) gain, or among all
 *    climbs when none is that big; it alone gets `steepest: true`.
 *
 * @param turns the series' turning points; computed when omitted.
 */
export function findClimbs(
  series: Float64Array,
  cumulative: Float64Array,
  turns: readonly number[] = turningPoints(series, HYSTERESIS_M),
): Climb[] {
  const ele = (i: number) => series[i] ?? 0;
  const at = (i: number) => cumulative[i] ?? 0;
  const grade = (lo: number, hi: number) => {
    const run = at(hi) - at(lo);
    return run > 0 ? (ele(hi) - ele(lo)) / run : 0;
  };

  const spans: ClimbSpan[] = [];
  let current: ClimbSpan | null = null;
  // Turning points alternate; a rise is a low followed by a high.
  for (let k = 0; k + 1 < turns.length; k++) {
    const b = turns[k] ?? 0;
    const t = turns[k + 1] ?? 0;
    if (ele(t) <= ele(b)) continue;
    if (current === null) {
      current = { lo: b, hi: t };
      continue;
    }
    const gain = ele(current.hi) - ele(current.lo);
    const dip = ele(current.hi) - ele(b);
    const tolerated = dip < MERGE_DIP_M || dip < MERGE_DIP_FRACTION * gain;
    if (ele(b) >= ele(current.lo) && tolerated) {
      if (ele(t) <= ele(current.hi)) continue; // absorbed below the top
      if (grade(current.lo, t) >= MIN_CLIMB_GRADE) {
        current.hi = t;
        continue;
      }
    }
    spans.push(current);
    current = { lo: b, hi: t };
  }
  if (current) spans.push(current);

  const climbs: Climb[] = [];
  for (const { lo, hi } of spans) {
    const gain = ele(hi) - ele(lo);
    const run = at(hi) - at(lo);
    if (gain < MIN_CLIMB_GAIN_M || run <= 0) continue;
    const avgGrade = gain / run;
    if (avgGrade < MIN_CLIMB_GRADE) continue;
    climbs.push({ start: at(lo), end: at(hi), gain, avgGrade });
  }

  const kept =
    climbs.length > MAX_CLIMBS
      ? [...climbs].sort((a, b) => b.gain - a.gain).slice(0, MAX_CLIMBS)
      : climbs;
  kept.sort((a, b) => a.start - b.start);
  return markSteepest(kept);
}

/**
 * `climbs` with `steepest: true` on the one that has the highest average grade among those of at
 * least {@link STEEPEST_MIN_GAIN_M} gain (among all of them when none is that big); the others
 * keep whatever they carry. Exported for scenes, which re-mark the climbs left after a trim.
 */
export function markSteepest(climbs: Climb[]): Climb[] {
  if (climbs.length === 0) return climbs;
  const big = climbs.filter((c) => c.gain >= STEEPEST_MIN_GAIN_M);
  const pool = big.length > 0 ? big : climbs;
  let steepest: Climb | undefined;
  for (const c of pool) if (!steepest || c.avgGrade > steepest.avgGrade) steepest = c;
  return climbs.map((c) => (c === steepest ? { ...c, steepest: true } : c));
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/**
 * Per-point timestamps with missing ones filled along the route ({@link fillGaps}), or `null`
 * when fewer than two points have a time or they span no time at all.
 */
function filledTimes(points: readonly TrackPoint[], cumulative: Float64Array): Float64Array | null {
  let known = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const p of points) {
    if (p.time === null) continue;
    known++;
    if (p.time < first) first = p.time;
    if (p.time > last) last = p.time;
  }
  if (known < 2 || last <= first) return null;
  return fillGaps(
    points.map((p) => p.time),
    cumulative,
  );
}

/** Moving time in seconds per the rules in the file header. */
function movingTimeOf(time: Float64Array, points: readonly TrackPoint[]): number {
  const n = time.length;
  const ok = continuousSteps(time, points);
  const stepOk = (i: number) => ok[i] === 1;
  const window = SPEED_WINDOW_S * 1000;
  let moving = 0;
  for (let i = 1; i < n; i++) {
    if (!stepOk(i)) continue;
    const t0 = time[i - 1] ?? 0;
    const t1 = time[i] ?? 0;
    // Grow [a, b] around the step, one point at a time on the side nearer its middle, until it
    // spans the window or meets a gap or an end of the track.
    const mid = (t0 + t1) / 2;
    let a = i - 1;
    let b = i;
    while ((time[b] ?? 0) - (time[a] ?? 0) < window) {
      const back = a > 0 && stepOk(a);
      const forward = b < n - 1 && stepOk(b + 1);
      if (!back && !forward) break;
      if (back && (!forward || mid - (time[a] ?? 0) <= (time[b] ?? 0) - mid)) a--;
      else b++;
    }
    // Straight-line displacement, not path length: jitter while standing adds path, not distance.
    const span = ((time[b] ?? 0) - (time[a] ?? 0)) / 1000;
    const from = points[a];
    const to = points[b];
    if (from && to && haversine(from, to) / span >= MIN_MOVING_SPEED) moving += (t1 - t0) / 1000;
  }
  return moving;
}

/**
 * Per step (index `i` is the step into point `i`), 1 when it is part of continuous recording:
 * it spans more than 0 s and at most {@link MAX_GAP_S}. A step touching a point whose time was
 * filled in is judged by the whole span between the recorded times around it, so an
 * interpolated gap stays a gap. Index 0 is always 0.
 */
function continuousSteps(time: Float64Array, points: readonly TrackPoint[]): Uint8Array {
  const n = time.length;
  const ok = new Uint8Array(n);
  const recorded = (i: number) => (points[i]?.time ?? null) !== null;
  // The first recorded point at or after each index (n when none), in one backward pass.
  const nextRecorded = new Int32Array(n);
  for (let i = n - 1, next = n; i >= 0; i--) {
    if (recorded(i)) next = i;
    nextRecorded[i] = next;
  }
  let previous = recorded(0) ? 0 : -1; // the last recorded point at or before i - 1
  for (let i = 1; i < n; i++) {
    let dt: number;
    if (recorded(i - 1) && recorded(i)) {
      dt = (time[i] ?? 0) - (time[i - 1] ?? 0);
    } else {
      const next = nextRecorded[i] ?? n;
      // Before the first or after the last recorded time the filled times are held (dt 0).
      dt = previous < 0 || next >= n ? 0 : (time[next] ?? 0) - (time[previous] ?? 0);
      if ((time[i] ?? 0) - (time[i - 1] ?? 0) <= 0) dt = 0;
    }
    if (dt > 0 && dt <= MAX_GAP_S * 1000) ok[i] = 1;
    if (recorded(i)) previous = i;
  }
  return ok;
}

/**
 * Seconds elapsed since the first point when the runner was `d` metres along the route,
 * interpolated between points; `null` without timestamps. `d` is clamped to the route.
 */
export function timeAtDistance(track: TimedTrack, d: number): number | null {
  const { cumulative, time } = track;
  if (!time || time.length === 0) return null;
  return (valueAtDistance(time, cumulative, d) - (time[0] ?? 0)) / 1000;
}

/**
 * Pace at `d` metres along the route, seconds per kilometre, over a window of `window` metres
 * centred on `d` (shifted to stay on the route). Elapsed time, so a stop inside the window slows
 * it. `null` without timestamps or on a route shorter than a few metres.
 */
export function paceAt(track: TimedTrack, d: number, window = 200): number | null {
  const total = track.cumulative[track.cumulative.length - 1] ?? 0;
  const span = Math.min(window, total);
  if (span < 1) return null;
  const from = Math.min(Math.max(0, d - span / 2), total - span);
  const t0 = timeAtDistance(track, from);
  const t1 = timeAtDistance(track, from + span);
  if (t0 === null || t1 === null) return null;
  return ((t1 - t0) / span) * 1000;
}
