/**
 * The scene format's constants and its integer form (docs/SCENE.md). `SceneData` holds exactly
 * what a file stores, every value an integer in the unit of its step; `toScene` turns it into the
 * decoded `Scene` (metres, seconds), `toSceneData` back. `checkSceneData` enforces every range and
 * rule the spec lists, for the decoder (untrusted bytes) and the encoder (a caller's scene) alike.
 */
import { SceneError } from './error';
import type { Scene, SceneClimb, SceneMarker } from './types';

/** First four bytes of every scene: ASCII "VSCN". */
export const SCENE_MAGIC = Uint8Array.of(0x56, 0x53, 0x43, 0x4e);
/** The format version this code writes and the only one it reads. */
export const SCENE_VERSION = 1;
/** Bytes of the file header: magic, version, reserved, byte length. */
export const HEADER_BYTES = 12;
/** Bytes before each section's payload: tag, length. */
export const SECTION_HEADER_BYTES = 8;

/** Section tags, four ASCII bytes each, in the order the encoder writes them. */
export const SECTION_TAGS = ['GRID', 'ROUT', 'MARK', 'CLMB', 'SUMM'] as const;
export type SectionTag = (typeof SECTION_TAGS)[number];

/**
 * Samples along the longer side of every grid `buildScene` writes. Fixed, so the grid's spacing
 * says nothing about latitude (docs/DECISIONS.md, "No latitude from the grid's spacing"); chosen
 * by measurement on real terrain (docs/SCENE.md, "Sizes"). Pass it to `buildHeightfield` as
 * `gridSize` so the builder need not resample.
 */
export const SCENE_LONG_SIDE = 320;

/** Quantisation steps, in the units of the decoded `Scene` (metres, seconds, fractions). */
export const SCENE_STEPS = {
  /** Grid spacing (`metresPerSample`). */
  metresPerSample: 0.01,
  /** Smallest grid elevation step `buildScene` uses; a file may carry any step ≥ 1 cm. */
  gridElevation: 0.1,
  /** Route, marker positions (x, y). */
  position: 0.5,
  /** Route and marker elevations. */
  elevation: 0.1,
  /** Route times. */
  time: 0.1,
  /** Distances along the route, climb ends, whole-run length. */
  distance: 0.01,
  /** Climb gain, whole-run climb. */
  gain: 0.1,
  /** Climb average grade. */
  grade: 0.0001,
} as const;

/**
 * Valid ranges. The decoder rejects anything outside them, so it never allocates from an
 * unchecked size and never accepts a value no writer produces.
 */
export const SCENE_LIMITS = {
  minGridSide: 2,
  maxGridSide: 1024,
  maxZoom: 24,
  /**
   * Grid elevation step, millimetres. A centimetre at least, so a float32 elevation (≤ 0.5 mm off
   * at 9,000 m) always rounds back to its level.
   */
  minElevationStepMm: 10,
  /** Grid elevations, quantised: 0 ≤ q ≤ this. */
  maxGridLevel: 0xffff,
  /** Grid spacing, centimetres. */
  maxMetresPerSampleCm: 10_000_000,
  /** Elevations anywhere in a scene, metres. */
  minElevation: -12_000,
  maxElevation: 9_000,
  minRoutePoints: 2,
  maxRoutePoints: 100_000,
  /** Distances along the route, centimetres (40,000 km). */
  maxDistanceCm: 4_000_000_000,
  /** Route times, seconds from the run's first point, either sign. */
  maxTime: 100_000_000,
  maxClimbs: 255,
  /** Climb gain and whole-run climb, decimetres (1,000 km). */
  maxGainDm: 10_000_000,
  /** Climb grade, units of 1e-4 (655%). */
  maxGradeE4: 0xffff,
} as const;

/** Whole-run climb stored when the run has no elevations. */
export const UNKNOWN_CLIMB = 0xffff_ffff;

/** Marker kinds as stored. */
export const MARKER_KINDS = { start: 0, finish: 1, summit: 2 } as const;
export type MarkerKind = keyof typeof MARKER_KINDS;
/** Bytes of one marker record and one climb record. */
export const MARKER_BYTES = 17;
export const CLIMB_BYTES = 15;

