/**
 * Pure geometry for the elevation profile: scaling into the 1000×120 viewBox, the line and area
 * paths, elevation at a distance, distance ticks and the text the slider announces.
 * No React, no DOM, so it is unit-tested on its own.
 */

export interface ProfilePoint {
  /** Cumulative distance along the route, metres. */
  d: number;
  /** Elevation, metres. */
  ele: number;
}

export interface Climb {
  /** Start and end distance along the route, metres. */
  start: number;
  end: number;
  steepest?: boolean;
}

export type Units = 'metric' | 'imperial';

/** viewBox size (canvas frame "Main"). */
export const VIEW_W = 1000;
export const VIEW_H = 120;
/** The lowest point sits at y = 110 and the highest at y = 15, as in the canvas. */
export const Y_BOTTOM = 110;
export const Y_TOP = 15;
/** A flat profile is drawn as a line half-way up the plot (see {@link minimumSpan}). */
export const Y_FLAT = (Y_BOTTOM + Y_TOP) / 2;

/**
 * The least elevation span (metres) a profile is drawn over, whatever the run's own range: a flat
 * city loop with a metre of GPS noise must read as flat, not as full-height mountains.
 */
export const MIN_SPAN_M = 100;
/**
 * …or this grade over the route's length, when larger (1%: 200 m over a 20 km run, 1,000 m over
 * 100 km). 1% keeps long mountain ultras as they were: the CCC's 1,521 m range is over its 994 m.
 */
export const MIN_SPAN_GRADE = 0.01;
/**
 * Elevation steps in GPX files (whole metres on many watches and course files), the size the
 * plotted line is smoothed against.
 */
export const QUANTUM_M = 1;
/** Drawn spans at least this tall (m) are never smoothed: a metre is under 0.5 px at 140 px. */
export const SMOOTH_BELOW_SPAN_M = 300;
/** The smoothing reaches at most this fraction of the points on either side. */
const MAX_SMOOTH_FRACTION = 0.05;

export const M_PER_KM = 1000;
export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;

export interface ProfileScale {
  /** Route length in metres (distance of the last point); 0 for fewer than two points. */
  total: number;
  /** The run's own lowest and highest elevation. */
  minEle: number;
  maxEle: number;
  /**
   * The elevations at the bottom (y 110) and top (y 15) of the plot: the run's range, widened to
   * {@link minimumSpan} around its middle when that is smaller.
   */
  bottomEle: number;
  topEle: number;
  /** Distance (m) → x in viewBox units, clamped to [0, VIEW_W]. */
  x: (d: number) => number;
  /** Elevation (m) → y in viewBox units. */
  y: (ele: number) => number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The least span a profile of `total` metres is drawn over: {@link MIN_SPAN_M}, or
 * {@link MIN_SPAN_GRADE} of the length when that is more. Normal trail runs (hundreds of metres of
 * range) are well above it and draw exactly as before.
 */
export function minimumSpan(total: number): number {
  return Math.max(MIN_SPAN_M, MIN_SPAN_GRADE * Math.max(0, total));
}

/**
 * Builds the distance and elevation scales for a profile. Safe for empty and flat input. A range
 * smaller than {@link minimumSpan} is drawn centred in that span, so a flat run is a flat line
 * half-way up and a gentle climb a gentle slope.
 */
export function scaleProfile(points: readonly ProfilePoint[]): ProfileScale {
  const last = points[points.length - 1];
  const total = points.length >= 2 && last ? Math.max(0, last.d) : 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const point of points) {
    if (point.ele < minEle) minEle = point.ele;
    if (point.ele > maxEle) maxEle = point.ele;
  }
  if (!Number.isFinite(minEle)) {
    minEle = 0;
    maxEle = 0;
  }
  const span = Math.max(maxEle - minEle, minimumSpan(total));
  const middle = (minEle + maxEle) / 2;
  const bottomEle = maxEle - minEle >= span ? minEle : middle - span / 2;
  const topEle = bottomEle + span;
  return {
    total,
    minEle,
    maxEle,
    bottomEle,
    topEle,
    x: (d) => (total > 0 ? clamp((d / total) * VIEW_W, 0, VIEW_W) : 0),
    y: (ele) => Y_BOTTOM - ((ele - bottomEle) / span) * (Y_BOTTOM - Y_TOP),
  };
}

