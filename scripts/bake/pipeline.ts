/**
 * The bake itself: one activity in, one scene and its sidecar out (docs/SCENE.md, "Baking a
 * scene").
 *
 * 1. **The run**, exactly as the app builds it: the parse worker's handler (or the same `buildRun`
 *    for a points file), then, when the file has no usable elevations or long gaps in them, the
 *    app's `withTerrainElevation` sampled from the app's own grid of the whole run
 *    (`buildHeightfield(run.bounds)`, bilinear), so the totals match what Vert's View shows.
 * 2. **The drawn stretch**: `trimTrack` (the poster's "Hide start and end"), `trim` metres off
 *    each end.
 * 3. **The scene grid**, framed on the drawn stretch: `buildHeightfield(bounds of the drawn
 *    stretch, SCENE_HEIGHTFIELD_OPTIONS)`; then `buildScene`, `encodeScene`, the sidecar.
 * 4. **Checks** before anything is written: the privacy scanners on the bytes, the decoded scene
 *    and the sidecar text, and the pixel-pitch attack with the true latitude (which only the bake
 *    knows). Any finding refuses the scene.
 *
 * Deterministic: no clock, no randomness reaches the bytes; the same input and tiles give the
 * same files.
 */
import {
  localMetres,
  lonLatToWorld,
  worldToLonLat,
  type Bounds,
  type LatLon,
} from '../../src/lib/geo';
import { formatNumber } from '../../src/lib/format';
import { withTerrainElevation } from '../../src/gpx/terrainElevation';
import { trimTrack } from '../../src/gpx/trim';
import type { Run, RunTrack } from '../../src/page/types';
import {
  HeightfieldError,
  HeightfieldTooLargeError,
  buildHeightfield,
  elevationAt,
  type BuildHeightfieldOptions,
  type Heightfield,
} from '../../src/terrain/heightfield';
import {
  SCENE_HEIGHTFIELD_OPTIONS,
  buildScene,
  buildSidecar,
  decodeScene,
  encodeScene,
  isPitchHidden,
  pitchSignature,
  scanScene,
  sidecarJson,
  type PrivacyFinding,
  type SceneSidecar,
} from '../../src/scene/bake';
import type { Scene } from '../../src/scene/types';
import { BakeError, scrub } from './errors';
import { checkIdPrivacy } from './id';
import type { BakeInput } from './input';
import { MAX_IN_FLIGHT, type TileSource, type TileStats } from './tiles';

/** The poster's "Hide start and end" default, metres off each end. */
export const DEFAULT_TRIM_M = 200;

/** Largest `--trim`, metres. */
export const MAX_TRIM_M = 10_000;

export interface BakeSceneOptions {
  readonly id: string;
  /** The id was given with `--id` (see `checkIdPrivacy`); false for one made from a file name. */
  readonly explicitId?: boolean;
  /** Metres trimmed off each end of the drawn route; 0 keeps the ends. */
  readonly trim: number;
  readonly tiles: TileSource;
}

/** A baked scene, checked and ready to write. */
export interface BakedScene {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly scene: Scene;
  readonly sidecar: SceneSidecar;
  /** The sidecar as published (two-space JSON, trailing newline). */
  readonly sidecarText: string;
  /** Where the run's elevations came from (`Run.elevationSource`). */
  readonly elevationSource: Run['elevationSource'];
  /**
   * The file's elevations minus the terrain's along the drawn route, whole metres: the mean
   * (weighted by distance) and the range. Null when the elevations are not all the file's own.
   */
  readonly elevationOffset: ElevationOffset | null;
  readonly tiles: Readonly<TileStats>;
  /** Tiles of the scene grid that were missing upstream and filled from their neighbours. */
  readonly sceneMissingTiles: number;
  readonly privacy: { readonly findings: number; readonly pitchHidden: boolean };
  /** Things worth knowing that did not stop the bake (no coordinates in them). */
  readonly warnings: readonly string[];
}

