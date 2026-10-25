// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  etagMatches,
  handleRequest,
  LIMIT_PERIOD_S,
  NOT_FOUND_CACHE_CONTROL,
  type ProxyEnv,
  TILE_CACHE_CONTROL,
  USER_AGENT,
} from './proxy';

const TILE_PATH = '/tiles/12/655/1582.png';
const KEY = 'terrarium/12/655/1582.png';
const UPSTREAM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/655/1582.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const UPSTREAM_ETAG = '"10811502889f17b94352a31e4795ec3f"';

interface Stored {
  bytes: Uint8Array;
  etag: string;
  contentType: string | undefined;
}

/** The slice of R2Bucket the proxy uses, backed by a Map. */
class FakeR2 {
  readonly objects = new Map<string, Stored>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];
  failGets = false;

  seed(key: string, bytes: Uint8Array, etag = '"r2-etag"') {
    this.objects.set(key, { bytes, etag, contentType: 'image/png' });
  }

  get(key: string, options?: { onlyIf?: Headers }) {
    this.gets.push(key);
    if (this.failGets) return Promise.reject(new Error('R2 unavailable'));
    const stored = this.objects.get(key);
    if (!stored) return Promise.resolve(null);
    const meta = { key, size: stored.bytes.byteLength, httpEtag: stored.etag };
    if (etagMatches(options?.onlyIf?.get('If-None-Match') ?? null, stored.etag)) {
      return Promise.resolve(meta);
    }
    return Promise.resolve({ ...meta, body: new Response(stored.bytes).body });
  }

  async put(key: string, value: ReadableStream, options?: { httpMetadata?: R2HTTPMetadata }) {
    this.puts.push(key);
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, {
      bytes,
      etag: '"stored"',
      contentType: options?.httpMetadata?.contentType,
    });
    return { key };
  }
}

/** The slice of `caches.default` the proxy uses. */
class FakeCache {
  readonly entries = new Map<string, { status: number; headers: Headers; bytes: ArrayBuffer }>();

  async put(request: Request, response: Response) {
    this.entries.set(request.url, {
      status: response.status,
      headers: new Headers(response.headers),
      bytes: await response.arrayBuffer(),
    });
  }

  match(request: Request) {
    const entry = this.entries.get(request.url);
    return Promise.resolve(
      entry
        ? new Response(entry.bytes, { status: entry.status, headers: entry.headers })
        : undefined,
    );
  }
}

let r2: FakeR2;
let pending: Promise<unknown>[];
let fetchMock: ReturnType<typeof vi.fn>;
let limits: Pick<ProxyEnv, 'TILE_LIMIT' | 'STORE_LIMIT'>;

function env(): ProxyEnv {
  return { TILES: r2 as unknown as R2Bucket, ...limits };
}

/** A rate limiter that allows `allowed` calls per key, recording the keys it saw. */
function fakeLimit(allowed: number) {
  const seen: string[] = [];
  const limiter = {
    seen,
    limit: ({ key }: { key: string }) => {
      seen.push(key);
      return Promise.resolve({ success: seen.filter((k) => k === key).length <= allowed });
    },
  };
  return limiter as typeof limiter & RateLimit;
}

function ctx(): ExecutionContext {
  const context = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => undefined,
    props: {},
  };
  return context as unknown as ExecutionContext;
}

/** Waits for everything handed to ctx.waitUntil, as the runtime would after the response. */
async function settle() {
  while (pending.length > 0) {
    const batch = pending.splice(0);
    await Promise.all(batch);
  }
}

function request(path: string, init?: RequestInit) {
  return handleRequest(new Request(`https://vert.test${path}`, init), env(), ctx());
}

function upstreamPng() {
  return new Response(PNG, {
    status: 200,
    headers: { 'Content-Type': 'image/png', ETag: UPSTREAM_ETAG, 'Set-Cookie': 'aws=1' },
  });
}

async function bytes(response: Response) {
  return new Uint8Array(await response.arrayBuffer());
}

