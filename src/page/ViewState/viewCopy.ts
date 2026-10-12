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
  mToFt,
} from '../../lib/format';
import type { Units } from '../../lib/format';
import type { ProfilePoint, Run } from '../types';

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
  const low = units === 'imperial' ? mToFt(run.lowPoint) : run.lowPoint;
  return `${formatNumber(low)}–${formatElevation(run.highPoint, units).text}`;
}

/**
 * Seconds per km at a distance, or `null` when unknown. PHASE 3 supplies it from the track's
 * timestamps; phase 2 has none, so the readout leaves pace out.
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

/** "Summit 1,267 m" for the legend chip. */
export function summitText(run: Run, units: Units): string {
  return `Summit ${formatElevation(run.highPoint, units).text}`;
}

/** "Vertical ×1.6" for the legend chip. */
export function exaggerationText(exaggeration: number): string {
  return `Vertical ×${exaggeration.toFixed(1)}`;
}

/**
 * The terrain's accessible name: "3D terrain of Coosa Backcountry Loop: 21.5 km loop, start and
 * finish marked with a circle, summit 1,267 m marked with a triangle".
 *
 * The legend's "Start / finish" (Main frame) treats every run as a loop, so the label does too.
 * PHASE 3: `TerrainView` replaces this box; once the track's ends are known, a point-to-point run
 * should say "route" and name its finish separately.
 */
export function terrainLabel(run: Run, units: Units): string {
  const distance = formatDistance(run.distance, units).text;
  const summit = formatElevation(run.highPoint, units).text;
  return (
    `3D terrain of ${run.name}: ${distance} loop, start and finish marked with a circle, ` +
    `summit ${summit} marked with a triangle`
  );
}
