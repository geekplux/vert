// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bounds, TileCoord } from '../../src/lib/geo';
import { buildHeightfield } from '../../src/terrain/heightfield';
import { TileHttpError } from '../../src/terrain/tiles';
import { BakeError } from './errors';
import { decodeTerrariumPngBytes } from './png';
import {
  delay,
  startTileServer,
  syntheticTilePng,
  syntheticTiles,
  type TileHandler,
  type TileServer,
} from './testing';
import {
  MAX_IN_FLIGHT,
  USER_AGENT,
  cachePath,
  checkTemplate,
  createTileSource,
  type TileSourceOptions,
} from './tiles';
import { writeFileAtomic } from './write';

const TILE: TileCoord = { z: 13, x: 4275, y: 2911 };

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vert-bake-tiles-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function server(handler?: TileHandler): Promise<TileServer> {
  const started = await startTileServer(handler);
  cleanups.push(started.close);
  return started;
}

function source(origin: string, options: TileSourceOptions = {}) {
  return createTileSource({
    template: `${origin}/tiles/{z}/{x}/{y}.png`,
    cacheDir: temporaryDir(),
    retryDelayMs: 10,
    ...options,
  });
}

/** Every file under `dir`, relative. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

/** An error's message names no tile and no URL. */
function expectNoTileInMessage(error: unknown, origin: string) {
  expect(error).toBeInstanceOf(BakeError);
  const message = (error as Error).message;
  expect(message).not.toContain(origin);
  expect(message).not.toMatch(/\d+\/\d+/);
  expect(message).not.toContain(String(TILE.x));
  expect(message).not.toContain(String(TILE.y));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected a rejection');
}

describe('checkTemplate', () => {
  it('accepts http(s) templates with {z}, {x} and {y}', () => {
    expect(() => {
      checkTemplate('https://example.org/tiles/{z}/{x}/{y}.png');
    }).not.toThrow();
  });
  it('refuses others', () => {
    expect(() => {
      checkTemplate('https://example.org/tiles/{z}/{x}.png');
    }).toThrow(/\{y\}/);
    expect(() => {
      checkTemplate('file:///tiles/{z}/{x}/{y}.png');
    }).toThrow(/http/);
    expect(() => {
      checkTemplate('{z}{x}{y}');
    }).toThrow(/not a URL/);
  });
});

