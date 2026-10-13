import { describe, expect, it } from 'vitest';
import type { Heightfield } from '../terrain/heightfield';
import { METRES_PER_FOOT } from '../lib/format';
import {
  chooseContourInterval,
  contourIntervalText,
  contourLevels,
  defaultContourInterval,
  contourPaths,
  extractContours,
  isIndexLevel,
  chaikin,
  largestNice,
  lineDetail,
  mapProjection,
  pathData,
  scaleBar,
  scaleBarFor,
  simplify,
  smoothHeightfield,
} from './contours';
import type { ContourLine } from './contours';

/** A synthetic heightfield from z(x, y) on a w × h grid (grid units). */
function field(
  w: number,
  h: number,
  z: (x: number, y: number) => number,
  metresPerSample = { x: 1, y: 1 },
): Heightfield {
  const elevations = new Float32Array(w * h);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = z(x, y);
      elevations[y * w + x] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return {
    bounds: { west: -84, south: 34.7, east: -83.9, north: 34.8 },
    zoom: 13,
    width: w,
    height: h,
    elevations,
    min,
    max,
    metresPerSample,
    failedTiles: [],
  };
}

/** Distances of a line's points from (cx, cy). */
function radii(line: ContourLine, cx: number, cy: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.points.length; i += 2) {
    out.push(Math.hypot((line.points[i] ?? 0) - cx, (line.points[i + 1] ?? 0) - cy));
  }
  return out;
}

