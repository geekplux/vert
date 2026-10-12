// @vitest-environment node
// Stats run in the parse worker, so they are tested without jsdom.
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../lib/geo';
import { parseGpx } from './parse';
import {
  MAX_CLIMBS,
  MAX_INTERPOLATED_GAP_M,
  PROFILE_POINTS,
  computeStats,
  elevationChange,
  findClimbs,
  median3,
  paceAt,
  timeAtDistance,
  turningPoints,
} from './stats';
import type { TrackPoint } from './types';

/** Degrees of latitude per metre along a meridian, where haversine is exactly R·Δφ. */
const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);
const T0 = Date.UTC(2026, 9, 3, 11, 10, 0);

/** A point `d` metres north of 45°N 7°E, with optional elevation and time (seconds after T0). */
function at(d: number, ele: number | null = null, seconds: number | null = null): TrackPoint {
  return {
    lat: 45 + d * DEG_PER_M,
    lon: 7,
    ele,
    time: seconds === null ? null : T0 + seconds * 1000,
  };
}

/** Points every `step` metres with elevation `ele(d)` and no times. */
function profileTrack(length: number, step: number, ele: (d: number) => number): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let d = 0; d <= length + 1e-9; d += step) points.push(at(d, ele(d)));
  return points;
}

/** Piecewise-linear elevation through `[d, ele]` knots. */
function knots(...pairs: [number, number][]): (d: number) => number {
  return (d) => {
    let previous: [number, number] | undefined;
    for (const [d1, e1] of pairs) {
      if (previous && d <= d1) {
        const [d0, e0] = previous;
        return e0 + ((e1 - e0) * (d - d0)) / (d1 - d0);
      }
      previous = [d1, e1];
    }
    return previous?.[1] ?? 0;
  };
}

describe('distance', () => {
  it('is the haversine length of a straight line', () => {
    const points = Array.from({ length: 101 }, (_, i) => at(i * 10));
    const stats = computeStats(points);
    expect(stats.distance).toBeCloseTo(1000, 6);
    expect(stats.cumulative).toHaveLength(101);
    expect(stats.cumulative[0]).toBe(0);
    expect(stats.cumulative[50]).toBeCloseTo(500, 6);
  });

  it('adds nothing for repeated positions', () => {
    const points = [at(0), at(0), at(100), at(100), at(100), at(250)];
    const stats = computeStats(points);
    expect(stats.distance).toBeCloseTo(250, 6);
    expect([...stats.cumulative].map((d) => Math.round(d))).toEqual([0, 0, 100, 100, 100, 250]);
  });

  it('handles one point and no points', () => {
    const one = computeStats([at(0, 500, 0)]);
    expect(one.distance).toBe(0);
    expect(one.ascent).toBe(0);
    expect(one.highPoint).toBe(500);
    expect(one.profile).toEqual([{ d: 0, ele: 500 }]);
    expect(one.movingTime).toBeNull(); // a single time spans nothing

    const none = computeStats([]);
    expect(none.distance).toBe(0);
    expect(none.hasElevation).toBe(false);
    expect(none.profile).toEqual([]);
  });
});

