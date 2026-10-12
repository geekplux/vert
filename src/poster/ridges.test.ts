import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { buildRun } from '../gpx/handler';
import { parseGpx } from '../gpx/parse';
import type { Heightfield } from '../terrain/heightfield';
import { lonLatToWorld, worldToLonLat } from '../lib/geo';
import type { Bounds } from '../lib/geo';
import { ridgeBounds } from './figures';
import { gridPosition } from '../terrain/heightfield';
import {
  HUG_PX,
  MIN_FLOATING_RUN_PX,
  MIN_VISIBLE_RUN_PX,
  RIDGE_RELIEF_BOOST,
  ridgeExaggeration,
  ridgeFigure,
  ridgePieces,
  smoothZigzags,
} from './ridges';

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

describe('ridgePieces', () => {
  /** A row sampled every px from x0 to x1 at height y(x). */
  const row = (x0: number, x1: number, y: (x: number) => number) => {
    const xs: number[] = [];
    for (let x = x0; x <= x1; x++) xs.push(x);
    return { xs, ys: xs.map(y) };
  };
  const spans = (row: { pieces: number[][] } | undefined) =>
    (row?.pieces ?? []).map((piece) => [piece[0], piece.at(-2)]);

  it('draws every row whole where nothing would show as a dash (the fills hide the rest)', () => {
    const pieces = ridgePieces([row(0, 100, () => 60), row(0, 100, () => 50)]);
    expect(spans(pieces[0])).toEqual([[0, 100]]);
    expect(spans(pieces[1])).toEqual([[0, 100]]);
  });

  it('drops the stub a back row leaves floating past the end of the rows in front', () => {
    // Hidden behind the front row, the back row sticks out 2 px, then 10 px past its end: the row
    // is cut a point short of where the stub begins (the front row's end counts as past it).
    expect(spans(ridgePieces([row(2, 102, () => 60), row(0, 100, () => 50)])[0])).toEqual([
      [2, 98],
    ]);
    expect(spans(ridgePieces([row(10, 110, () => 60), row(0, 100, () => 50)])[0])).toEqual([
      [10, 98],
    ]);
    // Real terrain past the edge, MIN_FLOATING_RUN_PX or longer, stays.
    expect(MIN_FLOATING_RUN_PX).toBe(20);
    expect(spans(ridgePieces([row(40, 140, () => 60), row(0, 100, () => 50)])[0])).toEqual([
      [40, 140],
    ]);
  });

  it('drops a short stretch at the field’s edge even when it rises from the line in front', () => {
    // The back row rises out from behind the front row's line 6 px before the end.
    const back = row(0, 100, (x) => 52 - Math.max(0, x - 94));
    expect(spans(ridgePieces([back, row(0, 100, () => 50)])[0])).toEqual([[0, 96]]);
    // Rising from 50 px before the end, it is terrain and stays.
    const long = row(0, 100, (x) => 52 - Math.max(0, x - 50) / 4);
    expect(spans(ridgePieces([long, row(0, 100, () => 50)])[0])).toEqual([[0, 100]]);
  });

  it('drops a short sliver standing clear above a crest in front', () => {
    expect(MIN_VISIBLE_RUN_PX).toBe(3);
    // Front: a flat line at 50; back: a spike 1.2 px above it (clear of the stroke), under 3 px
    // long.
    const back = row(0, 100, (x) => 50.5 - Math.max(0, 1.7 - Math.abs(x - 50) * 1.7));
    expect(spans(ridgePieces([back, row(0, 100, () => 50)])[0])).toEqual([
      [0, 49],
      [51, 100],
    ]);
  });

  it('drops what a hugging row shows past the end of the row in front, and keeps the rest', () => {
    // 0.5 px above the front row (inside its stroke), the back row runs on 6 px past its end.
    const pieces = ridgePieces([row(6, 106, () => 49.5), row(0, 100, () => 50)])[0];
    expect(spans(pieces)).toEqual([[6, 98]]);
    // Its fill is cut there too, so a row behind it is judged without the stub.
    expect(pieces?.last).toBe(92);
  });

  it('keeps near-coincident rows continuous: a bundle within the stroke is never cut', () => {
    expect(HUG_PX).toBe(1);
    // The back row wavers 0.3 px either side of the front row's line: short runs, all on it.
    const back = row(0, 100, (x) => 50 + 0.3 * Math.sin(x * 1.7));
    expect(spans(ridgePieces([back, row(0, 100, () => 50)])[0])).toEqual([[0, 100]]);
  });
});