/** The real start or finish closer than this to the drawn route earns a warning, metres. */
export const NEAR_END_WARNING_M = 100;

/** File minus terrain elevation along the drawn route, whole metres. */
export interface ElevationOffset {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/**
 * The bounds of a run's track (or a stretch of it), in the track's own longitudes. A run's
 * longitudes are already unwrapped across the antimeridian (`buildRun`, in the representation of
 * `run.bounds`), so their plain minimum and maximum are the box. `boundsOf` would choose the
 * narrowest representation for this stretch alone, which for a stretch of a loop centred on 180°
 * can be the other side of the line from the track's: every point would then lie off its grid.
 */
export function trackBounds(track: Pick<RunTrack, 'lat' | 'lon'>): Bounds {
  if (track.lat.length === 0) throw new RangeError('trackBounds needs at least one point');
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (let i = 0; i < track.lat.length; i++) {
    const lat = track.lat[i] ?? 0;
    const lon = track.lon[i] ?? 0;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return { west, south, east, north };
}

/** Metres from (lat, lon) to the nearest point of the polyline `track`. */
export function distanceToTrack(point: LatLon, track: Pick<RunTrack, 'lat' | 'lon'>): number {
  const at = (i: number) => localMetres(point, { lat: track.lat[i] ?? 0, lon: track.lon[i] ?? 0 });
  let best = Infinity;
  let a = at(0);
  best = Math.hypot(a.x, a.y);
  for (let i = 1; i < track.lat.length; i++) {
    const b = at(i);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
    a = b;
  }
  return best;
}

/** Whether `point` lies at least {@link NEAR_END_WARNING_M} from the route drawn with `trim`. */
function clearAt(track: RunTrack, point: LatLon, trim: number): boolean {
  const drawn = trimTrack(track, trim);
  return drawn !== null && distanceToTrack(point, drawn) >= NEAR_END_WARNING_M;
}

/**
 * The smallest `--trim` (in whole tens of metres, up to {@link MAX_TRIM_M}) whose drawn route
 * stays {@link NEAR_END_WARNING_M} clear of `point`, or null when none does (the route passes it
 * again too far from either end). A larger trim draws a sub-stretch of a smaller one's, so being
 * clear only ever turns on as the trim grows: a binary search finds the first.
 */
export function clearingTrim(track: RunTrack, point: LatLon, from: number): number | null {
  const total = track.cumulative[track.cumulative.length - 1] ?? 0;
  let lo = Math.floor(from / 10) + 1;
  let hi = Math.floor(Math.min(MAX_TRIM_M, total / 2) / 10);
  if (lo > hi || !clearAt(track, point, hi * 10)) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (clearAt(track, point, mid * 10)) hi = mid;
    else lo = mid + 1;
  }
  return lo * 10;
}

/**
 * Where along the whole route (its own metres) it passes within {@link NEAR_END_WARNING_M} of
 * `point` farthest from both ends: the pass a trim would have to reach. Null when no recorded
 * point is that close (only a step between two points is).
 */
function deepestPass(track: RunTrack, point: LatLon): number | null {
  const total = track.cumulative[track.cumulative.length - 1] ?? 0;
  let best: number | null = null;
  for (let i = 0; i < track.lat.length; i++) {
    const m = localMetres(point, { lat: track.lat[i] ?? 0, lon: track.lon[i] ?? 0 });
    if (Math.hypot(m.x, m.y) >= NEAR_END_WARNING_M) continue;
    const along = track.cumulative[i] ?? 0;
    if (best === null || Math.min(along, total - along) > Math.min(best, total - best)) {
      best = along;
    }
  }
  return best;
}

const km = (metres: number) => `km ${formatNumber(metres / 1000, 1)}`;

/**
 * Warnings for a real start or finish that lies near the drawn route (a loop or laps pass it
 * again after the trim): how near (tens of metres), where along the route (km, one decimal), and
 * the smallest `--trim` that hides it or that none does. Distances along the route only, never a
 * coordinate.
 */
function nearEndWarnings(track: RunTrack, drawn: RunTrack, trim: number): string[] {
  if (!(trim > 0)) return [];
  const n = track.lat.length;
  const total = track.cumulative[n - 1] ?? 0;
  const ends = [
    ['start', 0],
    ['finish', n - 1],
  ] as const;
  const warnings: string[] = [];
  for (const [name, i] of ends) {
    const point = { lat: track.lat[i] ?? 0, lon: track.lon[i] ?? 0 };
    const d = distanceToTrack(point, drawn);
    if (d >= NEAR_END_WARNING_M) continue;
    const near = d < 10 ? 'within 10 m of' : `about ${String(Math.round(d / 10) * 10)} m from`;
    const pass = deepestPass(track, point);
    const where = pass === null ? '' : ` at ${km(pass)} of ${formatNumber(total / 1000, 1)}`;
    const clearing = clearingTrim(track, point, trim);
    warnings.push(
      clearing === null
        ? `The run's real ${name} lies ${near} the drawn route${where}: the route passes its ` +
            `${name} again, so no --trim hides it.`
        : `The run's real ${name} lies ${near} the drawn route${where} (a loop or laps pass it ` +
            `again), so the trim does not hide it; a --trim of ${formatNumber(clearing)} m does.`,
    );
  }
  return warnings;
}

/**
 * File minus terrain elevation at each point of the drawn route (the terrain sampled from the
 * scene grid, bilinear): the distance-weighted mean and the range, whole metres. Null without a
 * finite sample.
 */
export function elevationOffset(drawn: RunTrack, grid: Heightfield): ElevationOffset | null {
  const { ele, cumulative } = drawn;
  if (!ele) return null;
  let min = Infinity;
  let max = -Infinity;
  let weighted = 0;
  let length = 0;
  let previous: number | null = null;
  for (let i = 0; i < ele.length; i++) {
    const offset = (ele[i] ?? NaN) - elevationAt(grid, drawn.lon[i] ?? 0, drawn.lat[i] ?? 0);
    if (!Number.isFinite(offset)) {
      previous = null;
      continue;
    }
    min = Math.min(min, offset);
    max = Math.max(max, offset);
    if (previous !== null) {
      const step = (cumulative[i] ?? 0) - (cumulative[i - 1] ?? 0);
      weighted += ((previous + offset) / 2) * step;
      length += step;
    }
    previous = offset;
  }
  if (!Number.isFinite(min)) return null;
  // A route with no length (all points in one place): the plain mean of its ends.
  const mean = length > 0 ? weighted / length : (min + max) / 2;
  return { mean: Math.round(mean), min: Math.round(min), max: Math.round(max) };
}

/** Latitude of a heightfield's centre row (Web Mercator midpoint of its bounds). */
function centreLatitude({ bounds }: Pick<Heightfield, 'bounds'>): number {
  const north = lonLatToWorld(bounds.west, bounds.north).y;
  const south = lonLatToWorld(bounds.west, bounds.south).y;
  return worldToLonLat(0, (north + south) / 2).lat;
}

/** `buildHeightfield` with the bake's tiles, its stop signal and its politeness. */
async function heightfield(
  bounds: Bounds,
  tiles: TileSource,
  options: BuildHeightfieldOptions = {},
): Promise<Heightfield> {
  try {
    return await buildHeightfield(bounds, {
      ...options,
      fetchTile: tiles.fetchTile,
      signal: tiles.signal,
      concurrency: MAX_IN_FLIGHT,
    });
  } catch (error) {
    if (error instanceof BakeError) throw error;
    if (tiles.signal.aborted && tiles.signal.reason instanceof BakeError) throw tiles.signal.reason;
    if (error instanceof HeightfieldTooLargeError) {
      throw new BakeError('The route covers too large an area to fetch elevation tiles for.');
    }
    if (error instanceof HeightfieldError) {
      throw new BakeError(
        `No elevation tile exists for this area (all ${String(error.failedTiles.length)} missing upstream).`,
      );
    }
    throw error;
  }
}

/**
 * Bakes the scene of `input` (see the module comment). Writes nothing.
 *
 * @throws BakeError for a route too short to trim, a tile problem, or any privacy finding.
 */
export async function bakeScene(input: BakeInput, options: BakeSceneOptions): Promise<BakedScene> {
  const { id, trim, tiles } = options;
  let run: Run = { ...input.run, id, track: input.points };
  checkIdPrivacy(id, run.bounds, { explicit: options.explicitId === true });

  // 1. Elevations from the terrain where the file has none, as the app fills them.
  let appGrid: Heightfield | null = null;
  if (!run.hasElevation) {
    const grid = await heightfield(run.bounds, tiles);
    appGrid = grid;
    run = withTerrainElevation(run, (lon, lat) => elevationAt(grid, lon, lat));
  }

  // 2. The drawn stretch.
  const drawn = trimTrack(run.track, trim);
  if (!drawn || drawn.cumulative.length < 2) {
    throw new BakeError(
      `The route is too short to trim ${String(trim)} m off each end; pass a smaller --trim.`,
    );
  }

  // 3. The scene grid on the drawn stretch, and the scene.
  const sceneGrid = await heightfield(trackBounds(drawn), tiles, SCENE_HEIGHTFIELD_OPTIONS);
  let bytes: Uint8Array;
  try {
    bytes = encodeScene(buildScene(sceneGrid, drawn, run));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BakeError(`The scene cannot be built: ${scrub(error.message)}`, { cause: error });
    }
    throw error;
  }
  const scene = decodeScene(bytes);
  const sidecar = buildSidecar(bytes);
  const sidecarText = sidecarJson(sidecar);

