/**
 * The library build (`pnpm build:lib` → `dist-lib/`): Vert's scene view for a host page such as
 * Activities (DECISIONS.md "Library for Activities", src/vert-lib/index.ts). Separate from the
 * app's vite.config.ts, which it leaves alone.
 *
 * - One ES module, `index.js`, and one stylesheet, `vert.css`; `index.d.ts` re-exports the
 *   declarations `tsc -p tsconfig.lib.json` writes to `types/` once the bundle is written, their
 *   relative imports given explicit `.js` extensions (so `node16` / `nodenext` resolve them too);
 *   and only the declarations the public entry reaches are kept. `README.md` is
 *   src/vert-lib/README.md, the host's CSS contract. `react`, `react-dom` (and their subpaths,
 *   `react/jsx-runtime` among them) and `three` (and every `three/…` module) stay imports: the
 *   host installs them. Nothing else is imported at run time.
 * - The CSS reads only custom properties, each with a fallback (the value in
 *   src/styles/tokens.css), so a host without Vert's tokens still gets style A and a host can
 *   restyle by setting them.
 *   Class names are CSS-module hashes with a `vert-` prefix, so they never meet a host's own.
 * - `VERT_LIB_VERSION` is `package.json`'s version plus the short git sha it was built from.
 * - No public directory (fonts, samples) is copied: hosts bring their own fonts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const root = new URL('./', import.meta.url);

/** `package.json`'s version plus the short sha of HEAD (`+nogit` outside a git checkout). */
export function libVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    version: string;
  };
  let sha = 'nogit';
  try {
    sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Not a git checkout (an exported tarball): the version alone, marked.
  }
  return `${version}+${sha}`;
}

/** The custom properties tokens.css defines, with their values. */
export function readTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) tokens.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return tokens;
}

/**
 * Gives every `var(--token)` in the library's CSS modules a fallback, the token's value in
 * tokens.css: `var(--route)` → `var(--route, #d9480f)`. A token tokens.css lacks fails the build,
 * so the stylesheet never reads a property without a fallback.
 */
export function tokenFallbacks(tokens: ReadonlyMap<string, string>): Plugin {
  return {
    name: 'vert-token-fallbacks',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.module\.css(\?|$)/.test(id)) return null;
      return code.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
        const value = tokens.get(name);
        if (value === undefined) {
          throw new Error(`${id}: ${name} is not in src/styles/tokens.css, so it has no fallback`);
        }
        return `var(${name}, ${value})`;
      });
    },
  };
}

/** A relative specifier in a declaration: `from './x'`, `import('./x')`, `import './x'`. */
const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\2/g;

/** Every `.d.ts` file under `dir`, absolute paths. */
function declarationFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.d.ts'))
    .map((name) => join(dir, name));
}

/**
 * Keeps only the declarations `entry` (relative to `dir`) reaches through relative imports,
 * deleting the rest (tsc writes one for every module the bundle compiles, the renderer's
 * internals included, which no public type mentions) and any folder left empty. Run after
 * {@link addDeclarationExtensions}. Returns the kept files relative to `dir`, sorted.
 */
export function pruneDeclarations(dir: string, entry: string): string[] {
  const keep = new Set<string>();
  const queue = [resolve(dir, entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (keep.has(file)) continue;
    keep.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_SPECIFIER)) {
      const specifier = match[3] ?? '';
      queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.d.ts')));
    }
  }
  for (const file of declarationFiles(dir)) if (!keep.has(file)) rmSync(file);
  const folders = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry_) => entry_.isDirectory())
    .map((entry_) => join(entry_.parentPath, entry_.name))
    .sort((a, b) => b.length - a.length);
  for (const folder of folders) if (readdirSync(folder).length === 0) rmdirSync(folder);
  return [...keep].map((file) => file.slice(dir.length + 1)).sort();
}

/**
 * Gives every relative import in the declarations under `dir` an explicit extension: `'./grid'`
 * becomes `'./grid.js'` and a folder `'./scene'` becomes `'./scene/index.js'`, as `node16` and
 * `nodenext` resolution require (`bundler` takes either). Throws on a specifier that points at no
 * declaration, so a broken tree never ships.
 */
export function addDeclarationExtensions(dir: string): void {
  for (const file of declarationFiles(dir)) {
    const source = readFileSync(file, 'utf8');
    const rewritten = source.replace(
      RELATIVE_SPECIFIER,
      (whole, head: string, quote: string, specifier: string) => {
        if (specifier.endsWith('.js')) return whole;
        const target = resolve(dirname(file), specifier);
        if (existsSync(`${target}.d.ts`)) return `${head}${quote}${specifier}.js${quote}`;
        if (existsSync(join(target, 'index.d.ts'))) {
          return `${head}${quote}${specifier}/index.js${quote}`;
        }
        throw new Error(`${file}: ${specifier} points at no declaration`);
      },
    );
    if (rewritten !== source) writeFileSync(file, rewritten);
  }
}

/**
 * The files next to `index.js` besides the stylesheet: `index.d.ts` (re-exporting `types/`),
 * `README.md`, and `types/` itself, written by `tsc -p tsconfig.lib.json` once the bundle is on
 * disk, then given explicit extensions ({@link addDeclarationExtensions}) and cut down to what the
 * public entry reaches ({@link pruneDeclarations}).
 */
export function libDeclarations(): Plugin {
  let outDir = '';
  let write = true;
  return {
    name: 'vert-lib-declarations',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      write = config.build.write;
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.d.ts',
        source: "export * from './types/vert-lib/index.js';\n",
      });
      this.emitFile({
        type: 'asset',
        fileName: 'README.md',
        source: readFileSync(new URL('src/vert-lib/README.md', root), 'utf8'),
      });
    },
    closeBundle() {
      if (!write) return;
      const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
      const types = join(outDir, 'types');
      execFileSync(process.execPath, [tsc, '-p', 'tsconfig.lib.json', '--outDir', types], {
        cwd: fileURLToPath(root),
        stdio: 'inherit',
      });
      addDeclarationExtensions(types);
      pruneDeclarations(types, 'vert-lib/index.d.ts');
    },
  };
}

/** Every import the bundle leaves to the host. */
export const LIB_EXTERNAL = /^(react|react-dom|three)(\/.*)?$/;

export default defineConfig((): UserConfig => {
  const tokens = readTokens(readFileSync(new URL('src/styles/tokens.css', root), 'utf8'));
  return {
    plugins: [tokenFallbacks(tokens), react(), libDeclarations()],
    publicDir: false,
    define: { __VERT_LIB_VERSION__: JSON.stringify(libVersion()) },
    // The production JSX runtime (`react/jsx-runtime`) even when NODE_ENV says otherwise (the
    // bundle test builds under Vitest, where it is "test").
    oxc: { jsx: { development: false } },
    css: {
      modules: { generateScopedName: 'vert-[local]-[hash:base64:6]' },
    },
    build: {
      outDir: 'dist-lib',
      emptyOutDir: true,
      copyPublicDir: false,
      cssCodeSplit: false,
      lib: {
        entry: 'src/vert-lib/index.ts',
        formats: ['es'],
        fileName: () => 'index.js',
        cssFileName: 'vert',
      },
      rolldownOptions: {
        external: (id: string) => LIB_EXTERNAL.test(id),
      },
    },
  };
});
