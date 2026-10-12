/**
 * Terrarium elevation tiles: URL, fetch, decode, cache.
 *
 * Privacy: a tile request is a same-origin GET of `/tiles/{z}/{x}/{y}.png` and nothing else. No
 * query string, no credentials, no referrer. Production serves the path from the Worker; dev and
 * preview proxy it to the AWS bucket (vite.config.ts).
 */
import { TERRARIUM_MAX_ZOOM, type TileCoord } from '../lib/geo';
import { decodeTerrariumImage } from '../lib/terrarium';

/** Terrarium tiles are 256 × 256 pixels. */
export const TILE_SIZE = 256;

/** Elevations of one tile in metres, row-major from the north-west pixel, TILE_SIZE² values. */
export type TileElevations = Float32Array;

/** Turns a fetched PNG's bytes into elevations. Injectable so tests need no canvas. */
export type TileDecoder = (png: ArrayBuffer) => Promise<TileElevations>;

/**
 * The part of `fetch` the loader uses; `window.fetch` fits. The body is read with
 * `arrayBuffer()`, never `blob()`: Chromium can back a response blob with a file, and with the
 * disk nearly full every `blob()` failed while `arrayBuffer()` still worked.
 */
export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'arrayBuffer'>>;

export interface FetchTileOptions {
  signal?: AbortSignal;
  /** Replaces `fetch` for a request this call starts (a cached or in-flight tile is reused). */
  fetchImpl?: FetchLike;
  /** Replaces the PNG decoder for a request this call starts. */
  decode?: TileDecoder;
}

/** A tile request that got an HTTP error (e.g. 404 where the bucket has no tile). */
export class TileHttpError extends Error {
  readonly status: number;
  constructor(coord: TileCoord, status: number) {
    super(`Tile ${tileKey(coord)} failed with HTTP ${String(status)}`);
    this.name = 'TileHttpError';
    this.status = status;
  }
}

/**
 * A tile arrived but could not be turned into elevations (the image would not decode, no 2D
 * canvas, wrong size): a problem in this browser, not the network, so it is not retried.
 */
export class TileDecodeError extends Error {
  constructor(coord: TileCoord, cause: unknown) {
    super(`Tile ${tileKey(coord)} could not be decoded`, { cause });
    this.name = 'TileDecodeError';
  }
}

/** `z/x/y`, the cache key. */
export function tileKey({ z, x, y }: TileCoord): string {
  return `${String(z)}/${String(x)}/${String(y)}`;
}

/**
 * Same-origin URL of a tile: `${BASE_URL}tiles/{z}/{x}/{y}.png`.
 *
 * @throws RangeError for a tile that does not exist, so nothing but a valid z/x/y reaches the URL.
 */
