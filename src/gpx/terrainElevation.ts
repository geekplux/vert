/**
 * Elevations for a run whose GPX has none, none usable, or long gaps in them, sampled from the
 * terrain grid the View draws (the same DEM), so the profile, vert, high point and climbs match
 * the model on screen.
 *
 * - No usable `<ele>` (none, all 0, all one value): every point from the terrain,
 *   `elevationSource: 'terrain'`.
 * - Long gaps (`track.partialEle`, see `recordedElevation` in stats.ts): only the gap's points
 *   come from the terrain, shifted to meet the recorded values on either side (the offset blends
 *   linearly by distance across the gap; one side at the route's ends), so a recorder that reads
 *   20 m above the DEM adds no step and no false climb at the joins. `elevationSource: 'mixed'`,
 *   or `'terrain'` when the file's own values cover under {@link MIN_RECORDED_SHARE} of the
 *   route's distance (they are then ignored).
 * - Long gaps and no terrain (it failed to load): {@link withInterpolatedGaps} draws a straight
 *   line across each gap instead, `elevationSource: 'interpolated'`, so the stats and profile
 *   still come from the file's own values; the page says the gaps are interpolated. Only for a
 *   file mostly recorded ({@link MIN_INTERPOLATED_SHARE} of the distance); any other keeps its
 *   elevation unknown.
 *
 * One bilinear sample per point, averaged over ±{@link TERRAIN_SMOOTHING_M} of route (the DEM's
 * own bumps are not climbing), then the same 3-point median filter and the same rules as the
 * file's own `<ele>` (`elevationStats`). O(n): a few tens of ms for the 500,000 points the parser
 * accepts, so it runs on the main thread when the terrain arrives.
 */

import type { ElevationSource, Run } from '../page/types';
import { elevationStats, median3 } from './stats';

/** Elevation (metres) at a position: `elevationAt(heightfield, lon, lat)` in the app. */
export type ElevationSampler = (lon: number, lat: number) => number;

/**
 * A file whose usable `<ele>` cover less than this share of the route's distance counts as having
 * none (a lone `<ele>`, or a few at the start of a long route).
 */
export const MIN_RECORDED_SHARE = 0.05;

/**
 * The share of the route's distance that `partialEle` covers: the steps whose two ends both have a
 * value (recorded, or a short gap already interpolated), over the whole distance. By points when
 * the route has no length.
 */
export function recordedShare(partialEle: Float64Array, cumulative: Float64Array): number {
  const n = partialEle.length;
  if (n === 0) return 0;
  const known = (i: number) => Number.isFinite(partialEle[i] ?? NaN);
  const total = (cumulative[n - 1] ?? 0) - (cumulative[0] ?? 0);
  if (!(total > 0)) {
    let points = 0;
    for (let i = 0; i < n; i++) if (known(i)) points++;
    return points / n;
  }
  let covered = 0;
  for (let i = 1; i < n; i++) {
    if (known(i - 1) && known(i)) covered += (cumulative[i] ?? 0) - (cumulative[i - 1] ?? 0);
  }
  return covered / total;
}

/**
 * A file whose usable `<ele>` cover at least this share of the route's distance ("mostly
 * recorded") has its long gaps interpolated when the terrain cannot fill them
 * ({@link withInterpolatedGaps}); under it a straight line would be most of the profile, so the
 * elevation stays unknown.
 */
export const MIN_INTERPOLATED_SHARE = 0.5;

/**
 * Whether the file's own values in `partialEle` cover at least `share` of the route's distance
 * (see {@link recordedShare}).
 */
function covers(
  partialEle: Float64Array | null | undefined,
  cumulative: Float64Array,
  share: number,
): partialEle is Float64Array {
  return partialEle?.length === cumulative.length && recordedShare(partialEle, cumulative) >= share;
}

/**
 * The run with elevations sampled from the terrain where the file has none: `track.ele`, vert,
 * descent, high and low point, profile and climbs filled in, `hasElevation: true` and
 * `elevationSource` `'terrain'` or `'mixed'`. A run whose elevations are complete (from its file,
 * or already filled) is returned as it is, and so is one where the sampler gives no finite value.
 */
