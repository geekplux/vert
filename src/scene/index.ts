/**
 * Vert scenes for a host page (docs/SCENE.md): decode a `.scene` file into a georeference-free
 * height grid and route. This entry imports no three.js, no terrain code and no tile loader; the
 * offline bake's tools (build, encode, sidecar, privacy checks) are in `./bake`.
 */
export type {
  Scene,
  SceneClimb,
  SceneGrid,
  SceneMarker,
  SceneMarkers,
  SceneRoute,
  SceneSummary,
} from './types';
export { SceneError, type SceneErrorReason } from './error';
export { SCENE_LIMITS, SCENE_LONG_SIDE, SCENE_STEPS, SCENE_VERSION } from './format';
export { decodeScene } from './decode';
