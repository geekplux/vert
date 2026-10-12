/**
 * The data the page renders: one run and its terrain.
 *
 * `src/gpx/loadRun.ts` builds a `Run` from a parsed GPX (in a Web Worker); `sample.ts` keeps a
 * placeholder for tests and stories. All quantities are SI: metres, seconds, fractions.
 *
 * Missing data: a GPX may have no timestamps (a planned route) or no elevations. The quantities
 * that need them are then `NaN` rather than `null`, so every formatter in `lib/format.ts` shows
 * "–" for them without a special case; `hasTime` and `hasElevation` say which is which. A run
 * without elevations gets them from the terrain once it loads (`withTerrainElevation`,
 * `elevationSource: 'terrain'`).
 */
import type { Bounds, TileCoord } from '../lib/geo';
import type { Heightfield } from '../terrain/heightfield';

/**
 * Where a run's elevations come from: the GPX's `<ele>`, sampled from the terrain grid (the file
 * has none, or none usable), or both (the terrain filled the file's long gaps); or the GPX's
 * `<ele>` with its long gaps drawn as straight lines because the terrain could not load
 * (`interpolated`).
 */
export type ElevationSource = 'gpx' | 'terrain' | 'mixed' | 'interpolated';

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
  /**
   * True on exactly one climb of a run that has climbs: the highest `avgGrade` among climbs of at
   * least 100 m gain, or among all of them when none is that big.
   */
  readonly steepest?: boolean;
}

/**
 * The run's points as parallel typed arrays, for the terrain, the route line and the scrub
 * marker. Index `i` is the same recorded point in every array.
 */
export interface RunTrack {
  /** Latitude, degrees. */
  readonly lat: Float64Array;
  /** Longitude, degrees. */
  readonly lon: Float64Array;
  /**
   * Elevation, metres, as the stats use it: gaps filled along the route and a 3-point median
   * filter applied. `null` when the file has no elevations, until the terrain supplies them.
   */
  readonly ele: Float64Array | null;
  /**
   * The file's usable elevations when long gaps in them wait for the terrain: unfiltered, `NaN`
   * where the terrain must fill (`recordedElevation` in src/gpx/stats.ts). Absent or `null` when
   * the file's elevations are complete or unusable.
   */
  readonly partialEle?: Float64Array | null;
  /** Distance from the start, metres; non-decreasing, the last entry is `Run.distance`. */
  readonly cumulative: Float64Array;
  /** Timestamp, ms since the Unix epoch, gaps filled along the route; `null` without times. */
  readonly time: Float64Array | null;
}

/** One run, everything the View and Poster states show about it. */
export interface Run {
  /** Stable for one loaded file; changes when another file is loaded. */
  readonly id: string;
  /** Route name: the GPX `<name>`, or the file name without extension. */
  readonly name: string;
  /**
   * Start time, ms since the Unix epoch (UTC): the first point's time, else the file's metadata
   * time; `NaN` when the file has neither (`formatDateLine` throws on that, so check first).
   */
  readonly startTime: number;
  /** A longitude on the run (the start point), degrees east; for the local date line. */
  readonly lonForOffset: number;
  /** The built-in sample run, not the user's file (the UI says "SAMPLE DATA"). */
  readonly isSample: boolean;
  /** Total distance, metres. */
  readonly distance: number;
  /** Whether the points carry timestamps; when false, time quantities are `NaN`. */
  readonly hasTime: boolean;
  /**
   * Whether the elevation figures are known (from the file or the terrain); when false, elevation
   * quantities are `NaN`, the profile and climbs are empty and `track.ele` is `null`.
   */
  readonly hasElevation: boolean;
  /** Where the elevations come from; `null` while unknown (no `<ele>`, terrain not loaded). */
  readonly elevationSource: ElevationSource | null;
  /** Total ascent, metres (2 m hysteresis on the median-filtered elevations). */
  readonly vert: number;
  /** Total descent, metres, positive. */
  readonly descent: number;
  /** Time spent moving, seconds (pauses over 30 s and standing still excluded). */
  readonly movingTime: number;
  /** First to last timestamp, seconds. */
  readonly elapsedTime: number;
  /** Highest elevation, metres. */
  readonly highPoint: number;
  /** Lowest elevation, metres. */
  readonly lowPoint: number;
  /** About 500 points, `d` increasing from 0 to `distance`; empty without elevations. */
  readonly profile: readonly ProfilePoint[];
  /** In order along the route; at most 8 (the biggest) on long runs. */
  readonly climbs: readonly Climb[];
  /** The track's lon/lat bounding box, rounded outward to 4 decimals (≈ 11 m). */
  readonly bounds: Bounds;
  /** Every recorded point, for drawing the route on the terrain. */
  readonly track: RunTrack;
}

export type TerrainStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The terrain under the run (`useTerrain()`): the height grid built from elevation tiles as soon as
 * a run loads (`RunProvider`), or why it could not be built.
 *
 * - `idle`: no run.
 * - `loading`: tiles are on their way.
 * - `ready`: `heightfield` is the grid; `failedTiles` lists tiles that did not load (their area is
 *   filled from neighbouring tiles; `totalTiles` is how many were asked for), empty when all loaded.
 * - `error`: no tile loaded (offline, server down) or the grid could not be built; `error` is the
 *   message to show. `useRetryTerrain()` tries again.
 */
export type Terrain =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly heightfield: Heightfield;
      readonly failedTiles: readonly TileCoord[];
      readonly totalTiles: number;
    }
  | { readonly status: 'error'; readonly error: string };
