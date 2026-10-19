/**
 * A decoded scene (docs/SCENE.md) as what drawing needs: a {@link TerrainGrid} and a
 * {@link GridTrack}. No latitude or longitude exists here or anywhere this module imports: the
 * scene is already in grid-local metres, so a position is just divided by the grid's spacing
 * (DECISIONS.md "Library for Activities").
 *
 * - Grid: the scene's elevations, min, max, spacing and zoom as they are (the same typed array).
 * - Track: column = x / spacing x, row = y / spacing y; `cumulative` the scene's distances (metres
 *   from the run's real start, so the drawn route may start past 0 and the scrub uses the same
 *   metres); `ele` the scene's elevations; `loop` when the scene has no finish marker (the bake
 *   decided it with the app's rule, `isLoop`, on the real track).
 * - Markers: the scene's stored markers, passed through exactly (`GridTrack.markers`). The bake
 *   placed them on the original track (the summit on its highest recorded point), not on the
 *   evenly resampled route, so re-deriving them from the route could move the summit.
 *
 * Route and markers are draped on the grid as the View drapes them (DECISIONS.md "Scene terrain
 * is softer, accepted"), never drawn at the recorded elevations.
 */
import type { Scene, SceneMarker } from '../scene/types';
import type { GridPoint, GridTrack, TerrainGrid } from './grid';

/** A scene's grid and route, ready for the stage. */
export interface GridScene {
  readonly grid: TerrainGrid;
  readonly track: GridTrack;
}

const cache = new WeakMap<Scene, GridScene>();

/**
 * `scene` as a grid and a grid track. Memoised per scene object, so every caller (and every render)
 * gets the same objects and the stage builds the route once per scene.
 */
export function sceneToGrid(scene: Scene): GridScene {
  const cached = cache.get(scene);
  if (cached) return cached;
  const result = convert(scene);
  cache.set(scene, result);
  return result;
}

function convert(scene: Scene): GridScene {
  const { grid: g, route, markers } = scene;
  const mx = g.metresPerSample.x;
  const my = g.metresPerSample.y;
  const grid: TerrainGrid = {
    zoom: g.zoom,
    width: g.width,
    height: g.height,
    elevations: g.elevations,
    min: g.min,
    max: g.max,
    metresPerSample: { x: mx, y: my },
  };
  const n = route.x.length;
  const col = new Float64Array(n);
  const row = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    col[k] = (route.x[k] ?? 0) / mx;
    row[k] = (route.y[k] ?? 0) / my;
  }
  const at = (marker: SceneMarker): GridPoint => ({ col: marker.x / mx, row: marker.y / my });
  const track: GridTrack = {
    col,
    row,
    cumulative: route.distance,
    ele: Float64Array.from(route.elevation),
    loop: markers.finish === null,
    markers: {
      start: at(markers.start),
      finish: markers.finish ? at(markers.finish) : null,
      summit: markers.summit ? at(markers.summit) : null,
    },
  };
  return { grid, track };
}
