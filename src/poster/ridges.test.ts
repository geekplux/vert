import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../terrain/heightfield';
import { lonLatToWorld, worldToLonLat } from '../lib/geo';
import { gridPosition } from '../terrain/heightfield';
import { RIDGE_RELIEF_BOOST, ridgeExaggeration, ridgeFigure, smoothZigzags } from './ridges';

function field(w: number, h: number, z: (x: number, y: number) => number): Heightfield {
  const elevations = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) elevations[y * w + x] = z(x, y);
  let min = Infinity;
  let max = -Infinity;
  for (const value of elevations) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    bounds: { west: -84, south: 34.7, east: -83.9, north: 34.8 },
    zoom: 13,
    width: w,
    height: h,
    elevations,
    min,
    max,
    metresPerSample: { x: 20, y: 20 },
    failedTiles: [],
  };
}

/** The [x, y] pairs of an SVG path made of M/L commands. */
function points(d: string): [number, number][] {
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

const BOX = { width: 600, height: 400 };
const cone = field(101, 101, (x, y) => 900 - 4 * Math.hypot(x - 50, y - 50));

describe('ridgeFigure', () => {
  it('draws the requested number of rows, dim at the back and bright at the front', () => {
    const figure = ridgeFigure(cone, BOX, null, { rows: 72 });
    expect(figure.rows).toHaveLength(72);
    expect(figure.rows[0]?.opacity).toBe(0.18);
    expect(figure.rows.at(-1)?.opacity).toBe(0.88);
    const opacities = figure.rows.map((row) => row.opacity);
    expect([...opacities].sort((a, b) => a - b)).toEqual(opacities);
    expect(figure.width).toBe(600);
    expect(figure.height).toBe(400);
  });

  it('fills each row down to its base, so it hides the rows behind it', () => {
    const figure = ridgeFigure(cone, BOX);
    let previousBase = -Infinity;
    for (const row of figure.rows) {
      expect(row.fill.endsWith('Z')).toBe(true);
      const fill = points(row.fill);
      const line = points(row.line);
      // The fill's last two corners sit on the base, under the line's two ends.
      const base = fill.at(-1)?.[1] ?? NaN;
      expect(fill.at(-2)?.[1]).toBe(base);
      expect(fill.at(-1)?.[0]).toBe(line[0]?.[0]);
      expect(fill.at(-2)?.[0]).toBe(line.at(-1)?.[0]);
      // Every point of the line is on or above (smaller y than) the base.
      for (const [, y] of line) expect(y).toBeLessThanOrEqual(base + 1e-9);
      // Rows step down the page from back to front.
      expect(base).toBeGreaterThan(previousBase);
      previousBase = base;
    }
  });

  it('fits the figure in the box and rests it on the bottom edge', () => {
    const figure = ridgeFigure(cone, BOX, null, { padding: 4 });
    const all = figure.rows.flatMap((row) => points(row.fill));
    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(4 - 0.05);
      expect(x).toBeLessThanOrEqual(596 + 0.05);
      expect(y).toBeGreaterThanOrEqual(4 - 0.05);
      expect(y).toBeLessThanOrEqual(396 + 0.05);
    }
    expect(Math.max(...all.map(([, y]) => y))).toBeCloseTo(396, 1);
  });

  it('lifts the rows by elevation: the peak row rises above its base', () => {
    const figure = ridgeFigure(cone, BOX, null, { rows: 101 });
    const middle = points(figure.rows[50]?.line ?? '');
    const base = points(figure.rows[50]?.fill ?? '').at(-1)?.[1] ?? 0;
    const highest = Math.min(...middle.map(([, y]) => y));
    expect(base - highest).toBeGreaterThan(20);
    // A flat field draws flat rows.
    const flat = ridgeFigure(
      field(11, 11, () => 300),
      BOX,
    );
    for (const row of flat.rows) {
      const ys = new Set(points(row.line).map(([, y]) => y));
      expect(ys.size).toBe(1);
    }
  });

  it('drapes the route on the surface: a point on a row lies on the row line', () => {
    // Latitude of grid row 50 (rows: 101 on a 101-row grid puts row r at grid y = r).
    const { bounds } = cone;
    const nw = lonLatToWorld(bounds.west, bounds.north);
    const se = lonLatToWorld(bounds.east, bounds.south);
    const lat50 = worldToLonLat(0, nw.y + (se.y - nw.y) / 2).lat;
    expect(gridPosition(cone, -83.95, lat50).y).toBeCloseTo(50, 6);
    const lon = Float64Array.from([-83.98, -83.95, -83.92]);
    const lat = Float64Array.from([lat50, lat50, lat50]);
    const figure = ridgeFigure(cone, BOX, { lat, lon }, { rows: 101, detailScale: 1000 });
    const row = points(figure.rows[50]?.line ?? '');
    /** The row line's y at x (linear between its points). */
    const rowY = (x: number) => {
      const i = row.findIndex(([px]) => px >= x);
      const [x1 = 0, y1 = 0] = row[i] ?? [];
      const [x0 = 0, y0 = 0] = row[i - 1] ?? row[i] ?? [];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    };
    const route = points(figure.route);
    expect(route).toHaveLength(3);
    for (const [x, y] of route) expect(Math.abs(y - rowY(x))).toBeLessThan(0.3);
    // The middle point is over the peak: higher on the page than the two others.
    expect(route[1]?.[1]).toBeLessThan(Math.min(route[0]?.[1] ?? 0, route[2]?.[1] ?? 0));
    expect(figure.start?.x).toBeCloseTo(route[0]?.[0] ?? NaN, 1);
    expect(figure.finish?.x).toBeCloseTo(route[2]?.[0] ?? NaN, 1);
  });

  it('a loop has a start and no separate finish', () => {
    const lat = Float64Array.from([34.75, 34.76, 34.75]);
    const lon = Float64Array.from([-83.95, -83.94, -83.95]);
    const figure = ridgeFigure(cone, BOX, { lat, lon });
    expect(figure.start).not.toBeNull();
    expect(figure.finish).toBeNull();
  });
});

