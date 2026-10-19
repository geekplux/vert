import { SceneElevationProfile } from '../components/ElevationProfile/SceneElevationProfile';
import type { ElevationProfileProps } from './types';

/**
 * The elevation profile of a scene, under the library's own props (src/vert-lib/types.ts): one
 * ARIA slider over the drawn route (arrow keys ±1%, Shift or PageUp / PageDown ±10%, Home / End,
 * pointer drag), climbs shaded and numbered and described in text. Every distance, the slider's
 * values and the ticks included, counts from the run's real start.
 */
export function ElevationProfile(props: ElevationProfileProps) {
  return <SceneElevationProfile {...props} />;
}
