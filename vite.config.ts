import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Elevation tiles in dev and preview: `/tiles/{z}/{x}/{y}.png` goes straight to the public AWS
 * Terrain Tiles bucket (Terrarium encoding). In production the same path is served by the Worker
 * (`worker/src`), which caches tiles in R2; the app always asks its own origin.
 *
 * The key is anchored, so only a bare z/x/y path is proxied: anything else (a query string, an
 * extra segment) falls through to Vite and never reaches AWS. Cookies and the referrer are
 * stripped so the upstream request carries the tile address and nothing else.
 */
const tileProxy: Record<string, ProxyOptions> = {
  '^/tiles/\\d{1,2}/\\d{1,5}/\\d{1,5}\\.png$': {
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

export default defineConfig({
  plugins: [react()],
  // The GPX parse worker (`src/gpx/worker.ts`) is a module worker; bundle it as ES too.
  worker: { format: 'es' },
  server: { proxy: tileProxy },
  preview: { proxy: tileProxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'worker/src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
