/**
 * PLACEHOLDER DATA, for tests and stories that need a run without a worker or a fetch. The app
 * itself loads the real sample (`public/samples/coosa-backcountry.gpx`) through `src/gpx/loadRun`.
 *
 * The totals are the real sample's as the app computes them (DECISIONS: the Coosa Backcountry
 * Trail loop; `SAMPLE_TOTALS`, which `sample.test.ts` checks against the parsed GPX): 21,480 m,
 * +1,102 m, 3:04:58 moving, 616–1,267 m, starting 2026-10-03T11:10:00Z at lon −83.926. The profile
 * is synthetic: smooth, a loop (ends where it starts), with three climbs placed as in the canvas's
 * View frame and scaled so its range is exactly 616–1,267 m and its ascent exactly the run's vert.
 */
import type { Climb, ProfilePoint, Run, RunTrack } from './types';

/**
 * The real sample's distance (m, to 10 m), vert (m) and moving time (s), as `computeStats` gives
 * them for `public/samples/coosa-backcountry.gpx`: what the View shows once the sample loads.
 * `sample.test.ts` parses the file and fails if these drift (regenerated sample, new stats rules).
 */
export const SAMPLE_TOTALS = { distance: 21_480, vert: 1_102, movingTime: 11_098 } as const;

/** Points in the placeholder profile. */
export const SAMPLE_PROFILE_POINTS = 500;

const DISTANCE = SAMPLE_TOTALS.distance;

/**
 * Profile anchors (distance m, elevation m). Between anchors the elevation follows an even blend of
 * a straight line and a half cosine: eased at the anchors, steepest mid-way at 1.29× the average
 * grade, and monotonic, so every rise between anchors is ascent and the anchors are the extremes.
 * Ascent: 30 + 9 + 230 + 12 + 564 + 257 = 1,102 m; descent the same (it is a loop).
 */
const ANCHORS: readonly (readonly [number, number])[] = [
  [0, 709],
  [1_200, 739],
  [3_000, 681],
  [4_400, 690],
  [5_600, 664], // climb 1 starts
  [8_400, 894], // climb 1 tops out
  [8_900, 878],
  [9_300, 890],
  [10_700, 616], // low point; climb 2 (steepest) starts
  [13_700, 1_180], // climb 2 tops out
  [16_800, 1_010], // climb 3 starts
  [19_000, 1_267], // high point; climb 3 tops out
  [DISTANCE, 709],
];

function climb(start: number, end: number, gain: number, steepest?: true): Climb {
  const base = { start, end, gain, avgGrade: gain / (end - start) };
  return steepest ? { ...base, steepest } : base;
}

const CLIMBS: readonly Climb[] = [
  climb(5_600, 8_400, 230),
  climb(10_700, 13_700, 564, true),
  climb(16_800, 19_000, 257),
];

/** Elevation at distance `d` along the anchors, rounded to 0.1 m. */
function elevationAt(d: number): number {
  let [d0, e0] = ANCHORS[0] ?? [0, 0];
  for (const [d1, e1] of ANCHORS.slice(1)) {
    if (d <= d1) {
      const t = Math.max(0, (d - d0) / (d1 - d0));
      const shape = (t + (1 - Math.cos(Math.PI * t)) / 2) / 2;
      const ele = e0 + (e1 - e0) * shape;
      return Math.round(ele * 10) / 10;
    }
    [d0, e0] = [d1, e1];
  }
  return e0;
}

/**
 * Evenly spaced points (≈ 43 m apart), except that the point nearest each anchor moves onto it, so
 * the profile hits the exact low and high points and its ascent is exactly the anchors' ascent.
 */
function makeProfile(): ProfilePoint[] {
  const step = DISTANCE / (SAMPLE_PROFILE_POINTS - 1);
  const distances = Array.from(
    { length: SAMPLE_PROFILE_POINTS },
    (_, i) => Math.round(i * step * 10) / 10,
  );
  for (const [anchor] of ANCHORS) distances[Math.round(anchor / step)] = anchor;
  return distances.map((d) => ({ d, ele: elevationAt(d) }));
}

const START_TIME = Date.UTC(2026, 9, 3, 11, 10, 0);
const MOVING_TIME = SAMPLE_TOTALS.movingTime;
const BOUNDS = { west: -83.9607, south: 34.7471, east: -83.9239, north: 34.7938 };

/**
 * A synthetic track, one point per profile point: a lobed loop inside the bounds starting and
 * ending at the trailhead, `cumulative` = the profile's distances (so a distance on the profile
 * finds its point), elevations from the profile and times at an even moving pace. The loop's own
 * length is not the run's distance; it only has to look like a route.
 */
function makeTrack(profile: readonly ProfilePoint[]): RunTrack {
  const n = profile.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const midLat = (BOUNDS.south + BOUNDS.north) / 2;
  const midLon = (BOUNDS.west + BOUNDS.east) / 2;
  const halfLat = ((BOUNDS.north - BOUNDS.south) / 2) * 0.8;
  const halfLon = ((BOUNDS.east - BOUNDS.west) / 2) * 0.8;
  profile.forEach(({ d }, i) => {
    const angle = (d / DISTANCE) * 2 * Math.PI;
    const r = 1 - 0.2 * Math.sin(3 * angle) ** 2;
    lat[i] = midLat - halfLat * r * Math.cos(angle);
    lon[i] = midLon + halfLon * r * Math.sin(angle);
  });
  return {
    lat,
    lon,
    ele: Float64Array.from(profile, (p) => p.ele),
    cumulative: Float64Array.from(profile, (p) => p.d),
    time: Float64Array.from(profile, (p) => START_TIME + (p.d / DISTANCE) * MOVING_TIME * 1000),
  };
}

const PROFILE = makeProfile();

/** The placeholder sample run. The app loads the parsed `coosa-backcountry.gpx` instead. */
export const SAMPLE_RUN: Run = {
  id: 'sample-coosa-backcountry',
  name: 'Coosa Backcountry Trail',
  startTime: START_TIME,
  lonForOffset: -83.926,
  isSample: true,
  hasTime: true,
  hasElevation: true,
  elevationSource: 'gpx',
  distance: DISTANCE,
  vert: SAMPLE_TOTALS.vert,
  descent: SAMPLE_TOTALS.vert,
  movingTime: MOVING_TIME,
  elapsedTime: 11_244,
  highPoint: 1_267,
  lowPoint: 616,
  profile: PROFILE,
  climbs: CLIMBS,
  // The GPX track's extremes rounded outward to 4 decimals, so every point is inside.
  bounds: BOUNDS,
  track: makeTrack(PROFILE),
};
