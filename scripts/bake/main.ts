/**
 * `pnpm bake`'s command line: reads the arguments, bakes, writes `<out>/<id>.scene` and
 * `<out>/<id>.scene.json`, prints a summary. Usage in {@link USAGE} and docs/SCENE.md ("Baking a
 * scene").
 *
 * Nothing printed (summary or error) holds a coordinate, a bound, a tile x/y or a tile URL: the
 * summary has lengths, sizes and counts; errors are {@link BakeError} messages or scrubbed.
 */
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatNumber } from '../../src/lib/format';
import { BakeError, UsageError, printableMessage } from './errors';
import { checkDefaultIdTimestamp, checkExplicitId, idFromFileName } from './id';
import { readInput } from './input';
import { DEFAULT_TRIM_M, bakeScene, type BakedScene } from './pipeline';
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_TILE_TEMPLATE,
  createTileSource,
  type TileSourceOptions,
} from './tiles';
import {
  NODE_FILE_OPS,
  NotAFileError,
  recoverLeftovers,
  writeFilesTogether,
  type FileOps,
} from './write';

export const USAGE = `Usage: pnpm bake <input> --out <dir> [options]

Bakes one activity (.gpx, or a .json points file) into <dir>/<id>.scene and
<dir>/<id>.scene.json for a host page (docs/SCENE.md, "Baking a scene").

Options:
  --out <dir>       where to write the scene and its sidecar (required)
  --id <id>         file name base, a-z 0-9 _ - (default: from the input's name)
  --trim <metres>   metres hidden at each end of the route (default ${String(DEFAULT_TRIM_M)}; 0 keeps them)
  --tiles <url>     tile URL template with {z} {x} {y}
                    (default ${DEFAULT_TILE_TEMPLATE})
  --cache <dir>     tile cache (default scripts/.cache/terrarium)
  -h, --help        show this help
`;

/** Largest `--trim`, metres. */
const MAX_TRIM_M = 10_000;

export interface CliArguments {
  readonly input: string;
  readonly out: string;
  readonly id: string | null;
  readonly trim: number;
  readonly tiles: string;
  readonly cache: string;
}

/**
 * The command line's arguments, checked.
 *
 * @returns null when help was asked for.
 * @throws UsageError for anything that cannot be understood.
 */
export function parseCli(argv: readonly string[]): CliArguments | null {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: 'string' },
        id: { type: 'string' },
        trim: { type: 'string' },
        tiles: { type: 'string' },
        cache: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    // parseArgs names the option, not a value.
    throw new UsageError(error instanceof Error ? error.message : 'Unreadable arguments.');
  }
  const { values, positionals } = parsed;
  if (values.help) return null;
  if (positionals.length !== 1) throw new UsageError('Give exactly one input file.');
  const [input = ''] = positionals;
  if (!values.out) throw new UsageError('--out <dir> is required.');
  let trim = DEFAULT_TRIM_M;
  if (values.trim !== undefined) {
    trim = /^\d+(\.\d+)?$/.test(values.trim) ? Number(values.trim) : NaN;
    if (!(trim >= 0 && trim <= MAX_TRIM_M)) {
      throw new UsageError(`--trim must be a number of metres from 0 to ${String(MAX_TRIM_M)}.`);
    }
  }
  return {
    input,
    out: values.out,
    id: values.id === undefined ? null : checkExplicitId(values.id),
    trim,
    tiles: values.tiles ?? DEFAULT_TILE_TEMPLATE,
    cache: values.cache ?? DEFAULT_CACHE_DIR,
  };
}

/** What a finished bake wrote. */
export interface BakeOutcome {
  readonly baked: BakedScene;
  readonly scenePath: string;
  readonly sidecarPath: string;
  readonly seconds: number;
}

/**
 * Bakes and writes one scene. Both files change together (`writeFilesTogether`): written to
 * temporary names first, then renamed into place; if any step fails, both targets are left as they
 * were (absent, or the previous scene and sidecar), never one new and one old, never partial.
 *
 * @throws BakeError / UsageError for anything the user can fix.
 */
