/**
 * Poster style E, Survey Quad: contour lines from a heightfield (marching squares), projected
 * top-down into the map box, and the scale bar. Pure: no React, no DOM, no three.js.
 *
 * Grid coordinates are (column, row) of the heightfield: x east, y south, in samples.
 */
import type { Heightfield } from '../terrain/heightfield';
import { gridPosition } from '../terrain/heightfield';
import type { Units } from '../lib/format';
import type { Bounds } from '../lib/geo';
import { METRES_PER_FOOT, METRES_PER_MILE } from '../lib/format';

/** Contour interval, metres (DESIGN-SPEC §4). */
export const CONTOUR_INTERVAL_M = 20;
/** Every 5th contour (100 m at the 20 m interval) is an index contour, drawn thicker. */
export const INDEX_EVERY = 5;

export interface ContourLine {
  /** Elevation, metres. */
  readonly level: number;
  /** An index contour (its level is a multiple of `interval × indexEvery`). */
  readonly index: boolean;
  /** Ends where it started (a ring); otherwise both ends lie on the grid's border. */
  readonly closed: boolean;
  /** x0, y0, x1, y1, … in grid coordinates. A closed line does not repeat its first point. */
  readonly points: Float64Array;
}

export interface ContourOptions {
  /** Metres between contours. */
  interval?: number;
  /** Every n-th contour is an index contour. */
  indexEvery?: number;
}

