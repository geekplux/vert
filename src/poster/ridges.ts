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
    smoothZigzags(flat, Math.max(16, box.width / 40));
    route = n > 1 ? pathData(simplify(flat, tolerance), false, decimals) : '';
    start = { x: flat[0] ?? 0, y: flat[1] ?? 0 };
    const end = { x: flat[flat.length - 2] ?? 0, y: flat[flat.length - 1] ?? 0 };
    finish = Math.hypot(end.x - start.x, end.y - start.y) >= 12 ? end : null;
  }

  return { width: box.width, height: box.height, rows: ridgeRows, route, start, finish };
}

/**
 * Evens out vertical zigzags in a projected route, in place. GPS jitter across a steep slope makes
 * the draped elevation (lifted ×2.4) flick up and down, which draws as spiky teeth. For each point
 * the stretch of route within `windowPx` (screen arc length) around it is examined; when y turns
 * back at least twice there (a zigzag, not a single summit or valley), and its vertical travel is
 * visible (≥ 1.5 px) and at least half its horizontal travel, y becomes the mean y of that
 * stretch. x and the two ends are left alone. Two passes; linear time (prefix sums, two pointers).
 */
export function smoothZigzags(flat: number[], windowPx = 16): void {
  smoothZigzagsOnce(flat, windowPx);
  smoothZigzagsOnce(flat, windowPx);
}

function smoothZigzagsOnce(flat: number[], windowPx: number): void {
  const n = Math.floor(flat.length / 2);
  if (n < 5) return;
  const xs = Array.from({ length: n }, (_, i) => flat[2 * i] ?? 0);
  const ys = Array.from({ length: n }, (_, i) => flat[2 * i + 1] ?? 0);
  const arc = new Float64Array(n);
  const absDy = new Float64Array(n); // prefix Σ|dy| up to point i
  const absDx = new Float64Array(n);
  const sumY = new Float64Array(n + 1);
  const turns = new Float64Array(n); // prefix count of points where y turns back
  const NOISE = 0.05; // px: smaller steps count as flat
  let lastSign = 0;
  sumY[1] = ys[0] ?? 0;
  for (let i = 1; i < n; i++) {
    const dx = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
    const dy = (ys[i] ?? 0) - (ys[i - 1] ?? 0);
    arc[i] = (arc[i - 1] ?? 0) + Math.hypot(dx, dy);
    absDy[i] = (absDy[i - 1] ?? 0) + Math.abs(dy);
    absDx[i] = (absDx[i - 1] ?? 0) + Math.abs(dx);
    sumY[i + 1] = (sumY[i] ?? 0) + (ys[i] ?? 0);
    const sign = Math.abs(dy) < NOISE ? 0 : Math.sign(dy);
    const turned = sign !== 0 && lastSign !== 0 && sign !== lastSign ? 1 : 0;
    if (sign !== 0) lastSign = sign;
    turns[i] = (turns[i - 1] ?? 0) + turned;
  }
  const half = windowPx / 2;
  let a = 0;
  let b = 0;
  for (let i = 1; i < n - 1; i++) {
    const centre = arc[i] ?? 0;
    while ((arc[a] ?? 0) < centre - half) a++;
    while (b + 1 < n && (arc[b + 1] ?? 0) <= centre + half) b++;
    if (b - a < 2) continue;
    const vertical = (absDy[b] ?? 0) - (absDy[a] ?? 0);
    const horizontal = (absDx[b] ?? 0) - (absDx[a] ?? 0);
    const reversals = (turns[b] ?? 0) - (turns[a] ?? 0);
    if (reversals >= 2 && vertical > 0.5 * horizontal && vertical >= 1.5) {
      flat[2 * i + 1] = ((sumY[b + 1] ?? 0) - (sumY[a] ?? 0)) / (b - a + 1);
    }
  }
}
