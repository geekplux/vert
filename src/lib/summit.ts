/**
 * When a run has a summit worth marking. One rule for the View's ▲ and legend, the terrain's
 * marker, the terrain's accessible name and the posters.
 */

/** The high point must stand at least this far (metres) above the route's lowest point. */
export const SUMMIT_MIN_RISE_M = 10;

/**
 * Whether the run's high point is a summit: known, and at least {@link SUMMIT_MIN_RISE_M} above
 * its low point. A flat city loop (a metre of GPS noise) has none; neither has a run whose
 * elevation is unknown (`NaN`).
 */
export function hasSummit(highPoint: number, lowPoint: number): boolean {
  return (
    Number.isFinite(highPoint) &&
    Number.isFinite(lowPoint) &&
    highPoint - lowPoint >= SUMMIT_MIN_RISE_M
  );
}
