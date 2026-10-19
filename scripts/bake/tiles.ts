/**
 * Elevation tiles for the bake: fetched from the tile Worker (or any server with its semantics),
 * kept in an on-disk cache, decoded in Node. `createTileSource().fetchTile` is what
 * `buildHeightfield` calls as its `fetchTile`.
 *
 * Politeness: at most {@link MAX_IN_FLIGHT} requests in flight, a `User-Agent` that says what is
 * asking, a time limit per request, one retry. Only z/x/y go out (in the URL path), as from the
 * app; nothing about the run does.
 *
 * What each answer means (worker/README.md):
 *
 * - **200 PNG**: the tile. Decoded and checked before it is cached; only verified PNGs are cached,
 *   written atomically (a temporary file renamed into place).
 * - **404**: the tile does not exist upstream (open sea, beyond the data). A missing tile: the
 *   request fails, and `buildHeightfield` fills its area from its neighbours and lists it in
 *   `failedTiles`, exactly as in the app. Not retried, not cached on disk.
 * - **400**: the request itself is wrong (a bug, or a `--tiles` template that builds bad paths).
 *   The bake stops.
 * - **5xx, 429, a network error or a timeout**: retried once, then the bake stops. Here the bake
 *   departs from the app on purpose: the app fills such a tile from its neighbours and says so on
 *   screen, but a scene is published and has no such note, so a passing outage must not become
 *   invented terrain in it (and the same input would bake differently on the next run).
 * - **200 that is not an image** (text, HTML, JSON, XML: the app's `TileNotServedError`), or a
 *   body that is not a 256 × 256 PNG: the template points at something that serves no tiles. The
 *   bake stops.
 * - Any other status: the bake stops.
 * - **Anything else that goes wrong** (a decoder bug, an unexpected file system error, any other
 *   exception): the bake stops. Only a confirmed 404 may become a filled tile.
 * - **A tile that cannot be written to the cache** (read-only or full disk): its verified
 *   elevations are used all the same and counted in `stats.uncached`, so the bake can warn; the
 *   cache only saves a later download.
 *
 * Stopping: `buildHeightfield` treats every failed tile as missing, so a fatal answer also aborts
 * {@link TileSource.signal} with the {@link BakeError} as its reason; pass that signal to
 * `buildHeightfield` and it rejects with that error.
 *
 * Errors name no tile and no URL (a tile's z/x/y is a location), only what went wrong.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TileCoord } from '../../src/lib/geo';
import { TileHttpError, isNotTileType, type TileElevations } from '../../src/terrain/tiles';
import { BakeError, scrub } from './errors';
import { PngError, decodeTerrariumPngBytes } from './png';
import { writeFileAtomic } from './write';

/** The tile Worker's public endpoint. */
export const DEFAULT_TILE_TEMPLATE = 'https://vert.geekplux.org/tiles/{z}/{x}/{y}.png';

/** The on-disk cache: `{z}/{x}/{y}.png` under it (git-ignored; `pnpm sample` fills it too). */
export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../.cache/terrarium/', import.meta.url));

/** Most tile requests in flight at once. */
export const MAX_IN_FLIGHT = 4;

/** Longest one tile request may take (response and body), ms. */
export const TILE_TIMEOUT_MS = 20_000;

/** Pause before the one retry, ms. */
export const RETRY_DELAY_MS = 1_000;

/** The part of `fetch` the source uses. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface TileSourceOptions {
  /** URL template with `{z}`, `{x}` and `{y}`; {@link DEFAULT_TILE_TEMPLATE} by default. */
  template?: string;
  /** Cache directory; {@link DEFAULT_CACHE_DIR} by default. */
  cacheDir?: string;
  /** Read only from the cache: a tile it lacks stops the bake (tests, offline re-bakes). */
  offline?: boolean;
  /** The `User-Agent` header. */
  userAgent?: string;
  fetch?: FetchFn;
  maxInFlight?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Writes a verified tile to the cache; {@link writeFileAtomic} by default (tests inject failures). */
  writeFile?: (path: string, bytes: Uint8Array) => void;
  /** Turns PNG bytes into elevations; {@link decodeTerrariumPngBytes} by default. */
  decode?: (png: Uint8Array) => TileElevations;
}

/** What the source did, counted once per distinct tile. */
export interface TileStats {
  /** Tiles downloaded. */
  fetched: number;
  /**
   * Downloaded tiles that could not be written to the cache (read-only or full disk). Their
   * verified elevations are used all the same; the bake warns.
   */
  uncached: number;
  /** Tiles read from the on-disk cache. */
  cached: number;
  /**
   * Tiles that do not exist upstream (a 404), filled from their neighbours: the only way a tile can
   * be filled. Counted once per tile across both of a bake's grids.
   */
  missing: number;
  /** HTTP requests made, retries included. */
  requests: number;
}

