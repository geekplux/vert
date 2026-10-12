/**
 * Poster style B, Night Ridge: the terrain as a ridgeline plot. Rows of the heightfield run west
 * to east, back (north) to front (south); each row is drawn as a line lifted by its elevation,
 * filled with the paper colour below so it hides the rows behind it, back rows dim and front rows
 * bright. The route is draped onto the same surface. Pure: no React, no DOM, no three.js.
 */
import type { Heightfield } from '../terrain/heightfield';
import { gridPosition } from '../terrain/heightfield';
import { sampleBilinear } from '../lib/terrarium';
import { lineDetail, pathData, simplify, smoothHeightfield } from './contours';
import type { BoxSize } from './contours';

/** A rectangle in the figure box, logical px. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RidgeOptions {
  /** Rows drawn, back to front. */
  rows?: number;
  /**
   * The poster's vertical exaggeration setting. The figure is drawn at
   * `ridgeExaggeration(exaggeration)` (the setting × RIDGE_RELIEF_BOOST), which is the factor the
   * poster prints.
   */
  exaggeration?: number;
  /** Fraction of the width the back row sits to the right of the front row (the oblique look). */
  skew?: number;
  /** Stroke opacity of the back and front rows (canvas: 0.18 → 0.88). */
  opacity?: readonly [number, number];
  /** Space kept free inside the box, logical px. */
  padding?: number;
  /**
   * Output pixels per logical px (the export scale, e.g. 7.5 for 18×24): lines are sampled and
   * simplified finely enough for that output. 1 (the default) suits the on-screen preview.
   */
  detailScale?: number;
  /**
   * Blur radius in samples applied to the heightfield first (raw tiles are noisy at row scale);
   * by default one sample per 160 along the longer side, at least 1.
   */
  smoothing?: number;
  /**
   * Areas of the box the ridge and route lines must stay out of (the text laid over the figure,
   * as in the canvas): the figure shrinks, still centred on the bottom edge, until no line point
   * falls inside one (with an 8 px margin), down to 40% of its full size.
   */
  keepOut?: readonly Rect[];
  /**
   * Even out GPS zigzags in the draped route (`smoothZigzags`); on by default. `false` draws the
   * route exactly as projected (for comparisons).
   */
  smoothRoute?: boolean;
}

