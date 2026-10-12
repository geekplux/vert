import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TILE_SIZE,
  TileDecodeError,
  TileHttpError,
  TileLoader,
  fetchTile,
  isAbortError,
  tileLoader,
  tileUrl,
  type FetchLike,
  type TileDecoder,
} from './tiles';

const COORD = { z: 12, x: 1088, y: 1641 };

const ok = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });
const status = (code: number) =>
  Promise.resolve({
    ok: false,
    status: code,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });

/** A decoder that skips the canvas and returns a flat tile. */
const flat: TileDecoder = () => Promise.resolve(new Float32Array(TILE_SIZE * TILE_SIZE).fill(42));

/** A fetch mock whose responses resolve only when the test says so. */
function deferredFetch() {
  const pending: { url: string; init: RequestInit; resolve: () => void }[] = [];
  const fetchImpl = vi.fn<FetchLike>(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        pending.push({
          url,
          init,
          resolve: () => {
            resolve(ok());
          },
        });
      }),
  );
  return { fetchImpl, pending };
}

describe('tileUrl', () => {
  it('is a same-origin path with z/x/y and nothing else', () => {
    const url = tileUrl(COORD);
    expect(url).toBe('/tiles/12/1088/1641.png');
    expect(url).toMatch(/^\/tiles\/\d+\/\d+\/\d+\.png$/);
    expect(url).not.toContain('?');
    expect(url).not.toContain('#');
  });

  it('rejects tiles that do not exist rather than putting other values in the URL', () => {
    expect(() => tileUrl({ z: 16, x: 0, y: 0 })).toThrow(RangeError);
    expect(() => tileUrl({ z: 2, x: 4, y: 0 })).toThrow(RangeError);
    expect(() => tileUrl({ z: 2, x: 1.5, y: 0 })).toThrow(RangeError);
    expect(() => tileUrl({ z: 2, x: -1, y: 0 })).toThrow(RangeError);
    expect(() => tileUrl({ z: Number.NaN, x: 0, y: 0 })).toThrow(RangeError);
  });
});

