/**
 * GPX text → {@link ParsedGpx}: the semantic layer over {@link XmlTokenizer}.
 *
 * A recursive-descent reader that walks only the parts of the GPX schema Vert needs and skips
 * everything else (waypoints, extensions, links, author blocks) without decoding it. No DOM, no
 * React, no network: it runs unchanged in a Web Worker and in Node.
 *
 * Accepts GPX 1.1 and 1.0, with or without a namespace prefix on the elements.
 */

import { GpxError, type ParsedGpx, type TrackPoint } from './types';
import { XmlSyntaxError, XmlTokenizer } from './xml';

/** Default cap on point elements; roughly 5½ days at one point per second. */
export const DEFAULT_MAX_POINTS = 500_000;

/** Options for {@link parseGpx}. */
export interface ParseGpxOptions {
  /** Throw `too-large` once the chosen track has more point elements than this. */
  maxPoints?: number;
}

/**
 * Parses a GPX document into the single track Vert draws.
 *
 * - Points: every `<trkseg>` of the first `<trk>` that has at least one valid point, concatenated
 *   in order. When no track has one, the first `<rte>` with a valid `<rtept>`. `<wpt>`s are
 *   ignored. Name, type and segment count come from the same track or route.
 * - Points whose `lat`/`lon` is missing, not a plain decimal (`xsd:decimal`: no exponent, hex,
 *   `Infinity`…) or out of range are dropped; if they are more than half of the chosen list's
 *   points the file is treated as damaged. `<ele>` must be a decimal too, but may carry an
 *   exponent (`1.2E3`); an unreadable `<ele>` becomes `null` without dropping the point.
 * - Name: the track's `<name>`, then the file's. Text is trimmed; empty becomes `null`.
 * - Repeated fields: wherever an element may hold a name, type, time or elevation, the first
 *   usable value in document order wins (non-empty text, a parseable time, a decimal elevation);
 *   later duplicates are still consumed, never read into the result. The file's name and time are
 *   one field each across `<metadata>` (GPX 1.1) and the top level (GPX 1.0): a file that has both
 *   keeps whichever comes first with a value.
 * - Anything after the closing `</gpx>` is not read.
 *
 * @throws {GpxError} `not-gpx` when the document's root is not `<gpx>` (or it is not XML at all);
 *   `malformed` when the XML breaks off or is broken inside `<gpx>`, or most (or all) points are
 *   invalid; `no-points` when there is no track or route point at all; `too-large` past
 *   `maxPoints`.
 */
export function parseGpx(text: string, options?: ParseGpxOptions): ParsedGpx {
  const maxPoints = options?.maxPoints ?? DEFAULT_MAX_POINTS;
  const xml = new XmlTokenizer(text);

  try {
    if (!openRoot(xml)) throw new GpxError('not-gpx');
  } catch (error) {
    if (error instanceof XmlSyntaxError) throw new GpxError('not-gpx', { cause: error });
    throw error;
  }

  let document: GpxDocument;
  try {
    document = readGpx(xml, maxPoints);
  } catch (error) {
    if (error instanceof XmlSyntaxError) throw new GpxError('malformed', { cause: error });
    throw error;
  }

  return toParsedGpx(document);
}

// ---------------------------------------------------------------------------------------------
// Reading: one function per element, each consuming its element through the closing tag.
// ---------------------------------------------------------------------------------------------

/** Points read from one `<trk>` or `<rte>`, with the bookkeeping the validity rule needs. */
interface PointList {
  name: string | null;
  type: string | null;
  points: TrackPoint[];
  /** Point elements seen, valid or not. */
  seen: number;
  /** Segments that contributed at least one valid point. */
  segments: number;
}

/** Everything {@link readGpx} collects before a source is chosen. */
interface GpxDocument {
  creator: string | null;
  metadataName: string | null;
  metadataTime: number | null;
  track: PointList | null;
  route: PointList | null;
}

/**
 * Advances to the first element and reports whether it is `<gpx>`. Leaves the tokenizer on
 * that `open` token.
 */
function openRoot(xml: XmlTokenizer): boolean {
  for (;;) {
    const kind = xml.next();
    if (kind === 'open') return xml.name === 'gpx';
    if (kind === 'end') return false;
    // Text before the root (whitespace, or junk in a file that is not GPX) is passed over.
  }
}

/**
 * Calls `visit` with the local name of each child element of the current element, then returns
 * once the current element closes. `visit` should consume the child (read it or skip it); a child
 * it leaves unconsumed is skipped here, so its closing tag can never be mistaken for the parent's
 * and end the loop early.
 */
