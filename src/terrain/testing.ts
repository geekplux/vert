/** Test fixtures for the terrain modules (a synthetic heightfield, tracks, scenes). Not app code. */
import { cumulativeDistances } from '../lib/geo';
import type { RunTrack } from '../page/types';
import type { Scene } from '../scene/types';
import { gridDistance, gridElevation, type GridTrack, type TerrainGrid } from './grid';
import { gridTrackFromRun } from './gridTrack';
import type { Heightfield } from './heightfield';

/** 120 × 80 samples, a hill and a valley, over ~3.6 × 2.2 km. */
export function hills(): Heightfield {
  const width = 120;
  const height = 80;
  const elevations = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = i / (width - 1);
      const y = j / (height - 1);
      const e =
        400 +
        600 * Math.exp(-((x - 0.7) ** 2 + (y - 0.3) ** 2) / 0.03) -
        150 * Math.exp(-((x - 0.3) ** 2 + (y - 0.6) ** 2) / 0.01);
      elevations[j * width + i] = e;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
  }
  return {
    bounds: { west: -84, south: 34.7, east: -83.96, north: 34.72 },
    zoom: 13,
    width,
    height,
    elevations,
    min,
    max,
    metresPerSample: { x: 30.6, y: 28.1 },
    failedTiles: [],
  };
}

/** A track through `points` (lat, lon), with cumulative distances and optional elevations. */
export function makeTrack(points: [number, number][], ele?: number[]): RunTrack {
  const lat = Float64Array.from(points.map(([la]) => la));
  const lon = Float64Array.from(points.map(([, lo]) => lo));
  const cumulative = cumulativeDistances(points.map(([la, lo]) => ({ lat: la, lon: lo })));
  return {
    lat,
    lon,
    cumulative,
    ele: ele ? Float64Array.from(ele) : null,
    time: null,
  };
}

/**
 * A grid track through `points` (column, row on `grid`), with cumulative distances measured with
 * the grid's spacing, optional elevations and the loop flag as given (default: not a loop): a
 * route as a baked scene carries it, no lat/lon.
 */
export function makeGridTrack(
  grid: TerrainGrid,
  points: [number, number][],
  ele?: number[],
  loop = false,
): GridTrack {
  const col = Float64Array.from(points.map(([c]) => c));
  const row = Float64Array.from(points.map(([, r]) => r));
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const a = { col: col[i - 1] ?? 0, row: row[i - 1] ?? 0 };
    const b = { col: col[i] ?? 0, row: row[i] ?? 0 };
    cumulative[i] = (cumulative[i - 1] ?? 0) + gridDistance(grid, a, b);
  }
  return { col, row, cumulative, ele: ele ? Float64Array.from(ele) : null, loop };
}

/** A track through `points` (lat, lon) put on `heightfield`'s grid, as TerrainView does. */
export function gridTrackOn(
  heightfield: Heightfield,
  points: [number, number][],
  ele?: number[],
): GridTrack {
  return gridTrackFromRun(heightfield, makeTrack(points, ele));
}

/** What {@link sceneOn} may set; everything else follows from the route. */
export interface SceneOnOptions {
  /** Distance of the route's first point, metres from the run's real start (the trim). */
  readonly start?: number;
  /** Route elevations (default: the grid's under the route). */
  readonly ele?: number[];
  /** Finish marker (column, row): default the route's last point; null for a loop. */
  readonly finish?: [number, number] | null;
  /** Summit marker (column, row), or null (the default) for none. */
  readonly summit?: [number, number] | null;
}

/**
 * A decoded scene (docs/SCENE.md) on `grid`: its route through `points` (column, row), evenly
 * spaced in distance from `start` with the grid's spacing, positions in grid-local metres, as
 * `decodeScene` returns one. No lat/lon anywhere.
 */
export function sceneOn(
  grid: TerrainGrid,
  points: [number, number][],
  { start = 200, ele, finish, summit = null }: SceneOnOptions = {},
): Scene {
  const { x: mx, y: my } = grid.metresPerSample;
  const n = points.length;
  const length = makeGridTrack(grid, points).cumulative[n - 1] ?? 0;
  const distance = Float64Array.from({ length: n }, (_, k) => start + (length * k) / (n - 1));
  const elevation = Float32Array.from(ele ?? points.map(([c, r]) => gridElevation(grid, c, r)));
  const marker = ([c, r]: [number, number], d: number) => ({
    distance: d,
    x: c * mx,
    y: r * my,
    elevation: gridElevation(grid, c, r),
  });
  const first = points[0] ?? [0, 0];
  const last = points[n - 1] ?? first;
  const end = start + length;
  return {
    version: 1,
    grid: {
      width: grid.width,
      height: grid.height,
      zoom: grid.zoom,
      metresPerSample: { x: mx, y: my },
      elevationStep: 0.1,
      elevations: grid.elevations,
      min: grid.min,
      max: grid.max,
    },
    route: {
      x: Float32Array.from(points.map(([c]) => c * mx)),
      y: Float32Array.from(points.map(([, r]) => r * my)),
      distance,
      elevation,
      time: null,
    },
    markers: {
      start: marker(first, start),
      finish: finish === null ? null : marker(finish ?? last, end),
      summit: summit ? marker(summit, (start + end) / 2) : null,
    },
    climbs: [],
    summary: {
      distance: end + start,
      climb: Number.NaN,
      drawnLength: length,
      extent: { x: mx * (grid.width - 1), y: my * (grid.height - 1) },
      trim: { start, end: start },
    },
  };
}