export interface TileSource {
  readonly fetchTile: (
    coord: TileCoord,
    options?: { signal?: AbortSignal },
  ) => Promise<TileElevations>;
  /** Aborted, with the {@link BakeError} as reason, when a tile answer stops the bake. */
  readonly signal: AbortSignal;
  readonly stats: Readonly<TileStats>;
}

/**
 * Checks a `--tiles` template: an http(s) URL with `{z}`, `{x}` and `{y}`.
 *
 * @throws BakeError otherwise (without echoing the template).
 */
export function checkTemplate(template: string): void {
  for (const key of ['{z}', '{x}', '{y}']) {
    if (!template.includes(key)) throw new BakeError(`The tile URL template has no ${key}.`);
  }
  let url: URL;
  try {
    url = new URL(fillTemplate(template, { z: 0, x: 0, y: 0 }));
  } catch {
    throw new BakeError('The tile URL template is not a URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BakeError('The tile URL template must be an http or https URL.');
  }
}

function fillTemplate(template: string, { z, x, y }: TileCoord): string {
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));
}

/** Path of a tile in the cache. */
export function cachePath(cacheDir: string, { z, x, y }: TileCoord): string {
  return join(cacheDir, String(z), String(x), `${String(y)}.png`);
}

/** The bare media type of a `Content-Type` (`text/html`), for an error message. */
function mediaType(contentType: string | null): string {
  return /^[\w.+-]+\/[\w.+-]+/.exec(contentType ?? '')?.[0] ?? 'text';
}

/** The one failure `buildHeightfield` may fill: the tile does not exist upstream (HTTP 404). */
class UpstreamMissing extends TileHttpError {
  constructor(coord: TileCoord) {
    super(coord, 404);
    this.name = 'UpstreamMissing';
  }
}

/** A failure worth one retry: 5xx, 429, a network error, a timeout. */
class TransientTileError extends Error {
  override name = 'TransientTileError';
}

/** A counting semaphore: at most `limit` holders at once. */
function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

function packageVersion(): string {
  try {
    const url = new URL('../../package.json', import.meta.url);
    const { version } = JSON.parse(readFileSync(url, 'utf8')) as { version?: unknown };
    return typeof version === 'string' ? version : '0';
  } catch {
    return '0';
  }
}

/** `vert-bake/<package version> (offline scene bake)`. */
export const USER_AGENT = `vert-bake/${packageVersion()} (offline scene bake)`;