beforeEach(() => {
  r2 = new FakeR2();
  limits = {};
  pending = [];
  fetchMock = vi.fn(() => Promise.resolve(upstreamPng()));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('etagMatches', () => {
  it.each([
    ['"a"', '"a"', true],
    ['W/"a"', '"a"', true],
    ['"b", "a"', '"a"', true],
    ['*', '"a"', true],
    ['"b"', '"a"', false],
    [null, '"a"', false],
    ['"a"', null, false],
  ])('If-None-Match %s against %s → %s', (header, etag, expected) => {
    expect(etagMatches(header, etag)).toBe(expected);
  });
});

describe('R2 hit', () => {
  beforeEach(() => {
    r2.seed(KEY, PNG, '"r2-etag"');
  });

  it('streams the stored tile with immutable caching and its ETag, without going upstream', async () => {
    const response = await request(TILE_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe(TILE_CACHE_CONTROL);
    expect(response.headers.get('ETag')).toBe('"r2-etag"');
    expect(response.headers.get('X-Tile-Source')).toBe('r2');
    expect(await bytes(response)).toEqual(PNG);
    expect(r2.gets).toEqual([KEY]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 304 with no body when If-None-Match matches', async () => {
    const response = await request(TILE_PATH, { headers: { 'If-None-Match': 'W/"r2-etag"' } });
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get('ETag')).toBe('"r2-etag"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the full tile when If-None-Match names another version', async () => {
    const response = await request(TILE_PATH, { headers: { 'If-None-Match': '"old"' } });
    expect(response.status).toBe(200);
    expect(await bytes(response)).toEqual(PNG);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await request(TILE_PATH, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('ETag')).toBe('"r2-etag"');
  });
});

describe('miss', () => {
  it('fetches the tile upstream once, with only z/x/y in the URL and none of the client headers', async () => {
    const response = await request(TILE_PATH, {
      headers: {
        Cookie: 'session=secret',
        Referer: 'https://vert.test/?route=abc',
        'User-Agent': 'Client/1.0',
        'X-Forwarded-For': '203.0.113.7',
        Authorization: 'Bearer token',
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Tile-Source')).toBe('upstream');
    expect(response.headers.get('ETag')).toBe(UPSTREAM_ETAG);
    expect(response.headers.get('Cache-Control')).toBe(TILE_CACHE_CONTROL);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await bytes(response)).toEqual(PNG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(UPSTREAM);
    const sent = new Headers(init.headers);
    expect([...sent.keys()].sort()).toEqual(['accept', 'user-agent']);
    expect(sent.get('User-Agent')).toBe(USER_AGENT);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('stores the upstream tile in R2 through waitUntil', async () => {
    const response = await request(TILE_PATH);
    expect(pending).toHaveLength(1);
    await bytes(response);
    await settle();
    expect(r2.puts).toEqual([KEY]);
    expect(r2.objects.get(KEY)).toMatchObject({ bytes: PNG, contentType: 'image/png' });

    const second = await request(TILE_PATH);
    expect(second.headers.get('X-Tile-Source')).toBe('r2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still stores the tile for HEAD, answering with headers only', async () => {
    const response = await request(TILE_PATH, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    await settle();
    expect(r2.objects.get(KEY)?.bytes).toEqual(PNG);
  });

  it('answers 304 when the client already holds the upstream version', async () => {
    const response = await request(TILE_PATH, { headers: { 'If-None-Match': UPSTREAM_ETAG } });
    expect(response.status).toBe(304);
    await settle();
    expect(r2.puts).toEqual([KEY]);
  });

  it('fetches twice for two concurrent misses of one tile, and R2 ends up with the tile', async () => {
    // Accepted: tiles are immutable, so both writes are identical. No lock.
    const [a, b] = await Promise.all([request(TILE_PATH), request(TILE_PATH)]);
    expect(await bytes(a)).toEqual(PNG);
    expect(await bytes(b)).toEqual(PNG);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r2.puts).toEqual([KEY, KEY]);
    expect(r2.objects.get(KEY)?.bytes).toEqual(PNG);
  });

  it('goes upstream when R2 fails', async () => {
    r2.failGets = true;
    const response = await request(TILE_PATH);
    expect(response.status).toBe(200);
    expect(await bytes(response)).toEqual(PNG);
  });
});

describe('upstream errors', () => {
  it('turns an upstream 404 into a JSON 404 cached for an hour, not stored in R2', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<Error><Code>NoSuchKey</Code></Error>', {
        status: 404,
        headers: { 'Content-Type': 'application/xml' },
      }),
    );
    const response = await request(TILE_PATH);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe(NOT_FOUND_CACHE_CONTROL);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ error: 'tile_not_found' });
    await settle();
    expect(r2.puts).toEqual([]);
  });

  it.each([500, 503, 403, 301])('turns upstream %i into an uncached 502', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status }));
    const response = await request(TILE_PATH);
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: 'upstream_error',
      upstreamStatus: status,
    });
    await settle();
    expect(r2.puts).toEqual([]);
  });

  it('turns a 200 that is not a PNG into a 502 and stores nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const response = await request(TILE_PATH);
    expect(response.status).toBe(502);
    await settle();
    expect(r2.puts).toEqual([]);
  });

  it('turns a network failure into an uncached 502', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const response = await request(TILE_PATH);
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: 'upstream_unavailable' });
  });
});

