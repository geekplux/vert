// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { valueAtDistance } from '../gpx/stats';
import { trimTrack } from '../gpx/trim';
import { boundsOf } from '../lib/geo';
import { sampleBilinear } from '../lib/terrarium';
import type { RunTrack } from '../page/types';
import { isLoop } from '../lib/loop';
import {
  buildHeightfield,
  elevationAt,
  gridPosition,
  type Heightfield,
} from '../terrain/heightfield';
import { gridTrackFromRun } from '../terrain/gridTrack';
import { MAX_ROUTE_POINTS, ROUTE_STEP_M, routeMarkerIndices } from '../terrain/routeRules';
import { SCENE_HEIGHTFIELD_OPTIONS, buildScene, gridElevationStep } from './build';
import { decodeScene } from './decode';
import { encodeScene } from './encode';
import { SCENE_LONG_SIDE, SCENE_STEPS } from './format';
import {
  MEASURED_TERRAIN,
  padded,
  runFromGpx,
  syntheticHeightfield,
  syntheticTiles,
} from './testing';

const { run, track } = runFromGpx(sampleGpx);
const TRIM = 200;

function drawn(metres = TRIM): RunTrack {
  const trimmed = trimTrack(track, metres);
  if (!trimmed) throw new Error('Nothing left after the trim');
  return trimmed;
}

/** A synthetic grid framed on `t` (as the bake frames it), around the sample's real place. */
function terrainFor(t: RunTrack, options: { longSide?: number } = {}): Heightfield {
  const bounds = boundsOf(Array.from(t.lat, (lat, k) => ({ lat, lon: t.lon[k] ?? 0 })));
  return syntheticHeightfield(padded(bounds), { ...MEASURED_TERRAIN.coosa, ...options });
}

