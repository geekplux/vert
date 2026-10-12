import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseZoom,
  lonLatToWorld,
  tileCount,
  tilesForBounds,
  worldToLonLat,
  type Bounds,
  type TileCoord,
} from '../lib/geo';
import { decodeTerrariumImage } from '../lib/terrarium';
import {
  HeightfieldError,
  MAX_GRID_SIZE,
  MAX_LONG_ROUTE_TILES,
  buildHeightfield,
  chooseHeightfieldZoom,
  elevationAt,
  gridPosition,
  groundExtent,
  type Heightfield,
} from './heightfield';
import {
  TILE_SIZE,
  TileDecodeError,
  TileHttpError,
  fetchTile,
  isAbortError,
  tileLoader,
  type FetchLike,
} from './tiles';

/** A known surface: linear in lon and lat, metres. */
const surface = (lon: number, lat: number) => 100 + lon * 1000 + lat * 500;

/** About 7.7 km × 6.7 km in the Alps (8.9 × 7.7 km padded); spans several z12 tiles. */
const BOUNDS: Bounds = { west: 7.4, south: 45.97, east: 7.5, north: 46.03 };

/** Terrarium RGBA for one elevation. */
function encode(elevation: number): [number, number, number] {
  const v = elevation + 32768;
  const whole = Math.floor(v);
  return [Math.floor(whole / 256), whole % 256, Math.floor((v - whole) * 256)];
}

/** A tile of `f` ({@link surface}), sampled at pixel centres and round-tripped through Terrarium. */
function analyticTile(
  { z, x, y }: TileCoord,
  f: (lon: number, lat: number) => number = surface,
): Float32Array {
  const n = 2 ** z;
  const rgba = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const { lon, lat } = worldToLonLat(
        (x + (px + 0.5) / TILE_SIZE) / n,
        (y + (py + 0.5) / TILE_SIZE) / n,
      );
      const [r, g, b] = encode(f(lon, lat));
      const i = (py * TILE_SIZE + px) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return decodeTerrariumImage(rgba, TILE_SIZE, TILE_SIZE);
}

/** A tile source over {@link analyticTile} that records what it was asked for. */
function fakeSource(fail: (tile: TileCoord) => boolean = () => false) {
  const requested: TileCoord[] = [];
  let active = 0;
  let peak = 0;
  const fetchTile = async (tile: TileCoord) => {
    requested.push(tile);
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    if (fail(tile)) throw new TileHttpError(tile, 404);
    return analyticTile(tile);
  };
  return {
    fetchTile,
    requested,
    get peak() {
      return peak;
    },
  };
}

/** Lon/lat of a grid node. */
function nodeLonLat(hf: Heightfield, i: number, j: number) {
  const { west, east, north, south } = hf.bounds;
  // Columns are linear in lon (Mercator x is linear in lon); rows are linear in Mercator y.
  const lon = west + ((east - west) * i) / (hf.width - 1);
  const yN = Math.log(Math.tan(Math.PI / 4 + (north * Math.PI) / 360));
  const yS = Math.log(Math.tan(Math.PI / 4 + (south * Math.PI) / 360));
  const y = yN + ((yS - yN) * j) / (hf.height - 1);
  const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);
  return { lon, lat };
}

const at = (hf: Heightfield, i: number, j: number) => hf.elevations[j * hf.width + i] ?? NaN;