/** The contour levels strictly between `min` and `max`: multiples of `interval`. */
export function contourLevels(min: number, max: number, interval = CONTOUR_INTERVAL_M): number[] {
  if (!(interval > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const levels: number[] = [];
  for (let k = Math.floor(min / interval) + 1; k * interval < max; k++) levels.push(k * interval);
  return levels;
}

/** Whether `level` is an index contour. */
export function isIndexLevel(
  level: number,
  interval = CONTOUR_INTERVAL_M,
  indexEvery = INDEX_EVERY,
): boolean {
  return Math.round(level / interval) % indexEvery === 0;
}

/*
 * Marching squares. A cell's corners are numbered tl = 8, tr = 4, br = 2, bl = 1; a corner is
 * "above" when its value ≥ the level. Each case lists the cell edges its segments join:
 * 0 top, 1 right, 2 bottom, 3 left. The two saddles (5 and 10) are resolved by the cell's centre
 * value (the mean of its corners), the same rule for every cell and level, so neighbouring cells
 * always agree and lines never cross.
 */
const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

const CASES: readonly (readonly number[])[] = [
  [],
  [LEFT, BOTTOM],
  [BOTTOM, RIGHT],
  [LEFT, RIGHT],
  [TOP, RIGHT],
  [], // saddle: see SADDLE_5
  [TOP, BOTTOM],
  [TOP, LEFT],
  [TOP, LEFT],
  [TOP, BOTTOM],
  [], // saddle: see SADDLE_10
  [TOP, RIGHT],
  [LEFT, RIGHT],
  [RIGHT, BOTTOM],
  [LEFT, BOTTOM],
  [],
];

/** Case 5 (tr and bl above). Centre above: the above corners connect, cutting off tl and br. */
const SADDLE_5_CENTRE_ABOVE = [LEFT, TOP, BOTTOM, RIGHT];
const SADDLE_5_CENTRE_BELOW = [LEFT, BOTTOM, TOP, RIGHT];
/** Case 10 (tl and br above). Centre above: cuts off tr and bl. */
const SADDLE_10_CENTRE_ABOVE = [TOP, RIGHT, LEFT, BOTTOM];
const SADDLE_10_CENTRE_BELOW = [TOP, LEFT, BOTTOM, RIGHT];

/**
 * Contour lines of `heightfield` every `interval` metres (20 by default), each level's segments
 * joined into polylines: open lines run border to border, closed lines are rings.
 */
export function extractContours(
  heightfield: Pick<Heightfield, 'width' | 'height' | 'elevations' | 'min' | 'max'>,
  { interval = CONTOUR_INTERVAL_M, indexEvery = INDEX_EVERY }: ContourOptions = {},
): ContourLine[] {
  const { width: w, height: h, elevations: z } = heightfield;
  const levels = contourLevels(heightfield.min, heightfield.max, interval);
  if (w < 2 || h < 2 || levels.length === 0) return [];
  const first = levels[0] ?? 0;

  // Edge ids: horizontal edges (i, j)–(i + 1, j) first, then vertical edges (i, j)–(i, j + 1).
  const horizontal = (w - 1) * h;
  const edgeCount = horizontal + w * (h - 1);
  const hEdge = (i: number, j: number) => j * (w - 1) + i;
  const vEdge = (i: number, j: number) => horizontal + j * w + i;

  // Pass 1: every cell once; its segments go to each level its value range spans.
  const segments: number[][] = levels.map(() => []);
  const at = (i: number, j: number) => z[j * w + i] ?? 0;
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);
      const lo = Math.min(tl, tr, br, bl);
      const hi = Math.max(tl, tr, br, bl);
      // Levels L with lo < L ≤ hi have corners on both sides (above = value ≥ L).
      const kFrom = Math.max(0, Math.floor((lo - first) / interval) + 1);
      const kTo = Math.min(levels.length - 1, Math.floor((hi - first) / interval));
      if (kFrom > kTo) continue;
      const edges = [hEdge(i, j), vEdge(i + 1, j), hEdge(i, j + 1), vEdge(i, j)];
      for (let k = kFrom; k <= kTo; k++) {
        const level = levels[k] ?? 0;
        const index =
          (tl >= level ? 8 : 0) |
          (tr >= level ? 4 : 0) |
          (br >= level ? 2 : 0) |
          (bl >= level ? 1 : 0);
        let sides: readonly number[];
        if (index === 5 || index === 10) {
          const centreAbove = (tl + tr + br + bl) / 4 >= level;
          if (index === 5) sides = centreAbove ? SADDLE_5_CENTRE_ABOVE : SADDLE_5_CENTRE_BELOW;
          else sides = centreAbove ? SADDLE_10_CENTRE_ABOVE : SADDLE_10_CENTRE_BELOW;
        } else {
          sides = CASES[index] ?? [];
        }
        const list = segments[k];
        if (!list) continue;
        for (let s = 0; s < sides.length; s += 2) {
          list.push(edges[sides[s] ?? 0] ?? 0, edges[sides[s + 1] ?? 0] ?? 0);
        }
      }
    }
  }

  // Pass 2: per level, join segments that share an edge (each edge joins at most two segments).
  const link1 = new Int32Array(edgeCount).fill(-1);
  const link2 = new Int32Array(edgeCount).fill(-1);
  const visited = new Uint8Array(edgeCount);
  const lines: ContourLine[] = [];

  levels.forEach((level, k) => {
    const list = segments[k] ?? [];
    const touched: number[] = [];
    const link = (from: number, to: number) => {
      if (link1[from] === -1) {
        link1[from] = to;
        touched.push(from);
      } else {
        link2[from] = to;
      }
    };
    for (let s = 0; s < list.length; s += 2) {
      const a = list[s] ?? 0;
      const b = list[s + 1] ?? 0;
      link(a, b);
      link(b, a);
    }

    const point = (edge: number, out: number[]) => {
      if (edge < horizontal) {
        const j = Math.floor(edge / (w - 1));
        const i = edge - j * (w - 1);
        const a = at(i, j);
        const b = at(i + 1, j);
        out.push(i + (level - a) / (b - a), j);
      } else {
        const e = edge - horizontal;
        const j = Math.floor(e / w);
        const i = e - j * w;
        const a = at(i, j);
        const b = at(i, j + 1);
        out.push(i, j + (level - a) / (b - a));
      }
    };

    const walk = (start: number): ContourLine => {
      const coords: number[] = [];
      let previous = -1;
      let current = start;
      let closed = false;
      for (;;) {
        visited[current] = 1;
        point(current, coords);
        const a = link1[current] ?? -1;
        const b = link2[current] ?? -1;
        const next = a !== previous ? a : b;
        if (next === -1) break;
        if (next === start) {
          closed = true;
          break;
        }
        if (visited[next]) break;
        previous = current;
        current = next;
      }
      return {
        level,
        index: isIndexLevel(level, interval, indexEvery),
        closed,
        points: Float64Array.from(coords),
      };
    };

    // Open lines first (from an end, an edge with one link), then the rings that are left.
    for (const edge of touched) {
      if (!visited[edge] && link2[edge] === -1) lines.push(walk(edge));
    }
    for (const edge of touched) if (!visited[edge]) lines.push(walk(edge));

    for (const edge of touched) {
      link1[edge] = -1;
      link2[edge] = -1;
      visited[edge] = 0;
    }
  });

  return lines.filter((line) => line.points.length >= 4 && !isDegenerate(line.points));
}

