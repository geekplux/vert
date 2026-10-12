// @vitest-environment node
import { describe, expect, it } from 'vitest';
import worker from './index';
import { parseTilePath } from './tiles';

async function get(path: string, method = 'GET') {
  const request = new Request(`https://vert.test${path}`, { method });
  const response = worker.fetch(request as Request<unknown, IncomingRequestCfProperties>);
  return { response, body: await response.json<Record<string, unknown>>() };
}

describe('parseTilePath', () => {
  it('reads z, x and y', () => {
    expect(parseTilePath('/tiles/12/655/1582.png')).toEqual({ z: 12, x: 655, y: 1582 });
  });

  it.each([
    ['/tiles/16/0/0.png', 'zoom above 15'],
    ['/tiles/2/4/0.png', 'x outside the zoom level'],
    ['/tiles/2/0/4.png', 'y outside the zoom level'],
    ['/tiles/1/0/0.jpg', 'wrong extension'],
    ['/tiles/1/0.png', 'missing a coordinate'],
    ['/tiles/-1/0/0.png', 'negative zoom'],
  ])('rejects %s (%s)', (path) => {
    expect(parseTilePath(path)).toBeNull();
  });
});

describe('worker', () => {
  it('exports only the default handler, since workerd treats named exports as entrypoints', async () => {
    expect(Object.keys(await import('./index'))).toEqual(['default']);
  });

  it('answers a valid tile request with 501 and the tile it parsed', async () => {
    const { response, body } = await get('/tiles/12/655/1582.png');
    expect(response.status).toBe(501);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body).toMatchObject({ error: 'not_implemented', tile: { z: 12, x: 655, y: 1582 } });
  });

  it('rejects tiles that do not exist with 400', async () => {
    const { response, body } = await get('/tiles/3/8/0.png');
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_tile');
  });

  it('allows only GET and HEAD', async () => {
    const { response } = await get('/tiles/1/0/0.png', 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
  });

  it('returns 404 outside /tiles/', async () => {
    const { response } = await get('/');
    expect(response.status).toBe(404);
  });
});
