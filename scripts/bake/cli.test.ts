// @vitest-environment node
/**
 * `node scripts/bake.ts` end to end, in a child process (exactly as `pnpm bake` runs it, resolve
 * hook included), against a local tile server.
 */
import { execFile, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSidecar,
  decodeScene,
  scanObject,
  scanText,
  sidecarJson,
  type LocationSecrets,
} from '../../src/scene/bake';
import { trackBounds } from './pipeline';
import {
  antimeridianRoute,
  gpxOf,
  lapsRoute,
  pointsJsonOf,
  startTileServer,
  syntheticRoute,
  syntheticTiles,
  type TileServer,
} from './testing';

const ENTRY = fileURLToPath(new URL('../bake.ts', import.meta.url));
const route = syntheticRoute();
const secrets: LocationSecrets = {
  lat: route.map((p) => p.lat),
  lon: route.map((p) => p.lon),
  bounds: [
    trackBounds({
      lat: Float64Array.from(route, (p) => p.lat),
      lon: Float64Array.from(route, (p) => p.lon),
    }),
  ],
};

let server: TileServer;
let dir: string;
let cache: string;
let tiles: string;

beforeAll(async () => {
  server = await startTileServer((request, coord, attempt) => {
    const url = request.url ?? '';
    if (url.startsWith('/bad/')) return { status: 400, type: 'application/json', body: '{}' };
    if (url.startsWith('/html/')) return { status: 200, type: 'text/html', body: '<html></html>' };
    return syntheticTiles(request, coord, attempt);
  });
  dir = mkdtempSync(join(tmpdir(), 'vert-bake-cli-'));
  cache = join(dir, 'cache');
  tiles = `${server.origin}/tiles/{z}/{x}/{y}.png`;
  writeFileSync(join(dir, 'Test Run.gpx'), gpxOf(route));
  writeFileSync(join(dir, 'points.json'), pointsJsonOf(route));
  writeFileSync(join(dir, 'no-ele.gpx'), gpxOf(route, { ele: false }));
  writeFileSync(join(dir, 'broken.json'), '{"points": [');
  writeFileSync(join(dir, 'taveuni.gpx'), gpxOf(antimeridianRoute()));
  writeFileSync(join(dir, 'taveuni.json'), pointsJsonOf(antimeridianRoute()));
  writeFileSync(join(dir, 'laps.gpx'), gpxOf(lapsRoute()));
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function bake(...args: string[]): Promise<Result> {
  return new Promise((resolve) => {
    execFile(process.execPath, [ENTRY, ...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/**
 * `bake(...args)` with `input` written to the child's standard input, through a pipe, as a host's
 * async `spawn` does; a string is written whole, a number is that many megabytes of spaces, written
 * a megabyte at a time until the child stops reading.
 */
function bakeWithStdin(input: string | number, ...args: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    // The child may stop reading (over the limit): its end of the pipe closes, which is fine.
    child.stdin.on('error', () => undefined);
    if (typeof input === 'string') {
      child.stdin.end(input);
      return;
    }
    const megabyte = Buffer.alloc(2 ** 20, ' ');
    let left = input;
    const write = () => {
      while (left > 0) {
        left--;
        if (!child.stdin.write(megabyte)) {
          child.stdin.once('drain', write);
          return;
        }
      }
      child.stdin.end();
    };
    write();
  });
}

/** Printed text gives no coordinate away: Activities' pattern, and no pair or key value in it. */
function expectNoCoordinates(text: string) {
  expect(scanText(text)).toEqual([]);
  expect(text).not.toMatch(/\d\.\d{4,}/);
  const numbers = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  expect(scanObject(numbers, secrets)).toEqual([]);
  for (const p of route.slice(0, 3)) {
    expect(text).not.toContain(String(p.lat));
    expect(text).not.toContain(String(p.lon));
  }
  expect(text).not.toContain(server.origin);
  expect(text).not.toMatch(/\/\d+\/\d+\/\d+/);
}

function outputs(out: string, id: string) {
  const bytes = new Uint8Array(readFileSync(join(out, `${id}.scene`)));
  const sidecar = readFileSync(join(out, `${id}.scene.json`), 'utf8');
  return { bytes, sidecar };
}

describe('node scripts/bake.ts', () => {
  it('bakes a GPX: a valid scene, its sidecar, a summary without coordinates', async () => {
    const out = join(dir, 'gpx');
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['test-run.scene', 'test-run.scene.json']);
    const { bytes, sidecar } = outputs(out, 'test-run');
    const scene = decodeScene(bytes);
    expect(sidecar).toBe(sidecarJson(buildSidecar(bytes)));
    expect(scene.summary.trim).toEqual({ start: 200, end: 200 });
    expect(result.stdout).toMatch(/^Baked test-run\n/);
    expect(result.stdout).toMatch(/elevation from the file/);
    expect(result.stdout).toMatch(
      /^ {2}offset {3}file − terrain elevation [+−]?\d+ m on average, [+−]?\d+ m to [+−]?\d+ m along the drawn route$/m,
    );
    expect(result.stdout).toMatch(/tiles {4}\d+ fetched, 0 from cache, 0 missing/);
    expect(result.stdout).toMatch(/privacy {2}clean/);
    expectNoCoordinates(result.stdout);
  });

  it('a second process with the same tiles: byte-identical files, no request', async () => {
    const before = server.requests.length;
    const out = join(dir, 'gpx-again');
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(0);
    expect(server.requests.length).toBe(before);
    expect(result.stdout).toMatch(/tiles {4}0 fetched, \d+ from cache/);
    const first = outputs(join(dir, 'gpx'), 'test-run');
    const second = outputs(out, 'test-run');
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    expect(second.sidecar).toBe(first.sidecar);
  });

  it('bakes a JSON points file: the same scene as the GPX of the same points', async () => {
    const out = join(dir, 'json');
    const result = await bake(
      join(dir, 'points.json'),
      '--out',
      out,
      '--id',
      'test-run',
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(0);
    const { bytes } = outputs(out, 'test-run');
    expect(decodeScene(bytes).route.time).not.toBeNull();
    expect(
      Buffer.from(bytes).equals(Buffer.from(outputs(join(dir, 'gpx'), 'test-run').bytes)),
    ).toBe(true);
    expectNoCoordinates(result.stdout);
  });

  it('bakes a points file from standard input (-): the same scene, no file of its own', async () => {
    const out = join(dir, 'stdin');
    const result = await bakeWithStdin(
      pointsJsonOf(route),
      '-',
      '--out',
      out,
      '--id',
      'test-run',
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['test-run.scene', 'test-run.scene.json']);
    expect(
      Buffer.from(outputs(out, 'test-run').bytes).equals(
        Buffer.from(outputs(join(dir, 'gpx'), 'test-run').bytes),
      ),
    ).toBe(true);
    expectNoCoordinates(result.stdout);
  });

  it('reads standard input larger than a pipe’s buffer: async spawn (2 MB) and spawnSync (20 MB)', async () => {
    const reference = outputs(join(dir, 'gpx'), 'test-run').bytes;
    // JSON allows trailing whitespace: the same points, padded past what one pipe buffer holds.
    const padded = (mb: number) => pointsJsonOf(route) + ' '.repeat(mb * 2 ** 20);
    const common = ['--id', 'test-run', '--tiles', tiles, '--cache', cache];
    const out = join(dir, 'stdin-large');
    const result = await bakeWithStdin(padded(2), '-', '--out', out, ...common);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(Buffer.from(outputs(out, 'test-run').bytes).equals(Buffer.from(reference))).toBe(true);
    const outSync = join(dir, 'stdin-sync');
    const sync = spawnSync(process.execPath, [ENTRY, '-', '--out', outSync, ...common], {
      input: padded(20),
      encoding: 'utf8',
    });
    expect(sync.stderr).toBe('');
    expect(sync.status).toBe(0);
    expect(Buffer.from(outputs(outSync, 'test-run').bytes).equals(Buffer.from(reference))).toBe(
      true,
    );
  });

  it('standard input over 128 MB: exit 1 as the limit passes, nothing written', async () => {
    const out = join(dir, 'stdin-huge');
    const result = await bakeWithStdin(130, '-', '--out', out, '--id', 'huge');
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/The input is over the 128 MB limit\.\nNothing was written\./);
    expect(existsSync(out)).toBe(false);
  });

  it('broken points on standard input: exit 1, nothing written, no value echoed', async () => {
    const out = join(dir, 'stdin-broken');
    const result = await bakeWithStdin(
      '{"points": [{"lat": 46.583917, "lng": 7.912846}]}',
      '-',
      '--out',
      out,
      '--id',
      'broken',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/needs at least 2 points|unknown key/);
    expect(result.stderr).not.toContain('46.58');
    expect(existsSync(out)).toBe(false);
  });

  it('bakes a GPX without <ele>, its elevations from the terrain', async () => {
    const out = join(dir, 'no-ele');
    const result = await bake(
      join(dir, 'no-ele.gpx'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/elevation from the terrain/);
    expect(result.stdout).not.toMatch(/offset/);
    const { sidecar } = outputs(out, 'no-ele');
    expect(
      (JSON.parse(sidecar) as { summary: { climb: number | null } }).summary.climb,
    ).toBeGreaterThan(0);
    expectNoCoordinates(result.stdout);
  });

  it('--trim 0 keeps the ends', async () => {
    const out = join(dir, 'trim0');
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--trim',
      '0',
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\(ends kept\)/);
    expect(decodeScene(outputs(out, 'test-run').bytes).summary.trim).toEqual({ start: 0, end: 0 });
  });

  it('a bad input: exit 1, a clear error, nothing written', async () => {
    const out = join(dir, 'broken');
    const result = await bake(
      join(dir, 'broken.json'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/not valid JSON\.\nNothing was written\./);
    expect(existsSync(out)).toBe(false);
  });

  it('a tile server that answers 400: exit 1, nothing written, no tile or URL printed', async () => {
    const out = join(dir, 'bad');
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--tiles',
      `${server.origin}/bad/{z}/{x}/{y}.png`,
      '--cache',
      join(dir, 'empty-cache'),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/HTTP 400/);
    expect(result.stderr.match(/Nothing was written/g)).toHaveLength(1);
    expect(existsSync(out)).toBe(false);
    expectNoCoordinates(result.stderr);
  });

  it('a tile URL that serves web pages: exit 1, nothing written', async () => {
    const out = join(dir, 'html');
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--tiles',
      `${server.origin}/html/{z}/{x}/{y}.png`,
      '--cache',
      join(dir, 'empty-cache'),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/not an image/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(dir, 'empty-cache'))).toBe(false);
  });

  it.each([
    [['--out', 'x'], /exactly one input/],
    [['in.gpx'], /--out <dir> is required/],
    [['in.gpx', '--out', 'x', '--trim=-5'], /--trim must be/],
    [['in.gpx', '--out', 'x', '--trim', 'lots'], /--trim must be/],
    [['in.gpx', '--out', 'x', '--id', 'Not OK'], /--id must be/],
    [['in.gpx', '--out', 'x', '--colour', 'red'], /Unknown option '--colour'/],
    [['-', '--out', 'x'], /--id <id> is required when the input is -/],
  ])('usage error %j: exit 2 with the usage', async (args, message) => {
    const result = await bake(...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toMatch(/Usage: pnpm bake/);
  });

  it('bakes the e2e Taveuni Dateline loop (across ±180°) from a GPX and a points file', async () => {
    const out = join(dir, 'dateline');
    const fromGpx = await bake(
      join(dir, 'taveuni.gpx'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(fromGpx.stderr).toBe('');
    expect(fromGpx.code).toBe(0);
    expect(fromGpx.stdout).toMatch(/privacy {2}clean/);
    const outJson = join(dir, 'dateline-json');
    const fromJson = await bake(
      join(dir, 'taveuni.json'),
      '--out',
      outJson,
      '--id',
      'taveuni',
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(fromJson.code).toBe(0);
    const a = outputs(out, 'taveuni');
    const b = outputs(outJson, 'taveuni');
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
    expect(decodeScene(a.bytes).summary.distance).toBeGreaterThan(13_000);
  });

  it('laps: warns that the real start and finish lie on the drawn route', async () => {
    const result = await bake(
      join(dir, 'laps.gpx'),
      '--out',
      join(dir, 'laps'),
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(
      /^vert-bake: warning: The run's real start lies .* the drawn route/m,
    );
    expect(result.stderr).toMatch(/^vert-bake: warning: The run's real finish/m);
    // Three laps: the start is passed again a lap in; a trim of a little over a lap hides it.
    expect(result.stderr).toMatch(
      /real start lies within 10 m of the drawn route at km \d+\.\d of \d+\.\d \(a loop or laps pass it again\), so the trim does not hide it; a --trim of 1,\d{3} m does\.$/m,
    );
    expectNoCoordinates(result.stderr);
  });

  it('a sidecar that cannot be written: exit 1, and no scene written either', async () => {
    const out = join(dir, 'blocked');
    mkdirSync(join(out, 'test-run.scene.json'), { recursive: true });
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /could not be written to --out \(test-run\.scene\.json is not a file\)\.\nNothing was written\./,
    );
    expect(readdirSync(out)).toEqual(['test-run.scene.json']);
  });

  it('a file name that is a timestamp: exit 2 unless an --id is given, which may be numeric', async () => {
    const stamped = join(dir, '1607437156744.gpx');
    writeFileSync(stamped, gpxOf(route));
    const refused = await bake(
      stamped,
      '--out',
      join(dir, 'stamped'),
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(
      /This file name looks like a timestamp \(epoch milliseconds\).*; pass --id\./,
    );
    expect(existsSync(join(dir, 'stamped'))).toBe(false);
    for (const id of ['4123456789', '1607437156744']) {
      const result = await bake(
        stamped,
        '--out',
        join(dir, 'stamped'),
        '--id',
        id,
        '--tiles',
        tiles,
        '--cache',
        cache,
      );
      expect(result.code).toBe(0);
      expect(existsSync(join(dir, 'stamped', `${id}.scene`))).toBe(true);
    }
  });

  it('recovers what a killed bake left aside before writing', async () => {
    const out = join(dir, 'killed');
    mkdirSync(out);
    writeFileSync(join(out, 'test-run.scene.old-99999-0'), 'old scene');
    writeFileSync(join(out, 'test-run.scene.json.tmp-99999-1'), 'partial');
    const result = await bake(
      join(dir, 'Test Run.gpx'),
      '--out',
      out,
      '--tiles',
      tiles,
      '--cache',
      cache,
    );
    expect(result.code).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['test-run.scene', 'test-run.scene.json']);
    expect(decodeScene(outputs(out, 'test-run').bytes).summary.trim.start).toBe(200);
  });

  it('--help prints the usage', async () => {
    const result = await bake('--help');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Usage: pnpm bake <input> --out <dir>/);
  });
});