function eachChild(xml: XmlTokenizer, visit: (name: string) => void): void {
  for (;;) {
    const kind = xml.next();
    if (kind === 'close') return;
    if (kind === 'open') {
      visit(xml.name);
      // Every reader leaves the tokenizer on the child's `close`; still `open` means untouched.
      if (xml.current === 'open') xml.skipElement();
    }
    // Text between child elements (indentation) is ignored.
  }
}

function readGpx(xml: XmlTokenizer, maxPoints: number): GpxDocument {
  const document: GpxDocument = {
    creator: clean(xml.attr('creator')),
    metadataName: null,
    metadataTime: null,
    track: null,
    route: null,
  };

  eachChild(xml, (name) => {
    switch (name) {
      case 'metadata':
        readMetadata(xml, document);
        break;
      // GPX 1.0 puts the file's name and time directly under <gpx>.
      case 'name':
      case 'time':
        readFileField(xml, name, document);
        break;
      case 'trk':
        // Keep reading tracks until one has a valid point; later ones are skipped undecoded.
        if (hasPoints(document.track)) xml.skipElement();
        else document.track = preferred(document.track, readTrack(xml, maxPoints));
        break;
      case 'rte':
        // A route is only a fallback: stop collecting once a track or route with points is in hand.
        if (hasPoints(document.track) || hasPoints(document.route)) xml.skipElement();
        else document.route = preferred(document.route, readRoute(xml, maxPoints));
        break;
      default:
        xml.skipElement(); // wpt, extensions, anything else
    }
  });
  return document;
}

function readMetadata(xml: XmlTokenizer, document: GpxDocument): void {
  eachChild(xml, (name) => {
    if (name === 'name' || name === 'time') readFileField(xml, name, document);
    else xml.skipElement(); // desc, author (which has its own <name>), copyright, link, bounds…
  });
}

/**
 * Reads the file's `<name>` or `<time>`, from `<metadata>` or the top level alike. Always consumes
 * the element; the first usable value wins.
 */
function readFileField(xml: XmlTokenizer, name: 'name' | 'time', document: GpxDocument): void {
  const text = xml.readText();
  if (name === 'name') document.metadataName ??= clean(text);
  else document.metadataTime ??= parseIsoTime(text);
}

function hasPoints(list: PointList | null): boolean {
  return list !== null && list.points.length > 0;
}

/**
 * Of an earlier list without valid points and a newly read one, the one to keep: the new one if
 * it has valid points, or if it at least has point elements where the earlier had none (so an
 * all-invalid file reports `malformed` rather than `no-points`). Otherwise the earlier one.
 */
function preferred(earlier: PointList | null, next: PointList): PointList {
  if (earlier === null || next.points.length > 0 || (earlier.seen === 0 && next.seen > 0)) {
    return next;
  }
  return earlier;
}

function emptyPointList(): PointList {
  return { name: null, type: null, points: [], seen: 0, segments: 0 };
}

function readTrack(xml: XmlTokenizer, maxPoints: number): PointList {
  const track = emptyPointList();
  eachChild(xml, (name) => {
    switch (name) {
      case 'name':
      case 'type':
        readListField(xml, name, track);
        break;
      case 'trkseg': {
        const before = track.points.length;
        eachChild(xml, (child) => {
          if (child === 'trkpt') readPoint(xml, track, maxPoints);
          else xml.skipElement();
        });
        if (track.points.length > before) track.segments++;
        break;
      }
      default:
        xml.skipElement();
    }
  });
  return track;
}

function readRoute(xml: XmlTokenizer, maxPoints: number): PointList {
  const route = emptyPointList();
  eachChild(xml, (name) => {
    switch (name) {
      case 'name':
      case 'type':
        readListField(xml, name, route);
        break;
      case 'rtept':
        readPoint(xml, route, maxPoints);
        break;
      default:
        xml.skipElement();
    }
  });
  if (route.points.length > 0) route.segments = 1;
  return route;
}

/** Reads a track's or route's `<name>` or `<type>`. Always consumes it; the first non-empty wins. */
function readListField(xml: XmlTokenizer, name: 'name' | 'type', list: PointList): void {
  const text = clean(xml.readText());
  if (name === 'name') list.name ??= text;
  else list.type ??= text;
}

