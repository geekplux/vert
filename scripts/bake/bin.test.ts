// @vitest-environment node
/**
 * The packaged `vert-bake` (package.json `bin`, `dist-lib/bake.js`): vite.bake.config.ts is built
 * here (Vite's `build()`, into node_modules/.tmp), then run as a host runs it, in a child process
 * with no TypeScript and no resolve hook. cli.test.ts covers the command line in full through
 * scripts/bake.ts; this checks the bundle keeps it: help, version, a bake from standard input that
 * matches the source's bytes, exit codes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pointsJsonOf, startTileServer, syntheticRoute, type TileServer } from './testing';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'node_modules', '.tmp', `vert-bake-bin-test-${String(process.pid)}`);
const BIN = join(OUT, 'bake.js');
const SOURCE = join(ROOT, 'scripts', 'bake.ts');

let server: TileServer;
let dir: string;

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  await build({
    configFile: join(ROOT, 'vite.bake.config.ts'),
    root: ROOT,
    logLevel: 'silent',
    build: { outDir: OUT },
  });
  server = await startTileServer();
  dir = mkdtempSync(join(tmpdir(), 'vert-bake-bin-'));
}, 60_000);

afterAll(async () => {
  await server.close();
  rmSync(OUT, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

/** `node <entry> ...args` with `input` piped to standard input. */
function run(entry: string, input: string, ...args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: dir });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

describe('the packaged vert-bake', () => {
  it('is one ES module for Node: a shebang, and nothing imported but Node built-ins', () => {
    expect(readdirSync(OUT)).toEqual(['bake.js']);
    const js = readFileSync(BIN, 'utf8');
    expect(js.startsWith('#!/usr/bin/env node\n')).toBe(true);
    const imports = [...js.matchAll(/^import\s[^;]*?from\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).toMatch(/^node:/);
    expect(js).not.toMatch(/\bimport\s*\(/);
  });

  it('--help names vert-bake and its cache; --version is the library build', () => {
    const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/^Usage: vert-bake <input> --out <dir>/);
    expect(help.stdout).toContain('(default node_modules/.cache/vert-bake)');
    const version = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' });
    expect(version.status).toBe(0);
    const { version: pkg } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(version.stdout).toMatch(new RegExp(`^${pkg.replace(/\./g, '\\.')}\\+\\w+`));
    const usage = spawnSync(process.execPath, [BIN, '-'], { encoding: 'utf8' });
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/^vert-bake: --out <dir> is required\./);
  });

  it('bakes points from standard input to the same bytes as scripts/bake.ts', async () => {
    const points = pointsJsonOf(syntheticRoute());
    const tiles = `${server.origin}/tiles/{z}/{x}/{y}.png`;
    const common = ['--id', 'test-run', '--tiles', tiles];
    const packaged = await run(BIN, points, '-', '--out', 'packaged', ...common);
    expect(packaged.stderr).toBe('');
    expect(packaged.code).toBe(0);
    expect(packaged.stdout).toMatch(/^Baked test-run\n/);
    // No --cache: the default is node_modules/.cache/vert-bake under the current directory.
    expect(readdirSync(join(dir, 'node_modules', '.cache', 'vert-bake')).length).toBeGreaterThan(0);
    const source = await run(SOURCE, points, '-', '--out', 'source', ...common, '--cache', 'c');
    expect(source.code).toBe(0);
    for (const name of ['test-run.scene', 'test-run.scene.json']) {
      const a = readFileSync(join(dir, 'packaged', name));
      expect(a.equals(readFileSync(join(dir, 'source', name)))).toBe(true);
    }
  });
});
