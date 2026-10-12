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
 *   or `'terrain'` when the file's own values are under {@link MIN_RECORDED_SHARE} of the points
 *   (they are then ignored).
 *
 * One bilinear sample per filled point, then the same 3-point median filter and the same rules as
 * the file's own `<ele>` (`elevationStats`). O(n): about 10 ms for the 500,000 points the parser
 * accepts, so it runs on the main thread when the terrain arrives.
 */

import type { ElevationSource, Run } from '../page/types';
import { elevationStats, median3 } from './stats';

/** Elevation (metres) at a position: `elevationAt(heightfield, lon, lat)` in the app. */
export type ElevationSampler = (lon: number, lat: number) => number;

/** A file whose usable `<ele>` cover fewer points than this share counts as having none. */
export const MIN_RECORDED_SHARE = 0.05;

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
  let recorded = 0;
  if (partialEle?.length === n) {
    for (let i = 0; i < n; i++) if (Number.isFinite(partialEle[i] ?? NaN)) recorded++;
    if (recorded >= MIN_RECORDED_SHARE * n) series.set(partialEle);
    else recorded = 0;
  }

  const terrainAt = (i: number) => sample(lon[i] ?? 0, lat[i] ?? 0);
  let sampled = 0;
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
      const t = terrainAt(i);
      if (!Number.isFinite(t)) continue;
      sampled++;
      let offset = before ?? after ?? 0;
      if (before !== null && after !== null && d1 > d0) {
        offset = before + ((after - before) * ((cumulative[i] ?? 0) - d0)) / (d1 - d0);
      }
      series[i] = t + offset;
    }
    s = e;
  }
  if (sampled === 0) return run;
  // A point off the grid (should not happen: the grid covers the track's bounds and more) holds
  // its neighbour's value.
  holdFinite(series);

  const elevation = median3(series);
  const stats = elevationStats(elevation, cumulative);
  const source: ElevationSource = recorded > 0 ? 'mixed' : 'terrain';
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
