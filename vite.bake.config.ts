/**
 * The bake as a command for the npm package: `pnpm build:lib` runs this after vite.lib.config.ts
 * and writes `dist-lib/bake.js`, package.json's `vert-bake` bin. scripts/bake/bin.ts and what it
 * reaches are bundled into one ES module for Node, with a `#!/usr/bin/env node` line; Node's
 * built-ins stay imports and nothing else is imported. `__VERT_LIB_VERSION__` is the library's
 * version, so `vert-bake --version` and its User-Agent name the same build as `VERSION`.
 */
import { defineConfig } from 'vite';
import { libVersion } from './vite.lib.config.ts';

export default defineConfig({
  publicDir: false,
  define: { __VERT_LIB_VERSION__: JSON.stringify(libVersion()) },
  build: {
    ssr: 'scripts/bake/bin.ts',
    outDir: 'dist-lib',
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'node22',
    rolldownOptions: {
      output: { entryFileNames: 'bake.js', banner: '#!/usr/bin/env node' },
    },
  },
});
