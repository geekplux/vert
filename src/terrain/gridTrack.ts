/**
 * The one place the drawing path reads latitude and longitude: a run's track projected onto the
 * heightfield it is drawn on. Everything after it (route, markers, stage) works in grid space
 * (grid.ts), so the library can draw a baked scene that has no coordinates at all.
 */
import type { RunTrack } from '../page/types';
import type { GridTrack } from './grid';
import { gridProjection, type Heightfield } from './heightfield';

/**
 * `track` on `heightfield`'s grid: each point's fractional (column, row), exactly as
 * `gridPosition` gives it, with the distances and elevations passed through as they are (the same
 * arrays, not copies).
 */
export function gridTrackFromRun(
  heightfield: Heightfield,
  track: Pick<RunTrack, 'lat' | 'lon' | 'cumulative' | 'ele'>,
): GridTrack {
  const project = gridProjection(heightfield);
  const n = track.lat.length;
  const col = new Float64Array(n);
  const row = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = project(track.lon[i] ?? 0, track.lat[i] ?? 0);
    col[i] = p.x;
    row[i] = p.y;
  }
  return { col, row, cumulative: track.cumulative, ele: track.ele };
}