describe('TileLoader', () => {
  it('fetches without credentials or referrer, from the HTTP cache when possible', async () => {
    const fetchImpl = vi.fn<FetchLike>(ok);
    const loader = new TileLoader({ fetchImpl, decode: flat });
    const tile = await loader.load(COORD);
    expect(tile).toHaveLength(TILE_SIZE * TILE_SIZE);
    expect(tile[0]).toBe(42);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('/tiles/12/1088/1641.png');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'force-cache',
    });
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it('serves repeat requests from memory', async () => {
    const fetchImpl = vi.fn<FetchLike>(ok);
    const loader = new TileLoader({ fetchImpl, decode: flat });
    const a = await loader.load(COORD);
    const b = await loader.load(COORD);
    expect(b).toBe(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(loader.size).toBe(1);
  });

  it('evicts the least recently used tile past its capacity', async () => {
    const fetchImpl = vi.fn<FetchLike>(ok);
    const loader = new TileLoader({ capacity: 2, fetchImpl, decode: flat });
    const a = { z: 1, x: 0, y: 0 };
    const b = { z: 1, x: 1, y: 0 };
    const c = { z: 1, x: 0, y: 1 };
    await loader.load(a);
    await loader.load(b);
    await loader.load(a); // a is now the most recent
    await loader.load(c); // evicts b
    expect(loader.size).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await loader.load(a);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await loader.load(b);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('shares one request between concurrent callers', async () => {
    const { fetchImpl, pending } = deferredFetch();
    const loader = new TileLoader({ fetchImpl, decode: flat });
    const a = loader.load(COORD);
    const b = loader.load(COORD);
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    pending[0]?.resolve();
    const [ta, tb] = await Promise.all([a, b]);
    expect(ta).toBe(tb);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an aborted caller with AbortError but keeps the request for the others', async () => {
    const { fetchImpl, pending } = deferredFetch();
    const loader = new TileLoader({ fetchImpl, decode: flat });
    const controller = new AbortController();
    const a = loader.load(COORD, { signal: controller.signal });
    const b = loader.load(COORD, { signal: new AbortController().signal });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    controller.abort();
    await expect(a).rejects.toSatisfy(isAbortError);
    expect(pending[0]?.init.signal?.aborted).toBe(false);
    pending[0]?.resolve();
    await expect(b).resolves.toHaveLength(TILE_SIZE * TILE_SIZE);
  });

  it('aborts the request once every caller has aborted, and does not cache it', async () => {
    const { fetchImpl, pending } = deferredFetch();
    const loader = new TileLoader({ fetchImpl, decode: flat });
    const one = new AbortController();
    const two = new AbortController();
    const a = loader.load(COORD, { signal: one.signal });
    const b = loader.load(COORD, { signal: two.signal });
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    one.abort();
    two.abort();
    await expect(a).rejects.toSatisfy(isAbortError);
    await expect(b).rejects.toSatisfy(isAbortError);
    expect(pending[0]?.init.signal?.aborted).toBe(true);
    expect(loader.size).toBe(0);

    // A later caller starts a fresh request.
    const c = loader.load(COORD);
    await vi.waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    pending[1]?.resolve();
    await expect(c).resolves.toHaveLength(TILE_SIZE * TILE_SIZE);
  });

  it('rejects at once for an already aborted signal without fetching', async () => {
    const fetchImpl = vi.fn<FetchLike>(ok);
    const loader = new TileLoader({ fetchImpl, decode: flat });
    await expect(loader.load(COORD, { signal: AbortSignal.abort() })).rejects.toSatisfy(
      isAbortError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries a network error once', async () => {
    const fetchImpl = vi
      .fn<FetchLike>(ok)
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    const loader = new TileLoader({ fetchImpl, decode: flat });
    await expect(loader.load(COORD)).resolves.toHaveLength(TILE_SIZE * TILE_SIZE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry fails', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.reject(new TypeError('Failed to fetch')));
    const loader = new TileLoader({ fetchImpl, decode: flat });
    await expect(loader.load(COORD)).rejects.toThrow(TypeError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(loader.size).toBe(0);
  });

  it('does not retry a 404', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => status(404));
    const loader = new TileLoader({ fetchImpl, decode: flat });
    const error: unknown = await loader.load(COORD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TileHttpError);
    expect((error as TileHttpError).status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a decoded tile of the wrong size as a decode error', async () => {
    const loader = new TileLoader({
      fetchImpl: ok,
      decode: () => Promise.resolve(new Float32Array(10)),
    });
    const error: unknown = await loader.load(COORD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TileDecodeError);
    expect((error as Error).cause).toBeInstanceOf(RangeError);
  });

  it('reads the body with arrayBuffer(), never blob(), and decodes those bytes', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const blob = vi.fn(() => Promise.reject(new TypeError('blob storage full')));
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes), blob }),
    );
    const decode = vi.fn<TileDecoder>(flat);
    await new TileLoader({ fetchImpl, decode }).load(COORD);
    expect(decode).toHaveBeenCalledWith(bytes);
    expect(blob).not.toHaveBeenCalled();
  });

  it('wraps a decoder failure in TileDecodeError and does not retry it', async () => {
    const fetchImpl = vi.fn<FetchLike>(ok);
    const cause = new DOMException('The source image could not be decoded.', 'InvalidStateError');
    const loader = new TileLoader({ fetchImpl, decode: () => Promise.reject(cause) });
    const error: unknown = await loader.load(COORD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TileDecodeError);
    expect((error as Error).cause).toBe(cause);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('still retries a body that fails to arrive (a network error, not a decode error)', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          calls++ === 0
            ? Promise.reject(new TypeError('network error'))
            : Promise.resolve(new ArrayBuffer(0)),
      }),
    );
    await expect(new TileLoader({ fetchImpl, decode: flat }).load(COORD)).resolves.toHaveLength(
      TILE_SIZE * TILE_SIZE,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('fetchTile', () => {
  beforeEach(() => {
    tileLoader.clear();
  });

  it('uses the shared loader with an injected fetch and decoder', async () => {
    const fetchImpl = vi.fn<FetchLike>(ok);
    await fetchTile(COORD, { fetchImpl, decode: flat });
    await fetchTile(COORD, { fetchImpl, decode: flat });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/tiles/12/1088/1641.png');
  });
});
