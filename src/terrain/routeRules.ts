/**
 * The route rules the app and the scene bake share, kept free of three.js so the bake (Node) can
 * import them: how finely the drawn route is sampled and where its markers go. `route.ts` and
 * `markers.ts` re-export them.
 */
import { hasSummit } from '../lib/summit';
import { gridElevation, type GridTrack, type TerrainGrid } from './grid';

/** Target spacing of the resampled route, metres. */
export const ROUTE_STEP_M = 10;
/** Most points in the drawn route; longer routes are resampled more coarsely. */
export const MAX_ROUTE_POINTS = 4000;

/** Indices of the route's markers in the track. */
export interface RouteMarkerIndices {
  readonly start: number;
  /** Null for a loop (the start marker stands for both). */
  readonly finish: number | null;
  /** Null when the high point is no summit (`hasSummit`: under 10 m above the lowest point). */
  readonly summit: number | null;
}

/**
 * Where the markers go: start at the first point, finish at the last unless the route is a loop
 * (`track.loop`, decided with the legend's rule; nothing is measured here),
 * summit at the highest point (the track's elevations as the stats use them, so it matches the
 * high point shown in the aside; the terrain's elevations when the file has none), and only when
 * it stands out (`hasSummit`, the same rule as the legend and the posters).
 */
export function routeMarkerIndices(
  track: Pick<GridTrack, 'col' | 'row' | 'ele' | 'loop'>,
  grid: TerrainGrid,
): RouteMarkerIndices {
  const n = track.col.length;
  if (n === 0) throw new RangeError('The track has no points');
  const last = n - 1;
  const elevation = (i: number): number => {
    const recorded = track.ele?.[i];
    if (recorded !== undefined && Number.isFinite(recorded)) return recorded;
    return gridElevation(grid, track.col[i] ?? 0, track.row[i] ?? 0);
  };
  let summit = 0;
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = 0; i < n; i++) {
    const e = elevation(i);
    if (e > highest) {
      highest = e;
      summit = i;
    }
    if (e < lowest) lowest = e;
  }
  return {
    start: 0,
    finish: n > 1 && !track.loop ? last : null,
    summit: hasSummit(highest, lowest) ? summit : null,
  };
}
