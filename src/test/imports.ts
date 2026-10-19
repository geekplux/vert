/// <reference types="node" />
/**
 * Every module a source file reaches through its static imports and re-exports (type-only ones
 * included), for tests that keep an entry free of some code: the scene's host entry, the library.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Every module reachable from `entry`: relative files as URLs, packages by name. */
export function reachable(entry: URL): Set<string> {
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

/** `modules` with files under `src/` as `src/…` paths, packages as they are. */
export function shortNames(modules: Set<string>): string[] {
  return [...modules].map((m) => (m.startsWith(SRC.href) ? `src/${m.slice(SRC.href.length)}` : m));
}
