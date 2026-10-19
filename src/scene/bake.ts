/**
 * Vert scenes for the offline bake (`pnpm bake`, Node): build a scene from a run and its terrain,
 * encode it, write its sidecar, and check that neither gives the place away. No three.js; it does
 * read latitude and longitude (in `buildScene` only), so a host page imports `./index` instead.
 */
export * from './index';
export {
  ELEVATION_STEP_PER_SPACING,
  SCENE_HEIGHTFIELD_OPTIONS,
  buildScene,
  gridElevationStep,
  sceneGridShape,
  type BuildSceneOptions,
  type SceneRun,
} from './build';
export { encodeScene } from './encode';
export { SIDECAR_FORMAT, buildSidecar, fnv1a32, sidecarJson, type SceneSidecar } from './sidecar';
export {
  ACTIVITIES_COORDINATE_PATTERN,
  scanBytes,
  scanObject,
  scanScene,
  scanText,
  type LocationSecrets,
  type PrivacyFinding,
} from './privacy';
export {
  isPitchHidden,
  kernelWidth,
  pitchSignature,
  publishedKernelWidth,
  type AxisSignature,
} from './pitchAttack';