export interface RidgeRow {
  /** Closed area under the row's line down to its base: fill it with the paper colour. */
  readonly fill: string;
  /** The ridge line. */
  readonly line: string;
  /** Stroke opacity: 0.18 at the back to 0.88 at the front. */
  readonly opacity: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface RidgeFigure {
  /** The box the paths are laid out in, logical px (the SVG viewBox). */
  readonly width: number;
  readonly height: number;
  /** Back to front: draw in this order. */
  readonly rows: readonly RidgeRow[];
  /** The route draped on the surface; empty without a track. */
  readonly route: string;
  readonly start: Point | null;
  /** The finish when it is apart from the start (≥ 12 px); `null` for a loop. */
  readonly finish: Point | null;
}

/** The track fields the figure reads. */
export interface RidgeTrack {
  readonly lat: ArrayLike<number>;
  readonly lon: ArrayLike<number>;
}

export const RIDGE_ROWS = 64;

/**
 * Extra lift on top of the poster's exaggeration setting: a ridgeline plot reads as terrain only
 * when the relief is a good part of the row spacing.
 */
export const RIDGE_RELIEF_BOOST = 1.5;

/**
 * The vertical exaggeration Night Ridge actually draws for the poster's `setting`: the one factor
 * the drawing uses and the poster prints ("ELEVATION ×2.4" for the default 1.6).
 */
export function ridgeExaggeration(setting: number): number {
  return Math.round(setting * RIDGE_RELIEF_BOOST * 1000) / 1000;
}

const DEFAULTS = {
  exaggeration: 1.6,
  skew: 0.08,
  opacity: [0.18, 0.88] as const,
  padding: 4,
  detailScale: 1,
};
/** Depth compression of the oblique view: sin(tilt), kept in this range. */
const FORESHORTEN_MIN = 0.25;
const FORESHORTEN_MAX = 0.8;
/** Margin around keep-out areas, logical px. */
const KEEP_OUT_MARGIN = 8;
/** The figure never shrinks below this fraction of its full size to clear the keep-out areas. */
const MIN_FIT = 0.4;

/**
 * The ridgeline figure of `heightfield` laid out in a `box` (logical px): rows evenly spaced from
 * the north edge to the south edge, a sample every ~2.5 output px along each, scaled uniformly to fit the
 * box (centred, resting on its bottom edge) and clear of `keepOut`. The depth compression (how
 * steeply we look down) is picked so the figure fills the box's aspect as far as it can.
 */
export function ridgeFigure(
  heightfield: Pick<
    Heightfield,
    'width' | 'height' | 'elevations' | 'min' | 'max' | 'metresPerSample' | 'bounds'
  >,
  box: BoxSize,
  track?: RidgeTrack | null,
  options: RidgeOptions = {},
): RidgeFigure {
  const rows = Math.max(2, Math.round(options.rows ?? RIDGE_ROWS));
  const { exaggeration, skew, opacity, padding, detailScale } = {
    ...DEFAULTS,
    ...options,
  };
  const { tolerance, decimals } = lineDetail(detailScale);
  const { width: w, height: h, metresPerSample: mps } = heightfield;
  const smoothed = smoothHeightfield(
    heightfield,
    options.smoothing ?? Math.max(1, Math.round(Math.max(w, h) / 160)),
  );
  const elevations = smoothed.elevations;
  const min = smoothed.min;
  const groundW = Math.max(1e-9, (w - 1) * mps.x);
  const lift = ridgeExaggeration(exaggeration); // model metres up per metre of elevation
  const innerW = Math.max(1, box.width - 2 * padding);
  const innerH = Math.max(1, box.height - 2 * padding);
  const keepOut = (options.keepOut ?? []).filter((rect) => rect.width > 0 && rect.height > 0);
  // Text laid over the figure takes part of the box's height: aim the oblique view at the rest.
  const keepOutBottom = Math.min(
    innerH * 0.8,
    Math.max(0, ...keepOut.map((rect) => rect.y + rect.height - padding)),
  );

  // Model space, metres: x east (+ skew for the back rows), y down the page. A point at depth d
  // (metres from the north edge) and lifted elevation z sits at y = d · foreshorten − z.
  const shift = (gy: number) => (1 - gy / Math.max(1, h - 1)) * skew * groundW;
  const modelX = (gx: number, gy: number) => gx * mps.x + shift(gy);
  // A sample every ~2.5 output px, but no finer than twice the grid (bilinear adds nothing more).
  const samples = Math.round(
    Math.min(Math.max(480, 2 * w), Math.max(60, (box.width * Math.max(1, detailScale)) / 2.5)),
  );
  const rowDepth: number[] = [];
  const rowLift: Float64Array[] = [];
  const rowX: Float64Array[] = [];
  const rowGy: number[] = [];
  for (let r = 0; r < rows; r++) {
    const gy = (r / (rows - 1)) * (h - 1);
    const xs = new Float64Array(samples);
    const zs = new Float64Array(samples);
    for (let c = 0; c < samples; c++) {
      const gx = (c / (samples - 1)) * (w - 1);
      xs[c] = modelX(gx, gy);
      zs[c] = (sampleBilinear(elevations, w, h, gx, gy) - min) * lift;
    }
    rowGy.push(gy);
    rowDepth.push(gy * mps.y);
    rowX.push(xs);
    rowLift.push(zs);
  }
  // The route, draped on the (smoothed) surface.
  const n = Math.min(track?.lat.length ?? 0, track?.lon.length ?? 0);
  const routeX = new Float64Array(n);
  const routeDepth = new Float64Array(n);
  const routeLift = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = gridPosition(heightfield as Heightfield, track?.lon[i] ?? 0, track?.lat[i] ?? 0);
    routeX[i] = modelX(g.x, g.y);
    routeDepth[i] = g.y * mps.y;
    routeLift[i] = (sampleBilinear(elevations, w, h, g.x, g.y) - min) * lift;
  }