describe('buildHeightfield', () => {
  it('fetches the tiles of the chosen zoom, at most six at a time', async () => {
    const source = fakeSource();
    const hf = await buildHeightfield(BOUNDS, { fetchTile: source.fetchTile, maxTiles: 16 });
    expect(source.requested.length).toBe(tileCount(BOUNDS, hf.zoom));
    expect(source.requested.length).toBeGreaterThan(1);
    expect(source.requested.length).toBeLessThanOrEqual(16);
    expect(source.requested.every((t) => t.z === hf.zoom)).toBe(true);
    expect(source.peak).toBeLessThanOrEqual(6);
    expect(hf.failedTiles).toEqual([]);
  });

  it('reproduces the surface at every grid node', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile });
    let worst = 0;
    for (let j = 0; j < hf.height; j++) {
      for (let i = 0; i < hf.width; i++) {
        const { lon, lat } = nodeLonLat(hf, i, j);
        worst = Math.max(worst, Math.abs(at(hf, i, j) - surface(lon, lat)));
      }
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('is continuous across tile seams', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile });
    // The surface is linear in lon and nearly linear in Mercator y, so neighbour differences are
    // constant along each axis; a seam would show as a jump in the second difference.
    let worstX = 0;
    for (let j = 0; j < hf.height; j++) {
      for (let i = 1; i < hf.width - 1; i++) {
        const second = at(hf, i + 1, j) - 2 * at(hf, i, j) + at(hf, i - 1, j);
        worstX = Math.max(worstX, Math.abs(second));
      }
    }
    let worstY = 0;
    for (let i = 0; i < hf.width; i++) {
      for (let j = 1; j < hf.height - 1; j++) {
        const second = at(hf, i, j + 1) - 2 * at(hf, i, j) + at(hf, i, j - 1);
        worstY = Math.max(worstY, Math.abs(second));
      }
    }
    expect(worstX).toBeLessThan(0.05);
    expect(worstY).toBeLessThan(0.05);
  });

  it('keeps the ground aspect ratio with roughly square samples', async () => {
    const hf = await buildHeightfield(BOUNDS, {
      fetchTile: fakeSource().fetchTile,
      gridSize: 200,
      padding: 0,
    });
    expect(hf.width).toBe(200); // wider than tall
    expect(hf.height).toBeLessThan(200);
    expect(hf.elevations).toHaveLength(hf.width * hf.height);
    expect(hf.metresPerSample.y / hf.metresPerSample.x).toBeCloseTo(1, 2);
    // ~7.74 km across at 46° N.
    expect(hf.metresPerSample.x * (hf.width - 1)).toBeGreaterThan(7600);
    expect(hf.metresPerSample.x * (hf.width - 1)).toBeLessThan(7850);

    const tall = await buildHeightfield(
      { west: 7.45, south: 45.9, east: 7.47, north: 46.0 },
      { fetchTile: fakeSource().fetchTile, gridSize: 128 },
    );
    expect(tall.height).toBe(128);
    expect(tall.width).toBeLessThan(128);
    expect(tall.metresPerSample.y / tall.metresPerSample.x).toBeCloseTo(1, 1);
  });

  it('reports min and max of the grid', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile });
    let min = Infinity;
    let max = -Infinity;
    for (const v of hf.elevations) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(hf.min).toBe(min);
    expect(hf.max).toBe(max);
    // Lowest at the south-west corner, highest at the north-east.
    expect(hf.min).toBeCloseTo(surface(hf.bounds.west, hf.bounds.south), 1);
    expect(hf.max).toBeCloseTo(surface(hf.bounds.east, hf.bounds.north), 1);
  });

  it('pads the bounds by 15% on each side by default', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile });
    expect(hf.bounds.west).toBeCloseTo(7.385, 10);
    expect(hf.bounds.east).toBeCloseTo(7.515, 10);
    expect(hf.bounds.south).toBeCloseTo(45.961, 10);
    expect(hf.bounds.north).toBeCloseTo(46.039, 10);
    const unpadded = await buildHeightfield(BOUNDS, {
      fetchTile: fakeSource().fetchTile,
      padding: 0,
    });
    expect(unpadded.bounds).toEqual(BOUNDS);
  });

  it('picks z12–14 and native resolution, at most 512 samples a side', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile });
    expect(hf.zoom).toBe(12); // z13 would be ~757 px across the padded area
    const nw = lonLatToWorld(hf.bounds.west, hf.bounds.north);
    const se = lonLatToWorld(hf.bounds.east, hf.bounds.south);
    const nativeWidth = (se.x - nw.x) * 2 ** hf.zoom * TILE_SIZE;
    expect(hf.width).toBe(Math.round(nativeWidth));
    expect(hf.width).toBeLessThanOrEqual(MAX_GRID_SIZE);

    // A ~1 km box gets the finest preferred zoom.
    const small = await buildHeightfield(
      { west: 7.45, south: 46.0, east: 7.46, north: 46.007 },
      { fetchTile: fakeSource().fetchTile },
    );
    expect(small.zoom).toBe(14);
    expect(Math.max(small.width, small.height)).toBeLessThanOrEqual(MAX_GRID_SIZE);
  });

  it('drops below z12 for a route too large for the budget, and caps the grid at 512', async () => {
    // ~78 km × 111 km: z12 would be ~2,600 px tall.
    const large: Bounds = { west: 7, south: 45.5, east: 8, north: 46.5 };
    const source = fakeSource();
    const hf = await buildHeightfield(large, { fetchTile: source.fetchTile });
    expect(hf.zoom).toBeLessThan(12);
    expect(source.requested.length).toBeLessThanOrEqual(16);
    expect(Math.max(hf.width, hf.height)).toBeLessThanOrEqual(MAX_GRID_SIZE);
    expect(chooseHeightfieldZoom(hf.bounds)).toBe(hf.zoom);
  });

  it('chooses the zoom from the tile and sample budgets', () => {
    // Unpadded BOUNDS: 291 px wide at z12, 582 px at z13.
    expect(chooseHeightfieldZoom(BOUNDS)).toBe(12);
    expect(chooseHeightfieldZoom(BOUNDS, { maxSamples: 600 })).toBe(13);
    expect(chooseHeightfieldZoom(BOUNDS, { maxSamples: 4000, maxTiles: 1000 })).toBe(14); // never 15
    const half: Bounds = { west: 7.4, south: 45.97, east: 7.45, north: 46.0 };
    expect(chooseHeightfieldZoom(half)).toBe(13);
    // The tile budget also binds: one tile only fits at a lower zoom.
    expect(chooseHeightfieldZoom(half, { maxTiles: 1 })).toBe(chooseZoom(half, 1));
    expect(chooseZoom(half, 1)).toBeLessThan(13);
  });

  it('samples a long route one zoom finer than its grid needs, then downsamples to 512', async () => {
    // ~39 × 28 km around Chamonix (the CCC's padded box): 368 px at z10, too wide for z11's 512.
    const ccc: Bounds = { west: 6.84, south: 45.78, east: 7.34, north: 46.03 };
    expect(chooseHeightfieldZoom(ccc, { maxLongRouteTiles: 0 })).toBe(10);
    expect(chooseHeightfieldZoom(ccc)).toBe(11);
    expect(tileCount(ccc, 11)).toBeLessThanOrEqual(MAX_LONG_ROUTE_TILES);
    // Not when the finer zoom would need more tiles than the long-route budget.
    expect(chooseHeightfieldZoom(ccc, { maxLongRouteTiles: tileCount(ccc, 11) - 1 })).toBe(10);
    // A short route (native fit at z12 or finer) is unchanged.
    expect(chooseHeightfieldZoom(BOUNDS)).toBe(12);

    const source = fakeSource();
    const hf = await buildHeightfield(ccc, { padding: 0, fetchTile: source.fetchTile });
    expect(hf.zoom).toBe(11);
    expect(source.requested.every((tile) => tile.z === 11)).toBe(true);
    expect(source.requested.length).toBe(tileCount(ccc, 11));
    expect(Math.max(hf.width, hf.height)).toBe(MAX_GRID_SIZE);
    expect(groundExtent(hf)).toBeGreaterThan(38_000);
    expect(groundExtent(hf)).toBeLessThan(40_000);
    expect(elevationAt(hf, 7.1, 45.9)).toBeCloseTo(surface(7.1, 45.9), 0);
  });

  it('gives a single point a small area instead of an empty one', async () => {
    const point = { west: 7.45, south: 46, east: 7.45, north: 46 };
    const hf = await buildHeightfield(point, { fetchTile: fakeSource().fetchTile });
    expect(hf.bounds.east - hf.bounds.west).toBeGreaterThan(0);
    expect(hf.bounds.north - hf.bounds.south).toBeGreaterThan(0);
    expect(elevationAt(hf, 7.45, 46)).toBeCloseTo(surface(7.45, 46), 1);
  });

  it('fills a failed tile from its neighbours and reports it', async () => {
    const all = fakeSource();
    const reference = await buildHeightfield(BOUNDS, { fetchTile: all.fetchTile });
    const [, missing = all.requested[0]] = all.requested;
    if (!missing) throw new Error('no tiles requested');
    const source = fakeSource((t) => t.x === missing.x && t.y === missing.y);
    const hf = await buildHeightfield(BOUNDS, { fetchTile: source.fetchTile });

    expect(hf.failedTiles).toEqual([missing]);
    expect(hf.elevations.every(Number.isFinite)).toBe(true);
    // The fill stays within the loaded range: a blend of neighbouring edges, not zeros or NaN.
    expect(hf.min).toBeGreaterThanOrEqual(reference.min - 0.01);
    expect(hf.max).toBeLessThanOrEqual(reference.max + 0.01);
    // Away from the hole the grid is untouched.
    expect(at(hf, 0, hf.height - 1)).toBe(at(reference, 0, reference.height - 1));
  });

  it('blends a failed tile from loaded neighbours on two sides', async () => {
    // A 2×2 block where only the diagonal corners load: the other two touch neither.
    const bounds: Bounds = { west: -90, south: -45, east: 90, north: 45 };
    const tiles = tilesForBounds(bounds, chooseZoom(bounds, 4));
    expect(tiles).toHaveLength(4);
    const [first, , , last] = tiles as [TileCoord, TileCoord, TileCoord, TileCoord];
    const same = (a: TileCoord, b: TileCoord) => a.x === b.x && a.y === b.y;
    const hf = await buildHeightfield(bounds, {
      maxTiles: 4,
      // A huge area samples one zoom finer by default (a long route); keep this test to the 2×2.
      maxLongRouteTiles: 4,
      padding: 0,
      fetchTile: (tile) => {
        if (same(tile, first)) return Promise.resolve(new Float32Array(TILE_SIZE ** 2).fill(9));
        if (same(tile, last)) return Promise.resolve(new Float32Array(TILE_SIZE ** 2).fill(7));
        return Promise.reject(new TileHttpError(tile, 404));
      },
    });
    expect(hf.failedTiles).toHaveLength(2);
    // Each failed tile has two loaded neighbours (one 9, one 7), so the blend stays in [7, 9].
    expect(hf.min).toBeGreaterThanOrEqual(7);
    expect(hf.max).toBeLessThanOrEqual(9);
  });

  it('fills tiles with no loaded neighbour in later passes', async () => {
    // A row of three tiles where only the first loads: the middle is filled from it, the last
    // from the filled middle (a later pass), so everything ends up at the loaded value.
    // z12 tiles are 0.087890625° wide; tile 2132 starts at 7.3828125°. This box clips into
    // tiles 2132 and 2134 and spans 2133: ~290 px, so z12 (z13 would exceed 512 px).
    const bounds: Bounds = { west: 7.465, south: 46.0, east: 7.5636, north: 46.001 };
    const zoom = chooseHeightfieldZoom(bounds);
    expect(zoom).toBe(12);
    const tiles = tilesForBounds(bounds, zoom);
    expect(tiles).toHaveLength(3);
    const [first] = tiles as [TileCoord];
    const hf = await buildHeightfield(bounds, {
      padding: 0,
      fetchTile: (tile) =>
        tile.x === first.x && tile.y === first.y
          ? Promise.resolve(new Float32Array(TILE_SIZE ** 2).fill(5))
          : Promise.reject(new TileHttpError(tile, 404)),
    });
    expect(hf.failedTiles).toHaveLength(tiles.length - 1);
    expect(hf.min).toBe(5);
    expect(hf.max).toBe(5);
  });

  it('throws HeightfieldError when no tile loads', async () => {
    const source = fakeSource(() => true);
    const error: unknown = await buildHeightfield(BOUNDS, { fetchTile: source.fetchTile }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HeightfieldError);
    expect((error as HeightfieldError).failedTiles.length).toBe(source.requested.length);
    expect((error as HeightfieldError).kind).toBe('network');
  });

  it('says so when every tile arrived but none could be decoded', async () => {
    const decodeFails = (tile: TileCoord) =>
      Promise.reject(new TileDecodeError(tile, new Error('bad PNG')));
    const error: unknown = await buildHeightfield(BOUNDS, { fetchTile: decodeFails }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HeightfieldError);
    expect((error as HeightfieldError).kind).toBe('decode');
  });

  it('calls a mix of decode and network failures a network failure', async () => {
    let n = 0;
    const mixed = (tile: TileCoord) =>
      Promise.reject(
        n++ === 0 ? new TypeError('Failed to fetch') : new TileDecodeError(tile, new Error('x')),
      );
    const error: unknown = await buildHeightfield(BOUNDS, { fetchTile: mixed }).catch(
      (e: unknown) => e,
    );
    expect((error as HeightfieldError).kind).toBe('network');
  });

  it('propagates AbortError and stops fetching', async () => {
    const controller = new AbortController();
    const requested: TileCoord[] = [];
    const promise = buildHeightfield(BOUNDS, {
      signal: controller.signal,
      concurrency: 1,
      fetchTile: (tile, { signal }) => {
        requested.push(tile);
        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    });
    controller.abort();
    await expect(promise).rejects.toSatisfy(isAbortError);
    expect(requested.length).toBeLessThanOrEqual(1);
  });
});

