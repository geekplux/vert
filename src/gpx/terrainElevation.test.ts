import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { SAMPLE_RUN } from '../page/sample';
import type { Run } from '../page/types';
import { buildRun } from './handler';
import { parseGpx } from './parse';
import type { TrackPoint } from './types';
import { withTerrainElevation } from './terrainElevation';

/**
 * A straight 6 km run north from (46.0, 7.0) without `<ele>`, one point every ~11 m, parsed the
 * way the worker parses a file.
 */
function noElevationRun(): Run {
  const points: TrackPoint[] = Array.from({ length: 541 }, (_, i) => ({
    lat: 46 + i * 1e-4,
    lon: 7,
    ele: null,
    time: null,
  }));
  const { run, points: track } = buildRun(
    { name: 'No ele', type: null, creator: null, time: null, points, segments: 1, source: 'trk' },
    'no-ele.gpx',
    false,
  );
  return { ...run, id: 'no-ele', track };
}

/**
 * A fake heightfield: a 400 m hill whose top is 3 km along the run (lat 46.027), on a 1,000 m
 * plain, sampled bilinearly in the app; here a smooth function of the position.
 */
const hill = (_lon: number, lat: number) =>
  1_000 + 400 * Math.max(0, 1 - Math.abs(lat - 46.027) / 0.027);

describe('withTerrainElevation', () => {
  it('starts from a run whose elevation is unknown', () => {
    const run = noElevationRun();
    expect(run).toMatchObject({ hasElevation: false, elevationSource: null, profile: [] });
    expect(run.vert).toBeNaN();
    expect(run.highPoint).toBeNaN();
    expect(run.track.ele).toBeNull();
  });

  it('fills the profile, vert, high and low point and climbs from the terrain, marked as such', () => {
    const run = withTerrainElevation(noElevationRun(), hill);
    expect(run.hasElevation).toBe(true);
    expect(run.elevationSource).toBe('terrain');
    expect(run.highPoint).toBeCloseTo(1_400, -1);
    expect(run.lowPoint).toBeCloseTo(1_000, 0);
    expect(run.vert).toBeGreaterThan(390);
    expect(run.vert).toBeLessThanOrEqual(400);
    expect(run.descent).toBeGreaterThan(390);
    expect(run.profile).toHaveLength(500);
    expect(run.profile[0]?.d).toBe(0);
    expect(run.profile.at(-1)?.d).toBeCloseTo(run.distance, 6);
    expect(run.climbs).toHaveLength(1);
    expect(run.climbs[0]?.steepest).toBe(true);
    expect(run.climbs[0]?.gain).toBeGreaterThan(390);
    expect(run.track.ele).toHaveLength(run.track.lat.length);
    expect(run.track.ele?.[300]).toBeCloseTo(hill(7, 46.03), 0);
  });

  it('keeps everything else of the run', () => {
    const before = noElevationRun();
    const after = withTerrainElevation(before, hill);
    expect(after.id).toBe(before.id);
    expect(after.distance).toBe(before.distance);
    expect(after.track.lat).toBe(before.track.lat);
    expect(after.track.cumulative).toBe(before.track.cumulative);
    expect(after.bounds).toBe(before.bounds);
  });

  it('leaves a run with its own elevations alone', () => {
    expect(withTerrainElevation(SAMPLE_RUN, hill)).toBe(SAMPLE_RUN);
  });

  it('leaves the run unknown when the terrain gives no value, and holds a few gaps', () => {
    const run = noElevationRun();
    expect(withTerrainElevation(run, () => NaN)).toBe(run);
    const gappy = withTerrainElevation(run, (lon, lat) => (lat < 46.001 ? NaN : hill(lon, lat)));
    expect(gappy.track.ele?.[0]).toBeCloseTo(hill(7, 46.001), 0);
    expect(Number.isFinite(gappy.vert)).toBe(true);
  });
});

describe('withTerrainElevation on patchy <ele> (the sample, edited)', () => {
  const parsed = parseGpx(sampleGpx);
  const original = parsed.points;
  /** The sample's own elevations by position: a "terrain" that agrees with the file exactly. */
  const byPosition = new Map(original.map((p) => [`${String(p.lon)},${String(p.lat)}`, p.ele]));
  const sampleTerrain = (lon: number, lat: number) =>
    byPosition.get(`${String(lon)},${String(lat)}`) ?? NaN;
  const variant = (ele: (e: number | null, i: number) => number | null): Run => {
    const points = original.map((p, i) => ({ ...p, ele: ele(p.ele, i) }));
    const { run, points: track } = buildRun({ ...parsed, points }, 'variant.gpx', false);
    return { ...run, id: 'variant', track };
  };
  const n = original.length;

  it('keeps every-tenth-point files GPX-based (short gaps interpolate): +1,092 m', () => {
    const run = variant((e, i) => (i % 10 === 0 ? e : null));
    expect(run.elevationSource).toBe('gpx');
    expect(Math.round(run.vert)).toBe(1_092);
    expect(withTerrainElevation(run, sampleTerrain)).toBe(run);
  });

  it('fills a missing second half from the terrain: mixed, about the full +1,102 m', () => {
    const run = variant((e, i) => (i < n / 2 ? e : null));
    expect(run.hasElevation).toBe(false);
    expect(run.vert).toBeNaN();
    const filled = withTerrainElevation(run, sampleTerrain);
    expect(filled.elevationSource).toBe('mixed');
    expect(Math.abs(filled.vert - 1_102)).toBeLessThan(5);
    expect(filled.track.partialEle).toBeNull();
  });

  it('ignores a lone <ele> and all-zero <ele>: everything from the terrain', () => {
    for (const run of [variant((e, i) => (i === 0 ? e : null)), variant(() => 0)]) {
      expect(run.hasElevation).toBe(false);
      const filled = withTerrainElevation(run, sampleTerrain);
      expect(filled.elevationSource).toBe('terrain');
      expect(Math.abs(filled.vert - 1_102)).toBeLessThan(5);
      expect(Math.round(filled.highPoint)).toBe(1_267);
    }
  });

  it('meets the recorded values at the joins: a terrain 30 m off adds no step', () => {
    const run = variant((e, i) => (i < n / 2 ? e : null));
    const filled = withTerrainElevation(run, (lon, lat) => sampleTerrain(lon, lat) - 30);
    expect(filled.elevationSource).toBe('mixed');
    expect(Math.abs(filled.vert - 1_102)).toBeLessThan(5);
    const ele = filled.track.ele;
    const join = Math.ceil(n / 2);
    expect(Math.abs((ele?.[join] ?? 0) - (ele?.[join - 1] ?? 0))).toBeLessThan(3);
  });
});