export function withTerrainElevation(run: Run, sample: ElevationSampler): Run {
  if (run.hasElevation) return run;
  const { lat, lon, cumulative, partialEle } = run.track;
  const n = lat.length;
  if (n === 0) return run;

  const series = new Float64Array(n).fill(NaN);
  const recorded = covers(partialEle, cumulative, MIN_RECORDED_SHARE);
  if (recorded) series.set(partialEle);

  // The terrain under every point, then smoothed along the route (TERRAIN_SMOOTHING_M).
  const raw = new Float64Array(n);
  let sampled = 0;
  for (let i = 0; i < n; i++) {
    const t = sample(lon[i] ?? 0, lat[i] ?? 0);
    raw[i] = t;
    if (Number.isFinite(t) && !Number.isFinite(series[i] ?? NaN)) sampled++;
  }
  if (sampled === 0) return run;
  // A point off the grid (should not happen: the grid covers the track's bounds and more) holds
  // its neighbour's value.
  holdFinite(raw);
  const terrain = smoothByDistance(raw, cumulative, TERRAIN_SMOOTHING_M);
  const terrainAt = (i: number) => terrain[i] ?? NaN;

  for (let s = 0; s < n; s++) {
    if (Number.isFinite(series[s] ?? NaN)) continue;
    let e = s;
    while (e + 1 < n && !Number.isFinite(series[e + 1] ?? NaN)) e++;
    // Offsets (recorded − terrain) at the recorded points around the gap, where there are any.
    const before = s > 0 ? offsetAt(series, s - 1, terrainAt) : null;
    const after = e < n - 1 ? offsetAt(series, e + 1, terrainAt) : null;
    const d0 = cumulative[s - 1] ?? 0;
    const d1 = cumulative[e + 1] ?? 0;
    for (let i = s; i <= e; i++) {
      let offset = before ?? after ?? 0;
      if (before !== null && after !== null && d1 > d0) {
        offset = before + ((after - before) * ((cumulative[i] ?? 0) - d0)) / (d1 - d0);
      }
      series[i] = terrainAt(i) + offset;
    }
    s = e;
  }

  return withElevation(run, series, recorded ? 'mixed' : 'terrain');
}

/**
 * Half the window (metres along the route) that elevations sampled from the terrain are averaged
 * over before the usual rules count them. Terrarium's grid is finer than the data under it (30 m
 * SRTM, or coarser, resampled to 8–40 m pixels) and in cities it is a surface model (roofs,
 * flyovers), so raw samples along a route add metres of bumps that no runner climbed: unsmoothed,
 * the terrain gave the sample +1,176 m, Lavaredo +1,222, the E51 +3,394 and the CCC +6,838, where
 * their own recorded elevations give +1,102, +1,062, +2,876 and +6,106 (7–18% high). Averaged over
 * ±50 m they give +1,094, +1,090, +2,958 and +5,939 (−3% to +3%), with high points within 2 m.
 */
export const TERRAIN_SMOOTHING_M = 50;

/**
 * `series` (per point, along `cumulative`) averaged over ±`half` metres of route: the integral of
 * its piecewise-linear curve over the window, divided by the window's length. The window shrinks
 * symmetrically near the ends, so the first and last values are kept and a steady grade stays as
 * it is; uneven point spacing (a stop, a burst of fixes) weighs by distance, not by points. O(n).
 */