describe('elevation', () => {
  /** Teeth of `amplitude` m in 0.5 m steps, each extreme held for two points (so median3 keeps it). */
  function sawtooth(teeth: number, amplitude: number): Float64Array {
    const values: number[] = [0, 0];
    for (let t = 0; t < teeth; t++) {
      for (let e = 0.5; e <= amplitude; e += 0.5) values.push(e);
      values.push(amplitude);
      for (let e = amplitude - 0.5; e >= 0; e -= 0.5) values.push(e);
      values.push(0);
    }
    return Float64Array.from(values);
  }

  it('counts every tooth of a sawtooth bigger than the hysteresis in full', () => {
    expect(elevationChange(sawtooth(5, 10))).toEqual({ ascent: 50, descent: 50 });
  });

  it('ignores wobble under the 2 m hysteresis entirely', () => {
    // A naive sum of rises would give 5 × 1.5 = 7.5 m.
    expect(elevationChange(sawtooth(5, 1.5))).toEqual({ ascent: 0, descent: 0 });
  });

  it('measures a climb with sub-2 m noise on it as the climb', () => {
    // 0 → 100 m in 1 m steps, every other point 1.5 m high: naive ascent would be ~175 m.
    const values = Float64Array.from({ length: 101 }, (_, i) => i + (i % 2 ? 1.5 : 0));
    const { ascent } = elevationChange(values);
    expect(ascent).toBeGreaterThanOrEqual(98);
    expect(ascent).toBeLessThanOrEqual(101.5);
  });

  it('removes a single-point spike with the median filter', () => {
    const points = [0, 1, 2, 3, 4].map((i) => at(i * 10, i === 2 ? 650 : 600));
    const stats = computeStats(points);
    expect(stats.ascent).toBe(0);
    expect(stats.highPoint).toBe(600);
    expect([...median3(Float64Array.from([1, 9, 2, 3, 3]))]).toEqual([1, 2, 3, 3, 3]);
  });

  it('fills missing elevations along the route and holds the ends', () => {
    const points = [
      at(0, null),
      at(10, 100),
      at(20, null),
      at(40, null),
      at(50, 150),
      at(60, null),
    ];
    const stats = computeStats(points);
    expect(stats.hasElevation).toBe(true);
    expect([...(stats.elevation ?? [])].map((e) => Math.round(e * 10) / 10)).toEqual([
      100, 100, 112.5, 137.5, 150, 150,
    ]);
    expect(stats.ascent).toBeCloseTo(50, 6);
  });

  describe('patchy or unusable <ele>', () => {
    /** A point every 10 m over `metres`, with `ele(i)` (null for none). */
    const route = (metres: number, ele: (i: number) => number | null) =>
      Array.from({ length: metres / 10 + 1 }, (_, i) => at(i * 10, ele(i)));
    const hill = (i: number) => 500 + 100 * Math.sin(i / 40);

    it('treats all-zero or constant <ele> as none', () => {
      for (const value of [0, 812]) {
        const stats = computeStats(route(2_000, () => value));
        expect(stats.hasElevation).toBe(false);
        expect(stats.partialElevation).toBeNull();
        expect(stats.ascent).toBeNull();
      }
      // A single <ele> on a long route is a constant too.
      expect(computeStats(route(2_000, (i) => (i === 0 ? 700 : null))).partialElevation).toBeNull();
    });

    it(`interpolates gaps under ${String(MAX_INTERPOLATED_GAP_M)} m (every tenth point recorded)`, () => {
      const stats = computeStats(route(2_000, (i) => (i % 10 === 0 ? hill(i) : null)));
      expect(stats.hasElevation).toBe(true);
      expect(stats.partialElevation).toBeNull();
    });

    it('leaves long gaps for the terrain: NaN there, the rest kept, no figures yet', () => {
      const stats = computeStats(route(2_000, (i) => (i <= 100 ? hill(i) : null)));
      expect(stats.hasElevation).toBe(false);
      expect(stats.ascent).toBeNull();
      const partial = stats.partialElevation;
      expect(partial).not.toBeNull();
      expect(partial?.[50]).toBeCloseTo(hill(50), 6);
      expect(partial?.[100]).toBeCloseTo(hill(100), 6);
      expect(partial?.[101]).toBeNaN();
      expect(partial?.[200]).toBeNaN();
    });

    it('measures a gap between the recorded points around it, and from the ends', () => {
      // Recorded points 190 m apart around a gap: interpolated. 220 m: left for the terrain.
      const short = computeStats(route(1_000, (i) => (i > 30 && i < 49 ? null : hill(i))));
      expect(short.hasElevation).toBe(true);
      const long = computeStats(route(1_000, (i) => (i > 30 && i < 52 ? null : hill(i))));
      expect(long.hasElevation).toBe(false);
      expect(long.partialElevation?.[31]).toBeNaN();
      expect(long.partialElevation?.[52]).toBeCloseTo(hill(52), 6);
      // A watch that starts recording altitude 50 m in: held, as before.
      const late = computeStats(route(1_000, (i) => (i < 5 ? null : hill(i))));
      expect(late.hasElevation).toBe(true);
      expect(late.elevation?.[0]).toBeCloseTo(hill(5), 6);
    });
  });

  it('reports no elevation figures for a file without any', () => {
    const stats = computeStats([at(0), at(100), at(200)]);
    expect(stats).toMatchObject({
      hasElevation: false,
      elevation: null,
      ascent: null,
      descent: null,
      highPoint: null,
      lowPoint: null,
      climbs: [],
      profile: [],
    });
    expect(stats.distance).toBeCloseTo(200, 6);
  });

  it('finds the high and low points of the filtered series', () => {
    // A plateau at the top: a sharp one-point apex would be clipped by the median filter.
    const ele = knots([0, 300], [1000, 800], [1100, 800], [2000, 250]);
    const stats = computeStats(profileTrack(2000, 10, ele));
    expect(stats.highPoint).toBeCloseTo(800, 6);
    expect(stats.lowPoint).toBeCloseTo(250, 6);
    expect(stats.ascent).toBeCloseTo(500, 6);
    expect(stats.descent).toBeCloseTo(550, 6);
  });

  it('turning points alternate lows and highs past the dead band', () => {
    const series = Float64Array.from([5, 4, 5, 10, 9, 10, 3, 4]);
    expect(turningPoints(series, 2)).toEqual([1, 3, 6]);
    expect(turningPoints(Float64Array.from([1, 2, 1, 2]), 2)).toEqual([]);
  });
});