describe('buildScene', () => {
  const route = drawn();
  const heightfield = terrainFor(route);
  const scene = buildScene(heightfield, route, run);

  it('keeps the grid at the fixed long side, its spacing rounded, its zoom', () => {
    const { grid } = scene;
    expect(Math.max(grid.width, grid.height)).toBe(SCENE_LONG_SIDE);
    expect([grid.width, grid.height]).toEqual([heightfield.width, heightfield.height]);
    expect(grid.zoom).toBe(heightfield.zoom);
    expect(grid.metresPerSample.x).toBeCloseTo(heightfield.metresPerSample.x, 2);
    expect(Math.round(grid.metresPerSample.x * 100)).toBe(grid.metresPerSample.x * 100);
    expect(grid.elevationStep).toBe(
      gridElevationStep(
        Math.max(grid.metresPerSample.x, grid.metresPerSample.y),
        heightfield.max - heightfield.min,
      ),
    );
    for (let i = 0; i < grid.elevations.length; i += 97) {
      expect(
        Math.abs((grid.elevations[i] ?? 0) - (heightfield.elevations[i] ?? 0)),
      ).toBeLessThanOrEqual(grid.elevationStep / 2 + 1e-3);
    }
  });

  it('refuses a grid not sampled smooth at the fixed long side (it never resamples)', () => {
    const native = terrainFor(route, { longSide: 512 });
    expect(() => buildScene(native, route, run)).toThrow(/must be \d+×\d+/);
    const bilinear: Heightfield = { ...heightfield, sampling: undefined };
    expect(() => buildScene(bilinear, route, run)).toThrow(/sampling: 'smooth'/);
    // A long side over the format's cap cannot be built either.
    expect(() =>
      buildScene(terrainFor(route, { longSide: 2000 }), route, run, { longSide: 2000 }),
    ).toThrow(RangeError);
  });

  it('builds from the real sampler path: buildHeightfield with SCENE_HEIGHTFIELD_OPTIONS', async () => {
    const bounds = boundsOf(Array.from(route.lat, (lat, k) => ({ lat, lon: route.lon[k] ?? 0 })));
    const hf = await buildHeightfield(bounds, {
      ...SCENE_HEIGHTFIELD_OPTIONS,
      fetchTile: syntheticTiles(),
    });
    expect(hf.sampling).toBe('smooth');
    const s = buildScene(hf, route, run);
    expect(Math.max(s.grid.width, s.grid.height)).toBe(SCENE_LONG_SIDE);
    expect(decodeScene(encodeScene(s))).toEqual(s);
  });

  it('keeps elevations near the format limits (the step never overflows 9,000 m)', () => {
    for (const [lo, hi] of [
      [8990, 9000],
      [-12_000, -11_000],
      [0, 8848],
    ] as const) {
      const elevations = Float32Array.from(
        heightfield.elevations,
        (v) => lo + ((v - heightfield.min) / (heightfield.max - heightfield.min)) * (hi - lo),
      );
      const s = buildScene({ ...heightfield, elevations, min: lo, max: hi }, route, run);
      expect(s.grid.max).toBeLessThanOrEqual(hi + s.grid.elevationStep / 2);
      expect(s.grid.min).toBeGreaterThanOrEqual(lo - s.grid.elevationStep / 2);
      expect(encodeScene(decodeScene(encodeScene(s)))).toEqual(encodeScene(s));
    }
  });

  it('puts route points where gridPosition puts them, on the grid it ships', () => {
    const { grid, route: r } = scene;
    const length = (route.cumulative.at(-1) ?? 0) - (route.cumulative[0] ?? 0);
    expect(r.x.length).toBe(Math.min(MAX_ROUTE_POINTS, Math.ceil(length / ROUTE_STEP_M) + 1));
    for (let k = 0; k < r.x.length; k++) {
      const d = r.distance[k] ?? 0;
      const lon = valueAtDistance(route.lon, route.cumulative, d);
      const lat = valueAtDistance(route.lat, route.cumulative, d);
      const p = gridPosition(heightfield, lon, lat);
      // Metres = grid column × spacing, to the position step (plus the spacing's own rounding).
      const slack = SCENE_STEPS.position / 2 + 0.01;
      expect(Math.abs((r.x[k] ?? 0) - p.x * grid.metresPerSample.x)).toBeLessThanOrEqual(slack);
      expect(Math.abs((r.y[k] ?? 0) - p.y * grid.metresPerSample.y)).toBeLessThanOrEqual(slack);
      // And the shipped grid, read at that position, is the terrain under the point.
      if (k % 50 === 0) {
        const fromScene = sampleBilinear(
          grid.elevations,
          grid.width,
          grid.height,
          (r.x[k] ?? 0) / grid.metresPerSample.x,
          (r.y[k] ?? 0) / grid.metresPerSample.y,
        );
        expect(Math.abs(fromScene - elevationAt(heightfield, lon, lat))).toBeLessThan(5);
      }
    }
  });

  it('keeps distances and times from the run’s real start, and the track’s elevations', () => {
    const r = scene.route;
    expect(r.distance[0]).toBeCloseTo(route.cumulative[0] ?? NaN, 2);
    expect(r.distance[0]).toBeCloseTo(TRIM, 2);
    expect(r.distance.at(-1)).toBeCloseTo(route.cumulative.at(-1) ?? NaN, 2);
    const ele = route.ele;
    const time = route.time;
    if (!ele || !time || !r.time) throw new Error('The sample has elevations and times');
    for (let k = 0; k < r.x.length; k += 37) {
      const d = r.distance[k] ?? 0;
      expect(
        Math.abs((r.elevation[k] ?? 0) - valueAtDistance(ele, route.cumulative, d)),
      ).toBeLessThanOrEqual(0.051);
      const seconds = (valueAtDistance(time, route.cumulative, d) - run.startTime) / 1000;
      expect(Math.abs((r.time[k] ?? 0) - seconds)).toBeLessThanOrEqual(0.051);
    }
    // The trimmed start is reached some time after the run's first point.
    expect(r.time[0]).toBeGreaterThan(30);
  });

  it('places markers by the app’s rules on the drawn stretch', () => {
    for (const metres of [0, TRIM]) {
      const t = drawn(metres);
      const hf = terrainFor(t);
      const s = buildScene(hf, t, run);
      const indices = routeMarkerIndices(gridTrackFromRun(hf, t), hf);
      expect(s.markers.finish === null).toBe(isLoop(t));
      const { start, finish, summit } = s.markers;
      expect(start.distance).toBeCloseTo(t.cumulative[0] ?? NaN, 2);
      expect(start.x).toBe(s.route.x[0]);
      expect(start.y).toBe(s.route.y[0]);
      expect(finish === null).toBe(indices.finish === null);
      expect(summit === null).toBe(indices.summit === null);
      if (summit && indices.summit !== null) {
        expect(summit.distance).toBeCloseTo(t.cumulative[indices.summit] ?? NaN, 2);
        expect(summit.elevation).toBeCloseTo(t.ele?.[indices.summit] ?? NaN, 1);
        const p = gridPosition(hf, t.lon[indices.summit] ?? 0, t.lat[indices.summit] ?? 0);
        expect(Math.abs(summit.x - p.x * s.grid.metresPerSample.x)).toBeLessThanOrEqual(0.26);
      }
    }
    // A route that does not come back (the first half of the loop) gets a finish ◉.
    const n = track.lat.length;
    const half = (a: Float64Array) => a.slice(0, Math.floor(n / 2));
    const oneWay: RunTrack = {
      lat: half(track.lat),
      lon: half(track.lon),
      ele: track.ele ? half(track.ele) : null,
      cumulative: half(track.cumulative),
      time: track.time ? half(track.time) : null,
    };
    const s = buildScene(terrainFor(oneWay), oneWay, run);
    expect(s.markers.finish?.distance).toBeCloseTo(oneWay.cumulative.at(-1) ?? NaN, 2);
    expect(s.markers.finish?.x).toBe(s.route.x.at(-1));
  });

  it('clips climbs to the drawn stretch and marks the steepest again', () => {
    const first = run.climbs[0];
    if (!first) throw new Error('The sample has climbs');
    // A trim that ends inside the first climb.
    const metres = first.start + (first.end - first.start) / 3;
    const t = drawn(metres);
    const s = buildScene(terrainFor(t), t, run);
    const from = t.cumulative[0] ?? 0;
    const to = t.cumulative.at(-1) ?? 0;
    for (const c of s.climbs) {
      expect(c.start).toBeGreaterThanOrEqual(from - 0.005);
      expect(c.end).toBeLessThanOrEqual(to + 0.005);
      expect(c.end).toBeGreaterThan(c.start);
    }
    const clipped = s.climbs[0];
    if (!clipped) throw new Error('The first climb should survive a one-third cut');
    expect(clipped.start).toBeCloseTo(from, 2);
    expect(clipped.end).toBeCloseTo(first.end, 2);
    const ele = t.ele;
    if (!ele) throw new Error('elevations');
    const gain =
      valueAtDistance(ele, t.cumulative, first.end) - valueAtDistance(ele, t.cumulative, from);
    expect(clipped.gain).toBeCloseTo(gain, 1);
    expect(clipped.avgGrade).toBeCloseTo(gain / (first.end - from), 3);
    // Untouched climbs keep the run's figures.
    for (const c of s.climbs.slice(1)) {
      const original = run.climbs.find((o) => Math.abs(o.start - c.start) < 0.01);
      expect(original).toBeDefined();
      expect(c.gain).toBeCloseTo(original?.gain ?? NaN, 1);
    }
    // Climbs wholly inside the trimmed ends are gone.
    expect(s.climbs.length).toBeLessThanOrEqual(run.climbs.length);
    expect(s.climbs.filter((c) => c.steepest).length).toBe(s.climbs.length > 0 ? 1 : 0);
    // With the default trim the sample's first climb, which starts at the run's start, begins at
    // the cut; the others are drawn whole.
    const cm = (m: number) => Math.round(m * 100) / 100;
    expect(scene.climbs.map((c) => [c.start, c.end])).toEqual(
      run.climbs.map((c) => [cm(Math.max(c.start, TRIM)), cm(c.end)]),
    );
  });

  it('summarises the whole run and the trim', () => {
    const { summary, grid } = scene;
    expect(summary.distance).toBeCloseTo(run.distance, 2);
    expect(summary.climb).toBeCloseTo(run.vert, 1);
    expect(summary.trim.start).toBeCloseTo(TRIM, 2);
    expect(summary.trim.end).toBeCloseTo(TRIM, 1);
    expect(summary.drawnLength).toBeCloseTo(run.distance - 2 * TRIM, 1);
    expect(summary.extent.x).toBeCloseTo(grid.metresPerSample.x * (grid.width - 1), 6);
  });

  it('falls back to the terrain without elevations, and drops time without times', () => {
    const bare: RunTrack = { ...route, ele: null, time: null };
    const s = buildScene(heightfield, bare, { ...run, vert: NaN, climbs: [] });
    expect(s.route.time).toBeNull();
    expect(s.summary.climb).toBeNaN();
    expect(s.climbs).toEqual([]);
    const k = 100;
    const d = s.route.distance[k] ?? 0;
    const lon = valueAtDistance(route.lon, route.cumulative, d);
    const lat = valueAtDistance(route.lat, route.cumulative, d);
    expect(s.route.elevation[k]).toBeCloseTo(elevationAt(heightfield, lon, lat), 1);
  });

  it('is deterministic and survives the round trip exactly', () => {
    const again = buildScene(terrainFor(route), route, run);
    const bytes = encodeScene(scene);
    expect(encodeScene(again)).toEqual(bytes);
    expect(decodeScene(bytes)).toEqual(scene);
  });

  it('refuses an empty track and a route off the grid', () => {
    const empty: RunTrack = {
      lat: new Float64Array(0),
      lon: new Float64Array(0),
      ele: null,
      cumulative: new Float64Array(0),
      time: null,
    };
    expect(() => buildScene(heightfield, empty, run)).toThrow(RangeError);
    const elsewhere: Heightfield = {
      ...heightfield,
      // The same grid one degree further east: same shape, the route now off it.
      bounds: {
        ...heightfield.bounds,
        west: heightfield.bounds.west + 1,
        east: heightfield.bounds.east + 1,
      },
    };
    expect(() => buildScene(elsewhere, route, run)).toThrow(/off the grid/);
  });
});