export function tileUrl(coord: TileCoord): string {
  const { z, x, y } = coord;
  const size = 2 ** z;
  const valid =
    Number.isInteger(z) &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    z >= 0 &&
    z <= TERRARIUM_MAX_ZOOM &&
    x >= 0 &&
    x < size &&
    y >= 0 &&
    y < size;
  if (!valid) throw new RangeError(`No Terrarium tile at ${tileKey(coord)}`);
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}tiles/${tileKey(coord)}.png`;
}

/** True for the error `fetch` and {@link fetchTile} reject with when aborted. */
export function isAbortError(error: unknown): boolean {
  // Not `instanceof Error`: DOMException is not an Error subclass in every realm.
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Default decoder: `createImageBitmap` with colour-space conversion and premultiplication off, so
 * the RGB bytes reach `getImageData` exactly as stored, then {@link decodeTerrariumImage}. The
 * bytes go in through a small in-memory `Blob` made here, not the response's own blob.
 */
export async function decodeTerrariumPng(png: ArrayBuffer): Promise<TileElevations> {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    const { width, height } = bitmap;
    const context =
      typeof OffscreenCanvas === 'undefined'
        ? Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', {
            willReadFrequently: true,
          })
        : new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No 2D canvas context to decode tiles');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
    return decodeTerrariumImage(data, width, height);
  } finally {
    bitmap.close();
  }
}

interface InFlight {
  promise: Promise<TileElevations>;
  controller: AbortController;
  waiters: number;
}

export interface TileLoaderOptions {
  /** Decoded tiles kept in memory, least recently used evicted first. */
  capacity?: number;
  fetchImpl?: FetchLike;
  decode?: TileDecoder;
}

/**
 * Fetches and decodes tiles with an LRU cache and request sharing: concurrent calls for one tile
 * share one request, which is aborted only when every caller has aborted. A network error (or a
 * 5xx) is retried once; an HTTP 4xx is not, nor a {@link TileDecodeError}.
 */
export class TileLoader {
  readonly capacity: number;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly decode: TileDecoder;
  private readonly cache = new Map<string, TileElevations>();
  private readonly inFlight = new Map<string, InFlight>();

  constructor({ capacity = 64, fetchImpl, decode = decodeTerrariumPng }: TileLoaderOptions = {}) {
    this.capacity = capacity;
    this.fetchImpl = fetchImpl;
    this.decode = decode;
  }

  /** Number of cached tiles. */
  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  async load(coord: TileCoord, options: FetchTileOptions = {}): Promise<TileElevations> {
    const { signal } = options;
    const url = tileUrl(coord);
    if (signal?.aborted) throw abortReason(signal);
    const key = tileKey(coord);

    const cached = this.cache.get(key);
    if (cached) {
      // Re-insert to mark as most recently used.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    let entry = this.inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const fetchImpl = options.fetchImpl ?? this.fetchImpl ?? ((u, init) => fetch(u, init));
      const decode = options.decode ?? this.decode;
      const promise = this.request(coord, url, controller.signal, fetchImpl, decode).finally(() => {
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
      });
      entry = { promise, controller, waiters: 0 };
      this.inFlight.set(key, entry);
      promise.then(
        (elevations) => {
          this.remember(key, elevations);
        },
        () => undefined,
      );
    }
    return this.wait(key, entry, signal);
  }

  private wait(
    key: string,
    entry: InFlight,
    signal: AbortSignal | undefined,
  ): Promise<TileElevations> {
    entry.waiters++;
    if (!signal) return entry.promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.waiters--;
        if (entry.waiters === 0) {
          // Nobody wants it any more: cancel, and let the next caller start afresh.
          if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
          entry.controller.abort(abortReason(signal));
        }
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private async request(
    coord: TileCoord,
    url: string,
    signal: AbortSignal,
    fetchImpl: FetchLike,
    decode: TileDecoder,
  ): Promise<TileElevations> {
    const init: RequestInit = {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'force-cache',
      signal,
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImpl(url, init);
        if (!response.ok) throw new TileHttpError(coord, response.status);
        // Reading the body can still fail on the network (a TypeError, retried below).
        const png = await response.arrayBuffer();
        let elevations: TileElevations;
        try {
          elevations = await decode(png);
        } catch (error) {
          if (signal.aborted || isAbortError(error)) throw error;
          throw new TileDecodeError(coord, error);
        }
        if (elevations.length !== TILE_SIZE * TILE_SIZE) {
          const size = new RangeError(`Tile ${tileKey(coord)} is not ${String(TILE_SIZE)}² pixels`);
          throw new TileDecodeError(coord, size);
        }
        return elevations;
      } catch (error) {
        if (signal.aborted) throw abortReason(signal);
        const retryable =
          error instanceof TypeError ||
          (error instanceof TileHttpError && error.status >= 500 && error.status < 600);
        if (!retryable || attempt >= 1) throw error;
      }
    }
  }

  private remember(key: string, elevations: TileElevations): void {
    this.cache.set(key, elevations);
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

/** The app-wide loader behind {@link fetchTile}. */
export const tileLoader = new TileLoader();

/**
 * Elevations of one tile in metres (TILE_SIZE² values), from the shared cache when possible.
 * Rejects with an AbortError when `signal` aborts and a {@link TileHttpError} on HTTP errors.
 */
export function fetchTile(coord: TileCoord, options?: FetchTileOptions): Promise<TileElevations> {
  return tileLoader.load(coord, options);
}
