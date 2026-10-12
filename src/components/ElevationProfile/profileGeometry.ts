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
/** A flat profile (min == max) is drawn as a centred line. */
export const Y_FLAT = VIEW_H / 2;

export const M_PER_KM = 1000;
export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;

export interface ProfileScale {
  /** Route length in metres (distance of the last point); 0 for fewer than two points. */
  total: number;
  minEle: number;
  maxEle: number;
  /** Distance (m) → x in viewBox units, clamped to [0, VIEW_W]. */
  x: (d: number) => number;
  /** Elevation (m) → y in viewBox units. */
  y: (ele: number) => number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Builds the distance and elevation scales for a profile. Safe for empty and flat input. */
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
  const range = maxEle - minEle;
  return {
    total,
    minEle,
    maxEle,
    x: (d) => (total > 0 ? clamp((d / total) * VIEW_W, 0, VIEW_W) : 0),
    y: (ele) => (range > 0 ? Y_BOTTOM - ((ele - minEle) / range) * (Y_BOTTOM - Y_TOP) : Y_FLAT),
  };
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
