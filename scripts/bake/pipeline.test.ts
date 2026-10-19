// @vitest-environment node
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { withTerrainElevation } from '../../src/gpx/terrainElevation';
import { buildHeightfield, elevationAt } from '../../src/terrain/heightfield';
import { decodeScene, scanScene } from '../../src/scene/bake';
import { BakeError } from './errors';
import { gpxInput, parsePointsJson, runFromPoints, type BakeInput } from './input';
import { trimTrack } from '../../src/gpx/trim';
import {
  DEFAULT_TRIM_M,
  bakeScene,
  clearingTrim,
  distanceToTrack,
  elevationOffset,
  howNear,
  nearestOnTrack,
  trackBounds,
} from './pipeline';
import { decodeTerrariumPngBytes } from './png';
import {
  antimeridianRoute,
  gpxOf,
  lapsRoute,
  pointsJsonOf,
  syntheticFetch,
  syntheticRoute,
  syntheticTilePng,
} from './testing';
import { createTileSource, type TileSourceOptions } from './tiles';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vert-bake-pipeline-'));
  dirs.push(dir);
  return dir;
}

/** A tile source over the synthetic tiles, with an empty cache of its own. */
function tiles(options: TileSourceOptions = {}) {
  const fake = syntheticFetch();
  return {
    source: createTileSource({
      template: 'https://tiles.test/{z}/{x}/{y}.png',
      cacheDir: temporaryDir(),
      fetch: fake.fetch,
      ...options,
    }),
    fake,
  };
}

const route = syntheticRoute();
const withEle: BakeInput = gpxInput(new TextEncoder().encode(gpxOf(route)), 'test-run.gpx');
const withoutEle: BakeInput = gpxInput(
  new TextEncoder().encode(gpxOf(route, { ele: false })),
  'no-ele.gpx',
);

