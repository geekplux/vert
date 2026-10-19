/**
 * The bake's input: a `.gpx` file, parsed exactly as the app's parse worker parses it
 * (`handleMessage`: the same decoding, parser and stats), or a `.json` points file, for a host
 * that has its activities as FIT or similar (docs/SCENE.md, "Baking a scene"), given as a path or
 * as `-`, read from standard input, so that no coordinate file touches the host's disk:
 *
 * ```json
 * { "points": [{ "lat": 46.1, "lon": 7.2, "ele": 1250.5, "t": "2026-10-03T11:10:00Z" }] }
 * ```
 *
 * - `lat` (degrees, −90…90) and `lon` (degrees, −180…180): finite numbers, required.
 * - `ele` (metres): a finite number, optional (absent or `null`). Without usable elevations the
 *   bake fills them from the terrain, as the app does.
 * - `t`: the point's time, optional (absent or `null`): an ISO 8601 date-time with a zone (`Z` or
 *   `±hh:mm`), or epoch milliseconds (a number between 1990 and 2100). Present times must not go
 *   backwards. Only offsets from the first point reach the scene.
 * - At least 2 points, at most the app's 500,000; no other keys, at the top or in a point (a typo
 *   such as `lng` or `elevation` would otherwise drop data silently).
 *
 * Errors say which point and which field is wrong, never its value (it may be a coordinate).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { buildRun, handleMessage, type RunSummary } from '../../src/gpx/handler';
import { DEFAULT_MAX_POINTS, parseIsoTime } from '../../src/gpx/parse';
import type { ParsedGpx, TrackPoint } from '../../src/gpx/types';
import { MAX_FILE_BYTES } from '../../src/gpx/limits';
import type { RunTrack } from '../../src/page/types';
import { BakeError } from './errors';

/** Largest points file read, bytes: 500,000 points with times fit. */
export const MAX_JSON_BYTES = 128 * 1024 * 1024;

/** The input path that means "a points file on standard input". */
export const STDIN_INPUT = '-';

/** The file name a points file on standard input goes by (it is never used as an id). */
const STDIN_FILE_NAME = 'stdin.json';

/** Earliest and latest epoch milliseconds accepted for `t`. */
const MIN_EPOCH_MS = Date.UTC(1990, 0, 1);
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);

/** A parsed input: the run's figures and its whole track, as the parse worker returns them. */
export interface BakeInput {
  readonly kind: 'gpx' | 'json';
  /** The input's file name (for the default id), without its directory. */
  readonly fileName: string;
  readonly run: RunSummary;
  readonly points: RunTrack;
}

/**
 * Reads and parses `path` by its extension (`.gpx` or `.json`). Standard input (`-`) is
 * {@link readStdinInput}'s.
 *
 * @throws BakeError when the file cannot be read or used.
 */
export function readInput(path: string): BakeInput {
  const fileName = basename(path);
  const extension = extname(path).toLowerCase();
  if (extension !== '.gpx' && extension !== '.json') {
    throw new BakeError('The input must be a .gpx file or a .json points file.');
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new BakeError('The input file cannot be read (does it exist?).');
  }
  const limit = extension === '.gpx' ? MAX_FILE_BYTES : MAX_JSON_BYTES;
  if (size > limit) {
    throw new BakeError(
      `The input is ${String(Math.ceil(size / 2 ** 20))} MB; the limit is ${String(limit / 2 ** 20)} MB.`,
    );
  }
  const bytes = readFileSync(path);
  if (extension === '.gpx') return gpxInput(bytes, fileName);
  return { kind: 'json', fileName, ...runFromPoints(parsePointsJson(bytes.toString('utf8'))) };
}

/**
 * A points file on standard input (`-`), under the same size limit as one on disk. Read as a
 * stream, chunk by chunk as the writer sends it: a pipe's reader must wait for data, which a
 * synchronous read of fd 0 does not (EAGAIN once the input outgrows the pipe's buffer). Stops
 * as soon as the limit is passed.
 *
 * @throws BakeError when standard input cannot be read or used.
 */
export async function readStdinInput(): Promise<BakeInput> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      if (size > MAX_JSON_BYTES) {
        process.stdin.destroy();
        throw new BakeError(`The input is over the ${String(MAX_JSON_BYTES / 2 ** 20)} MB limit.`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof BakeError) throw error;
    throw new BakeError('Standard input cannot be read (pipe the points file into the bake).');
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return { kind: 'json', fileName: STDIN_FILE_NAME, ...runFromPoints(parsePointsJson(text)) };
}