describe('profile', () => {
  it('has PROFILE_POINTS evenly spaced points from 0 to the end, interpolated', () => {
    const stats = computeStats(profileTrack(4990, 10, knots([0, 100], [4990, 599])));
    const { profile } = stats;
    expect(profile).toHaveLength(PROFILE_POINTS);
    expect(profile[0]).toEqual({ d: 0, ele: 100 });
    expect(profile.at(-1)?.d).toBe(stats.distance);
    const step = stats.distance / (PROFILE_POINTS - 1);
    profile.forEach(({ d, ele }, i) => {
      expect(d).toBeCloseTo(i * step, 6);
      expect(ele).toBeCloseTo(100 + (499 * d) / stats.distance, 6);
    });
  });
});

describe('moving time', () => {
  /**
   * 1 Hz at 3 m/s for 100 s, a 60 s stop (with ±1 m GPS jitter), 100 s more, a 45 s gap with no
   * points (the watch was paused; the runner moved on), then 100 s more.
   */
  function stopAndGap(): TrackPoint[] {
    const points: TrackPoint[] = [];
    let d = 0;
    let t = 0;
    for (; t <= 100; t++, d += 3) points.push(at(d, null, t));
    d -= 3;
    for (let s = 1; s <= 60; s++) points.push(at(d + (s % 2 ? 1 : -1), null, t++));
    for (let k = 1; k <= 100; k++) points.push(at((d += 3), null, t++));
    t += 44; // the next point comes 45 s after the last
    d += 3 * 45;
    for (let k = 0; k <= 100; k++) points.push(at(d + 3 * k, null, t + k));
    return points;
  }

  it('excludes the stop and the gap', () => {
    const stats = computeStats(stopAndGap());
    expect(stats.elapsedTime).toBe(405);
    // 300 s of running; the speed window lets ~4 s at each edge of the stop through.
    expect(stats.movingTime).toBeGreaterThanOrEqual(300);
    expect(stats.movingTime).toBeLessThanOrEqual(310);
    expect(stats.startTime).toBe(T0);
    expect(stats.endTime).toBe(T0 + 405_000);
  });

  it('keeps an interpolated gap out of moving time but in elapsed time', () => {
    // 100 s at 3 m/s and 1 Hz, then 30 points 20 m apart with no <time> spanning a 10-minute
    // recording gap, then 100 s more. The filled steps are 600/31 ≈ 19 s each: under MAX_GAP_S
    // one by one, but they stand for one 600 s gap.
    const points: TrackPoint[] = [];
    let d = 0;
    for (let t = 0; t <= 100; t++, d += 3) points.push(at(d, null, t));
    d -= 3;
    for (let k = 1; k <= 30; k++) points.push(at((d += 20), null, null));
    d += 20;
    for (let t = 700; t <= 800; t++, d += 3) points.push(at(d, null, t));
    const stats = computeStats(points);
    expect(stats.elapsedTime).toBe(800);
    expect(stats.movingTime).toBe(200);
    expect(stats.time?.[110]).toBeCloseTo(T0 + 100_000 + (600_000 * 10) / 31, 0);
  });

  it('still counts a short span with an untimed point', () => {
    // 1 Hz at 3 m/s, every fifth point without a time: each filled span is 2 s.
    const points = Array.from({ length: 101 }, (_, t) => at(t * 3, null, t % 5 === 2 ? null : t));
    expect(computeStats(points).movingTime).toBe(100);
  });

  it('does not count jitter while standing as moving', () => {
    // Two minutes standing at 1 Hz, wandering ±1.5 m: step speeds up to 3 m/s.
    const points = Array.from({ length: 121 }, (_, s) =>
      at([0, 1.5, -1.5, 0.5][s % 4] ?? 0, null, s),
    );
    expect(computeStats(points).movingTime).toBe(0);
  });

  it('is null without timestamps', () => {
    const stats = computeStats([at(0), at(100)]);
    expect(stats).toMatchObject({ movingTime: null, elapsedTime: null, time: null });
    expect(timeAtDistance(stats, 50)).toBeNull();
    expect(paceAt(stats, 50)).toBeNull();
  });

  it('gives the time and pace at a distance', () => {
    // 4 m/s for 1 km: 250 s/km.
    const stats = computeStats(Array.from({ length: 101 }, (_, i) => at(i * 10, null, i * 2.5)));
    expect(timeAtDistance(stats, 400)).toBeCloseTo(100, 6);
    expect(timeAtDistance(stats, 405)).toBeCloseTo(101.25, 6);
    expect(timeAtDistance(stats, 5000)).toBeCloseTo(250, 6); // clamped to the end
    expect(paceAt(stats, 500)).toBeCloseTo(250, 6);
    expect(paceAt(stats, 0)).toBeCloseTo(250, 6); // window shifted onto the route
  });
});

