import { useImperativeHandle, useRef } from 'react';
import type { TerrainViewHandle as StageHandle } from '../terrain/GridTerrainView';
import { SceneTerrainView } from '../terrain/SceneTerrainView';
import type { TerrainViewHandle, TerrainViewProps } from './types';

/**
 * The 3D terrain (style A) of a scene: `SceneTerrainView` behind the library's own props and
 * handle (src/vert-lib/types.ts), so no internal type is published and the handle offers only its
 * five stable methods. Drag to orbit, wheel or pinch to zoom; keyboard: focus the view (Tab),
 * arrow keys orbit (Shift for bigger steps), + / − zoom. With `prefers-reduced-motion` the intro
 * move is a fade.
 */
export function TerrainView({ ref, ...props }: TerrainViewProps) {
  const inner = useRef<StageHandle>(null);
  useImperativeHandle(
    ref,
    (): TerrainViewHandle => ({
      rotateBy: (radians) => inner.current?.rotateBy(radians),
      resetView: () => inner.current?.resetView(),
      requestRender: () => inner.current?.requestRender(),
      focus: () => inner.current?.focus(),
      camera: () => inner.current?.camera() ?? null,
    }),
    [],
  );
  return <SceneTerrainView {...props} ref={inner} />;
}