  /** Height of the drawn lines at a depth compression `f`. */
  const heightAt = (f: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    rowLift.forEach((zs, r) => {
      const d = (rowDepth[r] ?? 0) * f;
      for (const z of zs) {
        lo = Math.min(lo, d - z);
        hi = Math.max(hi, d - z);
      }
    });
    return hi - lo;
  };
  // Pick the depth compression whose figure, fitted to the width, fills the free height under the
  // text (bisection: the height grows with f).
  const targetH = (groundW * (1 + skew) * (innerH - keepOutBottom)) / innerW;
  let foreshorten = FORESHORTEN_MAX;
  if (heightAt(FORESHORTEN_MIN) >= targetH) {
    foreshorten = FORESHORTEN_MIN;
  } else if (heightAt(FORESHORTEN_MAX) > targetH) {
    let lo = FORESHORTEN_MIN;
    let hi = FORESHORTEN_MAX;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (heightAt(mid) > targetH) hi = mid;
      else lo = mid;
    }
    foreshorten = lo;
  }
  const baseY = (gy: number) => gy * mps.y * foreshorten;

  const rowLines: { xs: Float64Array; ys: Float64Array; gy: number }[] = [];
  let top = 0;
  rowLift.forEach((zs, r) => {
    const d = (rowDepth[r] ?? 0) * foreshorten;
    const ys = Float64Array.from(zs, (z) => d - z);
    for (const y of ys) top = Math.min(top, y);
    rowLines.push({ xs: rowX[r] ?? new Float64Array(samples), ys, gy: rowGy[r] ?? 0 });
  });
  const routeModel = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const y = (routeDepth[i] ?? 0) * foreshorten - (routeLift[i] ?? 0);
    routeModel[2 * i] = routeX[i] ?? 0;
    routeModel[2 * i + 1] = y;
    top = Math.min(top, y);
  }

  // Fit the drawn lines (the fills below them are paper and need no room).
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const { xs, ys } of rowLines) {
    for (let c = 0; c < samples; c++) {
      bottom = Math.max(bottom, ys[c] ?? 0);
      left = Math.min(left, xs[c] ?? 0);
      right = Math.max(right, xs[c] ?? 0);
    }
  }
  const modelW = Math.max(1e-9, right - left);
  const modelH = Math.max(1e-9, bottom - top);
  const fullScale = Math.min(innerW / modelW, innerH / modelH);
  let align: 'centre' | 'right' = 'centre';
  const offsetsFor = (scale: number) => ({
    offsetX:
      align === 'centre'
        ? padding + (innerW - modelW * scale) / 2 - left * scale
        : box.width - padding - right * scale,
    offsetY: box.height - padding - bottom * scale,
  });
  const collides = (scale: number): boolean => {
    const { offsetX, offsetY } = offsetsFor(scale);
    const hit = (x: number, y: number) => {
      const px = offsetX + x * scale;
      const py = offsetY + y * scale;
      return keepOut.some(
        (rect) =>
          px > rect.x - KEEP_OUT_MARGIN &&
          px < rect.x + rect.width + KEEP_OUT_MARGIN &&
          py > rect.y - KEEP_OUT_MARGIN &&
          py < rect.y + rect.height + KEEP_OUT_MARGIN,
      );
    };
    for (const { xs, ys } of rowLines) {
      for (let c = 0; c < samples; c++) if (hit(xs[c] ?? 0, ys[c] ?? 0)) return true;
    }
    for (let i = 0; i < n; i++) {
      if (hit(routeModel[2 * i] ?? 0, routeModel[2 * i + 1] ?? 0)) return true;
    }
    return false;
  };
  /** The largest scale in [MIN_FIT, 1] × full that clears the keep-out areas (bisection). */
  const clearScale = () => {
    if (keepOut.length === 0 || !collides(fullScale)) return fullScale;
    let lo = fullScale * MIN_FIT;
    let hi = fullScale;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (collides(mid)) hi = mid;
      else lo = mid;
    }
    return lo;
  };
  // Centred, unless pushing it to the right (away from the text column) lets it grow by 5%+.
  let scale = clearScale();
  if (keepOut.length > 0 && scale < fullScale) {
    align = 'right';
    const rightScale = clearScale();
    if (rightScale > scale * 1.05) scale = rightScale;
    else align = 'centre';
  }
  const { offsetX, offsetY } = offsetsFor(scale);
  const px = (x: number) => offsetX + x * scale;
  const py = (y: number) => offsetY + y * scale;

  const ridgeRows: RidgeRow[] = rowLines.map(({ xs, ys, gy }, r) => {
    const flat: number[] = [];
    for (let c = 0; c < samples; c++) flat.push(px(xs[c] ?? 0), py(ys[c] ?? 0));
    const kept = simplify(flat, tolerance);
    const base = py(baseY(gy));
    const x0 = kept[0] ?? 0;
    const xn = kept[kept.length - 2] ?? 0;
    const t = rows > 1 ? r / (rows - 1) : 1;
    return {
      fill: pathData([...kept, xn, base, x0, base], true, decimals),
      line: pathData(kept, false, decimals),
      opacity: Math.round((opacity[0] + (opacity[1] - opacity[0]) * t) * 100) / 100,
    };
  });

  let route = '';
  let start: Point | null = null;
  let finish: Point | null = null;
  if (n > 0) {
    const flat = Array.from(routeModel, (value, i) => (i % 2 === 0 ? px(value) : py(value)));
    if (options.smoothRoute !== false) {
      // The track's ground length at the figure's scale: the windows' measure.
      const along = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        const ground = Math.hypot(
          (routeX[i] ?? 0) - (routeX[i - 1] ?? 0),
          (routeDepth[i] ?? 0) - (routeDepth[i - 1] ?? 0),
        );
        along[i] = (along[i - 1] ?? 0) + ground * scale;
      }
      smoothZigzags(flat, Math.max(16, box.width / 40), {
        keepPx: KEEP_RELIEF_M * lift * scale,
        along,
      });
    }
    route = n > 1 ? pathData(simplify(flat, tolerance), false, decimals) : '';
    start = { x: flat[0] ?? 0, y: flat[1] ?? 0 };
    const end = { x: flat[flat.length - 2] ?? 0, y: flat[flat.length - 1] ?? 0 };
    finish = Math.hypot(end.x - start.x, end.y - start.y) >= 12 ? end : null;
  }

  return { width: box.width, height: box.height, rows: ridgeRows, route, start, finish };
}