/** A tile source for `buildHeightfield` (see the module comment for what each answer does). */
export function createTileSource({
  template = DEFAULT_TILE_TEMPLATE,
  cacheDir = DEFAULT_CACHE_DIR,
  offline = false,
  userAgent = USER_AGENT,
  fetch: fetchImpl = (url, init) => fetch(url, init),
  maxInFlight = MAX_IN_FLIGHT,
  timeoutMs = TILE_TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
  writeFile = writeFileAtomic,
  decode = decodeTerrariumPngBytes,
}: TileSourceOptions = {}): TileSource {
  checkTemplate(template);
  const stats: TileStats = { fetched: 0, uncached: 0, cached: 0, missing: 0, requests: 0 };
  const stop = new AbortController();
  const slot = limiter(Math.max(1, maxInFlight));
  /** One promise per distinct tile, so both grids of a bake share every tile and every count. */
  const tiles = new Map<string, Promise<TileElevations>>();

  const fail = (error: BakeError): never => {
    if (!stop.signal.aborted) stop.abort(error);
    throw stop.signal.reason instanceof BakeError ? stop.signal.reason : error;
  };

  /** One HTTP attempt: the tile's PNG bytes, `null` for a 404, or an error. */
  const attempt = async (url: string): Promise<Uint8Array | null> => {
    const limit = new AbortController();
    const onStop = () => {
      limit.abort(stop.signal.reason);
    };
    stop.signal.addEventListener('abort', onStop, { once: true });

    const timer = setTimeout(() => {
      limit.abort(new DOMException('The tile request timed out.', 'TimeoutError'));
    }, timeoutMs);
    try {
      stats.requests++;
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'User-Agent': userAgent, Accept: 'image/png' },
        redirect: 'follow',
        signal: limit.signal,
      });
      const { status } = response;
      if (status === 200) {
        const type = response.headers.get('content-type');
        if (isNotTileType(type)) {
          await response.body?.cancel();
          return fail(
            new BakeError(
              `A tile request was answered with ${mediaType(type)}, not an image: the tile URL ` +
                'serves no tiles. Check --tiles.',
            ),
          );
        }
        return new Uint8Array(await response.arrayBuffer());
      }
      await response.body?.cancel();
      if (status === 404) return null;
      if (status === 400) {
        return fail(
          new BakeError(
            'The tile server rejected a request as malformed (HTTP 400): a bug in the bake, or a ' +
              '--tiles template that builds paths the server does not accept.',
          ),
        );
      }
      if (status === 429 || (status >= 500 && status < 600)) {
        throw new TransientTileError(`HTTP ${String(status)}`);
      }
      return fail(new BakeError(`A tile request failed with HTTP ${String(status)}.`));
    } catch (error) {
      if (error instanceof BakeError || error instanceof TransientTileError) throw error;
      if (stop.signal.aborted) return fail(stop.signal.reason as BakeError);
      if (limit.signal.aborted) {
        throw new TransientTileError(`no answer within ${String(Math.round(timeoutMs / 1000))} s`);
      }
      throw new TransientTileError('network error');
    } finally {
      clearTimeout(timer);
      stop.signal.removeEventListener('abort', onStop);
    }
  };

  /** Downloads, checks and caches a tile; `null` when it does not exist upstream. */
  const download = async (coord: TileCoord): Promise<TileElevations | null> => {
    const url = fillTemplate(template, coord);
    let png: Uint8Array | null = null;
    for (let tries = 0; ; tries++) {
      try {
        png = await slot(() => attempt(url));
        break;
      } catch (error) {
        if (!(error instanceof TransientTileError)) throw error;
        if (tries >= 1) {
          return fail(
            new BakeError(
              `A tile could not be fetched (${error.message}, also on the retry); run the bake ` +
                'again (the tiles already fetched are cached).',
            ),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        if (stop.signal.aborted) return fail(stop.signal.reason as BakeError);
      }
    }
    if (png === null) return null;
    let elevations: TileElevations;
    try {
      elevations = decode(png);
    } catch (error) {
      if (!(error instanceof PngError)) throw error;
      return fail(
        new BakeError(
          `A tile arrived but is not a Terrarium PNG (${error.message}). Check --tiles.`,
        ),
      );
    }
    try {
      writeFile(cachePath(cacheDir, coord), png);
    } catch {
      // The elevations are verified and in memory; the cache only saves a later download. Failing
      // here would make a read-only cache unusable, so the bake uses them and warns.
      stats.uncached++;
    }
    return elevations;
  };

  /** A tile from the cache or the server; rejects with {@link UpstreamMissing} for a 404. */
  const loadUnchecked = async (coord: TileCoord): Promise<TileElevations> => {
    const path = cachePath(cacheDir, coord);
    let bytes: Uint8Array | null = null;
    try {
      bytes = readFileSync(path);
    } catch {
      // Not cached.
    }
    if (bytes) {
      try {
        const elevations = decode(bytes);
        stats.cached++;
        return elevations;
      } catch {
        // A damaged cache entry (written by something else): fetch it again, replacing it.
      }
    }
    if (offline) return fail(new BakeError('A tile the bake needs is not in the cache.'));
    const elevations = await download(coord);
    if (elevations === null) {
      stats.missing++;
      throw new UpstreamMissing(coord);
    }
    stats.fetched++;
    return elevations;
  };

  /**
   * {@link loadUnchecked}, where nothing but a confirmed upstream 404 may reach `buildHeightfield`
   * as a failed tile (which it fills from the neighbours). Anything else (a file system error, a
   * decoder bug, any exception) stops the bake: a filled tile would be invented terrain.
   */
  const load = async (coord: TileCoord): Promise<TileElevations> => {
    try {
      return await loadUnchecked(coord);
    } catch (error) {
      if (error instanceof UpstreamMissing) throw error;
      if (error instanceof BakeError) return fail(error);
      const what = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return fail(
        new BakeError(`A tile could not be loaded (${scrub(what)}).`, {
          cause: error,
        }),
      );
    }
  };

  const fetchTile = (coord: TileCoord): Promise<TileElevations> => {
    if (stop.signal.aborted) return Promise.reject(stop.signal.reason as Error);
    const key = `${String(coord.z)}/${String(coord.x)}/${String(coord.y)}`;
    let promise = tiles.get(key);
    if (!promise) {
      promise = load(coord);
      tiles.set(key, promise);
    }
    return promise;
  };

  return { fetchTile, signal: stop.signal, stats };
}
