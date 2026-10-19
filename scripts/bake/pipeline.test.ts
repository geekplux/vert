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
import { DEFAULT_TRIM_M, bakeScene, trackBounds } from './pipeline';
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

  it('laps: the real start and finish lie on the drawn route, in tens of metres', async () => {
    const loop = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute())), 'laps.gpx');
    const baked = await bakeScene(loop, { id: 'loop', trim: 200, tiles: tiles().source });
    expect(baked.warnings).toHaveLength(2);
    expect(baked.warnings[0]).toMatch(
      /real start lies (within 10 m of|about \d+0 m from) the drawn route/,
    );
    expect(baked.warnings[1]).toMatch(/real finish/);
    expect(baked.warnings.join(' ')).toMatch(/a larger --trim/);
    expect(baked.warnings.join(' ')).not.toMatch(/\d\.\d/);
  });

  it('none with --trim 0 (the ends are drawn on purpose)', async () => {
    const loop = gpxInput(new TextEncoder().encode(gpxOf(lapsRoute())), 'laps.gpx');
    const baked = await bakeScene(loop, { id: 'loop', trim: 0, tiles: tiles().source });
    expect(baked.warnings).toEqual([]);
  });
});