export async function runBake(
  args: CliArguments,
  tileOptions: TileSourceOptions = {},
  fileOps: FileOps = NODE_FILE_OPS,
): Promise<BakeOutcome> {
  const started = performance.now();
  let id = args.id;
  if (id === null) {
    // Only an id made from the file name is checked for a timestamp (see checkDefaultIdTimestamp).
    id = idFromFileName(args.input);
    checkDefaultIdTimestamp(id);
  }
  const out = resolve(args.out);
  const scenePath = join(out, `${id}.scene`);
  const sidecarPath = join(out, `${id}.scene.json`);
  // A bake killed mid-write may have left the previous files aside: put them back first.
  recoverLeftovers([scenePath, sidecarPath], fileOps);
  const input = readInput(args.input);
  const tiles = createTileSource({ template: args.tiles, cacheDir: args.cache, ...tileOptions });
  const baked = await bakeScene(input, {
    id,
    explicitId: args.id !== null,
    trim: args.trim,
    tiles,
  });
  try {
    writeFilesTogether(
      [
        { path: scenePath, data: baked.bytes },
        { path: sidecarPath, data: baked.sidecarText },
      ],
      fileOps,
    );
  } catch (error) {
    const reason =
      error instanceof NotAFileError
        ? error.message
        : error instanceof Error && 'code' in error
          ? String(error.code)
          : 'write failed';
    throw new BakeError(`The scene could not be written to --out (${reason}).`, { cause: error });
  }
  return { baked, scenePath, sidecarPath, seconds: (performance.now() - started) / 1000 };
}

const km = (metres: number) => `${formatNumber(metres / 1000, 2)} km`;
const m = (metres: number) => `${formatNumber(metres)} m`;

const ELEVATION_SOURCES: Record<string, string> = {
  gpx: 'from the file',
  terrain: 'from the terrain (the file has none usable)',
  mixed: 'from the file, its gaps from the terrain',
  interpolated: 'from the file, its gaps interpolated',
};

/** The summary printed after a bake: lengths, sizes and counts, never a coordinate. */
export function summaryText({ baked, scenePath, sidecarPath, seconds }: BakeOutcome): string {
  const { sidecar, scene, tiles } = baked;
  const { summary } = sidecar;
  const climb = summary.climb === null ? 'climb unknown' : `+${m(summary.climb)}`;
  const trim =
    summary.trim.start === 0 && summary.trim.end === 0
      ? 'ends kept'
      : `${m(summary.trim.start)} hidden at the start, ${m(summary.trim.end)} at the end`;
  const elevation = ELEVATION_SOURCES[baked.elevationSource ?? ''] ?? 'unknown';
  const lines = [
    `Baked ${baked.id}`,
    `  run      ${km(summary.distance)}, ${climb}; elevation ${elevation}`,
    `  drawn    ${km(summary.drawnLength)} (${trim})`,
    `  grid     ${String(scene.grid.width)} × ${String(scene.grid.height)} samples, ` +
      `${m(summary.extent.x)} × ${m(summary.extent.y)}, zoom ${String(scene.grid.zoom)}`,
    `  scene    ${formatNumber(sidecar.bytes)} bytes, hash ${sidecar.hash}`,
    `  tiles    ${String(tiles.fetched)} fetched, ${String(tiles.cached)} from cache, ` +
      `${String(tiles.missing)} missing upstream across both grids, ` +
      `${String(baked.sceneMissingTiles)} of them under the scene (filled from neighbours)`,
    `  privacy  clean (bytes, decoded scene, sidecar text, pixel pitch)`,
    `  wrote    ${scenePath}`,
    `           ${sidecarPath}`,
    `  took     ${formatNumber(seconds, 1)} s`,
  ];
  return `${lines.join('\n')}\n`;
}

export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Runs the command line; resolves to the exit code (0 done, 1 bake failed, 2 usage). */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  try {
    const args = parseCli(argv);
    if (!args) {
      io.stdout(USAGE);
      return 0;
    }
    const outcome = await runBake(args);
    io.stdout(summaryText(outcome));
    for (const warning of outcome.baked.warnings) io.stderr(`vert-bake: warning: ${warning}\n`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`vert-bake: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    io.stderr(`vert-bake: ${printableMessage(error)}\nNothing was written.\n`);
    return 1;
  }
}