/**
 * The points as drawn: on a short span (under {@link SMOOTH_BELOW_SPAN_M}) a centred moving
 * average removes the stairs whole-metre elevations draw, reaching ±4 quanta's worth of the plot
 * (`4 · QUANTUM_M / span` of the points each side, at most 5%). The ends stay where they are. Taller
 * spans, every normal trail run, are returned as they are. Only the line is smoothed: the stats,
 * readouts and climbs keep the real values. Expects evenly spaced points (the run's profile).
 */
export function smoothForPlot(
  points: readonly ProfilePoint[],
  scale: Pick<ProfileScale, 'bottomEle' | 'topEle'>,
): readonly ProfilePoint[] {
  const n = points.length;
  const span = scale.topEle - scale.bottomEle;
  if (n < 5 || !(span > 0) || span >= SMOOTH_BELOW_SPAN_M) return points;
  const radius = Math.min(
    Math.floor((n * 4 * QUANTUM_M) / span),
    Math.floor(n * MAX_SMOOTH_FRACTION),
  );
  if (radius < 2) return points;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] ?? 0) + (points[i]?.ele ?? 0);
  return points.map((point, i) => {
    // Symmetric, shrinking at the ends so the first and last points keep their elevation.
    const r = Math.min(radius, i, n - 1 - i);
    const sum = (prefix[i + r + 1] ?? 0) - (prefix[i - r] ?? 0);
    return { d: point.d, ele: sum / (2 * r + 1) };
  });
}

/** What a profile drawing needs: its scales and the points as drawn ({@link smoothForPlot}). */
export interface ProfilePlot {
  scale: ProfileScale;
  points: readonly ProfilePoint[];
}

/** Scales a profile and smooths it for drawing. Every elevation profile Vert draws uses this. */
export function plotProfile(points: readonly ProfilePoint[]): ProfilePlot {
  const scale = scaleProfile(points);
  return { scale, points: smoothForPlot(points, scale) };
}

/** Two decimals is well under a pixel at any width the profile is drawn. */
const fmt = (value: number) => String(Math.round(value * 100) / 100);

export interface ProfilePaths {
  /** The 2px ink line. Empty string when there is nothing to draw. */
  line: string;
  /** The same line closed along the bottom edge, for the 12% ink fill. */
  area: string;
}

export function profilePaths(points: readonly ProfilePoint[], scale: ProfileScale): ProfilePaths {
  if (scale.total <= 0) return { line: '', area: '' };
  const parts: string[] = [];
  for (const point of points) {
    parts.push(`${fmt(scale.x(point.d))},${fmt(scale.y(point.ele))}`);
  }
  const line = `M${parts.join(' L')}`;
  const first = points[0];
  const last = points[points.length - 1];
  const x0 = first ? fmt(scale.x(first.d)) : '0';
  const x1 = last ? fmt(scale.x(last.d)) : String(VIEW_W);
  const bottom = String(VIEW_H);
  return { line, area: `M${x0},${bottom} L${parts.join(' L')} L${x1},${bottom} Z` };
}

/**
 * Elevation at distance `d`, linearly interpolated between the neighbouring points (binary search,
 * points sorted by distance). Clamps to the first and last point; NaN for empty input.
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
    const point = points[mid];
    if (point && point.d <= d) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (!a || !b) return first.ele;
  const span = b.d - a.d;
  if (span <= 0) return a.ele;
  return a.ele + ((d - a.d) / span) * (b.ele - a.ele);
}

/** Metres per tick unit: km or mi. */
export const unitMetres = (units: Units) => (units === 'imperial' ? M_PER_MI : M_PER_KM);
export const distanceUnit = (units: Units) => (units === 'imperial' ? 'mi' : 'km');

/** Distance in km or mi with one decimal: 12200 m → "12.2". */
export function formatDistance(metres: number, units: Units): string {
  return (metres / unitMetres(units)).toFixed(1);
}

/** Elevation in m or ft, rounded and grouped: 640 → "640 m", 1250 → "1,250 m". */
export function formatElevation(metres: number, units: Units): string {
  const value = Math.round(units === 'imperial' ? metres * FT_PER_M : metres);
  return `${value.toLocaleString('en-US')} ${units === 'imperial' ? 'ft' : 'm'}`;
}

/** Default slider text: "km 12.2, 640 m" (imperial: "mi 7.6, 2,100 ft"). */
export function defaultValueText(d: number, ele: number, units: Units): string {
  const distance = `${distanceUnit(units)} ${formatDistance(d, units)}`;
  return Number.isFinite(ele) ? `${distance}, ${formatElevation(ele, units)}` : distance;
}

