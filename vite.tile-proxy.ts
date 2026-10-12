import type { ProxyOptions } from 'vite';

/**
 * Elevation tiles in dev and preview: `/tiles/{z}/{x}/{y}.png` goes straight to the public AWS
 * Terrain Tiles bucket (Terrarium encoding). In production the same path is served by the Worker
 * (`worker/src`), which caches tiles in R2; the app always asks its own origin.
 *
 * The key is anchored, so only a bare z/x/y path is proxied: anything else (a query string, an
 * extra segment) falls through to Vite and never reaches AWS. Cookies and the referrer are
 * stripped so the upstream request carries the tile address and nothing else. The zoom is capped at
 * 6–15, the range the production Worker serves (`MIN_ZOOM`–`MAX_ZOOM` in `worker/src/tiles.ts`;
 * 15 is Terrarium's deepest level), so a request the Worker would refuse fails in dev too (z=5 or
 * z=99 falls through to Vite instead of reaching S3).
 */
export const TILE_PROXY_PATTERN = '^/tiles/(?:1[0-5]|[6-9])/\\d{1,5}/\\d{1,5}\\.png$';

export const tileProxy: Record<string, ProxyOptions> = {
  [TILE_PROXY_PATTERN]: {
    target: 'https://s3.amazonaws.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/tiles\//, '/elevation-tiles-prod/terrarium/'),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('cookie');
        proxyReq.removeHeader('referer');
        proxyReq.removeHeader('origin');
      });
    },
  },
};
