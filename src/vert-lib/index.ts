/**
 * Vert as a library (DECISIONS.md "Library for Activities"): what a host page needs to show a baked
 * scene (docs/SCENE.md) as Vert's 3D terrain with its elevation profile. Built by `pnpm build:lib`
 * into `dist-lib/` (one ES module, `vert.css`, type declarations and README.md, the host's CSS
 * contract); `react`, `react-dom` and `three` are the host's.
 *
 * Nothing here reads a latitude or longitude, builds a heightfield or fetches anything: a scene is
 * already in grid-local metres, and the host loads its bytes itself (src/vert-lib/entry.test.ts
 * walks these imports; bundle.test.tsx checks the built file). The public types are standalone
 * (./types.ts), so the declarations publish none of the renderer's internals.
 *
 * The name `src/vert-lib` keeps it apart from `src/lib`, the app's shared maths.
 */

// The terrain view of a scene, and its profile, one scrub in the same metres.
export { TerrainView } from './TerrainView';
export { ElevationProfile } from './ElevationProfile';
export type {
  ElevationProfileProps,
  Insets,
  RoutePalette,
  ScreenRect,
  TerrainPalette,
  TerrainRenderer,
  TerrainViewHandle,
  TerrainViewMode,
  TerrainViewProps,
  Units,
  ViewCamera,
} from './types';

// Scenes: decode a `.scene` file's bytes.
export { decodeScene } from '../scene/decode';
export { SceneError, type SceneErrorReason } from '../scene/error';
export type {
  Scene,
  SceneClimb,
  SceneGrid,
  SceneMarker,
  SceneMarkers,
  SceneRoute,
  SceneSummary,
} from '../scene/types';

// What the host shows alongside: the build it vendored, and the credit for the elevation data.
export { VERT_LIB_VERSION } from './version';
export { TERRAIN_ATTRIBUTION, TERRAIN_ATTRIBUTION_LINK } from '../terrain/attribution';