describe('across the antimeridian', () => {
  /** Linear in longitude through 180° (continuous there), whatever representation it gets. */
  const dateline = (lon: number, lat: number) =>
    300 + (((lon + 360) % 360) - 180) * 2000 + (lat + 16.86) * 1000;
  /** Taveuni, Fiji, as `boundsOf` gives a loop across 180°: the east edge past it. */
  const TAVEUNI: Bounds = { west: 179.9775, south: -16.877, east: 180.0225, north: -16.843 };

  it('fetches only real tiles (x in [0, 2^z)), on both sides of the line', async () => {
    const requested: TileCoord[] = [];
    const hf = await buildHeightfield(TAVEUNI, {
      fetchTile: (tile) => {
        requested.push(tile);
        return Promise.resolve(analyticTile(tile, dateline));
      },
    });
    const n = 2 ** hf.zoom;
    expect(hf.zoom).toBeGreaterThanOrEqual(12);
    expect(requested.length).toBe(tileCount(hf.bounds, hf.zoom));
    expect(requested.every((t) => Number.isInteger(t.x) && t.x >= 0 && t.x < n)).toBe(true);
    const xs = new Set(requested.map((t) => t.x));
    expect(xs.has(0)).toBe(true);
    expect(xs.has(n - 1)).toBe(true);
    // The grid is a few km across, not the globe.
    expect(groundExtent(hf)).toBeLessThan(10_000);
    expect(hf.bounds.east).toBeGreaterThan(180);
  });

  it('reproduces the surface at every node, with no seam at 180°', async () => {
    const hf = await buildHeightfield(TAVEUNI, {
      fetchTile: (tile) => Promise.resolve(analyticTile(tile, dateline)),
    });
    let worst = 0;
    for (let j = 0; j < hf.height; j += 7) {
      for (let i = 0; i < hf.width; i++) {
        const { lon, lat } = nodeLonLat(hf, i, j);
        worst = Math.max(worst, Math.abs(at(hf, i, j) - dateline(lon, lat)));
      }
    }
    expect(worst).toBeLessThan(0.05);
    // Draping: a point just east of the line, in its unwrapped form, lands inside the grid.
    const p = gridPosition(hf, 180.01, -16.86);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(hf.width - 1);
    expect(elevationAt(hf, 180.01, -16.86)).toBeCloseTo(dateline(-179.99, -16.86), 1);
  });
});

