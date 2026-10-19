/**
 * Builds a scene from a run and its terrain: the one place in `src/scene` that sees latitude and
 * longitude. Pure and synchronous, no network, no three.js: it runs in `pnpm bake` (Node) and
 * would run in a browser.
 *
 * What it drops: the heightfield's bounds and `failedTiles`, every lat/lon, the run's timestamps
 * (times become offsets from its first point), its name. What it requires and guarantees:
 *
 * - **A smooth grid at the fixed long side.** The heightfield must come from `buildHeightfield`
 *   with {@link SCENE_HEIGHTFIELD_OPTIONS} (`gridSize` = {@link SCENE_LONG_SIDE}, `sampling:
 *   'smooth'`); anything else is refused. The fixed long side keeps the spacing from being the
 *   tiles' native pixel size, and the smooth sampler leaves no periodic trace of that pixel pitch
 *   in the elevations: either would give the latitude with `zoom` (docs/SCENE.md, "No latitude
 *   from the grid"). The grid is not resampled here, since resampling would put a lattice back.
 * - **Grid-local frame.** Positions are metres from the grid's north-west corner, x east, y south,
 *   at the scene's (rounded) spacing: a route point at grid column c sits at x = c × spacing.
 * - **Only the drawn stretch.** The route, markers and climbs come from `track`, which the caller
 *   has already trimmed (`trimTrack`); distances stay those from the run's real start.
 */
import { lonLatToWorld } from '../lib/geo';
import { MIN_CLIMB_GAIN_M, MIN_CLIMB_GRADE, markSteepest, valueAtDistance } from '../gpx/stats';
import type { Climb, Run, RunTrack } from '../page/types';
import {
  elevationAt,
  gridPosition,
  type BuildHeightfieldOptions,
  type Heightfield,
} from '../terrain/heightfield';
import { gridTrackFromRun } from '../terrain/gridTrack';
import { MAX_ROUTE_POINTS, ROUTE_STEP_M, routeMarkerIndices } from '../terrain/routeRules';
import { SceneError } from './error';
import {
  MARKER_KINDS,
  SCENE_LIMITS,
  SCENE_LONG_SIDE,
  SCENE_STEPS,
  UNKNOWN_CLIMB,
  checkSceneData,
  quantise,
  routeDistance,
  toScene,
  type ClimbData,
  type MarkerData,
  type SceneData,
} from './format';
import type { Scene } from './types';

/** What `buildHeightfield` needs to produce a grid `buildScene` accepts. */
export const SCENE_HEIGHTFIELD_OPTIONS = {
  gridSize: SCENE_LONG_SIDE,
  sampling: 'smooth',
} as const satisfies BuildHeightfieldOptions;

/**
 * Grid elevation step as a fraction of the grid's spacing: quantising then tilts the ground
 * between two samples by at most 1% (0.6°), which shading does not show, and a coarse grid of big
 * mountains (100 m+ spacing) is not stored at a precision its spacing cannot use. Measured on real
 * terrain (docs/SCENE.md, "Sizes"): half this step costs 15–23% more bytes for no visible gain.
 */
export const ELEVATION_STEP_PER_SPACING = 1 / 100;

/**
 * The grid's elevation step, metres: {@link ELEVATION_STEP_PER_SPACING} of its larger spacing, at
 * least `SCENE_STEPS.gridElevation` (0.1 m), and coarse enough that the grid's range fits the
 * format's 65,535 levels (Everest-scale relief still fits). Rounded up to a millimetre.
 */
export function gridElevationStep(spacing: number, range: number): number {
  const metres = Math.max(
    SCENE_STEPS.gridElevation,
    spacing * ELEVATION_STEP_PER_SPACING,
    // Rounding both ends to a level can add one: 65,534 steps keep the top level within 65,535.
    range / (SCENE_LIMITS.maxGridLevel - 1),
  );
  return Math.ceil(Math.round(metres * 1e6) / 1000) / 1000;
}

/** Samples on each side of a grid over `heightfield`'s bounds with `longSide` on the longer. */
export function sceneGridShape(
  heightfield: Pick<Heightfield, 'bounds'>,
  longSide: number,
): { width: number; height: number } {
  const { bounds } = heightfield;
  const nw = lonLatToWorld(bounds.west, bounds.north);
  const se = lonLatToWorld(bounds.east, bounds.south);
  const spanX = se.x - nw.x;
  const spanY = se.y - nw.y;
  // The same rule as buildHeightfield: square-ish samples, the shorter side by the aspect ratio.
  const shortest = (ratio: number) => Math.max(2, Math.round(1 + (longSide - 1) * ratio));
  return spanX >= spanY
    ? { width: longSide, height: shortest(spanY / spanX) }
    : { width: shortest(spanX / spanY), height: longSide };
}

