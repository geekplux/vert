/**
 * The parse worker's message protocol and its handler, kept apart from `worker.ts` (the thin
 * entry that wires the handler to `self`) so it can be unit-tested without a real Worker.
 *
 * Request: the GPX as bytes (`kind: 'file'`, the `ArrayBuffer` transferred) or as text.
 * Response: the run's figures plus its points as typed arrays whose buffers are transferred back,
 * or the parser's error code and the message to show. Plain data both ways; no class crosses the
 * boundary (structured cloning drops prototypes).
 */

import { boundsOf, unwrapLongitudes, type Bounds } from '../lib/geo';
import { GENERIC_LOAD_ERROR } from '../page/errors';
import type { Run, RunTrack } from '../page/types';
import { parseGpx } from './parse';
import { computeStats } from './stats';
import { GpxError, type GpxErrorCode, type ParsedGpx } from './types';

interface RequestBase {
  /** Correlates the response with its request. */
  readonly id: number;
  /** The file's name, for the run's name when the GPX has none. */
  readonly fileName: string;
  /** The built-in sample run rather than the user's file. */
  readonly isSample?: boolean;
}

/** What the page sends the worker. */
export type ParseRequest =
  | (RequestBase & { readonly kind: 'file'; readonly buffer: ArrayBuffer })
  | (RequestBase & { readonly kind: 'text'; readonly text: string });

/** Everything about the run except its id (the page assigns it) and its points (sent apart). */
export type RunSummary = Omit<Run, 'id' | 'track'>;

/** `internal` is a bug in Vert, not a problem with the file. */
export type ParseErrorCode = GpxErrorCode | 'internal';

/** What the worker sends back. */
export type ParseResponse =
  | { readonly id: number; readonly ok: true; readonly run: RunSummary; readonly points: RunTrack }
  | {
      readonly id: number;
      readonly ok: false;
      readonly code: ParseErrorCode;
      readonly message: string;
    };

/** A response and the buffers to transfer with it. */
export interface HandledMessage {
  readonly response: ParseResponse;
  readonly transfer: Transferable[];
}

/** Message for an unexpected failure inside the worker: the page's generic copy. */
export const INTERNAL_ERROR_MESSAGE = GENERIC_LOAD_ERROR;

/** Parses one request. Never throws: every failure becomes an `ok: false` response. */
export function handleMessage(request: ParseRequest): HandledMessage {
  const id = request.id;
  try {
    const text = request.kind === 'file' ? decodeGpxBytes(request.buffer) : stripBom(request.text);
    const parsed = parseGpx(text);
    const { run, points } = buildRun(parsed, request.fileName, request.isSample ?? false);
    const transfer: Transferable[] = [
      points.lat.buffer,
      points.lon.buffer,
      points.cumulative.buffer,
    ];
    if (points.ele) transfer.push(points.ele.buffer);
    if (points.time) transfer.push(points.time.buffer);
    return { response: { id, ok: true, run, points }, transfer };
  } catch (error) {
    if (error instanceof GpxError) {
      return {
        response: { id, ok: false, code: error.code, message: error.message },
        transfer: [],
      };
    }
    return {
      response: { id, ok: false, code: 'internal', message: INTERNAL_ERROR_MESSAGE },
      transfer: [],
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

/**
 * GPX bytes → text. UTF-16 when the file starts with a UTF-16 byte-order mark; otherwise UTF-8
 * (a UTF-8 BOM is dropped), falling back to Latin-1 (windows-1252, as browsers read it) when the
 * bytes are not valid UTF-8, as older exporters write ISO-8859-1 names.
 */
export function decodeGpxBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    // TextDecoder drops a leading UTF-8 BOM by default.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------------------------------------------------------------------------------------------
// Building the run
// ---------------------------------------------------------------------------------------------

/** The run's figures and points from a parsed GPX. Unknown quantities are `NaN` (see `Run`). */
export function buildRun(
  parsed: ParsedGpx,
  fileName: string,
  isSample: boolean,
): { run: RunSummary; points: RunTrack } {
  const { points } = parsed;
  const stats = computeStats(points);
  const first = points[0];
  const orNaN = (value: number | null) => value ?? NaN;
  const run: RunSummary = {
    name: runName(parsed.name, fileName),
    startTime: stats.startTime ?? parsed.time ?? NaN,
    lonForOffset: first ? first.lon : 0,
    isSample,
    hasTime: stats.time !== null,
    hasElevation: stats.hasElevation,
    distance: stats.distance,
    vert: orNaN(stats.ascent),
    descent: orNaN(stats.descent),
    movingTime: orNaN(stats.movingTime),
    elapsedTime: orNaN(stats.elapsedTime),
    highPoint: orNaN(stats.highPoint),
    lowPoint: orNaN(stats.lowPoint),
    profile: stats.profile,
    climbs: stats.climbs,
    bounds: roundOutward(boundsOf(points)),
  };
  return {
    run,
    points: {
      lat: Float64Array.from(points, (p) => p.lat),
      // Continuous across the antimeridian, in the same representation as `bounds` (lib/geo).
      lon: unwrapLongitudes(points.map((p) => p.lon)),
      ele: stats.elevation,
      cumulative: stats.cumulative,
      time: stats.time,
    },
  };
}

/**
 * A bbox rounded outward to 4 decimals (≈ 11 m), so every point stays inside. Longitudes are kept
 * within ±180 unless the box already lies past it (a run across the antimeridian).
 */
export function roundOutward(bounds: Bounds): Bounds {
  // Scaling by 1e4 can round across a boundary; a final comparison with the input settles it.
  const at = (k: number) => Number((k / 1e4).toFixed(4));
  const down = (v: number) => {
    const k = Math.floor(v * 1e4);
    return at(k) > v ? at(k - 1) : at(k);
  };
  const up = (v: number) => {
    const k = Math.ceil(v * 1e4);
    return at(k) < v ? at(k + 1) : at(k);
  };
  return {
    west: bounds.west < -180 ? down(bounds.west) : Math.max(-180, down(bounds.west)),
    south: Math.max(-90, down(bounds.south)),
    east: bounds.east > 180 ? up(bounds.east) : Math.min(180, up(bounds.east)),
    north: Math.min(90, up(bounds.north)),
  };
}

/** Words kept lower case inside a title-cased file name. */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
]);

/** Shown when neither the GPX nor the file name gives a usable name. */
export const UNTITLED_RUN = 'Untitled run';

/**
 * The run's name: the GPX's own (track, else metadata; whitespace collapsed, otherwise as
 * written), else the file name without its extension made readable: `_` and word-joining `-`
 * become spaces (a `-` between digits, as in a date, stays), and an all-lower-case result is
 * title-cased ("morning_run" → "Morning Run", "tour-of-the-hills" → "Tour of the Hills"). A name
 * that already has capitals is left alone ("UTMB_CCC" → "UTMB CCC").
 */
export function runName(gpxName: string | null, fileName: string): string {
  const own = gpxName?.replace(/\s+/g, ' ').trim();
  if (own) return own;

  const base = fileName.replace(/\.[^./\\]*$/, '');
  const spaced = base
    .replace(/_+/g, ' ')
    .replace(/(?<!\d)-|-(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return UNTITLED_RUN;
  if (spaced !== spaced.toLowerCase()) return spaced;
  return spaced
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}