/** All points in one place (a level touching a single grid node): nothing to draw. */
function isDegenerate(points: Float64Array): boolean {
  const x = points[0] ?? 0;
  const y = points[1] ?? 0;
  for (let i = 2; i + 1 < points.length; i += 2) {
    if (Math.abs((points[i] ?? 0) - x) > 1e-9 || Math.abs((points[i + 1] ?? 0) - y) > 1e-9) {
      return false;
    }
  }
  return true;
}

/**
 * The heightfield with its elevations smoothed by two passes of a (2·radius + 1)² box blur (close
 * to a Gaussian of σ ≈ 0.8·radius), edges clamped; min and max recomputed. Raw elevation tiles
 * carry metre-scale noise that turns 20 m contours and ridge lines into fuzz at poster size;
 * a blur of a sample or two keeps the landforms and drops the fuzz.
 */
export function smoothHeightfield<T extends Pick<Heightfield, 'width' | 'height' | 'elevations'>>(
  heightfield: T,
  radius: number,
): T & { min: number; max: number } {
  const { width: w, height: h } = heightfield;
  const r = Math.max(0, Math.round(radius));
  const data = Float32Array.from(heightfield.elevations);
  if (r > 0 && w > 1 && h > 1) {
    const tmp = new Float32Array(w * h);
    const blurRows = (src: Float32Array, dst: Float32Array) => {
      for (let j = 0; j < h; j++) {
        const row = j * w;
        for (let i = 0; i < w; i++) {
          let sum = 0;
          for (let d = -r; d <= r; d++) sum += src[row + Math.min(w - 1, Math.max(0, i + d))] ?? 0;
          dst[row + i] = sum / (2 * r + 1);
        }
      }
    };
    const blurColumns = (src: Float32Array, dst: Float32Array) => {
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          let sum = 0;
          for (let d = -r; d <= r; d++)
            sum += src[Math.min(h - 1, Math.max(0, j + d)) * w + i] ?? 0;
          dst[j * w + i] = sum / (2 * r + 1);
        }
      }
    };
    for (let pass = 0; pass < 2; pass++) {
      blurRows(data, tmp);
      blurColumns(tmp, data);
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { ...heightfield, elevations: data, min, max };
}

// ---------------------------------------------------------------------------------------------
// Projection into the map box
// ---------------------------------------------------------------------------------------------

export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

export interface MapProjection {
  readonly width: number;
  readonly height: number;
  /** Logical px per ground metre (the same along x and y: true aspect). */
  readonly pxPerMetre: number;
  /** Grid coordinates → box px (north up). */
  readonly grid: (x: number, y: number) => readonly [number, number];
  /** lon/lat → box px. */
  readonly lonLat: (lon: number, lat: number) => readonly [number, number];
}

/**
 * The top-down projection of `heightfield` into a box of `box` logical px, north up, true aspect
 * (`metresPerSample`). The map covers the box (cropping the heightfield's longer side) when that
 * keeps all of `focus` (the route's bounds) inside the box with `margin` (a fraction of the box)
 * around it, centred on the focus as far as the heightfield allows; otherwise it shrinks until
 * the focus fits, centred on it, and the box's edges show paper.
 */