describe('createTileSource', () => {
  it('fetches a tile, says who is asking, and caches the verified PNG', async () => {
    const tiles = await server();
    const cacheDir = temporaryDir();
    const first = source(tiles.origin, { cacheDir });
    const elevations = await first.fetchTile(TILE);
    expect(elevations).toEqual(decodeTerrariumPngBytes(syntheticTilePng(TILE)));
    expect(first.stats).toEqual({ fetched: 1, uncached: 0, cached: 0, missing: 0, requests: 1 });
    expect(tiles.requests).toEqual([
      { url: `/tiles/13/${String(TILE.x)}/${String(TILE.y)}.png`, userAgent: USER_AGENT },
    ]);
    expect(USER_AGENT).toMatch(/^vert-bake\/\S+ \(offline scene bake\)$/);
    // Cached atomically: the PNG, and no temporary file left behind.
    expect(files(cacheDir)).toEqual([`13/${String(TILE.x)}/${String(TILE.y)}.png`]);

    // A second bake reads it from the cache: no request at all.
    const second = source(tiles.origin, { cacheDir });
    expect(await second.fetchTile(TILE)).toEqual(elevations);
    expect(second.stats).toEqual({ fetched: 0, uncached: 0, cached: 1, missing: 0, requests: 0 });
    expect(tiles.requests).toHaveLength(1);
  });

  it('asks once for a tile wanted twice', async () => {
    const tiles = await server();
    const tileSource = source(tiles.origin);
    await Promise.all([tileSource.fetchTile(TILE), tileSource.fetchTile(TILE)]);
    await tileSource.fetchTile(TILE);
    expect(tiles.requests).toHaveLength(1);
  });

  it(`keeps at most ${String(MAX_IN_FLIGHT)} requests in flight`, async () => {
    const tiles = await server(async (request, coord, attempt) => {
      await delay(30);
      return syntheticTiles(request, coord, attempt);
    });
    const tileSource = source(tiles.origin);
    const coords = Array.from({ length: 12 }, (_, i) => ({ z: 13, x: TILE.x + i, y: TILE.y }));
    await Promise.all(coords.map((coord) => tileSource.fetchTile(coord)));
    expect(tiles.requests).toHaveLength(12);
    expect(tiles.maxInFlight()).toBe(MAX_IN_FLIGHT);
  });

  it('404: a missing tile, not retried and not cached', async () => {
    const tiles = await server(() => ({ status: 404, type: 'application/json', body: '{}' }));
    const cacheDir = temporaryDir();
    const tileSource = source(tiles.origin, { cacheDir });
    const error = await rejection(tileSource.fetchTile(TILE));
    expect(error).toBeInstanceOf(TileHttpError);
    expect((error as TileHttpError).status).toBe(404);
    expect(tileSource.stats).toEqual({
      fetched: 0,
      uncached: 0,
      cached: 0,
      missing: 1,
      requests: 1,
    });
    expect(tileSource.signal.aborted).toBe(false);
    expect(files(cacheDir)).toEqual([]);
  });

  it('400: stops the bake (a bug in the request)', async () => {
    const tiles = await server(() => ({ status: 400, type: 'application/json', body: '{}' }));
    const tileSource = source(tiles.origin);
    const error = await rejection(tileSource.fetchTile(TILE));
    expectNoTileInMessage(error, tiles.origin);
    expect((error as Error).message).toMatch(/HTTP 400/);
    expect(tileSource.signal.aborted).toBe(true);
    expect(tileSource.signal.reason).toBe(error);
    expect(tiles.requests).toHaveLength(1);
    // Nothing more is asked once the bake has stopped.
    expect(await rejection(tileSource.fetchTile({ ...TILE, x: TILE.x + 1 }))).toBe(error);
    expect(tiles.requests).toHaveLength(1);
  });

  it('502 once: retried, then served', async () => {
    const tiles = await server((request, coord, attempt) =>
      attempt === 1 ? { status: 502 } : syntheticTiles(request, coord, attempt),
    );
    const tileSource = source(tiles.origin);
    await tileSource.fetchTile(TILE);
    expect(tiles.requests).toHaveLength(2);
    expect(tileSource.stats.fetched).toBe(1);
  });

  it('502 twice: stops the bake after one retry', async () => {
    const tiles = await server(() => ({ status: 502, type: 'application/json', body: '{}' }));
    const cacheDir = temporaryDir();
    const tileSource = source(tiles.origin, { cacheDir });
    const error = await rejection(tileSource.fetchTile(TILE));
    expectNoTileInMessage(error, tiles.origin);
    expect((error as Error).message).toMatch(/HTTP 502, also on the retry/);
    expect(tiles.requests).toHaveLength(2);
    expect(tileSource.signal.aborted).toBe(true);
    expect(files(cacheDir)).toEqual([]);
  });

  it('a timeout: retried once, then stops the bake', async () => {
    const tiles = await server(() => null);
    const tileSource = source(tiles.origin, { timeoutMs: 100 });
    const error = await rejection(tileSource.fetchTile(TILE));
    expectNoTileInMessage(error, tiles.origin);
    expect((error as Error).message).toMatch(/no answer within/);
    expect(tiles.requests).toHaveLength(2);
  });

  it('a network error: retried once, then stops the bake', async () => {
    const closed = await startTileServer();
    await closed.close(); // nothing listens on its port any more
    let requests = 0;
    const tileSource = source(closed.origin, {
      fetch: (url, init) => {
        requests++;
        return fetch(url, init);
      },
    });
    const error = await rejection(tileSource.fetchTile(TILE));
    expectNoTileInMessage(error, closed.origin);
    expect((error as Error).message).toMatch(/network error, also on the retry/);
    expect(requests).toBe(2);
  });

  it('a 200 that is a web page: stops the bake, not retried, not cached', async () => {
    const tiles = await server(() => ({
      status: 200,
      type: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Vert</title>',
    }));
    const cacheDir = temporaryDir();
    const tileSource = source(tiles.origin, { cacheDir });
    const error = await rejection(tileSource.fetchTile(TILE));
    expectNoTileInMessage(error, tiles.origin);
    expect((error as Error).message).toMatch(/text\/html.*not an image/);
    expect(tiles.requests).toHaveLength(1);
    expect(files(cacheDir)).toEqual([]);
  });

  it('a 200 "PNG" that does not decode: stops the bake, not cached', async () => {
    const tiles = await server(() => ({ status: 200, type: 'image/png', body: 'GIF89a…' }));
    const cacheDir = temporaryDir();
    const tileSource = source(tiles.origin, { cacheDir });
    const error = await rejection(tileSource.fetchTile(TILE));
    expectNoTileInMessage(error, tiles.origin);
    expect((error as Error).message).toMatch(/not a Terrarium PNG/);
    expect(files(cacheDir)).toEqual([]);
  });

  it('any other status: stops the bake', async () => {
    const tiles = await server(() => ({ status: 403 }));
    const error = await rejection(source(tiles.origin).fetchTile(TILE));
    expect((error as Error).message).toMatch(/HTTP 403/);
    expect(tiles.requests).toHaveLength(1);
  });

  it('replaces a damaged cache entry', async () => {
    const tiles = await server();
    const cacheDir = temporaryDir();
    const path = cachePath(cacheDir, TILE);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'not a png');
    const tileSource = source(tiles.origin, { cacheDir });
    await tileSource.fetchTile(TILE);
    expect(tileSource.stats).toMatchObject({ fetched: 1, cached: 0 });
    expect(decodeTerrariumPngBytes(readFileSync(path))).toHaveLength(256 * 256);
  });

  it('a cache write that fails (full disk): the verified tile is used, and counted', async () => {
    const tiles = await server();
    const tileSource = source(tiles.origin, {
      writeFile: () => {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      },
    });
    expect(await tileSource.fetchTile(TILE)).toEqual(
      decodeTerrariumPngBytes(syntheticTilePng(TILE)),
    );
    expect(tileSource.stats).toMatchObject({ fetched: 1, uncached: 1, missing: 0 });
    expect(tileSource.signal.aborted).toBe(false);
  });

  it('a cache directory that is a file: tiles are fetched and used, none cached', async () => {
    const tiles = await server();
    const file = join(temporaryDir(), 'not-a-dir');
    writeFileSync(file, 'x');
    const tileSource = source(tiles.origin, { cacheDir: file });
    await tileSource.fetchTile(TILE);
    expect(tileSource.stats).toMatchObject({ fetched: 1, uncached: 1, cached: 0, missing: 0 });
  });

  it('an unexpected exception (a decoder bug) stops the bake: never a filled tile', async () => {
    const tiles = await server();
    const tileSource = source(tiles.origin, {
      decode: () => {
        throw new TypeError('decoder bug at 13/4275/2911 46.512345');
      },
    });
    const error = await rejection(tileSource.fetchTile(TILE));
    expect(error).toBeInstanceOf(BakeError);
    expect(error).not.toBeInstanceOf(TileHttpError);
    expectNoTileInMessage(error, tiles.origin);
    expect((error as Error).message).not.toMatch(/46\.51/);
    expect((error as Error).message).toMatch(/could not be loaded \(TypeError: decoder bug/);
    expect(tileSource.signal.aborted).toBe(true);
    expect(tileSource.stats.missing).toBe(0);
  });

  it('offline: a tile the cache lacks stops the bake without a request', async () => {
    const tiles = await server();
    const tileSource = source(tiles.origin, { offline: true });
    const error = await rejection(tileSource.fetchTile(TILE));
    expect((error as Error).message).toMatch(/not in the cache/);
    expect(tiles.requests).toHaveLength(0);
  });
});