describe('climbs', () => {
  it('merges two rises separated by a small dip, and skips a 40 m rise', () => {
    const ele = knots(
      [0, 500],
      [1000, 500], // flat approach
      [2000, 560], // +60 m at 6%
      [2100, 555], // a 5 m dip
      [3100, 615], // +60 m at 6%
      [4000, 615],
      [6000, 490], // down
      [6500, 530], // +40 m at 8%: not a climb
      [7500, 530],
    );
    const climbs = computeStats(profileTrack(7500, 10, ele)).climbs;
    expect(climbs).toHaveLength(1);
    const [climb] = climbs;
    expect(climb?.start).toBeCloseTo(1000, -1);
    expect(climb?.end).toBeCloseTo(3100, -1);
    expect(climb?.gain).toBeCloseTo(115, 6);
    expect(climb?.avgGrade).toBeCloseTo(115 / 2100, 2);
    expect(climb?.steepest).toBe(true);
  });

  it('keeps rises apart when the dip between them is too deep', () => {
    // A 20 m dip: over 10 m and over 10% of the first rise's 80 m. Extremes are plateaus so the
    // median filter leaves them alone.
    const ele = knots([0, 0], [1000, 80], [1100, 80], [1300, 60], [1400, 60], [2400, 140]);
    const climbs = computeStats(profileTrack(2600, 10, ele)).climbs;
    expect(climbs.map((c) => Math.round(c.gain))).toEqual([80, 80]);
    expect(climbs.filter((c) => c.steepest)).toHaveLength(1);
  });

  it('needs an average grade of 4%', () => {
    const gentle = computeStats(profileTrack(3000, 10, knots([0, 0], [2000, 60], [3000, 60])));
    expect(gentle.climbs).toEqual([]); // 3%
    const steep = computeStats(profileTrack(3000, 10, knots([0, 0], [1200, 60], [3000, 60])));
    expect(steep.climbs).toHaveLength(1); // 5%
  });

  it('prefers a climb of 100 m or more as the steepest', () => {
    // +60 m at 15%, a 30 m dip, then +120 m at 8%.
    const ele = knots([0, 0], [400, 60], [500, 60], [700, 30], [800, 30], [2300, 150], [2500, 150]);
    const climbs = computeStats(profileTrack(2500, 10, ele)).climbs;
    expect(climbs.map((c) => Math.round(c.gain))).toEqual([60, 120]);
    expect(climbs[0]?.avgGrade).toBeGreaterThan(climbs[1]?.avgGrade ?? 1); // 15% vs 8%
    expect(climbs.map((c) => c.steepest ?? false)).toEqual([false, true]);
  });

  it(`keeps the ${String(MAX_CLIMBS)} biggest climbs, in route order`, () => {
    // Twelve 1 km climbs of 55, 60, … 110 m, each followed by a descent back to 0 (with flat
    // tops and bottoms, which the median filter leaves alone).
    const pairs: [number, number][] = [[0, 0]];
    const gains = Array.from({ length: 12 }, (_, i) => 55 + 5 * i);
    // Shuffle the order along the route so "biggest" is not just "last".
    const order = [3, 10, 0, 7, 5, 11, 1, 8, 2, 6, 9, 4];
    order.forEach((g, i) => {
      const s = i * 3000;
      const gain = gains[g] ?? 0;
      pairs.push([s + 500, 0], [s + 1500, gain], [s + 2000, gain], [s + 3000, 0]);
    });
    const climbs = computeStats(profileTrack(36_000, 10, knots(...pairs))).climbs;
    expect(climbs).toHaveLength(MAX_CLIMBS);
    expect(climbs.map((c) => Math.round(c.gain)).sort((a, b) => a - b)).toEqual([
      75, 80, 85, 90, 95, 100, 105, 110,
    ]);
    const starts = climbs.map((c) => c.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(climbs.filter((c) => c.steepest)).toHaveLength(1);
  });

  it('finds nothing on a flat or falling profile', () => {
    expect(
      findClimbs(
        new Float64Array(10),
        Float64Array.from({ length: 10 }, (_, i) => i),
      ),
    ).toEqual([]);
    expect(computeStats(profileTrack(2000, 10, (d) => 800 - d / 10)).climbs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Real tracks
// ---------------------------------------------------------------------------------------------

function readGpx(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('the bundled sample (Coosa Backcountry Trail)', () => {
  const stats = computeStats(
    parseGpx(readGpx('../../public/samples/coosa-backcountry.gpx')).points,
  );

  it('matches the generator’s figures', () => {
    expect(stats.distance).toBeGreaterThan(21_480 * 0.995);
    expect(stats.distance).toBeLessThan(21_480 * 1.005);
    expect(stats.ascent).toBeGreaterThan(1090 * 0.97);
    expect(stats.ascent).toBeLessThan(1090 * 1.03);
    expect(Math.abs((stats.descent ?? 0) - (stats.ascent ?? 0))).toBeLessThan(10); // a loop
    expect(Math.abs((stats.movingTime ?? 0) - 11_098)).toBeLessThan(120); // 3:04:58 ± 2 min
    expect(stats.highPoint).toBeCloseTo(1267, -1);
    expect(stats.lowPoint).toBeCloseTo(616, -1);
    expect(stats.startTime).toBe(Date.parse('2026-10-03T11:10:00Z'));
  });

  it('has 3–6 climbs with one sensible steepest', () => {
    const { climbs } = stats;
    expect(climbs.length).toBeGreaterThanOrEqual(3);
    expect(climbs.length).toBeLessThanOrEqual(6);
    const steepest = climbs.filter((c) => c.steepest);
    expect(steepest).toHaveLength(1);
    expect(steepest[0]?.gain).toBeGreaterThanOrEqual(100);
    for (const c of climbs) {
      expect(c.gain).toBeGreaterThanOrEqual(50);
      expect(c.avgGrade).toBeGreaterThanOrEqual(0.04);
      expect(c.avgGrade).toBeLessThan(0.4);
      expect(c.end).toBeGreaterThan(c.start);
      expect(c.end).toBeLessThanOrEqual(stats.distance);
    }
    // The big climb to the high point (≈ km 5.4 → 11.3, ≈ +650 m) is one climb, not several.
    expect(climbs.some((c) => c.gain > 600 && c.start < 6000 && c.end > 11_000)).toBe(true);
  });

  it('computes in well under the 5 s first-frame budget', () => {
    const text = readGpx('../../public/samples/coosa-backcountry.gpx');
    const started = performance.now();
    computeStats(parseGpx(text).points);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

/**
 * The UTMB course files (git-ignored; `pnpm fixtures` downloads them) against the totals of the
 * elevation profile on each race page ("Page profile" in fixtures/courses/SOURCES.md).
 */
const COURSES = [
  { file: 'lavaredo-20k.gpx', distance: 19_890, ascent: 1063 },
  { file: 'eiger-e51.gpx', distance: 52_810, ascent: 2861 },
  { file: 'montblanc-ccc.gpx', distance: 101_410, ascent: 6015 },
] as const;

describe('UTMB course fixtures (skipped when absent)', () => {
  for (const course of COURSES) {
    const url = new URL(`../../fixtures/courses/${course.file}`, import.meta.url);
    it.skipIf(!existsSync(url))(`${course.file}: distance and D+ within 3% of the profile`, () => {
      const stats = computeStats(parseGpx(readFileSync(url, 'utf8')).points);
      expect(Math.abs(stats.distance / course.distance - 1)).toBeLessThan(0.03);
      expect(Math.abs((stats.ascent ?? 0) / course.ascent - 1)).toBeLessThan(0.03);
      expect(stats.climbs.length).toBeGreaterThan(0);
      expect(stats.climbs.length).toBeLessThanOrEqual(MAX_CLIMBS);
      expect(stats.climbs.filter((c) => c.steepest)).toHaveLength(1);
    });
  }
});
