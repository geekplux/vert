/**
 * `performance.mark` names for the drop-to-terrain budget (BRIEF: a 20 km GPX from drop to 3D view
 * in ≤ 5 s). Read them in DevTools' Performance panel or with
 * `performance.getEntriesByType('mark')`:
 *
 * - `vert:chosen`: a file (or the sample) was chosen; earlier `vert:*` marks are cleared.
 * - `vert:parsed`: the run is parsed and the page has it.
 * - `vert:heightfield`: the elevation tiles are in and the height grid is built.
 * - `vert:first-frame`: TerrainView drew its first frame with the terrain and the route.
 */
export const PERF_MARKS = {
  chosen: 'vert:chosen',
  parsed: 'vert:parsed',
  heightfield: 'vert:heightfield',
  firstFrame: 'vert:first-frame',
} as const;

export type PerfMark = (typeof PERF_MARKS)[keyof typeof PERF_MARKS];

/** Sets a mark; never throws (instrumentation only). */
export function perfMark(name: PerfMark): void {
  try {
    if (name === PERF_MARKS.chosen) {
      for (const mark of Object.values(PERF_MARKS)) performance.clearMarks(mark);
    }
    performance.mark(name);
  } catch {
    // No Performance API here: nothing to record.
  }
}
