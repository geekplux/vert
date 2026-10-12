/**
 * The data the page renders: one run and its terrain.
 *
 * Phase 2 fills these from `sample.ts` (placeholder data). Phase 3 produces the same shapes from a
 * parsed GPX (in a Web Worker) and fetched elevation tiles, so the components that read them do
 * not change. All quantities are SI: metres, seconds, fractions.
 */
import type { Bounds } from '../lib/geo';

/** One point of the elevation profile: distance from the start and elevation, both in metres. */
export interface ProfilePoint {
  readonly d: number;
  readonly ele: number;
}

/** A sustained climb, located by distance from the start. */
export interface Climb {
  /** Distance from the start where the climb begins, metres. */
  readonly start: number;
  /** Distance from the start where the climb ends, metres. */
  readonly end: number;
  /** Elevation gained over the climb, metres. */
  readonly gain: number;
  /** gain / (end − start), a fraction (0.188 is 18.8%). */
  readonly avgGrade: number;
  /** True on exactly one climb of a run that has climbs: the one with the highest `avgGrade`. */
  readonly steepest?: boolean;
}

/** One run, everything the View and Poster states show about it. */
export interface Run {
  /** Stable for one loaded file; changes when another file is loaded. */
  readonly id: string;
  /** Route name: the GPX `<name>`, or the file name without extension. */
  readonly name: string;
  /** Start time, ms since the Unix epoch (UTC). */
  readonly startTime: number;
  /** A longitude on the run (the start point), degrees east; for the local date line. */
  readonly lonForOffset: number;
  /** The built-in sample run, not the user's file (the UI says "SAMPLE DATA"). */
  readonly isSample: boolean;
  /** Total distance, metres. */
  readonly distance: number;
  /** Total ascent, metres. */
  readonly vert: number;
  /** Time spent moving, seconds. */
  readonly movingTime: number;
  /** Highest elevation, metres. */
  readonly highPoint: number;
  /** Lowest elevation, metres. */
  readonly lowPoint: number;
  /** About 500 points, `d` increasing from 0 to `distance`. */
  readonly profile: readonly ProfilePoint[];
  /** In order along the route. */
  readonly climbs: readonly Climb[];
  /** The track's lon/lat bounding box. */
  readonly bounds: Bounds;
}

export type TerrainStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The terrain under the run. Phase 2 has no terrain: `placeholder: true` tells the page to draw
 * the grey placeholder box. Phase 3 replaces this with the mesh state (tiles, errors).
 */
export interface Terrain {
  readonly status: TerrainStatus;
  readonly placeholder: true;
}