describe('ridgeFigure keep-out areas', () => {
  it('shrinks the figure until no line enters the text laid over it', () => {
    const keepOut = [{ x: 0, y: 0, width: 400, height: 220 }];
    const free = ridgeFigure(cone, BOX);
    const clear = ridgeFigure(cone, BOX, null, { keepOut });
    const inside = ([x, y]: [number, number]) => x > -8 && x < 408 && y > -8 && y < 228;
    const linePoints = (figure: typeof free) => figure.rows.flatMap((row) => points(row.line));
    expect(linePoints(free).some(inside)).toBe(true);
    expect(linePoints(clear).some(inside)).toBe(false);
    // Still resting on the bottom edge.
    expect(Math.max(...linePoints(clear).map(([, y]) => y))).toBeCloseTo(396, 0);
  });
});

describe('ridgeExaggeration', () => {
  it('is the setting times the ridgeline boost, the factor the figure is drawn at', () => {
    expect(RIDGE_RELIEF_BOOST).toBe(1.5);
    expect(ridgeExaggeration(1.6)).toBe(2.4);
    expect(ridgeExaggeration(1)).toBe(1.5);
    // Doubling the setting doubles the drawn relief of a row (same layout otherwise).
    const flatBase = (setting: number) => {
      const figure = ridgeFigure(cone, { width: 600, height: 4000 }, null, {
        rows: 101,
        exaggeration: setting,
      });
      const fill = points(figure.rows[50]?.fill ?? '');
      const base = fill.at(-1)?.[1] ?? 0;
      return base - Math.min(...points(figure.rows[50]?.line ?? '').map(([, y]) => y));
    };
    // Width-limited fit (a very tall box), so the scale is the same for both.
    expect(flatBase(2) / flatBase(1)).toBeCloseTo(2, 1);
  });
});

describe('detailScale', () => {
  it('samples and keeps more points for a print export than for the preview', () => {
    const preview = ridgeFigure(cone, BOX, null, { rows: 10 });
    const print = ridgeFigure(cone, BOX, null, { rows: 10, detailScale: 7.5 });
    const count = (figure: typeof preview) => points(figure.rows[5]?.line ?? '').length;
    expect(count(print)).toBeGreaterThan(count(preview));
  });
});

describe('smoothZigzags', () => {
  it('evens out a vertical zigzag and leaves smooth stretches and the ends alone', () => {
    // x steps by 1; y climbs smoothly, then zigzags ±6 around 50, then climbs again.
    const ys = [10, 20, 30, 40, 56, 44, 56, 44, 56, 60, 70, 80, 90];
    const flat = ys.flatMap((y, i) => [i, y]);
    smoothZigzags(flat, 60);
    const out = flat.filter((_, i) => i % 2 === 1);
    expect(out.slice(0, 3)).toEqual([10, 20, 30]);
    expect(out.slice(-3)).toEqual([70, 80, 90]);
    // The zigzag is gone: y no longer turns back anywhere (it climbs throughout).
    const turns = (values: number[]) =>
      values.slice(1, -1).filter((v, i) => (v - (values[i] ?? 0)) * ((values[i + 2] ?? 0) - v) < 0)
        .length;
    expect(turns(ys)).toBe(4);
    expect(turns(out)).toBe(0);
    // x is untouched.
    expect(flat.filter((_, i) => i % 2 === 0)).toEqual(ys.map((_, i) => i));
  });

  it('keeps a single bend (a summit) as it is', () => {
    const ys = [50, 40, 30, 20, 30, 40, 50];
    const flat = ys.flatMap((y, i) => [i, y]);
    smoothZigzags(flat, 60);
    expect(flat.filter((_, i) => i % 2 === 1)).toEqual(ys);
  });
});
