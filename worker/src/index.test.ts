// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { MAX_ZOOM, MIN_ZOOM, parseTilePath, r2Key, upstreamUrl } from './tiles';

describe('parseTilePath', () => {
  it('reads z, x and y', () => {
    expect(parseTilePath('/tiles/12/655/1582.png')).toEqual({ z: 12, x: 655, y: 1582 });
  });

  it(`accepts the edges of the served range, z ${String(MIN_ZOOM)} and z ${String(MAX_ZOOM)}`, () => {
    expect(parseTilePath('/tiles/6/63/63.png')).toEqual({ z: 6, x: 63, y: 63 });
    expect(parseTilePath('/tiles/15/32767/0.png')).toEqual({ z: 15, x: 32767, y: 0 });
  });

  it.each([
    ['/tiles/16/0/0.png', 'zoom above 15'],
    ['/tiles/5/0/0.png', 'zoom below 6'],
    ['/tiles/0/0/0.png', 'zoom 0'],
    ['/tiles/6/64/0.png', 'x outside the zoom level'],
    ['/tiles/6/0/64.png', 'y outside the zoom level'],
    ['/tiles/12/0/0.jpg', 'wrong extension'],
    ['/tiles/12/0.png', 'missing a coordinate'],
    ['/tiles/12/0/0/0.png', 'an extra segment'],
    ['/tiles/-1/0/0.png', 'negative zoom'],
    ['/tiles/12/0x1/0.png', 'not a decimal number'],
  ])('rejects %s (%s)', (path) => {
    expect(parseTilePath(path)).toBeNull();
  });
});

describe('tile addressing', () => {
  it('keys R2 and builds the upstream URL from z/x/y alone', () => {
    const tile = { z: 12, x: 655, y: 1582 };
    expect(r2Key(tile)).toBe('terrarium/12/655/1582.png');
    expect(upstreamUrl(tile)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/655/1582.png',
    );
  });
});

describe('worker entry point', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports only the default handler, since workerd treats named exports as entrypoints', async () => {
    expect(Object.keys(await import('./index'))).toEqual(['default']);
  });

  it('routes requests to the tile proxy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('https://vert.test/tiles/16/0/0.png');
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} };
    const response = await worker.fetch(
      request as Request<unknown, IncomingRequestCfProperties>,
      {} as Env,
      ctx as unknown as ExecutionContext,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
