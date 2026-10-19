/**
 * The terrain view of a baked scene alone: what the library exports as `TerrainView`
 * (src/vert-lib). The same view as `TerrainView`'s `scene` path, without its heightfield path, so
 * nothing it imports reads a latitude or longitude, builds a heightfield or fetches a tile
 * (src/vert-lib/entry.test.ts walks its imports; the bundle test greps the build).
 */
import { useMemo } from 'react';
import type { Scene } from '../scene/types';
import { GridTerrainView, type TerrainViewCommonProps } from './GridTerrainView';
import { sceneToGrid } from './sceneGrid';

export interface SceneTerrainViewProps extends TerrainViewCommonProps {
  /**
   * The decoded scene to draw (`decodeScene`); null draws nothing. Its route and its stored
   * markers (○ start, ◉ finish unless a loop, ▲ summit) are draped on its grid. Pass the same
   * object while it is unchanged: it is put on the grid once per scene object.
   */
  scene: Scene | null;
}

/**
 * The 3D terrain (style A) of a scene. Drag to orbit, wheel or pinch to zoom; keyboard: focus the
 * view (Tab), arrow keys orbit (Shift for bigger steps), + / − zoom. `scrub` is in the scene's
 * metres (from the run's real start). With `prefers-reduced-motion` the intro move is a fade.
 */
export function SceneTerrainView({ scene, ...rest }: SceneTerrainViewProps) {
  const drawn = useMemo(() => (scene ? sceneToGrid(scene) : null), [scene]);
  return <GridTerrainView {...rest} grid={drawn?.grid ?? null} gridTrack={drawn?.track ?? null} />;
}