/** One marker as stored: kind, distance (cm), position (½ m), elevation (dm). */
export interface MarkerData {
  readonly kind: number;
  readonly distance: number;
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

/** One climb as stored: ends (cm), gain (dm), grade (1e-4), steepest flag. */
export interface ClimbData {
  readonly start: number;
  readonly end: number;
  readonly gain: number;
  readonly grade: number;
  readonly steepest: boolean;
}

/** Everything a file stores, as integers in the unit of each field's step. */
export interface SceneData {
  readonly grid: {
    readonly width: number;
    readonly height: number;
    readonly zoom: number;
    /** Elevation step, millimetres. */
    readonly stepMm: number;
    /** Spacing, centimetres. */
    readonly mpsX: number;
    readonly mpsY: number;
    /** Elevation of level 0, in steps: elevation = (offset + level) × step. */
    readonly offset: number;
    /** Levels, row-major from the north-west corner. */
    readonly levels: Int32Array;
  };
  readonly route: {
    /** First and last distance, centimetres; the points are evenly spaced between them. */
    readonly start: number;
    readonly end: number;
    /** ½ m units. */
    readonly x: Int32Array;
    readonly y: Int32Array;
    /** Decimetres. */
    readonly elevation: Int32Array;
    /** Tenths of a second, or null. */
    readonly time: Int32Array | null;
  };
  /** Ordered by kind. */
  readonly markers: readonly MarkerData[];
  /** In route order. */
  readonly climbs: readonly ClimbData[];
  readonly summary: {
    /** Whole run, centimetres. */
    readonly distance: number;
    /** Whole run, decimetres, or {@link UNKNOWN_CLIMB}. */
    readonly climb: number;
  };
}

/**
 * Distance of route point `k` of `count`, metres: `(start + (end − start) · k / (count − 1)) / 100`
 * with `start`, `end` in centimetres. The one formula for writer and reader.
 */
export function routeDistance(start: number, end: number, k: number, count: number): number {
  return (start + ((end - start) * k) / (count - 1)) / 100;
}

/** The gradient predictor at column `i`, row `j` (docs/SCENE.md, "GRID"): the first sample against 0, the rest of
 * the first row against the sample to the west, the rest of the first column against the sample
 * to the north, every other sample against west + north − north-west. */
export function predictLevel(levels: ArrayLike<number>, width: number, i: number, j: number) {
  const at = j * width + i;
  if (j === 0) return i === 0 ? 0 : (levels[at - 1] ?? 0);
  if (i === 0) return levels[at - width] ?? 0;
  return (levels[at - 1] ?? 0) + (levels[at - width] ?? 0) - (levels[at - width - 1] ?? 0);
}

const fail = (reason: 'range' | 'length' | 'corrupt', message: string): never => {
  throw new SceneError(reason, message);
};

function inRange(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail('range', `${what} ${String(value)} is outside ${String(min)}–${String(max)}`);
  }
}

