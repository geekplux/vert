// @vitest-environment node
/// <reference types="node" />
/**
 * What the library entry pulls in, by walking the source's static imports (type-only ones
 * included): the scene path only. No module that reads latitude or longitude (`gridTrack.ts`,
 * `heightfield.ts`, `src/lib/geo.ts`), fetches tiles (`tiles.ts`), parses GPX or belongs to the
 * page; packages are React and three.js only.
 */
import { describe, expect, it } from 'vitest';
import { reachable, shortNames } from '../test/imports';

const modules = shortNames(reachable(new URL('./index.ts', import.meta.url)));

describe('library entry', () => {
  it('reaches no coordinate, heightfield, tile, GPX or page code', () => {
    for (const forbidden of [
      'src/terrain/gridTrack.ts',
      'src/terrain/heightfield.ts',
      'src/terrain/tiles.ts',
      'src/terrain/TerrainView.tsx',
      'src/lib/geo.ts',
      'src/scene/build.ts',
      'src/scene/bake.ts',
      'src/scene/privacy.ts',
    ]) {
      expect(modules).not.toContain(forbidden);
    }
    expect(modules.filter((m) => /^src\/(gpx|page|poster)\//.test(m))).toEqual([]);
    expect(modules.filter((m) => m.startsWith('src/') && m.endsWith('.test.ts'))).toEqual([]);
  });

  it('depends on React and three.js only', () => {
    const packages = modules.filter((m) => !m.startsWith('src/') && !m.startsWith('file:'));
    for (const name of packages) {
      expect(name).toMatch(/^(react|react-dom|three)(\/|$)/);
    }
  });

  it('does reach the scene path: the view, the grid conversion and the decoder', () => {
    expect(modules).toContain('src/terrain/SceneTerrainView.tsx');
    expect(modules).toContain('src/terrain/sceneGrid.ts');
    expect(modules).toContain('src/terrain/stage.ts');
    expect(modules).toContain('src/scene/decode.ts');
    expect(modules).toContain('src/scene/time.ts');
    expect(modules).toContain('src/components/ElevationProfile/SceneElevationProfile.tsx');
  });
});
