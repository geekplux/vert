import { describe, expect, it } from 'vitest';
import {
  formatDateLine,
  formatDistance,
  formatDuration,
  formatElevation,
  formatGrade,
  formatKmRange,
} from '../lib/format';
import { SAMPLE_PROFILE_POINTS, SAMPLE_RUN } from './sample';

const { profile, climbs } = SAMPLE_RUN;
const elevations = profile.map((point) => point.ele);

/** Elevation at distance d, linearly interpolated between profile points. */
function eleAt(d: number): number {
  const i = profile.findIndex((point) => point.d >= d);
  const b = profile[i];
  const a = profile[i - 1];
  if (!b) throw new RangeError(`no profile point at ${String(d)}`);
  if (!a || b.d === d) return b.ele;
  return a.ele + ((b.ele - a.ele) * (d - a.d)) / (b.d - a.d);
}

describe('SAMPLE_RUN', () => {
  it('carries the real sample totals', () => {
    expect(SAMPLE_RUN).toMatchObject({
      name: 'Coosa Backcountry Loop',
      isSample: true,
      distance: 21_480,
      vert: 1_092,
      movingTime: 11_093,
      highPoint: 1_267,
      lowPoint: 616,
      lonForOffset: -83.926,
    });
    expect(new Date(SAMPLE_RUN.startTime).toISOString()).toBe('2026-10-03T11:10:00.000Z');
  });

  it('formats as the spec copy', () => {
    expect(formatDistance(SAMPLE_RUN.distance, 'metric').text).toBe('21.5 km');
    expect(formatElevation(SAMPLE_RUN.vert, 'metric', { signed: true }).text).toBe('+1,092 m');
    expect(formatDuration(SAMPLE_RUN.movingTime)).toBe('3:04:53');
    expect(formatElevation(SAMPLE_RUN.highPoint, 'metric').text).toBe('1,267 m');
    expect(formatDateLine(new Date(SAMPLE_RUN.startTime), SAMPLE_RUN.lonForOffset)).toBe(
      'SAT · 2026-10-03',
    );
    expect(climbs.map((c) => formatKmRange(c.start, c.end, 'metric'))).toEqual([
      'km 5.6 → 8.4',
      'km 10.7 → 13.7',
      'km 16.8 → 19.0',
    ]);
  });

  it('has about 500 profile points from 0 to the full distance, d strictly increasing', () => {
    expect(profile).toHaveLength(SAMPLE_PROFILE_POINTS);
    expect(profile[0]?.d).toBe(0);
    expect(profile.at(-1)?.d).toBe(SAMPLE_RUN.distance);
    for (let i = 1; i < profile.length; i++) {
      expect((profile[i]?.d ?? 0) > (profile[i - 1]?.d ?? 0)).toBe(true);
    }
  });

  it('spans exactly the low and high points', () => {
    expect(Math.min(...elevations)).toBe(SAMPLE_RUN.lowPoint);
    expect(Math.max(...elevations)).toBe(SAMPLE_RUN.highPoint);
  });

  it('climbs as much as the run says, and is a loop', () => {
    let ascent = 0;
    let descent = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = (elevations[i] ?? 0) - (elevations[i - 1] ?? 0);
      if (diff > 0) ascent += diff;
      else descent -= diff;
    }
    expect(Math.abs(ascent - SAMPLE_RUN.vert)).toBeLessThan(0.5);
    expect(Math.abs(descent - SAMPLE_RUN.vert)).toBeLessThan(0.5);
    expect(profile.at(-1)?.ele).toBe(profile[0]?.ele);
  });

  it('has smooth steps (no jump over 15 m between neighbouring points)', () => {
    for (let i = 1; i < elevations.length; i++) {
      expect(Math.abs((elevations[i] ?? 0) - (elevations[i - 1] ?? 0))).toBeLessThan(15);
    }
  });

  it('has three climbs in order, inside the route, matching the profile', () => {
    expect(climbs).toHaveLength(3);
    let previousEnd = 0;
    let gains = 0;
    for (const c of climbs) {
      expect(c.start).toBeGreaterThanOrEqual(previousEnd);
      expect(c.end).toBeGreaterThan(c.start);
      expect(c.end).toBeLessThanOrEqual(SAMPLE_RUN.distance);
      expect(c.gain).toBeGreaterThan(0);
      expect(c.avgGrade).toBeCloseTo(c.gain / (c.end - c.start), 12);
      expect(eleAt(c.end) - eleAt(c.start)).toBeCloseTo(c.gain, 0);
      previousEnd = c.end;
      gains += c.gain;
    }
    expect(gains).toBeLessThanOrEqual(SAMPLE_RUN.vert);
  });

  it('marks exactly one climb steepest: the one with the highest average grade', () => {
    const steepest = climbs.filter((c) => c.steepest);
    expect(steepest).toHaveLength(1);
    const maxGrade = Math.max(...climbs.map((c) => c.avgGrade));
    expect(steepest[0]?.avgGrade).toBe(maxGrade);
    expect(formatGrade(maxGrade)).toBe('19%');
  });

  it('has bounds around the trail near its start longitude', () => {
    const { west, south, east, north } = SAMPLE_RUN.bounds;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(SAMPLE_RUN.lonForOffset).toBeGreaterThanOrEqual(west);
    expect(SAMPLE_RUN.lonForOffset).toBeLessThanOrEqual(east);
  });
});