/** px: y must retrace this far from its last extreme for the route to count as turning back. */
const TURN_PX = 0.5;
/** Summits and valleys of the route standing out this much (metres) are never smoothed. */
const KEEP_RELIEF_M = 25;

export interface ZigzagOptions {
  /** Summits and valleys of y standing out this much (px) on both sides are kept as they are. */
  keepPx?: number;
  /**
   * Distance along the route at each point, px, increasing: windows are measured in it. Default:
   * the route's horizontal travel (Σ|dx|). ridgeFigure passes the track's ground length at the
   * figure's scale, which the vertical teeth do not lengthen.
   */
  along?: ArrayLike<number>;
}

/**
 * Evens out vertical zigzags in a projected route, in place. GPS jitter across a steep slope makes
 * the draped elevation (lifted ×2.4) flick up and down, which draws as spiky teeth.
 *
 * The smoothing is blended in, never switched on and off: each point gets a zigzag strength
 * (0..1) from the stretch of route within `windowPx` (distance along the route, see `along`)
 * around it, rising with how often y turns back there (at least twice: a zigzag, not a single
 * summit or valley), how far it travels (from 1 px) and how steep that travel is against the
 * horizontal. The strength is spread (a running max, then a running mean), so a point between
 * smoothed neighbours is smoothed too and the weight ramps in and out without a step. The output
 * is `raw + weight × (fit − raw)`, where `fit` is a local quadratic fit of y along the route
 * (tricube kernel over ±`windowPx`): it averages the teeth out but follows the curve of a gentle
 * summit or valley. A summit or valley that stands out at least `keepPx` on both sides
 * (ridgeFigure: 25 m of relief) is kept: the weight is 0 within half a window of it and ramps back
 * over the next half. x is left alone, and the weight ramps to 0 at the two ends, which stay put.
 */