describe('writeFileAtomic', () => {
  it('writes through a temporary file and leaves none behind', () => {
    const dir = temporaryDir();
    writeFileAtomic(join(dir, 'a', 'b.bin'), Uint8Array.of(1, 2, 3));
    writeFileAtomic(join(dir, 'a', 'b.bin'), Uint8Array.of(4, 5));
    expect(files(dir)).toEqual(['a/b.bin']);
  });

  it('on failure, leaves neither a partial file nor a temporary one', () => {
    const dir = temporaryDir();
    mkdirSync(join(dir, 'taken'));
    writeFileSync(join(dir, 'taken', 'inside'), 'x');
    // The target is a non-empty directory: the rename fails after the temporary file is written.
    expect(() => {
      writeFileAtomic(join(dir, 'taken'), 'data');
    }).toThrow();
    expect(files(dir)).toEqual(['taken/inside']);
  });
});

describe('with buildHeightfield', () => {
  // About 1.5 km square: a few tiles at zoom 14.
  const bounds: Bounds = { west: 7.873, east: 7.893, south: 46.512, north: 46.526 };

  it('a missing (404) tile is filled from its neighbours, as in the app', async () => {
    let first: string | null = null;
    const tiles = await server((request, coord, attempt) => {
      first ??= request.url ?? '';
      return request.url === first ? { status: 404 } : syntheticTiles(request, coord, attempt);
    });
    const tileSource = source(tiles.origin);
    const grid = await buildHeightfield(bounds, {
      fetchTile: tileSource.fetchTile,
      signal: tileSource.signal,
      concurrency: 1,
    });
    expect(grid.failedTiles).toHaveLength(1);
    expect(tileSource.stats.missing).toBe(1);
  });

  it('a fatal answer rejects the whole grid with the BakeError, not a filled tile', async () => {
    let served = 0;
    const tiles = await server((request, coord, attempt) =>
      ++served === 2 ? { status: 400 } : syntheticTiles(request, coord, attempt),
    );
    const tileSource = source(tiles.origin);
    const error = await rejection(
      buildHeightfield(bounds, {
        fetchTile: tileSource.fetchTile,
        signal: tileSource.signal,
        concurrency: 1,
      }),
    );
    expect(error).toBeInstanceOf(BakeError);
    expect((error as Error).message).toMatch(/HTTP 400/);
  });
});

describe('cache location', () => {
  it('defaults to scripts/.cache/terrarium/{z}/{x}/{y}.png', async () => {
    const { DEFAULT_CACHE_DIR } = await import('./tiles');
    expect(cachePath(DEFAULT_CACHE_DIR, TILE)).toMatch(
      new RegExp(`scripts/\\.cache/terrarium/13/${String(TILE.x)}/${String(TILE.y)}\\.png$`),
    );
    expect(existsSync(join(DEFAULT_CACHE_DIR, '..', '..', 'bake.ts'))).toBe(true);
  });
});