/** Throws a {@link SceneError} unless `data` follows every rule of the format. */
export function checkSceneData(data: SceneData): void {
  const { grid, route, markers, climbs, summary } = data;
  const L = SCENE_LIMITS;
  inRange(grid.width, L.minGridSide, L.maxGridSide, 'Grid width');
  inRange(grid.height, L.minGridSide, L.maxGridSide, 'Grid height');
  inRange(grid.zoom, 0, L.maxZoom, 'Zoom');
  inRange(grid.stepMm, L.minElevationStepMm, 0xffff, 'Elevation step (mm)');
  inRange(grid.mpsX, 1, L.maxMetresPerSampleCm, 'Spacing x (cm)');
  inRange(grid.mpsY, 1, L.maxMetresPerSampleCm, 'Spacing y (cm)');
  if (grid.levels.length !== grid.width * grid.height) fail('length', 'Grid size mismatch');
  // Every elevation within half a step of −12,000 … 9,000 m (what rounding a value inside that
  // range to the step gives), in exact integer arithmetic: 2 × level × step(mm) vs 2 × limit(mm).
  const low = 2 * L.minElevation * 1000 - grid.stepMm;
  const high = 2 * L.maxElevation * 1000 + grid.stepMm;
  if (!Number.isInteger(grid.offset) || 2 * grid.offset * grid.stepMm < low) {
    fail('range', `Grid offset ${String(grid.offset)} is below ${String(L.minElevation)} m`);
  }
  for (const level of grid.levels) {
    if (level < 0 || level > L.maxGridLevel || 2 * (grid.offset + level) * grid.stepMm > high) {
      fail('range', `Grid level ${String(level)} is out of range`);
    }
  }

  const count = route.x.length;
  inRange(count, L.minRoutePoints, L.maxRoutePoints, 'Route points');
  if (
    route.y.length !== count ||
    route.elevation.length !== count ||
    (route.time !== null && route.time.length !== count)
  ) {
    fail('length', 'Route arrays differ in length');
  }
  inRange(route.start, 0, L.maxDistanceCm, 'Route start (cm)');
  inRange(route.end, route.start, L.maxDistanceCm, 'Route end (cm)');
  // Positions lie on the grid, give or take one sample. In ½ m units: 2 × metres, spacing in cm.
  const maxX = (2 * grid.mpsX * grid.width) / 100;
  const maxY = (2 * grid.mpsY * grid.height) / 100;
  const minX = (-2 * grid.mpsX) / 100;
  const minY = (-2 * grid.mpsY) / 100;
  const position = (x: number, y: number, what: string) => {
    if (!(x >= minX && x <= maxX && y >= minY && y <= maxY)) {
      fail('range', `${what} lies off the grid`);
    }
  };
  const elevation = (dm: number, what: string) => {
    inRange(dm, L.minElevation * 10, L.maxElevation * 10, `${what} elevation (dm)`);
  };
  for (let k = 0; k < count; k++) {
    position(route.x[k] ?? NaN, route.y[k] ?? NaN, 'A route point');
    elevation(route.elevation[k] ?? NaN, 'Route');
  }
  if (route.time) {
    for (const t of route.time) inRange(t, -L.maxTime * 10, L.maxTime * 10, 'Route time (ds)');
  }

  let previousKind = -1;
  for (const marker of markers) {
    inRange(marker.kind, 0, 2, 'Marker kind');
    if (marker.kind <= previousKind) fail('corrupt', 'Markers out of order or repeated');
    previousKind = marker.kind;
    inRange(marker.distance, route.start, route.end, 'Marker distance (cm)');
    position(marker.x, marker.y, 'A marker');
    elevation(marker.elevation, 'Marker');
    if (marker.kind === MARKER_KINDS.start && marker.distance !== route.start) {
      fail('corrupt', 'The start marker is not at the route start');
    }
    if (marker.kind === MARKER_KINDS.finish && marker.distance !== route.end) {
      fail('corrupt', 'The finish marker is not at the route end');
    }
  }
  if (markers[0]?.kind !== MARKER_KINDS.start) fail('corrupt', 'No start marker');

  inRange(climbs.length, 0, L.maxClimbs, 'Climbs');
  let previousStart = -1;
  let steepest = 0;
  for (const climb of climbs) {
    inRange(climb.start, route.start, route.end, 'Climb start (cm)');
    inRange(climb.end, climb.start + 1, route.end, 'Climb end (cm)');
    inRange(climb.gain, 0, L.maxGainDm, 'Climb gain (dm)');
    inRange(climb.grade, 0, L.maxGradeE4, 'Climb grade');
    if (climb.start < previousStart) fail('corrupt', 'Climbs out of route order');
    previousStart = climb.start;
    if (climb.steepest) steepest++;
  }
  if (steepest > 1) fail('corrupt', 'More than one steepest climb');

  inRange(summary.distance, route.end, L.maxDistanceCm, 'Run distance (cm)');
  if (summary.climb !== UNKNOWN_CLIMB) inRange(summary.climb, 0, L.maxGainDm, 'Run climb (dm)');
}

