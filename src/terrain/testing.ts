/** Test fixtures for the terrain modules (a synthetic heightfield and tracks). Not app code. */
import { cumulativeDistances } from '../lib/geo';
import type { RunTrack } from '../page/types';
import { gridDistance, type GridTrack, type TerrainGrid } from './grid';
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
 * the grid's spacing and optional elevations: a route as a baked scene carries it, no lat/lon.
 */
export function makeGridTrack(
  grid: TerrainGrid,
  points: [number, number][],
  ele?: number[],
): GridTrack {
  const col = Float64Array.from(points.map(([c]) => c));
  const row = Float64Array.from(points.map(([, r]) => r));
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const a = { col: col[i - 1] ?? 0, row: row[i - 1] ?? 0 };
    const b = { col: col[i] ?? 0, row: row[i] ?? 0 };
    cumulative[i] = (cumulative[i - 1] ?? 0) + gridDistance(grid, a, b);
  }
  return { col, row, cumulative, ele: ele ? Float64Array.from(ele) : null };
}

/** A track through `points` (lat, lon) put on `heightfield`'s grid, as TerrainView does. */
export function gridTrackOn(
  heightfield: Heightfield,
  points: [number, number][],
  ele?: number[],
): GridTrack {
  return gridTrackFromRun(heightfield, makeTrack(points, ele));
}