describe('rejected requests', () => {
  it.each([
    ['/tiles/12/655/1582.png?v=1', 'query_not_allowed'],
    ['/tiles/12/655/1582.png?', 'query_not_allowed'],
    ['/tiles/12/655/1582.png?lat=46.1&lon=7.2', 'query_not_allowed'],
    ['/tiles/16/0/0.png', 'invalid_tile'],
    ['/tiles/5/0/0.png', 'invalid_tile'],
    ['/tiles/12/4096/0.png', 'invalid_tile'],
    ['/tiles/12/0/4096.png', 'invalid_tile'],
    ['/tiles/12/0/0.webp', 'invalid_tile'],
    ['/tiles/', 'invalid_tile'],
  ])('%s → 400 %s, touching neither R2 nor upstream', async (path, error) => {
    const response = await request(path);
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error });
    expect(r2.gets).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('%s → 405 with Allow', async (method) => {
    const response = await request(TILE_PATH, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 outside /tiles/', async () => {
    for (const path of ['/', '/index.html', '/tiles', '/api/x']) {
      const response = await request(path);
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('edge cache in front of R2', () => {
  let cache: FakeCache;

  beforeEach(() => {
    cache = new FakeCache();
    vi.stubGlobal('caches', { default: cache });
  });

  it('fills the edge cache from an R2 hit, then serves from it without touching R2', async () => {
    r2.seed(KEY, PNG, '"r2-etag"');
    const first = await request(TILE_PATH);
    expect(await bytes(first)).toEqual(PNG);
    await settle();
    expect(cache.entries.has(`https://vert.test${TILE_PATH}`)).toBe(true);

    const second = await request(TILE_PATH);
    expect(second.headers.get('X-Tile-Source')).toBe('edge');
    expect(second.headers.get('ETag')).toBe('"r2-etag"');
    expect(second.headers.get('Cache-Control')).toBe(TILE_CACHE_CONTROL);
    expect(await bytes(second)).toEqual(PNG);
    expect(r2.gets).toEqual([KEY]);

    const conditional = await request(TILE_PATH, { headers: { 'If-None-Match': '"r2-etag"' } });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('X-Tile-Source')).toBe('edge');
  });

  it('keys the edge cache on the canonical path, never on client headers', async () => {
    r2.seed(KEY, PNG);
    await bytes(await request(TILE_PATH, { headers: { Cookie: 'a=1' } }));
    await settle();
    expect([...cache.entries.keys()]).toEqual([`https://vert.test${TILE_PATH}`]);
  });

  it('caches an upstream 404 at the edge so a repeat does not go upstream', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect((await request(TILE_PATH)).status).toBe(404);
    await settle();
    const repeat = await request(TILE_PATH);
    expect(repeat.status).toBe(404);
    expect(repeat.headers.get('X-Tile-Source')).toBe('edge');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache upstream 5xx at the edge', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await request(TILE_PATH)).status).toBe(502);
    await settle();
    expect(cache.entries.size).toBe(0);
    expect((await request(TILE_PATH)).status).toBe(200);
  });
});

describe('abuse limits', () => {
  it('answers 429 with Retry-After once a client IP passes TILE_LIMIT, before any lookup', async () => {
    const tileLimit = fakeLimit(1);
    limits = { TILE_LIMIT: tileLimit };
    const headers = { 'CF-Connecting-IP': '203.0.113.7' };
    expect((await request(TILE_PATH, { headers })).status).toBe(200);
    await settle();
    const gets = r2.gets.length;
    const limited = await request(TILE_PATH, { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe(String(LIMIT_PERIOD_S));
    expect(r2.gets).toHaveLength(gets);
    expect(tileLimit.seen).toEqual(['203.0.113.7', '203.0.113.7']);
  });

  it('past STORE_LIMIT streams a new tile from upstream without writing R2', async () => {
    const storeLimit = fakeLimit(0);
    limits = { STORE_LIMIT: storeLimit };
    const response = await request(TILE_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Tile-Source')).toBe('upstream');
    expect(await bytes(response)).toEqual(PNG);
    await settle();
    expect(r2.puts).toEqual([]);
    expect(storeLimit.seen).toEqual(['r2-writes']);
  });

  it('counts R2 writes, not R2 hits, against STORE_LIMIT', async () => {
    r2.seed(KEY, PNG);
    const storeLimit = fakeLimit(0);
    limits = { STORE_LIMIT: storeLimit };
    expect((await request(TILE_PATH)).headers.get('X-Tile-Source')).toBe('r2');
    expect(storeLimit.seen).toEqual([]);
  });
});
