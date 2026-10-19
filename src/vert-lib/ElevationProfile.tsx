import { useState } from 'react';
import { SceneElevationProfile } from '../components/ElevationProfile/SceneElevationProfile';
import type { Scene } from '../scene/types';
import type { ElevationProfileProps } from './types';

/**
 * The elevation profile of a scene, under the library's own props (src/vert-lib/types.ts): one
 * ARIA slider over the drawn route (arrow keys ±1%, Shift or PageUp / PageDown ±10%, Home / End,
 * pointer drag; Escape clears the position), climbs shaded and numbered and described in text.
 * Every distance, the slider's values and the ticks included, counts from the run's real start.
 *
 * `scrub` controls it (null: no position); left out, it keeps its own, which a new `scene` clears.
 * Either way every move the user makes is reported through `onScrub` (null when Escape clears it).
 */
export function ElevationProfile({ scrub, onScrub, scene, ...rest }: ElevationProfileProps) {
  // Uncontrolled: the position and the scene it was set on, so a new scene starts with none.
  const [own, setOwn] = useState<{ scene: Scene; metres: number | null }>({ scene, metres: null });
  const controlled = scrub !== undefined;
  // A new scene: forget the old position (React's "adjust state while rendering"; not reported).
  if (own.scene !== scene) setOwn({ scene, metres: null });
  const shown = controlled ? scrub : own.scene === scene ? own.metres : null;
  const move = (metres: number | null) => {
    if (!controlled) setOwn({ scene, metres });
    onScrub?.(metres);
  };
  // Escape is taken only where clearing can show: uncontrolled, or a host that hears it. A
  // controlled profile with no `onScrub` (read-only) leaves Escape to the page.
  const clearable = !controlled || onScrub !== undefined;
  return (
    <SceneElevationProfile
      {...rest}
      scene={scene}
      scrub={shown !== null && Number.isFinite(shown) ? shown : null}
      onScrub={move}
      onClear={
        clearable
          ? () => {
              move(null);
            }
          : undefined
      }
    />
  );
}
