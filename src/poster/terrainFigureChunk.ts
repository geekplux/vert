/**
 * Style A's terrain figure renderer (`terrainFigure.ts`) needs three.js, so it is loaded on demand,
 * like the View's terrain (`src/page/terrainChunk.ts`): one shared request, and a failed import
 * (offline) is forgotten so the next attempt fetches it afresh.
 */
type TerrainFigureModule = typeof import('./terrainFigure');

let pending: Promise<TerrainFigureModule> | null = null;
let loaded: TerrainFigureModule | null = null;

/** Imports the terrain figure module once; a failure is not cached. */
export function loadTerrainFigure(): Promise<TerrainFigureModule> {
  pending ??= import('./terrainFigure').then(
    (module) => {
      loaded = module;
      return module;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/**
 * Frees the shared figure renderer and its WebGL context, if the module was ever loaded (Poster
 * mode closing). Never starts a download.
 */
export function releaseLoadedTerrainFigure(): void {
  loaded?.releaseTerrainFigure();
}