describe('ridgeFigure on a tall stage', () => {
  const tall = { width: 300, height: 900 };
  const lon = Float64Array.from([-83.97, -83.95, -83.93]);
  const lat = Float64Array.from([34.705, 34.715, 34.705]);
  const fill = (figure: ReturnType<typeof ridgeFigure>) => {
    const ys = figure.rows.flatMap((r) => points(r.line)).map(([, y]) => y);
    return (Math.max(...ys) - Math.min(...ys)) / tall.height;
  };

  it('never draws the depth deeper than true: it crops the sides to the route instead', () => {
    const figure = ridgeFigure(cone, tall, { lat, lon }, { rows: 64 });
    expect(figure.depthScale).toBe(1);
    // Cropped: the rows are cut at both sides of the box (the skew no longer shows at the edges),
    // the route stays inside it.
    const ends = figure.rows.map((r) => points(r.fill)).filter((f) => f.length > 0);
    expect(ends.every((f) => Math.min(...f.map(([x]) => x)) === 0)).toBe(true);
    expect(ends.every((f) => Math.max(...f.map(([x]) => x)) === tall.width)).toBe(true);
    for (const [x] of points(figure.route)) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(tall.width);
    }
  });

  it('fills the height once the ground runs on behind the route (ridgeBounds adds it)', () => {
    // The same 2 km wide ground, 5 km deep: more terrain north of the route.
    const deep = field(101, 251, (x, y) => 900 - 4 * Math.hypot(x - 50, y - 200));
    const shallow = fill(ridgeFigure(cone, tall, { lat, lon }, { rows: 64 }));
    const figure = ridgeFigure(deep, tall, { lat, lon }, { rows: 64 });
    expect(figure.depthScale).toBeLessThanOrEqual(1);
    expect(fill(figure)).toBeGreaterThan(0.9);
    expect(fill(figure)).toBeGreaterThan(shallow);
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

/** How often y turns back by 0.5 px or more. */
const turns = (values: readonly number[]) => {
  let direction = 0;
  let extreme = values[0] ?? 0;
  let count = 0;
  for (const y of values) {
    if (direction === 0) {
      if (Math.abs(y - extreme) >= 0.5) [direction, extreme] = [Math.sign(y - extreme), y];
    } else if ((y - extreme) * direction > 0) {
      extreme = y;
    } else if ((extreme - y) * direction >= 0.5) {
      [count, direction, extreme] = [count + 1, -direction, y];
    }
  }
  return count;
};
const ysOf = (flat: readonly number[]) => flat.filter((_, i) => i % 2 === 1);
const xsOf = (flat: readonly number[]) => flat.filter((_, i) => i % 2 === 0);

describe('smoothZigzags', () => {
  it('takes the teeth out of a vertical zigzag, leaving x and the ends alone', () => {
    // x steps by 0.5; y climbs 0.3 px a step, with teeth (±4 px, 4 steps a period) in the middle.
    const teeth = [0, 4, 0, -4];
    const ys = Array.from(
      { length: 200 },
      (_, i) => 100 - 0.3 * i + (i >= 60 && i < 140 ? (teeth[i % 4] ?? 0) : 0),
    );
    const flat = ys.flatMap((y, i) => [i * 0.5, y]);
    smoothZigzags(flat, 16);
    const out = ysOf(flat);
    expect(turns(ys)).toBeGreaterThan(30);
    expect(turns(out)).toBe(0);
    expect(out[0]).toBe(ys[0]);
    expect(out.at(-1)).toBe(ys.at(-1));
    // Away from the teeth the climb is untouched.
    for (let i = 0; i < 30; i++) expect(out[i]).toBeCloseTo(ys[i] ?? NaN, 9);
    expect(xsOf(flat)).toEqual(ys.map((_, i) => i * 0.5));
  });

  it('keeps a single bend (a summit) as it is', () => {
    const ys = [50, 40, 30, 20, 30, 40, 50];
    const flat = ys.flatMap((y, i) => [i, y]);
    smoothZigzags(flat, 60);
    expect(ysOf(flat)).toEqual(ys);
  });

  it('keeps a sharp summit standing out keepPx or more, and smooths the teeth beside it', () => {
    // A 0.25 px-step route: a V summit 20 px high at x = 100, teeth (±1.5 px, 2 px period) on
    // both flanks away from it.
    const ys: number[] = [];
    for (let i = 0; i <= 800; i++) {
      const x = i * 0.25;
      const teeth = Math.abs(x - 100) > 30 ? 1.5 * Math.sin((x * Math.PI) / 1) : 0;
      ys.push(100 + 0.2 * Math.abs(x - 100) + teeth);
    }
    const flat = ys.flatMap((y, i) => [i * 0.25, y]);
    smoothZigzags(flat, 16, { keepPx: 6 });
    const out = ysOf(flat);
    expect(Math.abs((out[400] ?? 0) - (ys[400] ?? 0))).toBeLessThanOrEqual(1.5);
    expect(Math.min(...out)).toBeCloseTo(Math.min(...ys), 0);
    // The teeth are gone from the flanks (well away from the ends and the summit).
    const flank = (values: readonly number[]) => values.slice(40, 240);
    expect(turns(flank(ys))).toBeGreaterThan(20);
    expect(turns(flank(out))).toBe(0);
  });

  it('blends in without steps: no neighbour jump beyond the raw route’s, nowhere a lone spike', () => {
    // Teeth that fade in and out along a gentle climb: the smoothing must not switch.
    const ys: number[] = [];
    for (let i = 0; i <= 2000; i++) {
      const x = i * 0.3;
      const envelope = Math.max(0, Math.sin((x / 600) * Math.PI * 3));
      ys.push(400 - 0.1 * x + 2 * envelope * Math.sin(x * 2.2));
    }
    const flat = ys.flatMap((y, i) => [i * 0.3, y]);
    smoothZigzags(flat, 16, { keepPx: 6 });
    const out = ysOf(flat);
    const maxJump = (v: readonly number[]) =>
      Math.max(...v.slice(1).map((y, i) => Math.abs(y - (v[i] ?? 0))));
    expect(maxJump(out)).toBeLessThanOrEqual(maxJump(ys) + 0.25);
    expect(turns(out)).toBeLessThan(turns(ys) / 4);
  });
});

describe('ridgeFigure route on the sample', () => {
  const parsed = parseGpx(sampleGpx);
  const { run, points: track } = buildRun(parsed, 'coosa-backcountry.gpx', true);

  /** Rugged synthetic terrain over `bounds`: ridges and ravines 300–600 m apart. */
  function rugged(bounds: Bounds): Heightfield {
    const w = 220;
    const h = 220;
    const elevations = new Float32Array(w * h);
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const value =
          900 +
          260 * Math.sin(x / 9) * Math.cos(y / 13) +
          90 * Math.sin((x + 2 * y) / 4.5) +
          40 * Math.cos((3 * x - y) / 3.1);
        elevations[y * w + x] = value;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    const lat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
    return {
      bounds,
      zoom: 14,
      width: w,
      height: h,
      elevations,
      min,
      max,
      metresPerSample: {
        x: ((bounds.east - bounds.west) * Math.cos(lat) * 111_320) / (w - 1),
        y: ((bounds.north - bounds.south) * 111_320) / (h - 1),
      },
      failedTiles: [],
    };
  }

  // The stage boxes of the four sizes (the stories' Night Ridge stage, logical px).
  const SIZES = [
    { id: '18x24', box: { width: 624, height: 692 }, rows: 64 },
    { id: 'a3', box: { width: 624, height: 750 }, rows: 64 },
    { id: '4x5', box: { width: 936, height: 943 }, rows: 72 },
    { id: '9x16', box: { width: 936, height: 1513 }, rows: 72 },
  ];

  it.each(SIZES)('adds no step the raw route does not have at $id', ({ box, rows }) => {
    const heightfield = rugged(ridgeBounds(run.bounds, box));
    // A huge detail scale keeps (practically) every point of the route.
    const options = { rows, detailScale: 1e6 };
    const raw = points(
      ridgeFigure(heightfield, box, track, { ...options, smoothRoute: false }).route,
    );
    const smooth = points(ridgeFigure(heightfield, box, track, options).route);
    const maxJump = (route: [number, number][]) =>
      Math.max(...route.slice(1).map(([, y], i) => Math.abs(y - (route[i]?.[1] ?? 0))));
    expect(raw.length).toBeGreaterThan(5000);
    // The largest step stays the raw route's own (a steep segment the blend may lengthen by a few
    // per cent: 5.37 → 5.66 px at 18 × 24, 8.87 → 9.47 at 9 : 16), never a new, larger one.
    expect(maxJump(smooth)).toBeLessThanOrEqual(maxJump(raw) * 1.08);
    // The smoothing did act on this route, and kept its ends.
    expect(turns(smooth.map(([, y]) => y))).toBeLessThan(turns(raw.map(([, y]) => y)));
    expect(smooth[0]).toEqual(raw[0]);
    expect(smooth.at(-1)).toEqual(raw.at(-1));
  });
});