/** The decoded scene of checked `data`, every value in metres or seconds. */
export function toScene(data: SceneData): Scene {
  const { grid, route, summary } = data;
  const elevations = new Float32Array(grid.levels.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < elevations.length; i++) {
    elevations[i] = ((grid.offset + (grid.levels[i] ?? 0)) * grid.stepMm) / 1000;
    const e = elevations[i] ?? NaN;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  const count = route.x.length;
  const distance = new Float64Array(count);
  for (let k = 0; k < count; k++) distance[k] = routeDistance(route.start, route.end, k, count);
  const halves = (values: Int32Array) => Float32Array.from(values, (v) => v / 2);
  const tenths = (values: Int32Array) => Float32Array.from(values, (v) => v / 10);
  const marker = (kind: number): SceneMarker | null => {
    const found = data.markers.find((m) => m.kind === kind);
    return found
      ? {
          distance: found.distance / 100,
          x: found.x / 2,
          y: found.y / 2,
          elevation: found.elevation / 10,
        }
      : null;
  };
  const start = marker(MARKER_KINDS.start);
  // checkSceneData guarantees a start marker.
  if (!start) throw new SceneError('corrupt', 'No start marker');
  const climbs: SceneClimb[] = data.climbs.map((c) => ({
    start: c.start / 100,
    end: c.end / 100,
    gain: c.gain / 10,
    avgGrade: c.grade / 10_000,
    steepest: c.steepest,
  }));
  return {
    version: SCENE_VERSION,
    grid: {
      width: grid.width,
      height: grid.height,
      zoom: grid.zoom,
      metresPerSample: { x: grid.mpsX / 100, y: grid.mpsY / 100 },
      elevationStep: grid.stepMm / 1000,
      elevations,
      min,
      max,
    },
    route: {
      x: halves(route.x),
      y: halves(route.y),
      distance,
      elevation: tenths(route.elevation),
      time: route.time ? Float64Array.from(route.time, (v) => v / 10) : null,
    },
    markers: {
      start,
      finish: marker(MARKER_KINDS.finish),
      summit: marker(MARKER_KINDS.summit),
    },
    climbs,
    summary: {
      distance: summary.distance / 100,
      climb: summary.climb === UNKNOWN_CLIMB ? NaN : summary.climb / 10,
      drawnLength: (route.end - route.start) / 100,
      extent: {
        x: (grid.mpsX * (grid.width - 1)) / 100,
        y: (grid.mpsY * (grid.height - 1)) / 100,
      },
      trim: { start: route.start / 100, end: (summary.distance - route.end) / 100 },
    },
  };
}

/** `value / step`, rounded to the nearest integer (the one rounding rule of the format). */
export function quantise(value: number, step: number): number {
  return Math.round(value / step);
}

/**
 * The integer form of `scene`, each value rounded to its step; derived fields (`min`, `max`,
 * `summary.drawnLength`, `extent`, `trim`) are ignored. Not checked: see {@link checkSceneData}.
 */
export function toSceneData(scene: Scene): SceneData {
  const { grid, route, markers, climbs, summary } = scene;
  const stepMm = Math.round(grid.elevationStep * 1000);
  const absolute = Int32Array.from(grid.elevations, (e) => Math.round((e * 1000) / stepMm));
  let offset = Infinity;
  for (const level of absolute) if (level < offset) offset = level;
  if (!Number.isFinite(offset)) offset = 0;
  const levels = Int32Array.from(absolute, (level) => level - offset);
  const S = SCENE_STEPS;
  const ints = (values: ArrayLike<number>, step: number) =>
    Int32Array.from({ length: values.length }, (_, k) => quantise(values[k] ?? NaN, step));
  const last = route.distance.length - 1;
  const markerData = (kind: MarkerKind, m: SceneMarker | null): MarkerData[] =>
    m
      ? [
          {
            kind: MARKER_KINDS[kind],
            distance: quantise(m.distance, S.distance),
            x: quantise(m.x, S.position),
            y: quantise(m.y, S.position),
            elevation: quantise(m.elevation, S.elevation),
          },
        ]
      : [];
  return {
    grid: {
      width: grid.width,
      height: grid.height,
      zoom: grid.zoom,
      stepMm,
      mpsX: quantise(grid.metresPerSample.x, S.metresPerSample),
      mpsY: quantise(grid.metresPerSample.y, S.metresPerSample),
      offset,
      levels,
    },
    route: {
      start: quantise(route.distance[0] ?? NaN, S.distance),
      end: quantise(route.distance[last] ?? NaN, S.distance),
      x: ints(route.x, S.position),
      y: ints(route.y, S.position),
      elevation: ints(route.elevation, S.elevation),
      time: route.time ? ints(route.time, S.time) : null,
    },
    markers: [
      ...markerData('start', markers.start),
      ...markerData('finish', markers.finish),
      ...markerData('summit', markers.summit),
    ],
    climbs: climbs.map((c) => ({
      start: quantise(c.start, S.distance),
      end: quantise(c.end, S.distance),
      gain: quantise(c.gain, S.gain),
      grade: quantise(c.avgGrade, S.grade),
      steepest: c.steepest,
    })),
    summary: {
      distance: quantise(summary.distance, S.distance),
      climb: Number.isNaN(summary.climb) ? UNKNOWN_CLIMB : quantise(summary.climb, S.gain),
    },
  };
}