describe('bakeScene', () => {
  it('bakes a run with its own elevations: whole-run totals, a trimmed drawn stretch', async () => {
    const baked = await bakeScene(withEle, {
      id: 'test-run',
      trim: DEFAULT_TRIM_M,
      tiles: tiles().source,
    });
    const { summary } = baked.sidecar;
    expect(baked.elevationSource).toBe('gpx');
    expect(summary.distance).toBe(Math.round(withEle.run.distance));
    expect(summary.climb).toBe(Math.round(withEle.run.vert));
    expect(summary.trim).toEqual({ start: 200, end: 200 });
    expect(Math.abs(summary.drawnLength - (withEle.run.distance - 400))).toBeLessThanOrEqual(1);
    expect(baked.scene.grid.width === 320 || baked.scene.grid.height === 320).toBe(true);
    expect(baked.scene.route.time).not.toBeNull();
    expect(baked.privacy).toEqual({ findings: 0, pitchHidden: true });
    expect(decodeScene(baked.bytes)).toEqual(baked.scene);
    // One request per distinct tile, across both grids.
    expect(baked.tiles.requests).toBe(baked.tiles.fetched);
  });

  it('is deterministic: two bakes give the same bytes', async () => {
    const a = await bakeScene(withEle, { id: 'test-run', trim: 200, tiles: tiles().source });
    const b = await bakeScene(withEle, { id: 'test-run', trim: 200, tiles: tiles().source });
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
    expect(b.sidecarText).toBe(a.sidecarText);
  });

  it('--trim 0 keeps the ends', async () => {
    const baked = await bakeScene(withEle, { id: 'test-run', trim: 0, tiles: tiles().source });
    const { summary } = baked.sidecar;
    expect(summary.trim).toEqual({ start: 0, end: 0 });
    expect(Math.abs(summary.drawnLength - summary.distance)).toBeLessThanOrEqual(1);
  });

  it('reports the file’s elevations minus the terrain’s on the drawn route; none for terrain ones', async () => {
    const baked = await bakeScene(withEle, { id: 'test-run', trim: 200, tiles: tiles().source });
    // The synthetic file is the synthetic terrain plus a ±4 m wave (testing.ts, syntheticRoute).
    const offset = baked.elevationOffset;
    expect(offset).not.toBeNull();
    expect(Math.abs(offset?.mean ?? NaN)).toBeLessThanOrEqual(2);
    expect(offset?.min).toBeGreaterThanOrEqual(-8);
    expect(offset?.min).toBeLessThan(0);
    expect(offset?.max).toBeGreaterThan(0);
    expect(offset?.max).toBeLessThanOrEqual(8);
    const terrain = await bakeScene(withoutEle, { id: 'no-ele', trim: 200, tiles: tiles().source });
    expect(terrain.elevationOffset).toBeNull();
  });

  it('elevationOffset: weighted by distance, whole metres', async () => {
    const grid = await buildHeightfield(withEle.run.bounds, {
      fetchTile: (coord) => Promise.resolve(decodeTerrariumPngBytes(syntheticTilePng(coord))),
    });
    const n = 3;
    const lat = Float64Array.from({ length: n }, (_, i) => withEle.points.lat[i * 100] ?? 0);
    const lon = Float64Array.from({ length: n }, (_, i) => withEle.points.lon[i * 100] ?? 0);
    const terrain = Array.from(lat, (la, i) => elevationAt(grid, lon[i] ?? 0, la));
    // +10 m, +10 m over the first 100 m, then +40 m over the next 300 m: mean (10·100 + 25·300) / 400.
    const ele = Float64Array.from([10, 10, 40], (d, i) => (terrain[i] ?? 0) + d);
    const track = { lat, lon, ele, cumulative: Float64Array.from([0, 100, 400]), time: null };
    expect(elevationOffset(track, grid)).toEqual({ mean: 21, min: 10, max: 40 });
    expect(elevationOffset({ ...track, ele: null }, grid)).toBeNull();
  });

  it('fills a GPX without <ele> from the terrain, exactly as the app does', async () => {
    expect(withoutEle.run.hasElevation).toBe(false);
    const baked = await bakeScene(withoutEle, { id: 'no-ele', trim: 200, tiles: tiles().source });
    expect(baked.elevationSource).toBe('terrain');

    // The app: its own grid of the whole run (bilinear, default size), then withTerrainElevation.
    const grid = await buildHeightfield(withoutEle.run.bounds, {
      fetchTile: (coord) => Promise.resolve(decodeTerrariumPngBytes(syntheticTilePng(coord))),
    });
    const app = withTerrainElevation(
      { ...withoutEle.run, id: 'app', track: withoutEle.points },
      (lon, lat) => elevationAt(grid, lon, lat),
    );
    expect(app.elevationSource).toBe('terrain');
    expect(baked.sidecar.summary.climb).toBe(Math.round(app.vert));
    expect(app.vert).toBeGreaterThan(50);
    // The climbs on the drawn stretch come from those elevations too.
    expect(baked.scene.route.elevation.every(Number.isFinite)).toBe(true);
  });

  it('refuses a route too short for the trim', async () => {
    await expect(
      bakeScene(withEle, { id: 'test-run', trim: 5000, tiles: tiles().source }),
    ).rejects.toThrow(/too short to trim 5000 m/);
  });

  it('refuses an id that carries a coordinate, before asking for any tile', async () => {
    const { source, fake } = tiles();
    await expect(
      bakeScene(withEle, { id: 'from-46512', trim: 200, tiles: source }),
    ).rejects.toThrow(BakeError);
    expect(fake.state.calls).toBe(0);
  });

  it('an explicit bare-digit --id of 10+ digits is an opaque id; a default one is checked', async () => {
    // 46,520,000,000 reads as 46.52° (inside this run's latitudes) from its 2-digit prefix.
    const id = '46520000000';
    await expect(bakeScene(withEle, { id, trim: 200, tiles: tiles().source })).rejects.toThrow(
      /coordinate/,
    );
    const baked = await bakeScene(withEle, {
      id,
      explicitId: true,
      trim: 200,
      tiles: tiles().source,
    });
    expect(baked.id).toBe(id);
  });
});

