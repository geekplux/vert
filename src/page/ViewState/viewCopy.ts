/**
 * Data-driven copy and profile maths for the View state (DESIGN-SPEC §3 "02 View"). Pure: inputs
 * are SI (metres, fractions), `units` only picks the display unit (src/lib/format.ts).
 */
import {
  distanceUnit,
  formatDistance,
  formatElevation,
  formatGrade,
  formatNumber,
  formatPace,
  metresToDistance,
  MISSING,
  mToFt,
} from '../../lib/format';
import type { Units } from '../../lib/format';
import { isLoop } from '../../lib/loop';
import { hasSummit } from '../../lib/summit';
import type { ProfilePoint, Run, RunTrack, TerrainStatus } from '../types';

/** Half the window the readout's grade is measured over: ±50 m around the scrub point. */
export const GRADE_HALF_WINDOW = 50;

/** Where the scrub starts when the run has no steepest climb: 57% along, as the canvas draws it. */
export const DEFAULT_SCRUB_FRACTION = 0.57;

/**
 * Elevation at `d` metres along the profile, linearly interpolated between points (sorted by
 * distance). Clamps to the ends; NaN for an empty profile.
 */
export function elevationAt(points: readonly ProfilePoint[], d: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return Number.NaN;
  if (d <= first.d) return first.ele;
  if (d >= last.d) return last.ele;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid]?.d ?? 0) <= d) lo = mid;
    else hi = mid;
  }
  const a = points[lo] ?? first;
  const b = points[hi] ?? last;
  const span = b.d - a.d;
  return span > 0 ? a.ele + ((d - a.d) / span) * (b.ele - a.ele) : a.ele;
}

/**
 * Grade at `d`: rise over run across ±`GRADE_HALF_WINDOW` metres, the window clipped to the route.
 * NaN when the profile is empty or has no length.
 */
export function gradeAt(points: readonly ProfilePoint[], d: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return Number.NaN;
  const from = Math.max(first.d, d - GRADE_HALF_WINDOW);
  const to = Math.min(last.d, d + GRADE_HALF_WINDOW);
  if (to <= from) return Number.NaN;
  return (elevationAt(points, to) - elevationAt(points, from)) / (to - from);
}

/** The scrub's starting point: the steepest climb's midpoint, else 57% along the route. */
export function defaultScrub(run: Run): number {
  const steepest = run.climbs.find((climb) => climb.steepest === true);
  return steepest ? (steepest.start + steepest.end) / 2 : run.distance * DEFAULT_SCRUB_FRACTION;
}

/** "km 12.2" / "mi 7.6": a position along the route, one decimal. */
export function positionText(metres: number, units: Units): string {
  return `${distanceUnit(units)} ${formatNumber(metresToDistance(metres, units), 1)}`;
}

/** "616–1,267 m" / "2,021–4,157 ft": the run's elevation range. */
export function elevationRangeText(run: Run, units: Units): string {
  if (!Number.isFinite(run.lowPoint) || !Number.isFinite(run.highPoint)) return MISSING;
  const low = units === 'imperial' ? mToFt(run.lowPoint) : run.lowPoint;
  return `${formatNumber(low)}–${formatElevation(run.highPoint, units).text}`;
}

/**
 * Seconds per km at a distance, or `null` when unknown (no timestamps): the readout then leaves
 * pace out. The View supplies it from the run's track (`runPaceAt`).
 */
export type PaceAt = (d: number) => number | null;

/** The readout parts at the scrub point: "km 12.2", "640 m", "grade 18%", and pace if known. */
export function readoutParts(
  points: readonly ProfilePoint[],
  d: number,
  units: Units,
  paceAt?: PaceAt,
): string[] {
  const parts = [
    positionText(d, units),
    formatElevation(elevationAt(points, d), units).text,
    `grade ${formatGrade(gradeAt(points, d))}`,
  ];
  const pace = paceAt?.(d);
  if (pace != null) parts.push(formatPace(pace, units).text);
  return parts;
}

