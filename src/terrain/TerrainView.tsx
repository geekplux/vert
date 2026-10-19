/**
 * The 3D terrain view the page uses: a heightfield and the run's track, or a baked scene
 * (docs/SCENE.md). Either is put on the grid once (memoised) and drawn by `GridTerrainView`.
 *
 * The library (`src/vert-lib`) does not export this component but `SceneTerrainView`, the scene
 * half alone: this module also imports `gridTrackFromRun`, which reads latitude and longitude.
 */
import { useMemo } from 'react';
import type { RunTrack } from '../page/types';
import type { Scene } from '../scene/types';
import { GridTerrainView, type TerrainViewCommonProps } from './GridTerrainView';
import { gridTrackFromRun } from './gridTrack';
import type { Heightfield } from './heightfield';
import { sceneToGrid } from './sceneGrid';

export type { TerrainViewCommonProps, TerrainViewHandle } from './GridTerrainView';

/** A run's terrain, sampled in the browser, and its track (lat/lon), put on the grid here. */
export interface TerrainViewHeightfieldSource {
  /** The grid to draw; null draws nothing (the page shows its loading state). */
  heightfield: Heightfield | null;
  /** The run's points: the route is draped on the terrain with ○ start and ▲ summit markers. */
  track?: RunTrack | null;
  scene?: never;
}

/** A baked scene: grid, route and markers already in grid-local metres, no coordinates. */
export interface TerrainViewSceneSource {
  /**
   * The decoded scene to draw (`decodeScene`); null draws nothing. Its route and stored markers
   * are draped on its grid; `scrub` is in its metres (from the run's real start).
   */
  scene: Scene | null;
  heightfield?: never;
  track?: never;
}

/** A heightfield and track, or a scene: one or the other, never both. */
export type TerrainViewProps = TerrainViewCommonProps &
  (TerrainViewHeightfieldSource | TerrainViewSceneSource);

/**
 * The 3D terrain (style A). Drag to orbit, wheel or pinch to zoom. Keyboard: focus the view (Tab),
 * then arrow keys orbit (Shift for bigger steps) and + / − zoom; the page's Rotate and Flat map
 * buttons do the rest. With `prefers-reduced-motion` the intro camera move becomes a fade.
 */
export function TerrainView(props: TerrainViewProps) {
  const { heightfield = null, track = null, scene, ...rest } = props;
  // The input on the grid, once per heightfield and track (the one lon/lat → grid conversion) or
  // per scene (no coordinates: a division by the spacing). Memoised, so the route is still built
  // once per new input: the stage's show() and setTrack() get the same objects.
  const { grid, gridTrack } = useMemo(() => {
    if (scene !== undefined) {
      const drawn = scene ? sceneToGrid(scene) : null;
      return { grid: drawn?.grid ?? null, gridTrack: drawn?.track ?? null };
    }
    return {
      grid: heightfield,
      gridTrack: heightfield && track ? gridTrackFromRun(heightfield, track) : null,
    };
  }, [heightfield, track, scene]);
  return <GridTerrainView {...rest} grid={grid} gridTrack={gridTrack} />;
}