describe('tile problems never become invented terrain', () => {
  const reference = () => bakeScene(withEle, { id: 'test-run', trim: 200, tiles: tiles().source });

  it('a read-only cache missing half its tiles: the same scene, and a warning', async () => {
    const good = await reference();
    // A full cache, then half of its tiles removed, then made read-only.
    const full = temporaryDir();
    await bakeScene(withEle, {
      id: 'test-run',
      trim: 200,
      tiles: tiles({ cacheDir: full }).source,
    });
    const cacheDir = temporaryDir();
    cpSync(full, cacheDir, { recursive: true });
    const pngs = (readdirSync(cacheDir, { recursive: true }) as string[]).filter((f) =>
      f.endsWith('.png'),
    );
    pngs.slice(0, Math.ceil(pngs.length / 2)).forEach((f) => {
      rmSync(join(cacheDir, f));
    });
    const lock = (mode: number) => {
      for (const f of ['', ...(readdirSync(cacheDir, { recursive: true }) as string[])]) {
        if (statSync(join(cacheDir, f)).isDirectory()) chmodSync(join(cacheDir, f), mode);
      }
    };
    lock(0o555);
    try {
      const baked = await bakeScene(withEle, {
        id: 'test-run',
        trim: 200,
        tiles: tiles({ cacheDir }).source,
      });
      expect(Buffer.from(baked.bytes).equals(Buffer.from(good.bytes))).toBe(true);
      expect(baked.tiles.uncached).toBe(Math.ceil(pngs.length / 2));
      expect(baked.tiles.missing).toBe(0);
      expect(baked.warnings.join(' ')).toMatch(/could not be written to the cache/);
    } finally {
      lock(0o755);
    }
  });

  it('a cache directory that is a file: the same scene', async () => {
    const good = await reference();
    const file = join(temporaryDir(), 'cache');
    writeFileSync(file, 'x');
    const baked = await bakeScene(withEle, {
      id: 'test-run',
      trim: 200,
      tiles: tiles({ cacheDir: file }).source,
    });
    expect(Buffer.from(baked.bytes).equals(Buffer.from(good.bytes))).toBe(true);
  });

  it('a full disk (every cache write fails): the same scene', async () => {
    const good = await reference();
    const baked = await bakeScene(withEle, {
      id: 'test-run',
      trim: 200,
      tiles: tiles({
        writeFile: () => {
          throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        },
      }).source,
    });
    expect(Buffer.from(baked.bytes).equals(Buffer.from(good.bytes))).toBe(true);
    expect(baked.tiles.uncached).toBe(baked.tiles.fetched);
  });

  it('an exception inside the decoder: the bake stops', async () => {
    let calls = 0;
    const { source } = tiles({
      decode: (png) => {
        if (++calls === 2) throw new RangeError('decoder bug');
        return decodeTerrariumPngBytes(png);
      },
    });
    await expect(bakeScene(withEle, { id: 'test-run', trim: 200, tiles: source })).rejects.toThrow(
      /could not be loaded \(RangeError: decoder bug\)/,
    );
  });
});

describe('a run across the antimeridian (the e2e Taveuni Dateline loop)', () => {
  const points = antimeridianRoute();
  const gpx = gpxInput(new TextEncoder().encode(gpxOf(points)), 'taveuni.gpx');
  const json: BakeInput = {
    kind: 'json',
    fileName: 'taveuni.json',
    ...runFromPoints(parsePointsJson(pointsJsonOf(points))),
  };

  it('bakes from the GPX and from the points file alike, privacy-clean', async () => {
    const fromGpx = await bakeScene(gpx, { id: 'taveuni', trim: 200, tiles: tiles().source });
    const fromJson = await bakeScene(json, { id: 'taveuni', trim: 200, tiles: tiles().source });
    expect(Buffer.from(fromJson.bytes).equals(Buffer.from(fromGpx.bytes))).toBe(true);
    expect(fromGpx.elevationSource).toBe('terrain'); // every <ele> is 300: none usable
    expect(fromGpx.sidecar.summary.distance).toBeGreaterThan(13_000);
    expect(fromGpx.sidecar.summary.distance).toBeLessThan(14_000);
    const { extent } = fromGpx.sidecar.summary;
    // A run-sized grid (about 5 × 4 km with padding), not one around the globe.
    expect(Math.max(extent.x, extent.y)).toBeLessThan(10_000);
    // bakeScene ran the checks; again here, with the trim at 0 (the whole loop drawn) too.
    expect(fromGpx.privacy).toEqual({ findings: 0, pitchHidden: true });
    const whole = await bakeScene(gpx, { id: 'taveuni', trim: 0, tiles: tiles().source });
    const findings = scanScene(
      { bytes: whole.bytes, scene: whole.scene, sidecar: whole.sidecarText },
      { lat: gpx.points.lat, lon: gpx.points.lon, bounds: [trackBounds(gpx.points)] },
    );
    expect(findings).toEqual([]);
  });
});