export interface Tick {
  /** Label text: "0 km", "5", …, the total ("21.4"). */
  label: string;
  /** Position along the plot, 0–1. */
  at: number;
  /** How the label sits on its position: the first is left-aligned, the last right-aligned. */
  align: 'start' | 'center' | 'end';
}

export interface TickOptions {
  /** Plot width in px. When known, interior ticks whose label would touch the end labels drop. */
  widthPx?: number;
  /**
   * Interior ticks closer than this fraction of the length to the end are dropped. 0.1 keeps the
   * canvas's set for 21.4 km (0 km, 5, 10, 15, 21.4: the 20 at 93.5% goes).
   */
  minEndGap?: number;
  /** Most ticks, including "0 km" and the total. */
  maxTicks?: number;
}

/** Width of a 12px IBM Plex Mono glyph (0.6em) and the least space between two labels, px. */
const CHAR_PX = 7.2;
const LABEL_GAP_PX = 8;

const NICE = [1, 2, 5];

/** Decimal places a step needs: 0.2 → 1, 5 → 0. */
function decimalsFor(step: number): number {
  return step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
}

/**
 * Distance ticks: "0 km", round steps (1/2/5 × 10ⁿ in km or mi, the smallest that gives at most
 * `maxTicks` labels), then the total at the right end. Interior ticks are positioned by distance;
 * one that would crowd the total (within `minEndGap`, or overlapping it at `widthPx`) is dropped.
 */
export function buildTicks(totalMetres: number, units: Units, options: TickOptions = {}): Tick[] {
  const { widthPx, minEndGap = 0.1, maxTicks = 6 } = options;
  if (!(totalMetres > 0)) return [];
  const total = totalMetres / unitMetres(units);
  const totalLabel = total.toFixed(1);
  const zeroLabel = `0 ${distanceUnit(units)}`;

  const interiorFor = (step: number): Tick[] => {
    const decimals = decimalsFor(step);
    const ticks: Tick[] = [];
    for (let i = 1; i * step < total; i += 1) {
      const value = i * step;
      const at = value / total;
      const label = value.toFixed(decimals);
      if (1 - at < minEndGap) continue;
      ticks.push({ label, at, align: 'center' });
    }
    return ticks;
  };

  // At a known width, also drop an interior label that would touch "0 km" or the total.
  const fitsWidth = (tick: Tick): boolean => {
    if (widthPx === undefined || widthPx <= 0) return true;
    const x = tick.at * widthPx;
    const half = (tick.label.length * CHAR_PX) / 2;
    const endLeft = widthPx - totalLabel.length * CHAR_PX;
    const startRight = zeroLabel.length * CHAR_PX;
    return x + half <= endLeft - LABEL_GAP_PX && x - half >= startRight + LABEL_GAP_PX;
  };

  // Smallest nice step that fits; start an order of magnitude below the length.
  let exponent = Math.floor(Math.log10(total)) - 1;
  let interior: Tick[] = [];
  for (let guard = 0; guard < 12; guard += 1, exponent += 1) {
    const magnitude = 10 ** exponent;
    const fit = NICE.map((n) => interiorFor(n * magnitude)).find(
      (ticks) => ticks.length + 2 <= maxTicks,
    );
    if (fit) {
      interior = fit;
      break;
    }
  }

  return [
    { label: zeroLabel, at: 0, align: 'start' },
    ...interior.filter(fitsWidth),
    { label: totalLabel, at: 1, align: 'end' },
  ];
}

/** "km 10.7 to 13.7" */
function climbRange(climb: Climb, units: Units): string {
  const unit = distanceUnit(units);
  return `${unit} ${formatDistance(climb.start, units)} to ${formatDistance(climb.end, units)}`;
}

/**
 * The profile's accessible description, so the shaded bands are not colour-only:
 * "3 climbs; steepest: climb 2, km 10.7 to 13.7. Climb 1: km 5.6 to 8.4. Climb 2: …".
 */
export function describeClimbs(climbs: readonly Climb[], units: Units): string {
  const [only] = climbs;
  if (!only) return 'No climbs.';
  if (climbs.length === 1) return `1 climb: ${climbRange(only, units)}.`;
  const count = `${String(climbs.length)} climbs`;
  const steepestIndex = climbs.findIndex((climb) => climb.steepest);
  const steepest = climbs[steepestIndex];
  const head = steepest
    ? `${count}; steepest: climb ${String(steepestIndex + 1)}, ${climbRange(steepest, units)}.`
    : `${count}.`;
  const list = climbs.map(
    (climb, index) => `Climb ${String(index + 1)}: ${climbRange(climb, units)}.`,
  );
  return [head, ...list].join(' ');
}
