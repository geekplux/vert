/**
 * What drawing the terrain needs, and nothing georeferenced: a height grid ({@link TerrainGrid})
 * and a route in the grid's own sample coordinates ({@link GridTrack}). The mesh, the route, the
 * markers and the stage work in these alone; latitude and longitude are converted once, at the
 * edge (`gridTrackFromRun` in gridTrack.ts), or never (a baked scene whose route is already in
 * grid units: DECISIONS.md "Library for Activities").
 */
import { sampleBilinear } from '../lib/terrarium';

/**
 * A regular grid of elevations. Samples sit on grid nodes: column 0 is the west edge, column
 * `width − 1` the east edge, row 0 the north edge, row `height − 1` the south edge, evenly spaced
 * (very nearly square on the ground). A `Heightfield` is one, with the bounds it was sampled for.
 */
export interface TerrainGrid {
  /** Zoom of the tiles the grid was sampled from. */
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  /** Metres, row-major from the north-west corner, `width * height` values. */
  readonly elevations: Float32Array;
  readonly min: number;
  readonly max: number;
  /** Ground distance between neighbouring samples at the grid's centre. */
  readonly metresPerSample: { readonly x: number; readonly y: number };
}

/**
 * A route in a grid's sample coordinates, as parallel arrays (one entry per point): `col` and
 * `row` are fractional grid positions (column 0 the west edge, row 0 the north edge; outside the
 * grid they fall outside [0, width − 1] × [0, height − 1]). A grid track belongs to the grid it
 * was made for.
 */
export interface GridTrack {
  /** Fractional column, samples from the west edge. */
  readonly col: Float64Array;
  /** Fractional row, samples from the north edge. */
  readonly row: Float64Array;
  /** Distance from the start, metres; non-decreasing. */
  readonly cumulative: Float64Array;
  /**
   * Elevation, metres, as the stats use it (the summit marker goes on its highest point); `null`
   * when there is none, and the terrain's elevations stand in.
   */
  readonly ele: Float64Array | null;
  /**
   * The route ends where it starts: one ○ marks both, no ◉ finish. Decided once, outside grid
   * space, by the same rule as the legend and the accessible name (`isLoop` in src/lib/loop.ts,
   * by great-circle distance), never re-measured on the grid: the grid's spacing holds only at its
   * centre, and a baked scene sets it from its stored markers.
   */
  readonly loop: boolean;
  /**
   * Where the markers stand, when they were decided before the track reached the grid: a baked
   * scene's stored markers (docs/SCENE.md, `MARK`), placed on the original track and kept exactly.
   * Absent for the app's own tracks, whose markers follow `routeMarkerIndices` (routeRules.ts).
   */
  readonly markers?: GridMarkers;
}

/** A fractional grid position (column, row), as in {@link GridTrack}. */
export interface GridPoint {
  readonly col: number;
  readonly row: number;
}

/** Fixed markers in grid coordinates: ○ start, ◉ finish (null on a loop), ▲ summit (or null). */
export interface GridMarkers {
  readonly start: GridPoint;
  readonly finish: GridPoint | null;
  readonly summit: GridPoint | null;
}

/** Ground the grid spans on its longer side, metres (at its centre). */
export function groundExtent(grid: TerrainGrid): number {
  const { width, height, metresPerSample } = grid;
  return Math.max(metresPerSample.x * (width - 1), metresPerSample.y * (height - 1));
}

/** Bilinear elevation at a fractional grid position, metres; outside the grid, its edge value. */
export function gridElevation(grid: TerrainGrid, col: number, row: number): number {
  return sampleBilinear(grid.elevations, grid.width, grid.height, col, row);
}

/** Ground distance between two grid positions, metres (the grid's spacing at its centre). */
export function gridDistance(
  grid: TerrainGrid,
  a: { readonly col: number; readonly row: number },
  b: { readonly col: number; readonly row: number },
): number {
  return Math.hypot(
    (b.col - a.col) * grid.metresPerSample.x,
    (b.row - a.row) * grid.metresPerSample.y,
  );
}
