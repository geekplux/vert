// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M, haversine } from '../lib/geo';
import type { RunTrack } from '../page/types';
import { computeStats } from './stats';
import { trimEnds, trimTrack } from './trim';
import type { TrackPoint } from './types';

const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);

/** Points every 100 m due north, elevation = d / 10, time = d seconds after 0. */
function line(length: number, step = 100): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let d = 0; d <= length; d += step) {
    points.push({ lat: 10 + d * DEG_PER_M, lon: 20, ele: d / 10, time: d * 1000 });
  }
  return points;
}

const distanceFromStart = (points: readonly TrackPoint[], p: TrackPoint | undefined) =>
  points[0] && p ? haversine(points[0], p) : NaN;

describe('trimEnds', () => {
  const points = line(1000);
  const { cumulative } = computeStats(points);

  it('removes the first and last N metres, interpolating the cut points', () => {
    const trimmed = trimEnds(points, cumulative, 150);
    expect(distanceFromStart(points, trimmed[0])).toBeCloseTo(150, 6);
    expect(distanceFromStart(points, trimmed.at(-1))).toBeCloseTo(850, 6);
    // 150 (cut), 200 … 800 (kept), 850 (cut)
    expect(trimmed).toHaveLength(9);
    expect(trimmed[0]?.ele).toBeCloseTo(15, 9);
    expect(trimmed[0]?.time).toBeCloseTo(150_000, 6);
    expect(trimmed.slice(1, -1)).toEqual(points.slice(2, 9));
  });

  it('does not repeat a point when a cut falls exactly on it', () => {
    const trimmed = trimEnds(points, cumulative, 200);
    const ds = trimmed.map((p) => Math.round(distanceFromStart(points, p)));
    expect(ds).toEqual([200, 300, 400, 500, 600, 700, 800]);
  });

  it('keeps both cuts when they fall in the same step', () => {
    const short = line(100);
    const trimmed = trimEnds(short, computeStats(short).cumulative, 30);
    expect(trimmed.map((p) => Math.round(distanceFromStart(short, p)))).toEqual([30, 70]);
  });

  it('leaves nothing when the route is no longer than twice N', () => {
    expect(trimEnds(points, cumulative, 500)).toEqual([]);
    expect(trimEnds(points, cumulative, 800)).toEqual([]);
  });

  it('returns a copy for N ≤ 0', () => {
    const copy = trimEnds(points, cumulative, 0);
    expect(copy).toEqual(points);
    expect(copy).not.toBe(points);
    expect(trimEnds(points, cumulative, -5)).toEqual(points);
  });

  it('keeps a missing elevation or time missing at a cut', () => {
    const bare = points.map((p) => ({ ...p, ele: null, time: null }));
    const [first] = trimEnds(bare, cumulative, 50);
    expect(first).toMatchObject({ ele: null, time: null });
  });

  it('skips zero-length steps at a cut', () => {
    const doubled = [points[0], points[1], points[1], points[2], points[3]] as TrackPoint[];
    const trimmed = trimEnds(doubled, Float64Array.from([0, 100, 100, 200, 300]), 100);
    // The repeated point at 100 m appears once.
    expect(trimmed.map((p) => Math.round(distanceFromStart(doubled, p)))).toEqual([100, 200]);
  });
});

describe('trimTrack', () => {
  const points = line(1000);
  const stats = computeStats(points);
  const track: RunTrack = {
    lat: Float64Array.from(points, (p) => p.lat),
    lon: Float64Array.from(points, (p) => p.lon),
    ele: stats.elevation,
    cumulative: stats.cumulative,
    time: stats.time,
  };

  it('cuts the typed arrays the same way and keeps distances from the original start', () => {
    const trimmed = trimTrack(track, 150);
    expect(trimmed).not.toBeNull();
    if (!trimmed) return;
    const reference = trimEnds(points, stats.cumulative, 150);
    expect(trimmed.lat).toHaveLength(reference.length);
    reference.forEach((p, i) => {
      expect(trimmed.lat[i]).toBeCloseTo(p.lat, 12);
      expect(trimmed.lon[i]).toBeCloseTo(p.lon, 12);
      expect(trimmed.ele?.[i]).toBeCloseTo(p.ele ?? NaN, 9);
      expect(trimmed.time?.[i]).toBeCloseTo(p.time ?? NaN, 6);
    });
    expect(trimmed.cumulative[0]).toBeCloseTo(150, 6);
    expect(trimmed.cumulative.at(-1)).toBeCloseTo(850, 6);
  });

  it('returns the track for N ≤ 0 and null when nothing is left', () => {
    expect(trimTrack(track, 0)).toBe(track);
    expect(trimTrack(track, 600)).toBeNull();
    expect(trimTrack({ ...track, ele: null, time: null }, 100)).toMatchObject({
      ele: null,
      time: null,
    });
  });
});