  // 4. Privacy: every coordinate of the whole run, every box around it.
  const secrets = {
    lat: run.track.lat,
    lon: run.track.lon,
    bounds: [
      run.bounds,
      trackBounds(run.track),
      trackBounds(drawn),
      sceneGrid.bounds,
      ...(appGrid ? [appGrid.bounds] : []),
    ],
  };
  const findings = scanScene({ bytes, scene, sidecar: sidecarText }, secrets);
  const pitchHidden = isPitchHidden(pitchSignature(scene.grid, centreLatitude(sceneGrid)));
  if (findings.length > 0 || !pitchHidden) {
    throw new BakeError(
      `The privacy check refused this scene: ${describe(findings, pitchHidden)}.`,
    );
  }

  return {
    id,
    bytes,
    scene,
    sidecar,
    sidecarText,
    elevationSource: run.elevationSource,
    tiles: tiles.stats,
    sceneMissingTiles: sceneGrid.failedTiles.length,
    // Only when every elevation is the file's own (a mixed run's gaps came from this terrain).
    elevationOffset: run.elevationSource === 'gpx' ? elevationOffset(drawn, sceneGrid) : null,
    privacy: { findings: 0, pitchHidden },
    warnings: [
      ...nearEndWarnings(run.track, drawn, trim),
      ...(tiles.stats.uncached > 0
        ? [
            `${String(tiles.stats.uncached)} downloaded tile(s) could not be written to the cache ` +
              '(read-only or full?); the scene used them all the same.',
          ]
        : []),
    ],
  };
}

/** What the privacy check found, by place only (a finding's details may hold the value). */
function describe(findings: readonly PrivacyFinding[], pitchHidden: boolean): string {
  const count = (where: PrivacyFinding['where']) =>
    findings.filter((f) => f.where === where).length;
  const parts = [
    `${String(count('bytes'))} in the bytes`,
    `${String(count('object'))} in the decoded scene`,
    `${String(count('text'))} in the sidecar`,
  ];
  if (!pitchHidden) parts.push("the tiles' pixel pitch shows in the grid");
  return parts.join(', ');
}
