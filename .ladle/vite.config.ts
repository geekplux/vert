import { tileProxy } from '../vite.tile-proxy.ts';

// Ladle adds its own React plugin; this file exists so Ladle does not load the app's Vite 8 config.
// Stories that build a heightfield need the same-origin /tiles proxy the app uses in dev.
export default {
  server: { proxy: tileProxy },
};