describe('contourLevels', () => {
  it('lists the multiples of the interval strictly inside the range', () => {
    expect(contourLevels(605, 700)).toEqual([620, 640, 660, 680]);
    expect(contourLevels(600, 700)).toEqual([620, 640, 660, 680]);
    expect(contourLevels(-15, 15, 10)).toEqual([-10, 0, 10]);
    expect(contourLevels(5, 5)).toEqual([]);
  });

  it('marks every 5th level (100 m) as an index contour', () => {
    expect([600, 620, 640, 660, 680, 700].map((level) => isIndexLevel(level))).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});

describe('extractContours', () => {
  // A cone: 1010 m at the centre of a 201 × 201 grid, falling 5 m per sample (303 m at corners).
  const cone = field(201, 201, (x, y) => 1010 - 5 * Math.hypot(x - 100, y - 100));
  const lines = extractContours(cone);

  it('draws one ring per level that fits in the grid, at the right radius', () => {
    const rings = lines.filter((line) => line.closed);
    // Levels 520…1000 (radius 98…2) are whole circles.
    expect(rings.map((line) => line.level)).toEqual(
      Array.from({ length: 25 }, (_, i) => 520 + 20 * i),
    );
    for (const ring of rings) {
      const expected = (1010 - ring.level) / 5;
      for (const r of radii(ring, 100, 100)) expect(Math.abs(r - expected)).toBeLessThan(0.05);
    }
  });

  it('cuts the bigger circles into border-to-border arcs, four per level', () => {
    const open = lines.filter((line) => !line.closed);
    // Levels 320…500: radius 138…102, inside the square only near its four corners.
    expect(open).toHaveLength(10 * 4);
    for (const arc of open) {
      const first = [arc.points[0] ?? 0, arc.points[1] ?? 0];
      const last = [arc.points.at(-2) ?? 0, arc.points.at(-1) ?? 0];
      for (const [x, y] of [first, last]) {
        const onBorder = x === 0 || x === 200 || y === 0 || y === 200;
        expect(onBorder).toBe(true);
      }
    }
  });

  it('makes every 5th level an index line (multiples of 100 m)', () => {
    const index = new Set(lines.filter((line) => line.index).map((line) => line.level));
    expect([...index].sort((a, b) => a - b)).toEqual([400, 500, 600, 700, 800, 900, 1000]);
    for (const line of lines) expect(line.index).toBe(line.level % 100 === 0);
  });

  it('turns a ramp into straight lines at the right place', () => {
    // 2 m per sample eastward: level L sits at x = L / 2.
    const ramp = extractContours(field(101, 11, (x) => 2 * x));
    expect(ramp.map((line) => line.level)).toEqual(
      Array.from({ length: 9 }, (_, i) => 20 + 20 * i),
    );
    for (const line of ramp) {
      expect(line.closed).toBe(false);
      expect(line.points.length / 2).toBe(11);
      for (let i = 0; i < line.points.length; i += 2) {
        expect(line.points[i]).toBeCloseTo(line.level / 2, 6);
      }
    }
  });

  it('honours another interval', () => {
    const ramp = extractContours(
      field(101, 3, (x) => 2 * x),
      { interval: 50, indexEvery: 2 },
    );
    expect(ramp.map((line) => [line.level, line.index])).toEqual([
      [50, false],
      [100, true],
      [150, false],
    ]);
  });

  describe('saddles', () => {
    // One cell, tl and br high (case 10); level 0.5.
    const cell = (tl: number, tr: number, br: number, bl: number) => {
      const values = [tl, tr, bl, br];
      return field(2, 2, (x, y) => values[y * 2 + x] ?? 0);
    };
    /** Each line as its two end points, rounded to 3 decimals, sorted. */
    const segments = (result: ContourLine[]) =>
      result
        .map((line) => {
          const p = Array.from(line.points, (v) => Math.round(v * 1000) / 1000);
          return `${String(p[0])},${String(p[1])} ${String(p[2])},${String(p[3])}`;
        })
        .sort();

    it('centre above: the high corners join, the low corners are cut off', () => {
      // Mean 0.6 ≥ 0.5.
      const result = extractContours(cell(0.9, 0.3, 0.9, 0.3), { interval: 0.5 });
      // Around tr: top (0.667, 0) – right (1, 0.333); around bl: left (0, 0.667) – bottom.
      expect(segments(result)).toEqual(['0,0.667 0.333,1', '0.667,0 1,0.333']);
    });

    it('centre below: the high corners are cut off', () => {
      // Mean 0.45 < 0.5.
      const result = extractContours(cell(0.9, 0.1, 0.7, 0.1), { interval: 0.5 });
      // Around tl: top (0.5, 0) – left (0, 0.5); around br: right (1, 0.667) – bottom (0.667, 1).
      expect(segments(result)).toEqual(['0.5,0 0,0.5', '0.667,1 1,0.667']);
    });

    it('two peaks: separate rings above the saddle, one ring around both below it', () => {
      // Cones at x = 30 and x = 70 (peaks 500 m), meeting in a saddle at 400 m.
      const twin = field(101, 61, (x, y) =>
        Math.max(500 - 5 * Math.hypot(x - 30, y - 30), 500 - 5 * Math.hypot(x - 70, y - 30)),
      );
      const result = extractContours(twin);
      const ringsAt = (level: number) =>
        result.filter((line) => line.level === level && line.closed).length;
      expect(ringsAt(480)).toBe(2);
      expect(ringsAt(420)).toBe(2);
      expect(ringsAt(380)).toBe(1);
      expect(ringsAt(360)).toBe(1);
      // Every line is a ring or ends on the border (no dangling ends at the saddle).
      for (const line of result) {
        if (line.closed) continue;
        const x = line.points[0] ?? -1;
        const y = line.points[1] ?? -1;
        expect(x === 0 || x === 100 || y === 0 || y === 60).toBe(true);
      }
    });
  });

  it('returns nothing for a flat field', () => {
    expect(extractContours(field(10, 10, () => 300))).toEqual([]);
  });
});

describe('the 0 m line (the coast)', () => {
  const NINE = { x: 9, y: 9 }; // a z14 grid's samples, metres
  const xs = (line: ContourLine) => Array.from(line.points).filter((_, i) => i % 2 === 0);
  const coastOf = (lines: ContourLine[]) => lines.filter((line) => line.level === 0);
  const NONE: ContourLine = { level: 0, index: true, closed: false, points: new Float64Array(0) };

  it("traces the coast, not Terrarium's sea blocks: one index line where the land rises", () => {
    // A harbour: blocks 20 samples (180 m) across at +0.3 m or −1.5 m west of column 200, one of
    // them out in the water at +1.5 m; a quay at 4 m rising inland east of it.
    const harbour = field(
      300,
      200,
      (x, y) => {
        if (x >= 200) return 4 + (x - 200) * 2;
        if (x >= 20 && x < 40 && y >= 20 && y < 40) return 1.5;
        return (Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? 0.3 : -1.5;
      },
      NINE,
    );
    const coast = coastOf(extractContours(harbour));
    expect(coast).toHaveLength(1);
    expect(coast[0]?.index).toBe(true);
    // Along the quay, within a sample and a half of it (the low blocks beside it pull it out a
    // little), from the top edge to the bottom edge.
    for (const x of xs(coast[0] ?? NONE)) expect(Math.abs(x - 199.5)).toBeLessThan(1.5);
    // The levels above are traced from the elevations as they are.
    expect(extractContours(harbour).filter((line) => line.level > 0).length).toBeGreaterThan(0);
  });

  it('draws a shore where the sea is exactly 0 m (Étretat), as one clean line', () => {
    // Sea at exactly 0 m, deepening to −5 m at the west edge; a cliff rising from 20 m.
    const cliff = field(60, 40, (x) => (x === 0 ? -5 : x < 30 ? 0 : 20 + (x - 30) * 3), NINE);
    const coast = coastOf(extractContours(cliff));
    expect(coast).toHaveLength(1);
    // Between the last 0 m sample and the cliff, not out at sea.
    for (const x of xs(coast[0] ?? NONE)) expect(Math.abs(x - 29.5)).toBeLessThan(0.75);
  });

  it('keeps the 0 m line of land below sea level (the Dead Sea escarpment) where the data puts it', () => {
    const escarpment = field(60, 20, (x) => -430 + x * 15, { x: 35, y: 35 });
    const lines = extractContours(escarpment);
    const coast = coastOf(lines);
    expect(coast).toHaveLength(1);
    // −430 + 15x = 0 at x = 28.67: within half a sample.
    for (const x of xs(coast[0] ?? NONE)) expect(Math.abs(x - 430 / 15)).toBeLessThan(0.5);
    expect(lines.map((line) => line.level)).toEqual(
      [...new Set(lines.map((line) => line.level))].sort((p, q) => p - q),
    );
  });

  it('prints the coast as a smooth line, not a staircase on the grid', () => {
    // A cliff at 23° to the grid rising from a sea of exact zeros, and a sea of blocks beside a
    // gentle quay: segments exactly horizontal, vertical or 45° stay as rare as on any contour.
    const snapped = (lines: ContourLine[]) => {
      let count = 0;
      let all = 0;
      for (const line of lines) {
        const p = line.points;
        for (let k = 2; k + 1 < p.length; k += 2) {
          const dy = (p[k + 1] ?? 0) - (p[k - 1] ?? 0);
          const dx = (p[k] ?? 0) - (p[k - 2] ?? 0);
          const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 45;
          all++;
          if (angle < 0.5 || angle > 44.5) count++;
        }
      }
      return count / all;
    };
    const cliff = field(
      160,
      120,
      (x, y) => (x - 40 - 0.43 * y < 0 ? (x === 0 ? -5 : 0) : 30),
      NINE,
    );
    expect(snapped(coastOf(extractContours(cliff)))).toBeLessThan(0.1);
    const quay = field(
      160,
      120,
      (x, y) => {
        const d = x - 80 - 0.43 * y;
        if (d >= 0) return 0.6 + d * 0.05;
        return (Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? 0.3 : -1.5;
      },
      NINE,
    );
    expect(snapped(coastOf(extractContours(quay)))).toBeLessThan(0.1);
  });

  it('keeps a small island that rises above 3 m, drops a low patch of the same size', () => {
    // 15 × 15 samples (1.8 ha) in a sea at −5 m: one peaks at 20 m, one at 1.2 m.
    const sea = field(
      300,
      200,
      (x, y) => {
        if (x >= 20 && x < 35 && y >= 30 && y < 45) return 20;
        if (x >= 80 && x < 95 && y >= 30 && y < 45) return 1.2;
        return -5;
      },
      NINE,
    );
    const lefts = coastOf(extractContours(sea)).map((line) => Math.min(...xs(line)));
    expect(lefts.some((x) => x > 17 && x < 23)).toBe(true);
    expect(lefts.some((x) => x > 75)).toBe(false);
  });

  it('drops a small pond or islet, keeps one big enough or cut by the edge, draws none below 0', () => {
    // Land at 5 m with a 10 × 10 sample (90 m) pond at −2 m inside and a 40 × 40 lake.
    const land = field(
      120,
      80,
      (x, y) => {
        if (x >= 10 && x < 20 && y >= 10 && y < 20) return -2;
        if (x >= 60 && x < 100 && y >= 20 && y < 60) return -2;
        if (x < 30 && y >= 20 && y < 60) return -2; // a bay cut by the west edge
        if (x >= 115 && y < 8) return -2; // a sliver of sea in the corner
        return 5;
      },
      NINE,
    );
    const coast = coastOf(extractContours(land));
    const boxes = coast.map((line) => Math.min(...xs(line)));
    expect(boxes.some((x) => x < 2)).toBe(true); // the bay
    expect(boxes.some((x) => x > 55 && x < 61)).toBe(true); // the lake
    expect(boxes.some((x) => x > 8 && x < 12)).toBe(false); // not the pond
    expect(boxes.some((x) => x > 110)).toBe(false); // nor the sliver
    // A small grid (no ground size given) keeps its shore: a −50…+50 m plane, 50 × 10 samples.
    const plane = field(50, 10, (x) => -50 + (100 * x) / 49);
    expect(coastOf(extractContours({ ...plane, metresPerSample: undefined }))).toHaveLength(1);
    // A polder entirely below 0: no 0 m line at all.
    expect(coastOf(extractContours(field(30, 30, (x) => -10 + x * 0.2, NINE)))).toEqual([]);
  });
});

describe('simplify and pathData', () => {
  it('drops points within the tolerance and keeps corners', () => {
    const line = [0, 0, 1, 0.01, 2, 0, 3, 0, 3, 1, 3, 2];
    expect(simplify(line, 0.1)).toEqual([0, 0, 3, 0, 3, 2]);
    expect(simplify(line, 0)).toEqual(line);
  });

  it('writes SVG path data with one decimal', () => {
    expect(pathData([0, 0, 10.04, 5.06])).toBe('M0,0L10,5.1');
    expect(pathData([0, 0, 1, 0, 1, 1], true)).toBe('M0,0L1,0L1,1Z');
    expect(pathData([])).toBe('');
  });
});

describe('mapProjection', () => {
  // 1000 m × 1000 m: 101 × 51 samples at 10 m × 20 m.
  const hf = field(101, 51, () => 0, { x: 10, y: 20 });

  it('maps the grid into the box north up at true aspect', () => {
    const projection = mapProjection(hf, { width: 500, height: 500 });
    expect(projection.pxPerMetre).toBeCloseTo(0.5);
    expect(projection.grid(0, 0)).toEqual([0, 0]);
    expect(projection.grid(100, 50)).toEqual([500, 500]);
    expect(projection.grid(50, 0)).toEqual([250, 0]);
  });

  it('covers a box of another aspect, cropping the longer side', () => {
    const projection = mapProjection(hf, { width: 500, height: 250 });
    expect(projection.pxPerMetre).toBeCloseTo(0.5);
    const [x0, y0] = projection.grid(0, 0);
    const [x1, y1] = projection.grid(100, 50);
    expect([x0, x1]).toEqual([0, 500]);
    expect(y0).toBeCloseTo(-125);
    expect(y1).toBeCloseTo(375);
  });

  it('shrinks to keep the focus inside the box when covering would crop it', () => {
    const projection = mapProjection(hf, { width: 500, height: 250 }, hf.bounds, 0.05);
    // The whole grid (the focus) must fit 250 px tall with 5% margins: 225 px for 1000 m.
    expect(projection.pxPerMetre).toBeCloseTo(0.225);
    const [x0, y0] = projection.grid(0, 0);
    const [x1, y1] = projection.grid(100, 50);
    expect(y0).toBeCloseTo(12.5);
    expect(y1).toBeCloseTo(237.5);
    expect(x0).toBeCloseTo(250 - 112.5);
    expect(x1).toBeCloseTo(250 + 112.5);
    const [lx, ly] = projection.lonLat(hf.bounds.west, hf.bounds.north);
    expect(lx).toBeCloseTo(x0, 6);
    expect(ly).toBeCloseTo(y0, 6);
  });

  it('projects contours into paths, index and intermediate apart', () => {
    const cone = field(41, 41, (x, y) => 300 - 5 * Math.hypot(x - 20, y - 20));
    const paths = contourPaths(
      extractContours(cone),
      mapProjection(cone, { width: 80, height: 80 }),
    );
    // Levels 220…280; 200 is not reached inside the square's inscribed circle but at corners.
    expect(paths.index).toMatch(/^M/);
    expect(paths.intermediate.split('M').length - 1).toBeGreaterThanOrEqual(3);
  });
});

describe('chooseContourInterval', () => {
  it('keeps 20 m unless the lines would pack closer than the minimum spacing', () => {
    // A 10% slope: 20 m contours are 200 m apart.
    const ramp = field(101, 101, (x) => 0.1 * 10 * x, { x: 10, y: 10 });
    expect(chooseContourInterval(ramp, 0.1)).toBe(20); // 20 px apart
    expect(chooseContourInterval(ramp, 0.01)).toBe(40); // 2 px at 20 m, 4 px at 40 m
    expect(chooseContourInterval(ramp, 0.001)).toBe(500);
  });

  it('uses 50 ft in imperial units, and coarser steps in feet when that packs too tight', () => {
    const ramp = field(101, 101, (x) => 0.1 * 10 * x, { x: 10, y: 10 });
    const ft = (feet: number) => feet * METRES_PER_FOOT;
    expect(chooseContourInterval(ramp, 0.1, { units: 'imperial' })).toBeCloseTo(ft(50), 9);
    // 50 ft lines would be 1.5 px apart; 100 ft lines are 3 px apart.
    expect(chooseContourInterval(ramp, 0.01, { units: 'imperial' })).toBeCloseTo(ft(100), 9);
    expect(chooseContourInterval(ramp, 0.001, { units: 'imperial' })).toBeCloseTo(ft(1000), 9);
  });
});

describe('contour interval in each unit system', () => {
  it('is 20 m (index 100 m) in metric and 50 ft (index 250 ft) in imperial', () => {
    expect(defaultContourInterval('metric')).toBe(20);
    expect(defaultContourInterval('imperial')).toBeCloseTo(15.24, 9);
    expect(contourIntervalText(20)).toBe('20 METRES');
    expect(contourIntervalText(40, 'metric')).toBe('40 METRES');
    expect(contourIntervalText(defaultContourInterval('imperial'), 'imperial')).toBe('50 FEET');
    expect(contourIntervalText(100 * METRES_PER_FOOT, 'imperial')).toBe('100 FEET');
  });

  it('puts imperial index contours at multiples of 250 ft', () => {
    // 0 → 600 m eastward (0 → 1,968 ft): 50 ft levels, every 5th an index line.
    const ramp = extractContours(
      field(301, 3, (x) => 2 * x),
      { interval: defaultContourInterval('imperial') },
    );
    const feet = ramp.map((line) => line.level / METRES_PER_FOOT);
    expect(feet.length).toBe(39); // 50 … 1,950 ft
    for (const [i, line] of ramp.entries()) {
      const level = feet[i] ?? NaN;
      expect(level / 50).toBeCloseTo(Math.round(level / 50), 6);
      const onIndex = Math.abs(level / 250 - Math.round(level / 250)) < 1e-6;
      expect(line.index).toBe(onIndex);
    }
    expect(feet.filter((_, i) => ramp[i]?.index).map(Math.round)).toEqual([
      250, 500, 750, 1000, 1250, 1500, 1750,
    ]);
    // Metric stays at 20 m with 100 m index lines.
    const metric = extractContours(field(301, 3, (x) => 2 * x));
    expect(metric.filter((line) => line.index).map((line) => line.level)).toEqual([
      100, 200, 300, 400, 500,
    ]);
  });
});

describe('scaleBar', () => {
  it('picks a round length with four segments when it fits', () => {
    // 200 px = 4.5 km.
    const bar = scaleBarFor(200 / 4500, { maxPx: 200 });
    expect(bar.segmentMetres).toBe(1000);
    expect(bar.segments).toBe(4);
    expect(bar.segmentPx).toBeCloseTo(44.44, 2);
    expect(bar.labels).toEqual(['0', '1', '2', '3', '4 km']);
    expect(bar.text).toBe('4 km');
  });

  it('switches to metres for short bars and miles for imperial units', () => {
    expect(scaleBarFor(200 / 900, { maxPx: 200 }).labels).toEqual([
      '0',
      '200',
      '400',
      '600',
      '800 m',
    ]);
    const miles = scaleBarFor(200 / 9000, { maxPx: 200, units: 'imperial' });
    expect(miles.labels.at(-1)).toMatch(/ mi$/);
    expect(miles.lengthPx).toBeLessThanOrEqual(200);
  });

  it('measures the heightfield width the figure draws', () => {
    // 4.5 km wide drawn 450 px wide: 0.1 px/m; up to 300 px = 3 km, so four segments of at most
    // 750 m: 4 × 500 m.
    const hf = field(451, 10, () => 0, { x: 10, y: 10 });
    const bar = scaleBar(hf, 450, { maxPx: 300 });
    expect(bar.lengthPx).toBeCloseTo(200, 6);
    expect(bar.segmentMetres).toBe(500);
    expect(bar.labels).toEqual(['0', '0.5', '1', '1.5', '2 km']);
    expect(bar.text).toBe('2 km');
  });

  it('largestNice', () => {
    expect([0.9, 1, 1.9, 2.2, 3, 4.9, 7, 12, 260].map(largestNice)).toEqual([
      0.5, 1, 1, 2, 2.5, 2.5, 5, 10, 250,
    ]);
  });
});

describe('smoothHeightfield', () => {
  it('keeps a flat field flat and a ramp a ramp away from the edges', () => {
    const flat = smoothHeightfield(
      field(9, 9, () => 300),
      2,
    );
    expect(Array.from(flat.elevations).every((v) => Math.abs(v - 300) < 1e-4)).toBe(true);
    const ramp = smoothHeightfield(
      field(21, 5, (x) => 10 * x),
      1,
    );
    expect(ramp.elevations[2 * 21 + 10]).toBeCloseTo(100, 4);
  });

  it('removes noise, recomputes min and max and leaves the input alone', () => {
    const noisy = field(41, 41, (x, y) => ((x + y) % 2 === 0 ? 105 : 95));
    const smooth = smoothHeightfield(noisy, 2);
    expect(smooth.max - smooth.min).toBeLessThan(2);
    expect(noisy.max - noisy.min).toBe(10);
    expect(noisy.elevations[0]).toBe(105);
  });
});

describe('lineDetail (output-pixel detail)', () => {
  it('simplifies to 0.3 output px and rounds finely enough for the output scale', () => {
    expect(lineDetail()).toEqual({ tolerance: 0.3, decimals: 1 });
    // 18×24: 7.5 output px per logical px.
    expect(lineDetail(7.5).tolerance).toBeCloseTo(0.04, 6);
    expect(lineDetail(7.5).decimals).toBe(2);
    expect(lineDetail(0)).toEqual({ tolerance: 0.3, decimals: 1 });
  });

  it('keeps more of a contour at print scale than in the preview', () => {
    const cone = field(81, 81, (x, y) => 500 - 4 * Math.hypot(x - 40, y - 40));
    const lines = extractContours(cone);
    const projection = mapProjection(cone, { width: 300, height: 300 });
    const count = (d: string) => d.split('L').length;
    const preview = contourPaths(lines, projection);
    const print = contourPaths(lines, projection, 7.5);
    expect(count(print.intermediate)).toBeGreaterThan(count(preview.intermediate));
    // Two decimals at print scale.
    expect(print.intermediate).toMatch(/\.\d\d/);
  });
});

describe('chaikin', () => {
  it('cuts corners, keeps the ends of an open line', () => {
    expect(chaikin([0, 0, 4, 0, 4, 4], false)).toEqual([0, 0, 3, 0, 4, 1, 4, 4]);
  });

  it('wraps a closed ring and stays inside it', () => {
    const square = [0, 0, 4, 0, 4, 4, 0, 4];
    const out = chaikin(square, true, 2);
    expect(out.length).toBe(8 * 4);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4);
    }
  });
});
