import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeScene } from '../../scene/decode';
import type { Scene } from '../../scene/types';
import {
  defaultSceneScrub,
  sceneElevationRange,
  sceneElevationRangeText,
  sceneLine,
  scenePaceAt,
  sceneSummitText,
  sceneTerrainLabel,
  sceneTrimText,
} from './sceneCopy';

const SCENE = decodeScene(
  new Uint8Array(
    readFileSync(join(import.meta.dirname, '../../scene/fixtures/coosa-backcountry.scene')),
  ),
);

/** The scene with some parts replaced (a decoded scene is a plain object). */
function withParts(parts: Partial<Scene>): Scene {
  return { ...SCENE, ...parts };
}

describe('scene copy', () => {
  it('ranges and labels from what the scene stores', () => {
    const { low, high } = sceneElevationRange(SCENE);
    expect(low).toBeLessThan(high);
    expect(sceneElevationRangeText(SCENE, 'metric')).toMatch(/^[\d,]+–[\d,]+ m$/);
    expect(sceneElevationRangeText(SCENE, 'imperial')).toMatch(/^[\d,]+–[\d,]+ ft$/);
    expect(sceneSummitText(SCENE, 'metric')).toMatch(/^Summit [\d,]+ m$/);
    // Coosa is a loop: the scene stores no finish marker.
    expect(SCENE.markers.finish).toBeNull();
    expect(sceneTerrainLabel(SCENE, 'coosa-backcountry', 'metric')).toMatch(
      /^3D terrain of coosa-backcountry: 21\.5 km loop, start and finish marked with a circle, summit [\d,]+ m marked with a triangle$/,
    );
    expect(sceneLine('activities.geekplux.org')).toBe('SCENE · ACTIVITIES.GEEKPLUX.ORG');
  });

  it('words a point-to-point scene and one without a summit', () => {
    const start = SCENE.markers.start;
    const scene = withParts({ markers: { start, finish: start, summit: null } });
    expect(sceneSummitText(scene, 'metric')).toBeNull();
    expect(sceneTerrainLabel(scene, 'x', 'metric')).toBe(
      '3D terrain of x: 21.5 km from start to finish, start marked with a circle, finish with a dotted circle',
    );
  });

  it('says which ends are not drawn', () => {
    expect(sceneTrimText(SCENE, 'metric')).toBe(
      'The first 200 m and the last 200 m of the run are not drawn.',
    );
    const summary = SCENE.summary;
    const trimmed = (start: number, end: number) =>
      sceneTrimText(withParts({ summary: { ...summary, trim: { start, end } } }), 'metric');
    expect(trimmed(0, 0)).toBeNull();
    expect(trimmed(0.4, 0.2)).toBeNull();
    expect(trimmed(300, 0)).toBe('The first 300 m of the run are not drawn.');
    expect(trimmed(0, 150)).toBe('The last 150 m of the run are not drawn.');
  });

  it('starts the scrub at the steepest climb, else 57% along the drawn route', () => {
    const steepest = SCENE.climbs.find((climb) => climb.steepest);
    expect(steepest).toBeDefined();
    if (steepest) expect(defaultSceneScrub(SCENE)).toBe((steepest.start + steepest.end) / 2);
    const plain = withParts({ climbs: [] });
    const { distance } = SCENE.route;
    const first = distance[0] ?? 0;
    const last = distance[distance.length - 1] ?? 0;
    expect(defaultSceneScrub(plain)).toBeCloseTo(first + (last - first) * 0.57, 6);
  });

  it('gives pace from the route times over 200 m, none without times', () => {
    const pace = scenePaceAt(SCENE, 10_000);
    expect(pace).not.toBeNull();
    // A trail run: between 3 and 30 minutes a km.
    expect(pace).toBeGreaterThan(180);
    expect(pace).toBeLessThan(1800);
    // At the drawn route's very start the window stays on the route.
    expect(scenePaceAt(SCENE, 0)).not.toBeNull();
    expect(scenePaceAt(SCENE, Number.NaN)).toBeNull();
    expect(scenePaceAt(withParts({ route: { ...SCENE.route, time: null } }), 10_000)).toBeNull();
  });
});