export function smoothZigzags(
  flat: number[],
  windowPx = 16,
  { keepPx = Infinity, along }: ZigzagOptions = {},
): void {
  const n = Math.floor(flat.length / 2);
  if (n < 5 || !(windowPx > 0)) return;
  const ys = Float64Array.from({ length: n }, (_, i) => flat[2 * i + 1] ?? 0);
  const arc = new Float64Array(n);
  const absDy = new Float64Array(n); // prefix Σ|dy| up to point i
  const absDx = new Float64Array(n);
  const turns = new Float64Array(n); // prefix count of turn-backs (with TURN_PX hysteresis)
  let direction = 0;
  let extreme = ys[0] ?? 0;
  for (let i = 1; i < n; i++) {
    const y = ys[i] ?? 0;
    const dx = (flat[2 * i] ?? 0) - (flat[2 * i - 2] ?? 0);
    const dy = y - (ys[i - 1] ?? 0);
    arc[i] = along ? (along[i] ?? 0) - (along[0] ?? 0) : (arc[i - 1] ?? 0) + Math.abs(dx);
    absDy[i] = (absDy[i - 1] ?? 0) + Math.abs(dy);
    absDx[i] = (absDx[i - 1] ?? 0) + Math.abs(dx);
    let turned = 0;
    if (direction === 0) {
      if (Math.abs(y - extreme) >= TURN_PX) {
        direction = Math.sign(y - extreme);
        extreme = y;
      }
    } else if ((y - extreme) * direction > 0) {
      extreme = y;
    } else if ((extreme - y) * direction >= TURN_PX) {
      turned = 1;
      direction = -direction;
      extreme = y;
    }
    turns[i] = (turns[i - 1] ?? 0) + turned;
  }
  const total = arc[n - 1] ?? 0;
  const half = windowPx / 2;
  const quarter = windowPx / 4;

  // Zigzag strength of the stretch around each point.
  const strength = new Float64Array(n);
  forWindows(arc, half, (i, a, b) => {
    if (b - a < 2) return;
    const vertical = (absDy[b] ?? 0) - (absDy[a] ?? 0);
    const horizontal = (absDx[b] ?? 0) - (absDx[a] ?? 0);
    const reversals = (turns[b] ?? 0) - (turns[a] ?? 0);
    const steep = horizontal > 0 ? clamp01((vertical / horizontal - 0.3) / 0.4) : 1;
    strength[i] = clamp01(reversals - 1) * clamp01(vertical - 1) * steep;
  });
  // Spread it: a running max, then a triangular running mean, each over ±quarter window.
  const spread = new Float64Array(n);
  forWindows(arc, quarter, (i, a, b) => {
    let max = 0;
    for (let j = a; j <= b; j++) max = Math.max(max, strength[j] ?? 0);
    spread[i] = max;
  });
  const weight = new Float64Array(n);
  forWindows(arc, quarter, (i, a, b) => {
    let sum = 0;
    let norm = 0;
    for (let j = a; j <= b; j++) {
      const k = 1 - Math.abs((arc[j] ?? 0) - (arc[i] ?? 0)) / (quarter * 1.0001);
      sum += k * (spread[j] ?? 0);
      norm += k;
    }
    const ends = clamp01(Math.min(arc[i] ?? 0, total - (arc[i] ?? 0)) / half);
    weight[i] = norm > 0 ? (sum / norm) * ends : 0;
  });
  // Keep the real summits and valleys.
  for (const e of prominentExtremes(ys, keepPx)) {
    const centre = arc[e] ?? 0;
    for (const step of [-1, 1]) {
      for (let j = e; j >= 0 && j < n && Math.abs((arc[j] ?? 0) - centre) < windowPx; j += step) {
        const keep = clamp01((Math.abs((arc[j] ?? 0) - centre) - half) / half);
        weight[j] = (weight[j] ?? 0) * keep;
      }
    }
  }
  // Blend towards the local quadratic fit as far as the weight says.
  forWindows(arc, windowPx, (i, a, b) => {
    const w = weight[i] ?? 0;
    if (w <= 0 || i === 0 || i === n - 1) return;
    const raw = ys[i] ?? 0;
    flat[2 * i + 1] = raw + w * (localQuadratic(arc, ys, i, a, b, windowPx) - raw);
  });
}

