/**
 * Which build of the library a host vendored: `package.json`'s version plus the short git sha it
 * was built from (`0.1.0+1a2b3c4`), so a host can pin it and report it. `pnpm build:lib` sets it
 * (vite.lib.config.ts, `define`); in tests, stories and the dev server it is `<version>+dev`.
 */
declare const __VERT_LIB_VERSION__: string | undefined;

/** Under tests and dev; a test keeps the version part equal to package.json's. */
export const DEV_VERSION = '0.1.0+dev';

export const VERT_LIB_VERSION: string =
  typeof __VERT_LIB_VERSION__ === 'string' ? __VERT_LIB_VERSION__ : DEV_VERSION;
