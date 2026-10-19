/**
 * A scene's id: the base of its file names (`<id>.scene`, `<id>.scene.json`), which a host
 * publishes. Lower-case letters, digits, `_` and `-`, at most {@link MAX_ID_LENGTH} characters,
 * starting with a letter or digit.
 *
 * An id must not give the place away: one whose digits read as a coordinate of the run is refused,
 * whoever chose it ({@link checkIdPrivacy}). A default id, made from the file name, must not give
 * the time away either ({@link checkDefaultIdTimestamp}); an explicit `--id` may be any number, as
 * a host's own activity ids are.
 */
import { basename, extname } from 'node:path';
import type { Bounds } from '../../src/lib/geo';
import { BakeError, UsageError } from './errors';

export const MAX_ID_LENGTH = 64;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Checks an id given with `--id`: it must already be valid (an explicit id is used as typed or
 * not at all).
 *
 * @throws UsageError otherwise.
 */
export function checkExplicitId(id: string): string {
  if (!ID_PATTERN.test(id) || id.length > MAX_ID_LENGTH) {
    throw new UsageError(
      `--id must be 1–${String(MAX_ID_LENGTH)} characters of a–z, 0–9, "_" and "-", starting with a letter or digit.`,
    );
  }
  return id;
}

/**
 * The default id for an input file: its name without the extension, lower-cased, every run of
 * other characters turned into one `-`, trimmed to {@link MAX_ID_LENGTH}.
 *
 * @throws UsageError when nothing usable is left (pass `--id`).
 */
export function idFromFileName(path: string): string {
  const base = basename(path, extname(path));
  const id = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents off: é → e
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/[-_]+$/, '');
  if (!id) throw new UsageError('The input file name gives no usable id; pass one with --id.');
  return id;
}

/** Date span (2000 to 2100) a default id's digits may not read as, in epoch milliseconds. */
const EPOCH_MS = { min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) };

/** Timestamp encodings looked for in a default id: a digit run's length and the unit's span. */
const TIMESTAMPS = [
  { unit: 'epoch microseconds', digits: [15, 16], per: 1e-3 },
  { unit: 'epoch milliseconds', digits: [12, 13], per: 1 },
  { unit: 'epoch seconds', digits: [9, 10], per: 1e3 },
  { unit: 'epoch minutes', digits: [8], per: 6e4 },
] as const;