/** Reads one `<trkpt>` or `<rtept>` into `list`, dropping it if its position is unusable. */
function readPoint(xml: XmlTokenizer, list: PointList, maxPoints: number): void {
  if (++list.seen > maxPoints) throw new GpxError('too-large');

  // Attributes belong to the current token, so read them before moving on to the children.
  const lat = parseDecimal(xml.attr('lat'), false);
  const lon = parseDecimal(xml.attr('lon'), false);
  let ele: number | null = null;
  let time: number | null = null;

  eachChild(xml, (name) => {
    // Both always consume the element; a repeated one only fills a value still missing.
    if (name === 'ele') {
      const value = parseDecimal(xml.readText(), true);
      if (ele === null && Number.isFinite(value)) ele = value;
    } else if (name === 'time') {
      const value = parseIsoTime(xml.readText());
      time ??= value;
    } else {
      xml.skipElement(); // extensions (heart rate, cadence…), hdop, sat, name, sym…
    }
  });

  if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
    list.points.push({ lat, lon, ele, time });
  }
}

// ---------------------------------------------------------------------------------------------
// Choosing the source and validating it.
// ---------------------------------------------------------------------------------------------

function toParsedGpx(document: GpxDocument): ParsedGpx {
  const { track, route } = document;
  const source = hasPoints(track) ? 'trk' : hasPoints(route) ? 'rte' : null;
  const list = source === 'trk' ? track : source === 'rte' ? route : null;
  if (source === null || list === null) {
    // Point elements, but not one usable: damaged, not empty.
    const seen = (track?.seen ?? 0) + (route?.seen ?? 0);
    throw new GpxError(seen > 0 ? 'malformed' : 'no-points');
  }

  const invalid = list.seen - list.points.length;
  if (invalid * 2 > list.seen) throw new GpxError('malformed');

  return {
    name: list.name ?? document.metadataName,
    type: list.type,
    creator: document.creator,
    time: document.metadataTime,
    points: list.points,
    segments: list.segments,
    source,
  };
}

// ---------------------------------------------------------------------------------------------
// Values.
// ---------------------------------------------------------------------------------------------

/** Trims text content; empty or missing becomes `null`. */
function clean(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The number `value` spells if it is an `xsd:decimal` (the type GPX gives `lat`, `lon` and `ele`)
 * once trimmed: optional sign, digits, optional fraction. Otherwise `NaN`, including for blank.
 *
 * `Number()` does the reading; what it accepts beyond `xsd:decimal` is then rejected: `Infinity`,
 * `0x1A` / `0b1` / `0o7`, and exponents (`1e1`). This is cheaper than scanning or matching a regex
 * first, which matters at three values per point.
 *
 * @param allowExponent Keep exponents (`1.2E3`). Tolerated for `<ele>`, which float-printing
 *   writers may emit that way; never for coordinates.
 */
function parseDecimal(value: string | null, allowExponent: boolean): number {
  if (value === null) return NaN;
  const s = value.trim();
  if (s === '') return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  const prefix = s.charCodeAt(1) | 0x20; // lower-cased
  if (s.charCodeAt(0) === 0x30 /* 0 */ && (prefix === 0x78 || prefix === 0x62 || prefix === 0x6f)) {
    return NaN; // 0x, 0b, 0o
  }
  if (!allowExponent && (s.includes('e') || s.includes('E'))) return NaN;
  return n;
}

/** XML Schema's zone offset range is -14:00 to +14:00. */
const MAX_OFFSET_MINUTES = 14 * 60;

/**
 * Anchored to one short `<time>` value, never run over the file. Date and time are required;
 * fractional seconds and a zone (`Z`, `±hh:mm`, `±hhmm`, `±hh`) are optional. A zone offset must
 * lie within ±14:00 with minutes below 60, as in XML Schema.
 */
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?$/;

/**
 * Parses an ISO 8601 / XML Schema `dateTime` into ms since the epoch, or `null` when absent or
 * unparsable (including an out-of-range zone offset). A value without a zone is read as UTC, as
 * the GPX schema specifies (unlike `Date.parse`, which would use the device's local zone).
 * Fractions beyond milliseconds are truncated.
 */
export function parseIsoTime(value: string | null): number | null {
  if (value === null) return null;
  const match = ISO_DATE_TIME.exec(value.trim());
  if (match === null) return null;

  const [, y, mo, d, h, mi, s, fraction = '', , sign, offsetHours, offsetMinutes = '0'] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (
    year < 100 || // Date.UTC maps 0–99 to 1900–1999; no GPS recording is that old anyway
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 60 // 60 allows a leap second, which rolls into the next minute
  ) {
    return null;
  }

  const millis = Number(fraction.slice(0, 3).padEnd(3, '0'));
  let offset = 0;
  if (sign !== undefined) {
    const minutes = Number(offsetHours) * 60 + Number(offsetMinutes);
    if (Number(offsetMinutes) > 59 || minutes > MAX_OFFSET_MINUTES) return null;
    offset = (sign === '-' ? -minutes : minutes) * 60_000;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offset;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
