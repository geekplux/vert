/**
 * When a run is a loop. One rule for the View's legend ("Start / finish"), the terrain's
 * accessible name and the terrain's markers (one ○ for a loop, else ○ start and ◉ finish), so
 * the shapes and the words never disagree. No three.js: the page imports it from the main bundle.
 */
import { haversine } from './geo';

/** A route that ends within this many metres of its start (on the ground) is a loop. */
export const LOOP_DISTANCE_M = 50;

/**
 * Whether the track ends within {@link LOOP_DISTANCE_M} of its start, by great-circle distance
 * (one ○ marks both). A track of one point (or none) is a loop.
 */
export function isLoop(track: {
  readonly lat: ArrayLike<number>;
  readonly lon: ArrayLike<number>;
}): boolean {
  const last = track.lat.length - 1;
  if (last < 1) return true;
  const gap = haversine(
    { lat: track.lat[0] ?? 0, lon: track.lon[0] ?? 0 },
    { lat: track.lat[last] ?? 0, lon: track.lon[last] ?? 0 },
  );
  return gap <= LOOP_DISTANCE_M;
}
