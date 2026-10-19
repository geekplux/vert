// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
/// <reference types="node" />
/**
 * What each entry pulls in, by walking the static imports of the source: the host entry
 * (`index.ts`) must reach no three.js, no terrain code, no tile loader and nothing that reads
 * coordinates; the bake entry (`bake.ts`) no three.js.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Every module reachable from `entry`: relative files as URLs, packages by name. */
function reachable(entry: URL): Set<string> {
  const seen = new Set<string>();
  const visit = (file: URL) => {
    if (seen.has(file.href)) return;
    seen.add(file.href);
    const source = readFileSync(file, 'utf8');
    const specifiers = [
      ...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/gms),
      ...source.matchAll(/^\s*import\s+'([^']+)'/gm),
    ].map((m) => m[1] ?? '');
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        seen.add(specifier);
        continue;
      }
      const base = new URL(specifier, file);
      const candidates = [
        `${base.href}.ts`,
        `${base.href}.tsx`,
        `${base.href}/index.ts`,
        base.href,
      ];
      const found = candidates
        .map((c) => new URL(c))
        .find((c) => existsSync(c) && !c.href.endsWith('/'));
      if (found && /\.(ts|tsx)$/.test(found.pathname)) visit(found);
      else if (found) seen.add(found.href);
    }
  };
  visit(entry);
  return seen;
}

const SRC = new URL('../', import.meta.url);
const short = (modules: Set<string>) =>
  [...modules].map((m) => (m.startsWith(SRC.href) ? `src/${m.slice(SRC.href.length)}` : m));

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