/**
 * The points where y has a local minimum or maximum that stands out at least `keepPx` on both
 * sides: walking either way, y moves `keepPx` away from it before it passes it (or the route ends
 * after at least that much). Each walk stops as soon as that is decided.
 */
function prominentExtremes(ys: Float64Array, keepPx: number): number[] {
  const n = ys.length;
  const found: number[] = [];
  if (!(keepPx < Infinity)) return found;
  const standsOut = (i: number, sign: number, step: number) => {
    const peak = (ys[i] ?? 0) * sign; // the extreme, as a maximum
    for (let j = i + step; j >= 0 && j < n; j += step) {
      const v = (ys[j] ?? 0) * sign;
      if (v > peak) return false;
      if (peak - v >= keepPx) return true;
    }
    return false;
  };
  for (let i = 1; i < n - 1; i++) {
    const y = ys[i] ?? 0;
    const before = ys[i - 1] ?? 0;
    const after = ys[i + 1] ?? 0;
    for (const sign of [1, -1]) {
      // sign 1: a maximum of y (a valley on the page); -1: a minimum (a summit).
      if (y * sign >= before * sign && y * sign > after * sign) {
        if (standsOut(i, sign, -1) && standsOut(i, sign, 1)) found.push(i);
      }
    }
  }
  return found;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Calls `visit(i, a, b)` for each point, with a..b the points within `radius` of arc length of
 * it (two pointers).
 */
function forWindows(
  arc: Float64Array,
  radius: number,
  visit: (i: number, a: number, b: number) => void,
): void {
  const n = arc.length;
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const centre = arc[i] ?? 0;
    while ((arc[a] ?? 0) < centre - radius) a++;
    b = Math.max(b, i);
    while (b + 1 < n && (arc[b + 1] ?? 0) <= centre + radius) b++;
    visit(i, a, b);
  }
}

/**
 * The value at point `i` of the weighted least-squares quadratic of y against arc length over
 * points a..b (tricube weights over ±`radius`); their weighted mean when that is degenerate.
 */
function localQuadratic(
  arc: Float64Array,
  ys: Float64Array,
  i: number,
  a: number,
  b: number,
  radius: number,
): number {
  // Σk·u^p for p = 0..4 and Σk·u^p·y for p = 0..2, with u = (arc − arc[i]) / radius.
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  const centre = arc[i] ?? 0;
  for (let j = a; j <= b; j++) {
    const u = ((arc[j] ?? 0) - centre) / radius;
    const c = 1 - Math.abs(u) ** 3;
    const k = c * c * c;
    if (!(k > 0)) continue;
    const y = ys[j] ?? 0;
    const u2 = u * u;
    s0 += k;
    s1 += k * u;
    s2 += k * u2;
    s3 += k * u2 * u;
    s4 += k * u2 * u2;
    t0 += k * y;
    t1 += k * u * y;
    t2 += k * u2 * y;
  }
  if (!(s0 > 0)) return ys[i] ?? 0;
  // Cramer's rule for the constant term of [s0 s1 s2; s1 s2 s3; s2 s3 s4] · c = [t0 t1 t2].
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-9 * s0 * s0 * s0) return t0 / s0;
  const c0 = t0 * (s2 * s4 - s3 * s3) - s1 * (t1 * s4 - s3 * t2) + s2 * (t1 * s3 - s2 * t2);
  return c0 / det;
}