/** A GPX file through the parse worker's own handler. */
export function gpxInput(bytes: Uint8Array, fileName: string): BakeInput {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { response } = handleMessage({
    id: 1,
    kind: 'file',
    buffer: buffer as ArrayBuffer,
    fileName,
  });
  if (!response.ok) throw new BakeError(response.message);
  return { kind: 'gpx', fileName, run: response.run, points: response.points };
}

/** The run of a points file, built as the parse worker builds one from a GPX. */
export function runFromPoints(parsed: ParsedGpx): { run: RunSummary; points: RunTrack } {
  return buildRun(parsed, 'points.json', false);
}

const POINT_KEYS = new Set(['lat', 'lon', 'ele', 't']);

/**
 * A points file's points, checked (see the module comment), as the GPX parser's output.
 *
 * @throws BakeError naming the first problem (the point's index and field, never its value).
 */
export function parsePointsJson(text: string): ParsedGpx {
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new BakeError('The points file is not valid JSON.');
  }
  if (!isRecord(data)) throw new BakeError('The points file must be a JSON object with "points".');
  for (const key of Object.keys(data)) {
    if (key !== 'points') throw new BakeError(`The points file has an unknown key ${quote(key)}.`);
  }
  const list = data.points;
  if (!Array.isArray(list)) throw new BakeError('"points" must be an array.');
  if (list.length < 2) throw new BakeError('"points" needs at least 2 points.');
  if (list.length > DEFAULT_MAX_POINTS) {
    throw new BakeError(
      `"points" has ${String(list.length)} points; the most Vert draws is ${String(DEFAULT_MAX_POINTS)}.`,
    );
  }
  const points: TrackPoint[] = [];
  let lastTime = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const item: unknown = list[i];
    const where = `points[${String(i)}]`;
    if (!isRecord(item)) throw new BakeError(`${where} must be an object.`);
    for (const key of Object.keys(item)) {
      if (!POINT_KEYS.has(key)) {
        throw new BakeError(
          `${where} has an unknown key ${quote(key)} (allowed: lat, lon, ele, t).`,
        );
      }
    }
    const lat = finite(item.lat, `${where}.lat`);
    const lon = finite(item.lon, `${where}.lon`);
    if (lat < -90 || lat > 90) throw new BakeError(`${where}.lat is outside −90…90.`);
    if (lon < -180 || lon > 180) throw new BakeError(`${where}.lon is outside −180…180.`);
    const ele =
      item.ele === undefined || item.ele === null ? null : finite(item.ele, `${where}.ele`);
    const time = item.t === undefined || item.t === null ? null : timeOf(item.t, `${where}.t`);
    if (time !== null) {
      if (time < lastTime) throw new BakeError(`${where}.t is earlier than the point before it.`);
      lastTime = time;
    }
    points.push({ lat, lon, ele, time });
  }
  return {
    name: null,
    type: null,
    creator: null,
    time: null,
    points,
    segments: 1,
    source: 'trk',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A key for an error message: quoted, shortened, no digits (a key could be anything). */
function quote(key: string): string {
  const safe = key.replace(/[^A-Za-z_]/g, '?').slice(0, 24);
  return `"${safe}"`;
}

function finite(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BakeError(`${where} must be a finite number.`);
  }
  return value;
}

/** An ISO 8601 date-time with a zone, or epoch milliseconds, as epoch milliseconds. */
function timeOf(value: unknown, where: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < MIN_EPOCH_MS || value > MAX_EPOCH_MS) {
      throw new BakeError(
        `${where} must be epoch milliseconds between 1990 and 2100 (seconds are not accepted).`,
      );
    }
    return value;
  }
  if (typeof value === 'string') {
    const zoned = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value.trim());
    const ms = zoned ? parseIsoTime(value) : null;
    if (ms === null || ms < MIN_EPOCH_MS || ms > MAX_EPOCH_MS) {
      throw new BakeError(
        `${where} must be an ISO 8601 date-time with a zone (e.g. 2026-10-03T11:10:00Z).`,
      );
    }
    return ms;
  }
  throw new BakeError(`${where} must be an ISO 8601 string or epoch milliseconds.`);
}
