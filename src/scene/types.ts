/**
 * A decoded scene (docs/SCENE.md): a height grid and the drawn stretch of one run in grid-local
 * units, with no georeference. Everything a host needs to draw the terrain, the route, its
 * markers and climbs, and to map time to distance; nothing from which the place can be read
 * except the shape of the ground itself.
 *
 * Frame: metres from the grid's north-west corner (sample 0), x east, y south. Sample (i, j) of
 * the grid sits at (i · metresPerSample.x, j · metresPerSample.y).
 *
 * Distances along the route are metres from the run's real start, before any trim; times are
 * seconds since the run's first point.
 *
 * Values are the file's integers times their steps (`SCENE_STEPS`), computed in float64 and held
 * as float32 (`Float32Array`) or float64 (`Float64Array`, plain numbers): binary approximations of
 * the stepped values, not the decimals themselves. A 0.1 m elevation of 412.3 m is the float32
 * 412.29998779296875; a decoded scene still re-encodes to the same bytes. **Never write decoded
 * values into published text as they are**: their digits would fail Activities' coordinate check
 * (`\d{2}\.\d{4,}`). Round them to their step's decimals (or whole units) first.
 */

/** The height grid. */
export interface SceneGrid {
  /** Samples per row (west → east). */
  readonly width: number;
  /** Rows (north → south). */
  readonly height: number;
  /** Tile zoom the grid was sampled from (how detailed its source was). */
  readonly zoom: number;
  /** Ground distance between neighbouring samples, metres. */
  readonly metresPerSample: { readonly x: number; readonly y: number };
  /** Quantisation step of the elevations, metres. */
  readonly elevationStep: number;
  /** Metres above sea level, row-major from the north-west corner, `width × height` values. */
  readonly elevations: Float32Array;
  /** Lowest and highest of `elevations`, metres. */
  readonly min: number;
  readonly max: number;
}

/**
 * The drawn route, evenly spaced along its length (parallel arrays; index `k` is one point).
 */
export interface SceneRoute {
  /** Grid-local position, metres east of the grid's west edge. */
  readonly x: Float32Array;
  /** Grid-local position, metres south of the grid's north edge. */
  readonly y: Float32Array;
  /** Distance from the run's real start, metres; increasing, evenly spaced. */
  readonly distance: Float64Array;
  /** Elevation, metres (the run's elevations as its stats use them, else the terrain's). */
  readonly elevation: Float32Array;
  /** Seconds since the run's first point; `null` when the run has no times. */
  readonly time: Float64Array | null;
}

/** A marker on the drawn route. */
export interface SceneMarker {
  /** Distance from the run's real start, metres (within the route's distances). */
  readonly distance: number;
  /** Grid-local position, metres. */
  readonly x: number;
  readonly y: number;
  /** Elevation, metres. */
  readonly elevation: number;
}

/**
 * Start ○ at the drawn route's first point; finish ◉ at its last, unless the drawn route ends
 * within `LOOP_DISTANCE_M` of its start (a loop: ○ stands for both); summit ▲ at its highest
 * point when that stands `SUMMIT_MIN_RISE_M` or more above its lowest (`hasSummit`).
 */
export interface SceneMarkers {
  readonly start: SceneMarker;
  readonly finish: SceneMarker | null;
  readonly summit: SceneMarker | null;
}

/** A climb on the drawn route, clipped to it. */
export interface SceneClimb {
  /** Distance from the run's real start where it begins and ends, metres. */
  readonly start: number;
  readonly end: number;
  /** Elevation gained, metres. */
  readonly gain: number;
  /** gain / (end − start), a fraction (0.188 is 18.8%). */
  readonly avgGrade: number;
  /** True on at most one climb: the steepest (the app's rule, `Climb.steepest`). */
  readonly steepest: boolean;
}

/**
 * Totals. `distance` and `climb` describe the whole run (the host publishes those already); the
 * rest follow from the grid and the route and are not stored separately.
 */
export interface SceneSummary {
  /** Length of the whole run, metres. */
  readonly distance: number;
  /** Total ascent of the whole run, metres; `NaN` when unknown. */
  readonly climb: number;
  /** Length of the drawn route, metres. */
  readonly drawnLength: number;
  /** Ground the grid spans, metres: `metresPerSample × (samples − 1)` on each axis. */
  readonly extent: { readonly x: number; readonly y: number };
  /** Metres cut from the run's start and end before drawing ("Hide start and end"). */
  readonly trim: { readonly start: number; readonly end: number };
}

export interface Scene {
  /** Format version of the file it came from (or will be written as). */
  readonly version: number;
  readonly grid: SceneGrid;
  readonly route: SceneRoute;
  readonly markers: SceneMarkers;
  /** In route order. */
  readonly climbs: readonly SceneClimb[];
  readonly summary: SceneSummary;
}