export function mapProjection(
  heightfield: Pick<Heightfield, 'width' | 'height' | 'metresPerSample' | 'bounds'>,
  box: BoxSize,
  focus?: Bounds,
  margin = 0.06,
): MapProjection {
  const { width: w, height: h, metresPerSample: mps } = heightfield;
  const groundW = Math.max(1e-9, (w - 1) * mps.x);
  const groundH = Math.max(1e-9, (h - 1) * mps.y);
  const cover = Math.max(box.width / groundW, box.height / groundH);
  const hf = heightfield as Heightfield;

  // Focus extent in grid coordinates (whole grid without a focus).
  let fx0 = 0;
  let fy0 = 0;
  let fx1 = w - 1;
  let fy1 = h - 1;
  if (focus) {
    const nw = gridPosition(hf, focus.west, focus.north);
    const se = gridPosition(hf, focus.east, focus.south);
    fx0 = nw.x;
    fy0 = nw.y;
    fx1 = se.x;
    fy1 = se.y;
  }
  const focusW = Math.max(1e-9, (fx1 - fx0) * mps.x);
  const focusH = Math.max(1e-9, (fy1 - fy0) * mps.y);
  const fit = focus
    ? Math.min((box.width * (1 - 2 * margin)) / focusW, (box.height * (1 - 2 * margin)) / focusH)
    : Infinity;
  const scale = Math.min(cover, fit);

  // Centre (in grid coordinates) on the focus, clamped so the heightfield still covers the box.
  const halfX = box.width / 2 / (scale * mps.x);
  const halfY = box.height / 2 / (scale * mps.y);
  const clampCentre = (c: number, half: number, size: number) =>
    half * 2 >= size - 1 ? (size - 1) / 2 : Math.min(size - 1 - half, Math.max(half, c));
  const coverBox = scale >= cover - 1e-9;
  const cx = coverBox ? clampCentre((fx0 + fx1) / 2, halfX, w) : (fx0 + fx1) / 2;
  const cy = coverBox ? clampCentre((fy0 + fy1) / 2, halfY, h) : (fy0 + fy1) / 2;

  const grid = (x: number, y: number) =>
    [box.width / 2 + (x - cx) * mps.x * scale, box.height / 2 + (y - cy) * mps.y * scale] as const;
  return {
    width: box.width,
    height: box.height,
    pxPerMetre: scale,
    grid,
    lonLat: (lon, lat) => {
      const p = gridPosition(hf, lon, lat);
      return grid(p.x, p.y);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

/**
 * Ramer–Douglas–Peucker on a flat [x0, y0, x1, y1, …] list: the points to keep so no dropped
 * point is farther than `tolerance` from the kept line. Iterative (long lines would overflow the
 * stack).
 */
export function simplify(points: ArrayLike<number>, tolerance: number): number[] {
  const n = Math.floor(points.length / 2);
  if (n <= 2 || tolerance <= 0) return Array.from(points);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  const x = (i: number) => points[2 * i] ?? 0;
  const y = (i: number) => points[2 * i + 1] ?? 0;
  while (stack.length > 0) {
    const [a, b] = stack.pop() ?? [0, 0];
    const ax = x(a);
    const ay = y(a);
    const dx = x(b) - ax;
    const dy = y(b) - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD2 = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = x(i) - ax;
      const py = y(i) - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worstD2) {
        worstD2 = d2;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(x(i), y(i));
  return out;
}

/**
 * An SVG path for a flat point list ("M x,y L x,y …", plus "Z" when closed), coordinates rounded
 * to `decimals` places.
 */
export function pathData(points: ArrayLike<number>, closed = false, decimals = 1): string {
  const f = 10 ** decimals;
  const num = (value: number) => String(Math.round(value * f) / f);
  let d = '';
  for (let i = 0; i + 1 < points.length; i += 2) {
    d += `${i === 0 ? 'M' : 'L'}${num(points[i] ?? 0)},${num(points[i + 1] ?? 0)}`;
  }
  return d && closed ? `${d}Z` : d;
}

/** Largest deviation a simplified line may have from the full one, in OUTPUT px. */
export const OUTPUT_TOLERANCE_PX = 0.3;

/**
 * How finely to write lines for an output drawn at `detailScale` output px per logical px (the
 * export scale; 1 for the preview): the simplification tolerance in logical px (0.3 output px)
 * and the decimals that keep coordinate rounding under ~0.1 output px.
 */
export function lineDetail(detailScale = 1): { tolerance: number; decimals: number } {
  const scale = Number.isFinite(detailScale) && detailScale > 0 ? detailScale : 1;
  return {
    tolerance: OUTPUT_TOLERANCE_PX / scale,
    decimals: Math.max(1, Math.min(4, Math.ceil(Math.log10(scale * 10)))),
  };
}

export interface ContourPaths {
  /** All index contours as one path. */
  readonly index: string;
  /** All intermediate contours as one path. */
  readonly intermediate: string;
}

/**
 * The contour lines projected into the map box, simplified to 0.3 output px for an output at
 * `detailScale` output px per logical px (see `lineDetail`) and, from 2× up, with the grid's
 * facets rounded off (`chaikin`), as two SVG paths.
 */
export function contourPaths(
  lines: readonly ContourLine[],
  projection: Pick<MapProjection, 'grid'>,
  detailScale = 1,
): ContourPaths {
  const { tolerance, decimals } = lineDetail(detailScale);
  const index: string[] = [];
  const intermediate: string[] = [];
  for (const line of lines) {
    const projected: number[] = [];
    for (let i = 0; i + 1 < line.points.length; i += 2) {
      const [px, py] = projection.grid(line.points[i] ?? 0, line.points[i + 1] ?? 0);
      projected.push(px, py);
    }
    // At print scale a grid cell spans several output px, so the marching-squares facets would
    // show: round them off (Chaikin, two passes) before simplifying.
    const smooth = detailScale >= 2 ? chaikin(projected, line.closed, 2) : projected;
    // Close rings explicitly before simplifying so the closing segment is kept exact.
    if (line.closed) smooth.push(smooth[0] ?? 0, smooth[1] ?? 0);
    const d = pathData(simplify(smooth, tolerance), false, decimals);
    (line.index ? index : intermediate).push(d);
  }
  return { index: index.join(''), intermediate: intermediate.join('') };
}

/**
 * Chaikin corner cutting on a flat [x0, y0, …] list: each pass replaces every segment by points
 * at 1/4 and 3/4 of it, rounding corners while staying within a quarter segment of the original.
 * An open line keeps its end points; a closed one (first point not repeated) wraps around.
 */
export function chaikin(points: ArrayLike<number>, closed: boolean, passes = 1): number[] {
  let current = Array.from(points);
  for (let pass = 0; pass < passes; pass++) {
    const n = Math.floor(current.length / 2);
    if (n < 3) return current;
    const next: number[] = [];
    const at = (i: number) => [current[2 * i] ?? 0, current[2 * i + 1] ?? 0] as const;
    if (!closed) next.push(...at(0));
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const [ax, ay] = at(i);
      const [bx, by] = at((i + 1) % n);
      next.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by);
      next.push(0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    if (!closed) {
      // Keep the true ends: drop the cut points next to them.
      next.splice(2, 2);
      next.splice(next.length - 2, 2);
      next.push(...at(n - 1));
    }
    current = next;
  }
  return current;
}

/**
 * Contour interval for a heightfield drawn at `pxPerMetre`: 20 m (DESIGN-SPEC §4), or the next of
 * 40 / 50 / 100 / 200 / 500 m when 20 m lines would be packed closer than `minSpacingPx` on
 * average (the mean slope of the grid sets the spacing), so big mountains on a small map stay
 * legible. The map's label always states the interval actually used.
 */
export function chooseContourInterval(
  heightfield: Pick<Heightfield, 'width' | 'height' | 'elevations' | 'metresPerSample'>,
  pxPerMetre: number,
  minSpacingPx = 2.5,
): number {
  const { width: w, height: h, elevations: z, metresPerSample: mps } = heightfield;
  let sum = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(Math.max(w, h) / 128));
  for (let j = 0; j + step < h; j += step) {
    for (let i = 0; i + step < w; i += step) {
      const c = z[j * w + i] ?? 0;
      const gx = ((z[j * w + i + step] ?? c) - c) / (step * mps.x);
      const gy = ((z[(j + step) * w + i] ?? c) - c) / (step * mps.y);
      sum += Math.hypot(gx, gy);
      count++;
    }
  }
  const slope = count > 0 ? sum / count : 0;
  for (const interval of [CONTOUR_INTERVAL_M, 40, 50, 100, 200, 500]) {
    if (slope === 0 || (interval / slope) * pxPerMetre >= minSpacingPx) return interval;
  }
  return 1000;
}

// ---------------------------------------------------------------------------------------------
// Scale bar
// ---------------------------------------------------------------------------------------------

export interface ScaleBar {
  /** Ground length of one segment, metres. */
  readonly segmentMetres: number;
  /** Number of alternating segments. */
  readonly segments: number;
  /** Length of one segment, logical px. */
  readonly segmentPx: number;
  /** Whole bar, logical px. */
  readonly lengthPx: number;
  /** Tick labels at 0, 1, …, `segments` segment ends; the last carries the unit ("4 km"). */
  readonly labels: readonly string[];
  /** The whole bar's length as text, "4 km". */
  readonly text: string;
}

/** The largest of 1, 2, 2.5, 5 × 10ⁿ that is ≤ `x` (x > 0). */
export function largestNice(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const exponent = Math.floor(Math.log10(x));
  for (const e of [exponent, exponent - 1]) {
    for (const base of [5, 2.5, 2, 1]) {
      const value = base * 10 ** e;
      if (value <= x * (1 + 1e-9)) return value;
    }
  }
  return 10 ** (exponent - 1);
}

const trim = (value: number) => String(Math.round(value * 1000) / 1000);

/** Segments in the scale bar (as the canvas: 0 1 2 3 4 km). */
export const SCALE_BAR_SEGMENTS = 4;

/**
 * A scale bar for a map that draws the whole heightfield `figureWidthPx` wide: four alternating
 * segments of a round length (1, 2, 2.5 or 5 × 10ⁿ metres or feet), as long as fits in `maxPx`,
 * labelled in km (mi) once the bar reaches 1 km (½ mi), else in m (ft): "0 1 2 3 4 km",
 * "0 0.5 1 1.5 2 km", "0 200 400 600 800 m".
 */
export function scaleBar(
  heightfield: Pick<Heightfield, 'width' | 'metresPerSample'>,
  figureWidthPx: number,
  { maxPx = 200, units = 'metric' }: { maxPx?: number; units?: Units } = {},
): ScaleBar {
  const groundWidth = Math.max(1e-9, (heightfield.width - 1) * heightfield.metresPerSample.x);
  return scaleBarFor(figureWidthPx / groundWidth, { maxPx, units });
}

/** {@link scaleBar} for a map drawn at `pxPerMetre`. */
export function scaleBarFor(
  pxPerMetre: number,
  { maxPx = 200, units = 'metric' }: { maxPx?: number; units?: Units } = {},
): ScaleBar {
  const segments = SCALE_BAR_SEGMENTS;
  const metres =
    units === 'imperial'
      ? (() => {
          const miles = largestNice(maxPx / segments / pxPerMetre / METRES_PER_MILE);
          return miles * segments >= 0.5
            ? miles * METRES_PER_MILE
            : largestNice(maxPx / segments / pxPerMetre / METRES_PER_FOOT) * METRES_PER_FOOT;
        })()
      : largestNice(maxPx / segments / pxPerMetre);
  const total = metres * segments;
  const [unit, name] =
    units === 'imperial'
      ? total >= 0.5 * METRES_PER_MILE - 1e-6
        ? [METRES_PER_MILE, 'mi']
        : [METRES_PER_FOOT, 'ft']
      : total >= 1000 - 1e-6
        ? [1000, 'km']
        : [1, 'm'];
  const chosen = { metres, segments, unit, name };
  const value = chosen.metres / chosen.unit;
  const labels = Array.from({ length: chosen.segments + 1 }, (_, i) => trim(i * value));
  labels[labels.length - 1] = `${labels[labels.length - 1] ?? ''} ${chosen.name}`;
  const segmentPx = chosen.metres * pxPerMetre;
  return {
    segmentMetres: chosen.metres,
    segments: chosen.segments,
    segmentPx,
    lengthPx: segmentPx * chosen.segments,
    labels,
    text: `${trim(value * chosen.segments)} ${chosen.name}`,
  };
}