/** Whether an 8-digit run is a calendar date YYYYMMDD from 1990 to 2100. */
function isCalendarDate(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Refuses a **default** id (one made from the file name) whose digits read as a timestamp: epoch
 * microseconds, milliseconds, seconds or minutes from 2000 to 2100 (15–16, 12–13, 9–10 or 8
 * digits), or a calendar date written YYYYMMDD (1990–2100). Some apps name exports by the time of
 * the run (`1607437156744.gpx`), and that time would be published in the file names. An explicit
 * `--id` is never checked for this: a host passes its own activity ids (a 10-digit Strava id reads
 * as epoch seconds), which it publishes anyway.
 *
 * @throws UsageError naming the encoding, not the digits.
 */
export function checkDefaultIdTimestamp(id: string): void {
  for (const [digits] of id.matchAll(/\d+/g)) {
    if (isCalendarDate(digits)) {
      throw new UsageError(
        'This file name looks like a timestamp (a date, YYYYMMDD), which would date the run; pass --id.',
      );
    }
    const n = Number(digits);
    for (const { unit, digits: lengths, per } of TIMESTAMPS) {
      const ms = n * per;
      if (
        (lengths as readonly number[]).includes(digits.length) &&
        ms >= EPOCH_MS.min &&
        ms <= EPOCH_MS.max
      ) {
        throw new UsageError(
          `This file name looks like a timestamp (${unit}), which would date the run; pass --id.`,
        );
      }
    }
  }
}

/** Fewest digits in one run read as a decimal coordinate (0.001° at 2 integer digits). */
const MIN_COORDINATE_DIGITS = 5;

/** Fewest digits in the fraction of a decimal coordinate split from its degrees (0.001°). */
const MIN_FRACTION_DIGITS = 3;

/** Leading digits of a long run read as degrees, the rest as their fraction (`34766385925`). */
const PREFIX_DEGREE_DIGITS = [2, 3] as const;

/**
 * A hash, not numbers, when it has a letter in it: a run of 16+ hex digits (`f-<sha1>`), or a UUID
 * (8-4-4-4-12 hex digits, with `-` or `_`).
 */
const HASH_TOKEN =
  /[0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12}|[0-9a-f]{16,}/g;

/**
 * Every reading of an id's digits as one coordinate magnitude (degrees, no sign: a minus cannot
 * survive in an id). Digit runs are the groups; any run of other characters separates them.
 *
 * - One run of {@link MIN_COORDINATE_DIGITS}+ digits with 1–7 decimals implied (`34766` → 34.766),
 *   and with its first 2 or 3 digits as degrees and all the rest as their fraction (a latitude and
 *   longitude run together: `347663839251` → 34.7663839251, 347.66…). Not its first digit alone:
 *   on a box by a 1-digit degree (the CCC, near 7° E) that refused about 5% of uniformly random
 *   10-digit ids, against 0.3–0.4% for 2 and 3 digits (time-ordered Strava ids skip all readings when given
 *   as an explicit `--id`: see {@link checkIdPrivacy}); runs of 6–8 digits still get it from the
 *   implied decimals.
 * - Degrees and a decimal fraction: a group of 1–3 digits (leading zeros allowed: `0034`), then a
 *   group of {@link MIN_FRACTION_DIGITS}+ digits (`34-7663`, `34point7663` → 34.7663).
 * - Degrees and minutes: degrees as above, then 1–2 digits below 60 (`34-45` → 34.75).
 * - Degrees, minutes and seconds: then 1–2 more digits below 60 (`34d45m58s` → 34.766).
 * - Degrees and decimal minutes: degrees, minutes, then a group of any length as the minutes'
 *   fraction (`n34-45-966` → 34 + 45.966 / 60), or degrees then one group of 3+ digits whose first
 *   two are the minutes (`34d45966` → 34 + 45.966 / 60).
 *
 * A hash is skipped whole: a hex run of 16+ characters, or a UUID, with a letter in it (Activities'
 * file ids are `f:<sha1>`). Its digit groups are noise, not numbers anyone wrote (UUIDs refused
 * about a quarter of ids on the CCC box before they were skipped).
 */
export function coordinateReadings(id: string): number[] {
  const text = id.replace(HASH_TOKEN, (token) => (/[a-f]/.test(token) ? '-' : token));
  const groups = [...text.matchAll(/\d+/g)].map((m) => m[0]);
  const out: number[] = [];
  const degrees = (g: string | undefined) => {
    if (g === undefined) return null;
    const significant = g.replace(/^0+(?=\d)/, '');
    const value = Number(significant);
    return significant.length <= 3 && value <= 180 ? value : null;
  };
  const sixtieths = (g: string | undefined) =>
    g !== undefined && g.length <= 2 && Number(g) < 60 ? Number(g) : null;
  groups.forEach((g, i) => {
    if (g.length >= MIN_COORDINATE_DIGITS) {
      for (let decimals = 1; decimals <= 7 && decimals < g.length; decimals++) {
        out.push(Number(g) / 10 ** decimals);
      }
      // Degrees in front, the rest its fraction, however long (lat and lon run together).
      for (const k of PREFIX_DEGREE_DIGITS) out.push(Number(`${g.slice(0, k)}.${g.slice(k)}`));
    }
    const d = degrees(g);
    if (d === null) return;
    const next = groups[i + 1];
    if (next !== undefined && next.length >= MIN_FRACTION_DIGITS) {
      out.push(Number(`${String(d)}.${next}`));
      // Decimal minutes run together (`34d45966`: 45.966′).
      if (Number(next.slice(0, 2)) < 60) {
        out.push(d + Number(`${next.slice(0, 2)}.${next.slice(2)}`) / 60);
      }
    }
    const minutes = sixtieths(next);
    if (minutes === null) return;
    out.push(d + minutes / 60);
    const third = groups[i + 2];
    const seconds = sixtieths(third);
    if (seconds !== null) out.push(d + minutes / 60 + seconds / 3600);
    if (third !== undefined) out.push(d + Number(`${String(minutes)}.${third}`) / 60);
  });
  return out;
}

/**
 * An explicit `--id` that is one run of this many digits or more and nothing else is an opaque
 * public identifier (a Strava activity id: 11 digits, rising with time), not a coordinate.
 */
const OPAQUE_ID = /^\d{10,}$/;

/**
 * Refuses an id any of whose {@link coordinateReadings} falls inside the run's latitude or
 * longitude range (as magnitudes), widened by 0.01° (about a kilometre). A date in an id can
 * collide with a run's box by chance (`lap-10-03` read as 10° 3′); the message then asks for
 * another id.
 *
 * Every id is checked, except an **explicit** `--id` of 10 or more digits and nothing else
 * ({@link OPAQUE_ID}): real Strava ids rise with time, so the 2- and 3-digit prefix readings would
 * refuse whole bands of them wherever a run's latitude or longitude is 10–19° or 100–199° (every id
 * from 11,413,000,000 to 11,426,000,000 on a Hong Kong run). The residual: someone typing
 * concatenated coordinates as a bare-digit `--id`. A default id from a file name keeps every
 * reading, digit-only or not.
 *
 * @throws BakeError naming the problem, not the digits.
 */
export function checkIdPrivacy(
  id: string,
  bounds: Bounds,
  { explicit = false }: { explicit?: boolean } = {},
): void {
  if (explicit && OPAQUE_ID.test(id)) return;
  const magnitudes = (a: number, b: number) => ({
    low: (a <= 0 && b >= 0 ? 0 : Math.min(Math.abs(a), Math.abs(b))) - 0.01,
    high: Math.max(Math.abs(a), Math.abs(b)) + 0.01,
  });
  const ranges = [magnitudes(bounds.south, bounds.north), magnitudes(bounds.west, bounds.east)];
  for (const value of coordinateReadings(id)) {
    if (ranges.some(({ low, high }) => value >= low && value <= high)) {
      throw new BakeError(
        'The id has digits that read as a coordinate of this run (or collide with one by ' +
          'chance); pass another with --id.',
      );
    }
  }
}
