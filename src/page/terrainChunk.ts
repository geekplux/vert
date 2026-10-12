/**
 * The terrain view's code (three.js, ~150 kB gzipped) is its own chunk, loaded on demand so the
 * Upload state stays light (DECISIONS "lazy-loaded"). The page starts fetching it the moment a
 * file or the sample is chosen, in parallel with parsing and the elevation tiles, and the View's
 * `TerrainBox` renders it through `React.lazy`. One shared request; a failed import (offline) is
 * forgotten so "Try again" can fetch it afresh.
 */
import { lazy } from 'react';
import type { TerrainView } from '../terrain/TerrainView';

interface TerrainViewModule {
  readonly TerrainView: typeof TerrainView;
}

let pending: Promise<TerrainViewModule> | null = null;

/**
 * The terrain view's code did not download (offline, or a deploy replaced the chunk), so the View
 * can say so instead of blaming the elevation data or the browser.
 */
export class TerrainChunkError extends Error {
  constructor(cause: unknown) {
    super('The 3D view code did not load.', { cause });
    this.name = 'TerrainChunkError';
  }
}

/** Imports the terrain view module once; a failure (a `TerrainChunkError`) is not cached. */
export function loadTerrainView(): Promise<TerrainViewModule> {
  pending ??= import('../terrain/TerrainView').catch((error: unknown) => {
    pending = null;
    throw new TerrainChunkError(error);
  });
  return pending;
}

/** Starts loading the chunk and ignores the outcome (the View reports a failure itself). */
export function preloadTerrainView(): void {
  loadTerrainView().catch(() => undefined);
}

/**
 * A `React.lazy` `TerrainView`. `React.lazy` remembers a rejected import for good, so the View
 * makes a fresh one when the user retries after the chunk failed to load.
 */
export function createLazyTerrainView() {
  return lazy(() => loadTerrainView().then((module) => ({ default: module.TerrainView })));
}
