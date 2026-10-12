/**
 * Load errors, in their own module so the loader (`src/gpx`) and the hooks can both import them
 * without a cycle. `hooks.ts` re-exports both.
 */

/** A load failure whose message is fit to show on the Upload screen, e.g. "No track in this file." */
export class RunLoadError extends Error {
  override name = 'RunLoadError';
}

/** Shown when a load fails with anything other than a `RunLoadError`. */
export const GENERIC_LOAD_ERROR = "Vert couldn't read this file.";