describe('near the poles', () => {
  it('builds a grid for a Svalbard loop (78° N)', async () => {
    const svalbard: Bounds = { west: 15.49, south: 78.19, east: 15.67, north: 78.22 };
    const hf = await buildHeightfield(svalbard, { fetchTile: fakeSource().fetchTile });
    expect(hf.zoom).toBeGreaterThanOrEqual(12);
    expect(hf.bounds.north).toBeLessThanOrEqual(85);
    expect(hf.width).toBeGreaterThan(1);
    expect(hf.height).toBeGreaterThan(1);
  });

  it('keeps a run beyond the Mercator limit inside it, without an inverted box', async () => {
    const pole: Bounds = { west: 10, south: 88.9, east: 11, north: 89.5 };
    const hf = await buildHeightfield(pole, { fetchTile: fakeSource().fetchTile });
    expect(hf.bounds.north).toBe(85);
    expect(hf.bounds.south).toBeLessThan(hf.bounds.north);
    expect(Number.isFinite(hf.min) && Number.isFinite(hf.max)).toBe(true);
  });
});

describe('elevationAt', () => {
  it('matches the surface between grid nodes', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile });
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 200; k++) {
      const lon = BOUNDS.west + random() * (BOUNDS.east - BOUNDS.west);
      const lat = BOUNDS.south + random() * (BOUNDS.north - BOUNDS.south);
      expect(Math.abs(elevationAt(hf, lon, lat) - surface(lon, lat))).toBeLessThan(0.05);
    }
  });

  it('maps the corners to the corner nodes and clamps outside the grid', async () => {
    const hf = await buildHeightfield(BOUNDS, { fetchTile: fakeSource().fetchTile, padding: 0 });
    const nw = gridPosition(hf, BOUNDS.west, BOUNDS.north);
    const se = gridPosition(hf, BOUNDS.east, BOUNDS.south);
    expect(nw.x).toBeCloseTo(0, 9);
    expect(nw.y).toBeCloseTo(0, 9);
    expect(se.x).toBeCloseTo(hf.width - 1, 9);
    expect(se.y).toBeCloseTo(hf.height - 1, 9);
    expect(elevationAt(hf, BOUNDS.west - 1, BOUNDS.north + 1)).toBe(at(hf, 0, 0));
  });
});

describe('privacy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tileLoader.clear();
  });

  it('only ever requests /tiles/{z}/{x}/{y}.png, with no body, headers, credentials or referrer', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetchMock = vi.fn<FetchLike>((url, init) => {
      seen.push({ url, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    });
    // The default path: buildHeightfield → shared fetchTile → global fetch.
    vi.stubGlobal('fetch', fetchMock);
    const flat = () => Promise.resolve(new Float32Array(TILE_SIZE * TILE_SIZE).fill(1));
    await buildHeightfield(BOUNDS, {
      fetchTile: (coord, options) => fetchTile(coord, { ...options, decode: flat }),
    });
    await buildHeightfield(
      { west: 7, south: 45.5, east: 8, north: 46.5 },
      {
        fetchTile: (coord, options) => fetchTile(coord, { ...options, decode: flat }),
      },
    );

    expect(seen.length).toBeGreaterThan(1);
    for (const { url, init } of seen) {
      expect(url).toMatch(/^\/tiles\/\d{1,2}\/\d{1,5}\/\d{1,5}\.png$/);
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toBeUndefined();
      expect(init?.credentials).toBe('omit');
      expect(init?.referrerPolicy).toBe('no-referrer');
    }
  });
});
