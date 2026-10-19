// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
/// <reference types="node" />
/**
 * What each entry pulls in, by walking the static imports of the source: the host entry
 * (`index.ts`) must reach no three.js, no terrain code, no tile loader and nothing that reads
 * coordinates; the bake entry (`bake.ts`) no three.js.
 */
import { describe, expect, it } from 'vitest';
import { reachable, shortNames as short } from '../test/imports';

describe('scene entries', () => {
  it('the host entry reaches no three.js, terrain, tiles, GPX or geodesy code', () => {
    const modules = short(reachable(new URL('./index.ts', import.meta.url)));
    expect(modules.filter((m) => !m.startsWith('src/scene/'))).toEqual([]);
    expect(modules).not.toContain('src/scene/build.ts');
    expect(modules).not.toContain('src/scene/privacy.ts');
  });

  it('the bake entry reaches no three.js', () => {
    const modules = short(reachable(new URL('./bake.ts', import.meta.url)));
    expect(modules.filter((m) => m === 'three' || m.startsWith('three/'))).toEqual([]);
    for (const renderer of ['route', 'markers', 'mesh', 'stage', 'TerrainView']) {
      expect(modules.filter((m) => m.startsWith(`src/terrain/${renderer}.`))).toEqual([]);
    }
    // The walk does follow imports: the bake reaches the terrain sampler and the shared rules.
    expect(modules).toContain('src/scene/build.ts');
    expect(modules).toContain('src/terrain/heightfield.ts');
    expect(modules).toContain('src/terrain/routeRules.ts');
  });
});