/**
 * "Summit 1,267 m" for the legend chip, or `null` when the run has no summit to mark (`hasSummit`:
 * elevation unknown, or a high point under 10 m above the low point): the terrain draws no ▲ then.
 */
export function summitText(run: Run, units: Units): string | null {
  if (!hasSummit(run.highPoint, run.lowPoint)) return null;
  return `Summit ${formatElevation(run.highPoint, units).text}`;
}

/** Under the stats when the terrain supplied every elevation (the file has none it can use). */
export const TERRAIN_ELEVATION_TEXT =
  'Elevation from terrain data. This file has no usable elevation.';
/** …when the terrain filled long gaps in the file's own elevations. */
export const MIXED_ELEVATION_TEXT = 'Elevation partly from terrain data, where this file has gaps.';
/** …while the terrain is still loading. */
export const PENDING_ELEVATION_TEXT =
  'This file has no usable elevation. Reading it from the terrain…';
export const PENDING_GAPS_TEXT = "This file's elevation has gaps. Filling them from the terrain…";
/** …when the terrain could not load. */
export const MISSING_ELEVATION_TEXT =
  "This file has no usable elevation, and the terrain couldn't load.";
export const MISSING_GAPS_TEXT =
  "This file's elevation has gaps, and the terrain couldn't load to fill them.";
/** …when the terrain could not load, so a mostly recorded file's gaps were interpolated. */
export const INTERPOLATED_GAPS_TEXT = "Elevation gaps interpolated; the terrain couldn't load.";

/**
 * The plain-words note under the stats about where the elevations come from: `null` for a file
 * with complete elevations of its own; otherwise whether the terrain supplied all or part of them,
 * is on its way, or failed (no usable elevation, or gaps in it: `track.partialEle`; gaps
 * interpolated instead).
 */
export function elevationSourceText(
  run: Pick<Run, 'elevationSource'> & { readonly track: Pick<RunTrack, 'partialEle'> },
  terrainStatus: TerrainStatus,
): string | null {
  if (run.elevationSource === 'gpx') return null;
  if (run.elevationSource === 'terrain') return TERRAIN_ELEVATION_TEXT;
  if (run.elevationSource === 'mixed') return MIXED_ELEVATION_TEXT;
  if (run.elevationSource === 'interpolated') return INTERPOLATED_GAPS_TEXT;
  const gaps = run.track.partialEle != null;
  if (terrainStatus === 'error') return gaps ? MISSING_GAPS_TEXT : MISSING_ELEVATION_TEXT;
  return gaps ? PENDING_GAPS_TEXT : PENDING_ELEVATION_TEXT;
}

/** "Vertical ×1.6" for the legend chip. */
export function exaggerationText(exaggeration: number): string {
  return `Vertical ×${exaggeration.toFixed(1)}`;
}

// The loop rule lives in src/lib/loop.ts, shared with the terrain's markers (gridTrackFromRun
// decides it once for them), so the legend, the accessible name and the shapes always agree.
export { LOOP_DISTANCE_M, isLoop } from '../../lib/loop';

/**
 * The terrain's accessible name, describing the markers the terrain draws (src/terrain/markers.ts).
 * A loop: "3D terrain of Coosa Backcountry Trail: 21.5 km loop, start and finish marked with a
 * circle, summit 1,267 m marked with a triangle". A point-to-point run: "…: 21.5 km from start to
 * finish, start marked with a circle, finish with a dotted circle, summit … with a triangle". A run
 * with no summit to mark (`summitText` is null) leaves the summit out.
 */
export function terrainLabel(run: Run, units: Units): string {
  const distance = formatDistance(run.distance, units).text;
  const route = isLoop(run.track)
    ? `${distance} loop, start and finish marked with a circle`
    : `${distance} from start to finish, start marked with a circle, finish with a dotted circle`;
  if (!hasSummit(run.highPoint, run.lowPoint)) return `3D terrain of ${run.name}: ${route}`;
  const summit = formatElevation(run.highPoint, units).text;
  return `3D terrain of ${run.name}: ${route}, summit ${summit} marked with a triangle`;
}
