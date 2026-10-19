/**
 * Time ↔ distance on a scene's drawn route (docs/SCENE.md): what a host needs to drive Vert's
 * scrub from its own time-based chart (a heart-rate chart, say) and to follow Vert's scrub back.
 * Linear interpolation over the route's parallel arrays, `distance` (metres from the run's real
 * start) and `time` (seconds since the run's first point). Pure: no React, no three.js.
 *
 * The rules, the same for every function here:
 *
 * - **No times, no answer.** A scene baked from a run without times (`route.time` null) gives
 *   `null`, as does a route with no points.
 * - **The drawn stretch only.** A time before the drawn route's first point or after its last (in
 *   the trimmed ends, or past the run) gives `null`, as does a distance off the drawn route: the
 *   host hides the scrub there rather than parking it at an end, which would show the runner
 *   somewhere they were not. `sceneTimeRange` says which stretch of the host's own time axis
 *   that is.
 * - **Non-finite input** (NaN, ±Infinity) gives `null`.
 * - **Stops.** A decoded scene's points are evenly spaced in distance, so a stop shows as one step
 *   that takes a long time; both directions interpolate linearly across it. Where a route repeats a
 *   distance while time goes on (a hand-made scene's stop), `metresAtTime` stays at that distance
 *   (flat) and `timeAtMetres` gives the first time at it; where it repeats a time while the
 *   distance moves on, `metresAtTime` gives the first distance at that time.
 * - **Well-ordered routes only.** Distances and times must be finite and never decrease (as
 *   `pnpm bake` writes them); a route that breaks that (a hand-written file) gives `null`. It is
 *   checked once per route object.
 *
 * Each lookup is a binary search, O(log n), and allocates nothing.
 */
import type { Scene, SceneRoute } from './types';

/** The drawn route's first and last times, seconds since the run's first point. */
export interface SceneTimeRange {
  readonly start: number;
  readonly end: number;
}

/** Per route object: whether its distances and times are finite and non-decreasing. */
const ordered = new WeakMap<SceneRoute, boolean>();

/** The route's points that have both a distance and a time; 0 when it cannot be used. */
function usableLength(route: SceneRoute): number {
  const { distance, time } = route;
  if (!time) return 0;
  const n = Math.min(distance.length, time.length);
  if (n === 0) return 0;
  let ok = ordered.get(route);
  if (ok === undefined) {
    ok = isOrdered(distance, n) && isOrdered(time, n);
    ordered.set(route, ok);
  }
  return ok ? n : 0;
}

function isOrdered(values: Float64Array, n: number): boolean {
  let last = -Infinity;
  for (let k = 0; k < n; k++) {
    const value = values[k] ?? Number.NaN;
    if (!Number.isFinite(value) || value < last) return false;
    last = value;
  }
  return true;
}

/** The first index in `values[0, n)` whose value is ≥ `target` (n when none is). */
function lowerBound(values: Float64Array, n: number, target: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((values[mid] ?? Infinity) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * `at` mapped from `from` onto `to` (parallel, non-decreasing, `n` long): `to` at the first index
 * where `from` equals `at`, else interpolated between the two points around it; null off the range.
 */
function interpolate(from: Float64Array, to: Float64Array, n: number, at: number): number | null {
  if (n === 0 || !Number.isFinite(at)) return null;
  const first = from[0] ?? Number.NaN;
  const last = from[n - 1] ?? Number.NaN;
  if (at < first || at > last) return null;
  const j = lowerBound(from, n, at);
  const fj = from[j] ?? Number.NaN;
  const tj = to[j] ?? Number.NaN;
  // j ≥ 1 here unless from[0] === at (handled by this branch), since at ≥ from[0].
  if (fj === at) return tj;
  const fi = from[j - 1] ?? Number.NaN;
  const ti = to[j - 1] ?? Number.NaN;
  // from[j − 1] < at < from[j], so the step has a length.
  return ti + ((tj - ti) * (at - fi)) / (fj - fi);
}

/**
 * Where the runner was `seconds` after the run's first point: metres from the run's real start
 * (the scene's distances, the metres `TerrainView` and `ElevationProfile` take as `scrub`). Null
 * without times, off the drawn stretch, or for a non-finite time (see the rules above).
 */
export function metresAtTime(scene: Scene, seconds: number): number | null {
  const { route } = scene;
  const n = usableLength(route);
  return route.time ? interpolate(route.time, route.distance, n, seconds) : null;
}

/**
 * When the runner was `metres` from the run's real start: seconds since the run's first point (the
 * first such time when the route stood still there). Null without times, off the drawn route, or
 * for a non-finite distance (see the rules above).
 */
export function timeAtMetres(scene: Scene, metres: number): number | null {
  const { route } = scene;
  const n = usableLength(route);
  return route.time ? interpolate(route.distance, route.time, n, metres) : null;
}

/**
 * The stretch of the run's time the drawn route covers, seconds since its first point: where a
 * host's own time axis (which spans the whole run, from 0) can drive the scrub, and outside which
 * `metresAtTime` gives null (the trimmed ends). Null without times.
 */
export function sceneTimeRange(scene: Scene): SceneTimeRange | null {
  const { time } = scene.route;
  const n = usableLength(scene.route);
  if (!time || n === 0) return null;
  return { start: time[0] ?? 0, end: time[n - 1] ?? 0 };
}
