import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { tileProxy } from './vite.tile-proxy.ts';

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