export interface BuildSceneOptions {
  /**
   * Samples on the grid's longer side; {@link SCENE_LONG_SIDE} by default (other values are for
   * measurement). The heightfield must have exactly this shape.
   */
  longSide?: number;
  /**
   * Grid elevation step, metres; {@link gridElevationStep} by default. It must leave the grid's
   * range within 65,535 levels and be at least 1 cm.
   */
  elevationStep?: number;
}

/** The parts of a run a scene keeps: its totals, its climbs and the time of its first point. */
export type SceneRun = Pick<Run, 'distance' | 'vert' | 'startTime' | 'climbs'>;

/**
 * The scene of `track` (the drawn stretch: already trimmed, `cumulative` from the run's real
 * start) on `heightfield` (with bounds, framed on that stretch), with `run`'s whole-run totals.
 *
 * - Grid: as sampled (smooth, fixed long side); spacing rounded to a centimetre; elevations to
 *   {@link gridElevationStep}.
 * - Route: evenly spaced along the drawn stretch, every {@link ROUTE_STEP_M} m or coarser to stay
 *   within {@link MAX_ROUTE_POINTS} (as the app draws it); elevations from `track.ele` (the stats'
 *   elevations), else the terrain's; times as seconds since `run.startTime`.
 * - Markers: the app's rules (`routeMarkerIndices` on `gridTrackFromRun`, so the loop is decided
 *   by `isLoop`) on the drawn stretch.
 * - Climbs: `run.climbs` clipped to the drawn stretch. A clipped climb takes its gain and grade
 *   from the drawn elevations and is dropped when it no longer counts as a climb (under
 *   `MIN_CLIMB_GAIN_M` or `MIN_CLIMB_GRADE`); the steepest is marked again among those left.
 *
 * @throws RangeError when the heightfield was not sampled smooth at the long side, the track is
 *   empty, or the scene would break a rule of the format (a route off the grid, an elevation out
 *   of range).
 */
