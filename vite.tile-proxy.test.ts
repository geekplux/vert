import { describe, expect, it } from 'vitest';
import { TILE_PROXY_PATTERN, tileProxy } from './vite.tile-proxy.ts';

// Vite treats a proxy key that starts with `^` as a RegExp and tests it against the request URL
// (path and query string).
const proxied = (url: string) => new RegExp(TILE_PROXY_PATTERN).test(url);

describe('dev tile proxy', () => {
  it('is keyed by the exported pattern', () => {
    expect(Object.keys(tileProxy)).toEqual([TILE_PROXY_PATTERN]);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 6))('proxies zoom %i', (z) => {
    expect(proxied(`/tiles/${String(z)}/0/0.png`)).toBe(true);
  });

  it('proxies real tile addresses', () => {
    expect(proxied('/tiles/12/1093/1625.png')).toBe(true);
    expect(proxied('/tiles/15/8749/13005.png')).toBe(true);
  });

  // Only the Worker's range (z6–15), so dev fails where production would.
  it.each(['0', '2', '5', '16', '19', '99', '00', '07', '150', '-1'])(
    'does not proxy zoom %s',
    (z) => {
      expect(proxied(`/tiles/${z}/0/0.png`)).toBe(false);
    },
  );

  it.each([
    '/tiles/12/1093/1625.png?lat=34.7',
    '/tiles/12/1093/1625.png/extra',
    '/tiles/12/1093/1625.jpg',
    '/tiles/12/1093.png',
    '/tiles/12/123456/1.png',
    '/x/tiles/12/1/1.png',
  ])('does not proxy %s', (url) => {
    expect(proxied(url)).toBe(false);
  });

  it('rewrites the path onto the Terrarium bucket', () => {
    const rewrite = tileProxy[TILE_PROXY_PATTERN]?.rewrite;
    expect(rewrite?.('/tiles/12/1093/1625.png')).toBe(
      '/elevation-tiles-prod/terrarium/12/1093/1625.png',
    );
  });
});