describe('warnings', () => {
  it('none for a point-to-point run', async () => {
    const baked = await bakeScene(withEle, { id: 'test-run', trim: 200, tiles: tiles().source });
    expect(baked.warnings).toEqual([]);
  });

  it('laps: the start and finish are passed again mid-run, so no --trim hides them; it says where', async () => {
    // Four laps: the start is passed again halfway, which no trim can reach.
    const loop = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute(4))), 'laps.gpx');
    const baked = await bakeScene(loop, { id: 'loop', trim: 200, tiles: tiles().source });
    const total = (loop.run.distance / 1000).toFixed(1);
    const half = (loop.run.distance / 2000).toFixed(1);
    expect(baked.warnings).toEqual(
      ['start', 'finish'].map(
        (name) =>
          `The drawn route passes within 10 m of the run's real ${name} at about km ${half} of ` +
          `${total}: the route passes its ${name} again, so no --trim hides it.`,
      ),
    );
    // Three laps: a trim of a little over one lap hides both ends.
    const three = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute(3))), 'laps.gpx');
    const lap = three.run.distance / 3;
    const warned = await bakeScene(three, { id: 'loop', trim: 200, tiles: tiles().source });
    for (const warning of warned.warnings) {
      const trim = Number(/; --trim (\d+) does\.$/.exec(warning)?.[1]);
      expect(trim).toBeGreaterThan(lap);
      expect(trim).toBeLessThan(lap + 200);
    }
    // Distances along the route only: every decimal number is a km figure.
    expect(
      [...baked.warnings, ...warned.warnings].join(' ').replace(/(km|of) \d+\.\d/g, ''),
    ).not.toMatch(/\d\.\d/);
  });

  it('one loop with a short trim: says where, and the smallest --trim that hides each end', async () => {
    const loop = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute(1))), 'loop.gpx');
    const baked = await bakeScene(loop, { id: 'loop', trim: 50, tiles: tiles().source });
    expect(baked.warnings).toHaveLength(2);
    expect(baked.warnings[0]).toMatch(
      /^The drawn route passes about \d0 m from the run's real start at about km \d\.\d of \d\.\d \(a loop or laps pass it again\), so the trim does not hide it; --trim \d+ does\.$/,
    );
    expect(baked.warnings[1]).toMatch(
      /^The drawn route passes .* real finish .*; --trim \d+ does\.$/,
    );
    // That trim does hide them, and 10 m less does not.
    const trims = baked.warnings.map((w) => Number(/--trim (\d+) does/.exec(w)?.[1]));
    const enough = Math.max(...trims);
    expect(enough).toBeGreaterThan(50);
    expect(enough).toBeLessThan(400);
    const hidden = await bakeScene(loop, { id: 'loop', trim: enough, tiles: tiles().source });
    expect(hidden.warnings).toEqual([]);
    const short = await bakeScene(loop, { id: 'loop', trim: enough - 10, tiles: tiles().source });
    expect(short.warnings).not.toEqual([]);
  });

  it('clearingTrim: the first trim, in tens of metres, that keeps the drawn route 100 m away', () => {
    const loop = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute(1))), 'loop.gpx');
    const start = { lat: loop.points.lat[0] ?? 0, lon: loop.points.lon[0] ?? 0 };
    const trim = clearingTrim(loop.points, start, 0);
    expect(trim).not.toBeNull();
    const at = (metres: number) => {
      const drawn = trimTrack(loop.points, metres);
      return drawn ? distanceToTrack(start, drawn) : Infinity;
    };
    expect(at(trim ?? 0)).toBeGreaterThanOrEqual(100);
    expect(at((trim ?? 0) - 10)).toBeLessThan(100);
    // Four laps pass the start halfway: no trim clears it.
    const laps = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute(4))), 'laps.gpx');
    expect(clearingTrim(laps.points, start, 200)).toBeNull();
  });

  it('howNear: tens of metres, never "about 100 m"', () => {
    expect(howNear(3)).toBe('within 10 m of');
    expect(howNear(44)).toBe('about 40 m from');
    expect(howNear(94.9)).toBe('about 90 m from');
    expect(howNear(95)).toBe('within 100 m of');
    expect(howNear(99.9)).toBe('within 100 m of');
  });

  it('nearestOnTrack: how far and where along, interpolated within the step', () => {
    const track = {
      lat: Float64Array.from([46, 46, 46]),
      lon: Float64Array.from([7, 7.001, 7.002]),
      cumulative: Float64Array.from([0, 77, 154]),
    };
    // Half-way along the second step, 50 m north of it.
    const point = { lat: 46 + 50 / 111_320, lon: 7.0015 };
    const near = nearestOnTrack(point, track);
    expect(near.distance).toBeCloseTo(50, 0);
    expect(near.along).toBeCloseTo(115.5, 0);
  });

  it('none with --trim 0 (the ends are drawn on purpose)', async () => {
    const loop = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute())), 'laps.gpx');
    const baked = await bakeScene(loop, { id: 'loop', trim: 0, tiles: tiles().source });
    expect(baked.warnings).toEqual([]);
  });
});