export function smoothByDistance(
  series: Float64Array,
  cumulative: Float64Array,
  half: number,
): Float64Array {
  const n = series.length;
  const out = Float64Array.from(series);
  if (n < 3 || !(half > 0)) return out;
  const c = (i: number) => cumulative[i] ?? 0;
  const v = (i: number) => series[i] ?? 0;
  // Integral of the curve from the first point to each point (trapezoids).
  const prefix = new Float64Array(n);
  for (let i = 1; i < n; i++)
    prefix[i] = (prefix[i - 1] ?? 0) + ((c(i) - c(i - 1)) * (v(i) + v(i - 1))) / 2;
  /** Integral up to `x`, where c(k) ≤ x ≤ c(k + 1). */
  const integral = (x: number, k: number) => {
    const span = c(k + 1) - c(k);
    const dx = x - c(k);
    const at = span > 0 ? v(k) + ((v(k + 1) - v(k)) * dx) / span : v(k);
    return (prefix[k] ?? 0) + (dx * (v(k) + at)) / 2;
  };
  const first = c(0);
  const last = c(n - 1);
  // Both window edges only move forward along the route as i grows.
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < n - 1; i++) {
    const d = c(i);
    const h = Math.min(half, d - first, last - d);
    if (!(h > 0)) continue;
    while (lo < n - 2 && c(lo + 1) < d - h) lo++;
    while (hi < n - 2 && c(hi + 1) < d + h) hi++;
    out[i] = (integral(d + h, hi) - integral(d - h, lo)) / (2 * h);
  }
  return out;
}

/**
 * The fallback when the terrain could not load for a file with long gaps (`track.partialEle`): each
 * gap is a straight line by distance between the recorded values around it (held level at the
 * route's ends), then the usual median filter and rules, `elevationSource: 'interpolated'`. A run
 * that already has elevations, has no gaps to fill, or whose own values cover under
 * {@link MIN_INTERPOLATED_SHARE} of the route is returned as it is (its elevation stays unknown).
 */
export function withInterpolatedGaps(run: Run): Run {
  if (run.hasElevation) return run;
  const { cumulative, partialEle } = run.track;
  if (!covers(partialEle, cumulative, MIN_INTERPOLATED_SHARE)) return run;
  const series = Float64Array.from(partialEle);
  const n = series.length;
  let previous = -1; // the last index with a value
  for (let i = 0; i <= n; i++) {
    if (i < n && !Number.isFinite(series[i] ?? NaN)) continue;
    if (i - previous > 1) {
      const a = series[previous] ?? NaN;
      const b = series[i] ?? NaN;
      const d0 = cumulative[previous] ?? 0;
      const span = (cumulative[i] ?? 0) - d0;
      for (let k = previous + 1; k < i; k++) {
        if (previous < 0) series[k] = b;
        else if (i >= n) series[k] = a;
        else {
          const f = span > 0 ? ((cumulative[k] ?? 0) - d0) / span : (k - previous) / (i - previous);
          series[k] = a + (b - a) * f;
        }
      }
    }
    previous = i;
  }
  return withElevation(run, series, 'interpolated');
}

/** `run` with `series` (filled, unfiltered) as its elevations, filtered, and its figures. */
function withElevation(run: Run, series: Float64Array, source: ElevationSource): Run {
  const { cumulative } = run.track;
  const elevation = median3(series);
  const stats = elevationStats(elevation, cumulative);
  return {
    ...run,
    hasElevation: true,
    elevationSource: source,
    vert: stats.ascent ?? NaN,
    descent: stats.descent ?? NaN,
    highPoint: stats.highPoint ?? NaN,
    lowPoint: stats.lowPoint ?? NaN,
    profile: stats.profile,
    climbs: stats.climbs,
    track: { ...run.track, ele: elevation, partialEle: null },
  };
}

/** Recorded minus terrain elevation at point `i`, or `null` when the terrain has no value there. */
function offsetAt(
  series: Float64Array,
  i: number,
  terrainAt: (i: number) => number,
): number | null {
  const offset = (series[i] ?? NaN) - terrainAt(i);
  return Number.isFinite(offset) ? offset : null;
}

/** Replaces non-finite entries with the nearest finite one before them (or after, at the start). */
function holdFinite(values: Float64Array): void {
  let last = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? NaN;
    if (Number.isFinite(v)) last = v;
    else values[i] = last;
  }
  const first = values.find((v) => Number.isFinite(v)) ?? 0;
  for (let i = 0; i < values.length && !Number.isFinite(values[i] ?? NaN); i++) values[i] = first;
}
