import { useMemo } from 'react';
import type { Scene } from '../../scene/types';
import { ElevationProfile, type ElevationProfileProps } from './ElevationProfile';
import { sceneProfile } from './sceneProfile';

export interface SceneElevationProfileProps extends Omit<
  ElevationProfileProps,
  'points' | 'climbs' | 'origin'
> {
  /** The decoded scene (`decodeScene`): its drawn route's profile and its climbs are drawn. */
  scene: Scene;
  /**
   * Scrub position, metres from the run's real start (the scene's distances, the same metres as
   * `TerrainView`'s `scrub`); clamped to the drawn route. Null: no position (see
   * `ElevationProfile`).
   */
  scrub: number | null;
  /** Called with the new scrub position, in the same metres, on drag and keys. */
  onScrub: (d: number) => void;
}

/**
 * The elevation profile of a scene: `ElevationProfile` fed from the scene's drawn route and
 * climbs. The plot spans the drawn route (from its first point, past 0 when the ends are
 * trimmed); every distance, the slider's values and the ticks included, counts from the run's real
 * start. The same ARIA slider (arrow keys ±1%, Shift or PageUp / PageDown ±10%, Home / End),
 * value text ("km 12.2, 640 m") and climb description as in the app.
 */
export function SceneElevationProfile({ scene, ...rest }: SceneElevationProfileProps) {
  const { origin, points, climbs } = useMemo(() => sceneProfile(scene), [scene]);
  return <ElevationProfile {...rest} origin={origin} points={points} climbs={climbs} />;
}
