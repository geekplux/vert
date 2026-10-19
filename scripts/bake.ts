#!/usr/bin/env node
/**
 * `pnpm bake <input> --out <dir> [--id <id>] [--trim <metres>] [--tiles <url>] [--cache <dir>]`:
 * one activity into a Vert scene and its sidecar (docs/SCENE.md, "Baking a scene"). The work is in
 * `scripts/bake/`; this entry only makes `src/` importable in plain Node.
 *
 * Node runs this file with its built-in type stripping (Node 22.18 or later), but `src/` imports
 * have no extensions (Vite's bundler resolution), which Node's own resolver refuses. So before
 * the real entry is imported, a synchronous resolve hook (`module.registerHooks`) retries a
 * relative, extensionless import from a `.ts` file as `<specifier>.ts`, then
 * `<specifier>/index.ts`. Nothing else changes: bare and absolute specifiers, and relative ones
 * with an extension, go to Node's resolver as they are. No loader, no dependency.
 */
import { existsSync } from 'node:fs';
import * as nodeModule from 'node:module';
import process from 'node:process';

// Node older than 22.18 refuses a `.ts` entry before this line runs (unless type stripping is
// turned on by flag), so `engines.node` (>= 22.18) and `.nvmrc` carry the requirement; this check
// only catches a flagged older Node, or one without `registerHooks`.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18) || typeof nodeModule.registerHooks !== 'function') {
  process.stderr.write(
    `vert-bake: needs Node 22.18 or later (it runs TypeScript directly); this is Node ${process.versions.node}.\n`,
  );
  process.exit(2);
}

/** A specifier that already names a file type Node can load. */
const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node|wasm)$/;

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (
      relative &&
      parent?.startsWith('file:') &&
      parent.endsWith('.ts') &&
      !HAS_EXTENSION.test(specifier)
    ) {
      for (const suffix of ['.ts', '/index.ts']) {
        const candidate = new URL(specifier + suffix, parent);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { main } = await import('./bake/main.ts');
process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
