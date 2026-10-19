/**
 * The packaged command, `vert-bake` (package.json `bin`): built into `dist-lib/bake.js` by
 * vite.bake.config.ts. The same command line as `pnpm bake` (scripts/bake.ts, which runs this
 * folder's TypeScript in place), except that the default tile cache is
 * `node_modules/.cache/vert-bake` in the current directory instead of a folder in Vert's checkout.
 */
import process from 'node:process';
import { main } from './main';

process.exitCode = await main(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  {
    command: 'vert-bake',
    cache: 'node_modules/.cache/vert-bake',
    cacheLabel: 'node_modules/.cache/vert-bake',
  },
);
