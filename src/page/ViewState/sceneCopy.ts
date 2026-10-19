/**
 * The View's copy and maths for a baked scene opened from a link (src/page/sceneLink.ts), the
 * scene counterparts of `viewCopy.ts`'s run helpers. Pure. A scene describes the drawn stretch of
 * a run (its ends may be hidden) plus the whole run's distance and climb; every figure here says
 * which it uses.
 */
import { formatDistance, formatElevation, formatNumber, MISSING, mToFt } from '../../lib/format';
import type { Units } from '../../lib/format';
import { timeAtMetres } from '../../scene/time';
import type { Scene } from '../../scene/types';
import { DEFAULT_SCRUB_FRACTION } from './viewCopy';

/** The drawn route's lowest and highest elevations, metres; NaN for a route with none. */
export function sceneElevationRange(scene: Scene): { low: number; high: number } {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const ele of scene.route.elevation) {
    if (!Number.isFinite(ele)) continue;
    if (ele < low) low = ele;
    if (ele > high) high = ele;
  }
  return low <= high ? { low, high } : { low: Number.NaN, high: Number.NaN };
}

/** "616–1,267 m": the drawn route's elevation range. */
export function sceneElevationRangeText(scene: Scene, units: Units): string {
  const { low, high } = sceneElevationRange(scene);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return MISSING;
  return `${formatNumber(units === 'imperial' ? mToFt(low) : low)}–${formatElevation(high, units).text}`;
}

/** First and last distance of the drawn route, metres from the run's real start. */
function drawnEnds(scene: Scene): { first: number; last: number } {
  const { distance } = scene.route;
  const first = distance[0] ?? 0;
  return { first, last: distance[distance.length - 1] ?? first };
}

/**
 * Where the scrub starts, as for a run (`defaultScrub`): the steepest climb's midpoint, else 57%
 * along the drawn route.
 */
export function defaultSceneScrub(scene: Scene): number {
  const steepest = scene.climbs.find((climb) => climb.steepest);
  if (steepest) return (steepest.start + steepest.end) / 2;
  const { first, last } = drawnEnds(scene);
  return first + (last - first) * DEFAULT_SCRUB_FRACTION;
}

/**
 * Pace at `d`, seconds per km, over 200 m around it (the run's rule, `paceAt` in src/gpx/stats.ts),
 * the window kept on the drawn route; `null` without times or where no time passed.
 */
export function scenePaceAt(scene: Scene, d: number, window = 200): number | null {
  if (!scene.route.time) return null;
  const { first, last } = drawnEnds(scene);
  const span = Math.min(window, last - first);
  if (!(span >= 1) || !Number.isFinite(d)) return null;
  const from = Math.min(Math.max(first, d - span / 2), last - span);
  const t0 = timeAtMetres(scene, from);
  const t1 = timeAtMetres(scene, from + span);
  if (t0 === null || t1 === null) return null;
  const pace = ((t1 - t0) / span) * 1000;
  return Number.isFinite(pace) && pace > 0 ? pace : null;
}

/** "Summit 1,267 m" for the legend chip, or `null` when the scene stores no summit (no ▲). */
export function sceneSummitText(scene: Scene, units: Units): string | null {
  const { summit } = scene.markers;
  return summit ? `Summit ${formatElevation(summit.elevation, units).text}` : null;
}

/**
 * The terrain's accessible name, as `terrainLabel` words it for a run, from the markers the scene
 * stores (no finish marker: a loop). The distance is the whole run's.
 */
export function sceneTerrainLabel(scene: Scene, name: string, units: Units): string {
  const distance = formatDistance(scene.summary.distance, units).text;
  const route =
    scene.markers.finish === null
      ? `${distance} loop, start and finish marked with a circle`
      : `${distance} from start to finish, start marked with a circle, finish with a dotted circle`;
  const { summit } = scene.markers;
  if (!summit) return `3D terrain of ${name}: ${route}`;
  const height = formatElevation(summit.elevation, units).text;
  return `3D terrain of ${name}: ${route}, summit ${height} marked with a triangle`;
}

/**
 * Under the stats when the run's ends are hidden: "The first 200 m and the last 200 m of the run
 * are not drawn." `null` when the whole run is drawn.
 */
export function sceneTrimText(scene: Scene, units: Units): string | null {
  const { start, end } = scene.summary.trim;
  // Whole metres: the bake trims in metres, and anything under one is rounding.
  const hidden = (metres: number) => Math.round(metres) >= 1;
  const amount = (metres: number) => formatElevation(Math.round(metres), units).text;
  if (hidden(start) && hidden(end)) {
    return `The first ${amount(start)} and the last ${amount(end)} of the run are not drawn.`;
  }
  if (hidden(start)) return `The first ${amount(start)} of the run are not drawn.`;
  if (hidden(end)) return `The last ${amount(end)} of the run are not drawn.`;
  return null;
}

/** The mono line above the h1: "SCENE · ACTIVITIES.GEEKPLUX.ORG", where it was opened from. */
export function sceneLine(host: string): string {
  return `SCENE · ${host.toUpperCase()}`;
}