export function buildScene(
  heightfield: Heightfield,
  track: RunTrack,
  run: SceneRun,
  { longSide = SCENE_LONG_SIDE, elevationStep }: BuildSceneOptions = {},
): Scene {
  const n = track.cumulative.length;
  if (n === 0 || track.lat.length !== n || track.lon.length !== n) {
    throw new RangeError('The track has no points, or its arrays differ in length');
  }
  const S = SCENE_STEPS;

  // Grid.
  const { width, height } = sceneGridShape(heightfield, longSide);
  if (heightfield.sampling !== 'smooth') {
    throw new RangeError(
      "The heightfield must be sampled with sampling: 'smooth' (SCENE_HEIGHTFIELD_OPTIONS)",
    );
  }
  if (heightfield.width !== width || heightfield.height !== height) {
    throw new RangeError(
      `The heightfield must be ${String(width)}×${String(height)} (gridSize ${String(longSide)}), not ${String(heightfield.width)}×${String(heightfield.height)}`,
    );
  }
  const elevations = heightfield.elevations;
  let min = Infinity;
  let max = -Infinity;
  for (const e of elevations) {
    if (e < min) min = e;
    if (e > max) max = e;
  }
  const mpsX = quantise(heightfield.metresPerSample.x, S.metresPerSample);
  const mpsY = quantise(heightfield.metresPerSample.y, S.metresPerSample);
  const step = elevationStep ?? gridElevationStep(Math.max(mpsX, mpsY) / 100, max - min);
  const stepMm = Math.round(step * 1000);
  const offset = Math.round((min * 1000) / stepMm);
  const levels = Int32Array.from(elevations, (e) => Math.round((e * 1000) / stepMm) - offset);

  // Grid-local metres of a lon/lat, in ½ m units: its grid column and row times the scene's
  // (rounded) spacing, so it lines up with the scene's samples.
  const local = (lon: number, lat: number) => {
    const p = gridPosition(heightfield, lon, lat);
    return {
      x: quantise((p.x * mpsX) / 100, S.position),
      y: quantise((p.y * mpsY) / 100, S.position),
    };
  };
  const elevationOf = (i: number) => {
    const recorded = track.ele?.[i];
    return recorded !== undefined && Number.isFinite(recorded)
      ? recorded
      : elevationAt(heightfield, track.lon[i] ?? 0, track.lat[i] ?? 0);
  };

  // Route.
  const first = track.cumulative[0] ?? 0;
  const last = track.cumulative[n - 1] ?? 0;
  const start = quantise(first, S.distance);
  const end = Math.max(start, quantise(last, S.distance));
  const length = (end - start) / 100;
  const count = Math.max(2, Math.min(MAX_ROUTE_POINTS, Math.ceil(length / ROUTE_STEP_M) + 1));
  const x = new Int32Array(count);
  const y = new Int32Array(count);
  const elevation = new Int32Array(count);
  const hasTime = track.time !== null && Number.isFinite(run.startTime);
  const time = hasTime ? new Int32Array(count) : null;
  for (let k = 0; k < count; k++) {
    const d = routeDistance(start, end, k, count);
    const lon = valueAtDistance(track.lon, track.cumulative, d);
    const lat = valueAtDistance(track.lat, track.cumulative, d);
    const p = local(lon, lat);
    x[k] = p.x;
    y[k] = p.y;
    const e = track.ele
      ? valueAtDistance(track.ele, track.cumulative, d)
      : elevationAt(heightfield, lon, lat);
    elevation[k] = quantise(e, S.elevation);
    if (time && track.time) {
      const t = (valueAtDistance(track.time, track.cumulative, d) - run.startTime) / 1000;
      time[k] = quantise(t, S.time);
    }
  }

  // Markers.
  const indices = routeMarkerIndices(gridTrackFromRun(heightfield, track), heightfield);
  const marker = (kind: number, i: number, distance: number): MarkerData => ({
    kind,
    distance,
    ...local(track.lon[i] ?? 0, track.lat[i] ?? 0),
    elevation: quantise(elevationOf(i), S.elevation),
  });
  const markers: MarkerData[] = [marker(MARKER_KINDS.start, indices.start, start)];
  if (indices.finish !== null) markers.push(marker(MARKER_KINDS.finish, indices.finish, end));
  if (indices.summit !== null) {
    const d = quantise(track.cumulative[indices.summit] ?? first, S.distance);
    markers.push(marker(MARKER_KINDS.summit, indices.summit, Math.min(end, Math.max(start, d))));
  }

  const data: SceneData = {
    grid: { width, height, zoom: heightfield.zoom, stepMm, mpsX, mpsY, offset, levels },
    route: { start, end, x, y, elevation, time },
    markers,
    climbs: clipClimbs(run.climbs, track, first, last),
    summary: {
      distance: Math.max(end, quantise(run.distance, S.distance)),
      climb: Number.isFinite(run.vert) ? quantise(run.vert, S.gain) : UNKNOWN_CLIMB,
    },
  };
  try {
    checkSceneData(data);
  } catch (error) {
    if (error instanceof SceneError)
      throw new RangeError(`Cannot build the scene: ${error.message}`);
    throw error;
  }
  return toScene(data);
}

/** `climbs` clipped to the drawn stretch [from, to] (see {@link buildScene}), as stored. */
function clipClimbs(
  climbs: readonly Climb[],
  track: RunTrack,
  from: number,
  to: number,
): ClimbData[] {
  const ele = track.ele;
  if (!ele) return [];
  const kept: Climb[] = [];
  for (const climb of climbs) {
    const start = Math.max(climb.start, from);
    const end = Math.min(climb.end, to);
    if (!(end > start)) continue;
    if (start === climb.start && end === climb.end) {
      kept.push({ start, end, gain: climb.gain, avgGrade: climb.avgGrade });
      continue;
    }
    const gain =
      valueAtDistance(ele, track.cumulative, end) - valueAtDistance(ele, track.cumulative, start);
    const avgGrade = gain / (end - start);
    if (gain < MIN_CLIMB_GAIN_M || avgGrade < MIN_CLIMB_GRADE) continue;
    kept.push({ start, end, gain, avgGrade });
  }
  const S = SCENE_STEPS;
  return markSteepest(kept)
    .map((c) => ({
      start: quantise(c.start, S.distance),
      end: quantise(c.end, S.distance),
      gain: quantise(c.gain, S.gain),
      grade: Math.min(SCENE_LIMITS.maxGradeE4, quantise(c.avgGrade, S.grade)),
      steepest: c.steepest === true,
    }))
    .filter((c) => c.end > c.start);
}
