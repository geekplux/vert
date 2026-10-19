/**
 * The elevation profile of a baked scene (docs/SCENE.md): its drawn route's elevations and its
 * climbs, in the scene's metres (from the run's real start, so a trimmed route starts past 0).
 * Pure, no React; the scene types only, so nothing here reads a coordinate.
 */
import type { Scene } from '../../scene/types';
import type { Climb, ProfilePoint } from './profileGeometry';

/**
 * Points in a scene's profile, as many as the app's own (`PROFILE_POINTS` in src/gpx/stats.ts;
 * a test keeps them equal): a scene's route has up to 4,000.
 */
export const SCENE_PROFILE_POINTS = 500;

export interface SceneProfile {
  /** Distance of the drawn route's first point, metres from the run's real start. */
  readonly origin: number;
  /** Evenly spaced along the drawn route, `d` in the scene's metres. */
  readonly points: readonly ProfilePoint[];
  /** The scene's climbs (clipped to the drawn route by the bake), the steepest flagged. */
  readonly climbs: readonly Climb[];
}

const cache = new WeakMap<Scene, SceneProfile>();

/** `scene`'s profile, memoised per scene object. */
export function sceneProfile(scene: Scene): SceneProfile {
  const cached = cache.get(scene);
  if (cached) return cached;
  const result = build(scene);
  cache.set(scene, result);
  return result;
}

function build(scene: Scene): SceneProfile {
  const { distance, elevation } = scene.route;
  const n = distance.length;
  const origin = distance[0] ?? 0;
  const end = distance[n - 1] ?? origin;
  const climbs = scene.climbs.map((c): Climb => ({
    start: c.start,
    end: c.end,
    steepest: c.steepest,
  }));
  if (n < 2) {
    return { origin, points: n === 1 ? [{ d: origin, ele: elevation[0] ?? 0 }] : [], climbs };
  }
  // The route's points are evenly spaced, so a point's index is proportional to its distance.
  const count = Math.min(n, SCENE_PROFILE_POINTS);
  const points: ProfilePoint[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k * (n - 1)) / (count - 1);
    const i = Math.min(n - 2, Math.floor(t));
    const f = t - i;
    const a = elevation[i] ?? 0;
    const b = elevation[i + 1] ?? a;
    const d = k === count - 1 ? end : origin + ((end - origin) * k) / (count - 1);
    points.push({ d, ele: a + (b - a) * f });
  }
  return { origin, points, climbs };
}
