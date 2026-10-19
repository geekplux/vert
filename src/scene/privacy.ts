/**
 * Checks that a scene gives away no location (docs/SCENE.md, "Forbidden content"), for the tests
 * here and for `pnpm bake` on every scene it writes. Given the secrets (the track's lat/lon and
 * the bounds involved), it looks in three places, designed to catch any plausible way of writing a
 * coordinate while staying silent on clean real scenes (a scanner that fails by chance would be
 * switched off):
 *
 * - **Bytes.** The **box** is the union of the secret bounds: anything inside it is "a
 *   coordinate of this place", exact or derived (an interpolated route point, a centre, a value
 *   nudged by 1e-7). The **key values** are the bound edges, their arithmetic and Web Mercator
 *   centres, and the track's first and last points.
 *   - At every offset: a float64 equal to any track coordinate (or its 4–6 decimal rounding); a
 *     float32 or float64 within {@link KEY_TOLERANCE} of a key value; and a (lat, lon) pair, in
 *     either order, of adjacent float32 or float64 values inside the box.
 *   - Outside the Rice streams (the header, the fixed fields, any section the format does not
 *     define): adjacent int32 (lat, lon) pairs, and int32 key values, at 1e5, 1e6, 1e7 and
 *     2³¹/180 (semicircles) units per degree; tile (x, y) pairs at zooms 6–15 as u16 or u32
 *     (those with a zero in them, column 0 by the antimeridian, only where tile numbers are).
 *   - In sections the format does not define: any single float32, float64 or int32 (at those
 *     scales) inside the box; any u16 or u32 equal to a tile x or y; float32 or float64 (x, y)
 *     pairs inside the box in projected form (Web Mercator world units, EPSG:3857 metres,
 *     fractional tile coordinates at zooms 6–15); and decimals written as text (`34.76375`) inside
 *     the box. Not in the format's own fixed fields, whose meanings are fixed (and
 *     whose values the object scan covers): a climb at 75 km is 7,500,000 cm, which reads as
 *     7.5° at 10⁶ per degree, and real scenes near 7° E do have such climbs.

 *   Inside a stream every value is a coded residual, so a raw number cannot sit there except by
 *   chance, and in tens of kilobytes of coded data chance is frequent: one of the four real scenes
 *   measured had a u16 tile pair such as (34, 22), the bytes `22 00 16 00`, in its grid stream.
 *   Only the patterns too long to occur by chance (float64 values, float pairs, key values to
 *   1e-5°) are looked for there. The decoded-object scan covers the streams' values.
 * - **Decoded object.** Forbidden keys; numbers within {@link KEY_TOLERANCE} of a key value;
 *   (lat, lon) pairs inside the box among adjacent array elements or the numbers of one object;
 *   epoch-like timestamps; `x`/`y` scalars equal to a tile index. A single number merely inside
 *   the box is not flagged: a route time of 34.8 s or a low grid's 46.6 m elevation would be, by
 *   chance, on real scenes.
 * - **Published text** (the sidecar): Activities' coordinate check, `\d{2}\.\d{4,}`.
 */
import {
  MERCATOR_RADIUS_M,
  lonLatToWorld,
  tilesForBounds,
  worldToLonLat,
  wrapTile,
  type Bounds,
} from '../lib/geo';
import { HEADER_BYTES, SECTION_HEADER_BYTES } from './format';

/** Activities' privacy test: any such run of digits in published text fails its build. */
export const ACTIVITIES_COORDINATE_PATTERN = /\d{2}\.\d{4,}/;

/** Keys a scene must never carry (compared case-insensitively). */
export const FORBIDDEN_KEYS = [
  'bounds',
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'west',
  'east',
  'north',
  'south',
  'failedTiles',
  'tiles',
  'date',
  'timestamp',
  'startTime',
  'name',
] as const;

/** Zooms whose tile numbers are looked for. */
export const TILE_ZOOMS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

/** How close (degrees, about a metre) a number must be to a key value to count as it. */
export const KEY_TOLERANCE = 1e-5;

/** Integer encodings of degrees looked for: units per degree. */
export const INTEGER_SCALES = [1e5, 1e6, 1e7, 2 ** 31 / 180] as const;

/** Numbers this large are taken for epoch timestamps (1e9 s is 2001; ms epochs are ~1.7e12). */
const TIMESTAMP_MIN = 1e9;

/** What must not be recoverable from a scene. */
export interface LocationSecrets {
  /** Every track latitude and longitude, degrees (the whole run, trimmed ends included). */
  readonly lat: ArrayLike<number>;
  readonly lon: ArrayLike<number>;
  /** Bounding boxes involved (the track's, the grid's padded one). */
  readonly bounds: readonly Bounds[];
}

export interface PrivacyFinding {
  readonly where: 'bytes' | 'object' | 'text';
  readonly what: string;
}

/** The box, the key values and the exact track values of a set of secrets. */
interface Prepared {
  readonly inLat: (v: number) => boolean;
  readonly inLon: (v: number) => boolean;
  readonly nearKey: (v: number) => boolean;
  readonly exact: ReadonlySet<number>;
  readonly tilePairs: ReadonlySet<string>;
  readonly tileXs: ReadonlySet<number>;
  readonly tileYs: ReadonlySet<number>;
  readonly tileNumbers: ReadonlySet<number>;
  /**
   * Projected forms of the box, for (x, y) pairs: Web Mercator world units (0–1, y south), EPSG:3857
   * metres, and fractional tile coordinates at each of {@link TILE_ZOOMS}.
   */
  readonly projected: readonly {
    name: string;
    inX: (v: number) => boolean;
    inY: (v: number) => boolean;
  }[];
}

/** A value and its roundings to 4, 5 and 6 decimals. */
function withRoundings(value: number): number[] {
  return [value, ...[4, 5, 6].map((d) => Number(value.toFixed(d)))];
}

function prepare(secrets: LocationSecrets): Prepared {
  const lats = Array.from(secrets.lat);
  const lons = Array.from(secrets.lon);
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const b of secrets.bounds) {
    south = Math.min(south, b.south);
    north = Math.max(north, b.north);
    west = Math.min(west, b.west);
    east = Math.max(east, b.east);
  }
  for (const v of lats) {
    south = Math.min(south, v);
    north = Math.max(north, v);
  }
  for (const v of lons) {
    west = Math.min(west, v);
    east = Math.max(east, v);
  }
  const keys: number[] = [];
  for (const i of lats.length > 0 ? [0, lats.length - 1] : []) {
    keys.push(lats[i] ?? NaN, lons[i] ?? NaN);
  }
  for (const b of secrets.bounds) {
    const nw = lonLatToWorld(b.west, b.north);
    const se = lonLatToWorld(b.east, b.south);
    keys.push(
      b.west,
      b.east,
      b.north,
      b.south,
      (b.west + b.east) / 2,
      (b.north + b.south) / 2,
      worldToLonLat(0, (nw.y + se.y) / 2).lat,
    );
  }
  const sortedKeys = Float64Array.from(keys.filter(Number.isFinite)).sort();
  const exact = new Set<number>();
  for (const v of [...lats, ...lons, ...keys]) for (const r of withRoundings(v)) exact.add(r);
  const tiles = tileIndices(secrets.bounds);
  return {
    inLat: (v) => v >= south && v <= north,
    // A box past ±180° (by the antimeridian) also holds the same longitudes a turn away.
    inLon: (v) => [v, v - 360, v + 360].some((w) => w >= west && w <= east),
    nearKey: (v) => near(sortedKeys, v, KEY_TOLERANCE),
    exact,
    tilePairs: new Set(
      tiles.flatMap(({ x, y }) => [`${String(x)},${String(y)}`, `${String(y)},${String(x)}`]),
    ),
    tileXs: new Set(tiles.map((t) => t.x)),
    tileYs: new Set(tiles.map((t) => t.y)),
    tileNumbers: new Set(tiles.flatMap((t) => [t.x, t.y])),
    projected: projectedBoxes(west, east, south, north),
  };
}

/** The box in Web Mercator world units, EPSG:3857 metres and fractional tiles at z6–15. */
function projectedBoxes(west: number, east: number, south: number, north: number) {
  const nw = lonLatToWorld(west, north);
  const se = lonLatToWorld(east, south);
  const between = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return (v: number) => v >= lo && v <= hi;
  };
  const metres = 2 * Math.PI * MERCATOR_RADIUS_M;
  return [
    { name: 'Web Mercator world', inX: between(nw.x, se.x), inY: between(nw.y, se.y) },
    {
      name: 'EPSG:3857 metre',
      inX: between((nw.x - 0.5) * metres, (se.x - 0.5) * metres),
      inY: between((0.5 - nw.y) * metres, (0.5 - se.y) * metres),
    },
    ...TILE_ZOOMS.map((z) => ({
      name: `z${String(z)} tile`,
      inX: between(nw.x * 2 ** z, se.x * 2 ** z),
      inY: between(nw.y * 2 ** z, se.y * 2 ** z),
    })),
  ];
}

/** Decimal numbers written as text (`34.76375`, `-83.9264`): 4 or more decimals. */
const DECIMAL_TEXT = /-?\d{1,3}\.\d{4,}/g;

/** Whether a sorted array holds a value within `tolerance` of `value`. */
function near(sorted: Float64Array, value: number, tolerance: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < value - tolerance) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && Math.abs((sorted[lo] ?? NaN) - value) <= tolerance;
}

/**
 * The (x, y) of every tile over the bounds at {@link TILE_ZOOMS}, x folded into [0, 2^z) (bounds
 * past ±180°, by the antimeridian, cover columns −1 or 2^z, which are stored as the tile they
 * wrap to).
 */
export function tileIndices(bounds: readonly Bounds[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const b of bounds) {
    for (const z of TILE_ZOOMS) out.push(...tilesForBounds(b, z).map(wrapTile));
  }
  return out;
}

/** Bytes of the fixed fields before the streams in the GRID and ROUT sections. */
const STREAM_STARTS: Partial<Record<string, number>> = { GRID: 20, ROUT: 16 };

/** Tags whose fixed fields the format defines (their values are covered by the object scan). */
const KNOWN_TAGS = new Set(['GRID', 'ROUT', 'MARK', 'CLMB', 'SUMM']);

/**
 * Byte ranges [from, to) of a scene's Rice streams and of the payloads of sections the format
 * does not define, from its section table. When the table cannot be read: no streams, and the
 * whole file as unknown, so everything is scanned at full strength.
 */
export function sceneLayout(bytes: Uint8Array): {
  streams: [number, number][];
  unknown: [number, number][];
} {
  const streams: [number, number][] = [];
  const unknown: [number, number][] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = HEADER_BYTES; offset < bytes.length;) {
    const start = offset + SECTION_HEADER_BYTES;
    const end = start > bytes.length ? Infinity : start + view.getUint32(offset + 4, true);
    if (end > bytes.length) return { streams: [], unknown: [[0, bytes.length]] };
    const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const fields = STREAM_STARTS[tag];
    if (fields !== undefined && start + fields <= end) streams.push([start + fields, end]);
    if (!KNOWN_TAGS.has(tag)) unknown.push([start, end]);
    offset = end;
  }
  return { streams, unknown };
}

/** Findings in the raw bytes of a scene (see the file comment). */
export function scanBytes(bytes: Uint8Array, secrets: LocationSecrets): PrivacyFinding[] {
  const p = prepare(secrets);
  const findings: PrivacyFinding[] = [];
  const found = (what: string, k: number) => {
    findings.push({ where: 'bytes', what: `${what} at byte ${String(k)}` });
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { streams, unknown } = sceneLayout(bytes);
  const within = (ranges: [number, number][], k: number) =>
    ranges.some(([from, to]) => k >= from && k < to);
  const pair = (a: number, b: number) => (p.inLat(a) && p.inLon(b)) || (p.inLon(a) && p.inLat(b));
  const inBox = (v: number) => p.inLat(v) || p.inLon(v);
  const n = bytes.length;
  for (let k = 0; k < n; k++) {
    const f64 = k + 8 <= n ? view.getFloat64(k, true) : NaN;
    const f32 = k + 4 <= n ? view.getFloat32(k, true) : NaN;
    if (p.exact.has(f64)) found('float64 coordinate', k);
    else if (p.nearKey(f64)) found('float64 near a bound, centre or end point', k);
    if (p.nearKey(f32)) found('float32 near a bound, centre or end point', k);
    if (k + 16 <= n && pair(f64, view.getFloat64(k + 8, true))) found('float64 lat/lon pair', k);
    if (k + 8 <= n && pair(f32, view.getFloat32(k + 4, true))) found('float32 lat/lon pair', k);
    if (within(streams, k)) continue;
    const free = within(unknown, k);
    if (free && inBox(f64)) found('float64 inside the area', k);
    if (free && inBox(f32)) found('float32 inside the area', k);
    if (free) {
      const f64next = k + 16 <= n ? view.getFloat64(k + 8, true) : NaN;
      const f32next = k + 8 <= n ? view.getFloat32(k + 4, true) : NaN;
      for (const box of p.projected) {
        const xy = (a: number, b: number) =>
          (box.inX(a) && box.inY(b)) || (box.inY(a) && box.inX(b));
        if (xy(f64, f64next)) found(`float64 ${box.name} (x, y) pair`, k);
        if (xy(f32, f32next)) found(`float32 ${box.name} (x, y) pair`, k);
      }
    }
    if (k + 4 <= n) {
      const i32 = view.getInt32(k, true);
      const next = k + 8 <= n ? view.getInt32(k + 4, true) : NaN;
      for (const scale of INTEGER_SCALES) {
        const degrees = i32 / scale;
        if (p.nearKey(degrees)) found(`int32 at ${String(scale)}/° near a key value`, k);
        else if (free && inBox(degrees)) found(`int32 at ${String(scale)}/° inside the area`, k);
        if (pair(degrees, next / scale)) found(`int32 lat/lon pair at ${String(scale)}/°`, k);
      }
      const a16 = view.getUint16(k, true);
      const b16 = view.getUint16(k + 2, true);
      // A pair with a zero in it (tile x 0, by the antimeridian) is the same bytes as one u32,
      // which outside undefined sections is any length or count (a MARK section of 35 bytes read
      // as tile (0, 35) at zoom 6): looked for in undefined sections only, like a lone number.
      const p16 = `${String(a16)},${String(b16)}`;
      if (p.tilePairs.has(p16) && (free || (a16 !== 0 && b16 !== 0))) found('u16 tile pair', k);
      if (free && p.tileNumbers.has(view.getUint16(k, true))) found('u16 tile number', k);
      if (free && p.tileNumbers.has(view.getUint32(k, true))) found('u32 tile number', k);
    } else if (k + 2 <= n && free && p.tileNumbers.has(view.getUint16(k, true))) {
      found('u16 tile number', k);
    }
    if (k + 8 <= n) {
      const a32 = view.getUint32(k, true);
      const b32 = view.getUint32(k + 4, true);
      const p32 = `${String(a32)},${String(b32)}`;
      if (p.tilePairs.has(p32) && (free || (a32 !== 0 && b32 !== 0))) found('u32 tile pair', k);
    }
  }
  for (const [from, to] of unknown) {
    const text = String.fromCharCode(...bytes.subarray(from, to));
    for (const match of text.matchAll(DECIMAL_TEXT)) {
      const v = Number(match[0]);
      if (inBox(v)) found(`decimal text "${match[0]}" inside the area`, from + match.index);
    }
  }
  return findings;
}

/** Findings in a decoded scene, or any object (see the file comment). */
export function scanObject(value: unknown, secrets: LocationSecrets): PrivacyFinding[] {
  const p = prepare(secrets);
  const findings: PrivacyFinding[] = [];
  const forbidden = new Set(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));
  const found = (what: string) => {
    findings.push({ where: 'object', what });
  };
  const pair = (a: number, b: number) => (p.inLat(a) && p.inLon(b)) || (p.inLon(a) && p.inLat(b));

  const number = (n: number, path: string, key: string, scalar: boolean) => {
    if (!Number.isFinite(n)) return;
    if (p.nearKey(n)) found(`${path} is a bound, centre or end point (${String(n)})`);
    if (Math.abs(n) >= TIMESTAMP_MIN) found(`${path} looks like a timestamp (${String(n)})`);
    if (
      scalar &&
      Number.isInteger(n) &&
      ((key === 'x' && p.tileXs.has(n)) || (key === 'y' && p.tileYs.has(n)))
    ) {
      found(`${path} equals a tile index (${String(n)})`);
    }
  };
  /** Adjacent elements of a numeric sequence that form a (lat, lon) pair. */
  const sequence = (values: ArrayLike<number>, path: string, key: string) => {
    for (let i = 0; i < values.length; i++) {
      const v = values[i] ?? NaN;
      number(v, `${path}[${String(i)}]`, key, false);
      if (i + 1 < values.length && pair(v, values[i + 1] ?? NaN)) {
        found(`${path}[${String(i)}], [${String(i + 1)}] form a lat/lon pair`);
      }
    }
  };
  const walk = (node: unknown, path: string, key: string) => {
    if (typeof node === 'number') {
      number(node, path, key, true);
    } else if (typeof node === 'string') {
      for (const f of scanText(node)) found(`${path}: ${f.what}`);
    } else if (ArrayBuffer.isView(node) && !(node instanceof DataView)) {
      const array = node as unknown as ArrayLike<number | bigint>;
      sequence(
        Array.from({ length: array.length }, (_, i) => Number(array[i])),
        path,
        key,
      );
    } else if (Array.isArray(node)) {
      if (node.every((item) => typeof item === 'number')) {
        sequence(node, path, key);
      } else {
        node.forEach((item: unknown, i) => {
          walk(item, `${path}[${String(i)}]`, key);
        });
      }
    } else if (node !== null && typeof node === 'object') {
      const numbers: [string, number][] = [];
      for (const [k, v] of Object.entries(node)) {
        if (forbidden.has(k.toLowerCase())) found(`forbidden key ${path}.${k}`);
        if (typeof v === 'number') numbers.push([k, v]);
        walk(v, `${path}.${k}`, k);
      }
      for (const [ka, a] of numbers) {
        for (const [kb, b] of numbers) {
          if (ka < kb && pair(a, b)) found(`${path}.${ka} and .${kb} form a lat/lon pair`);
        }
      }
    }
  };
  walk(value, '$', '');
  return findings;
}

/** Findings in published text: Activities' coordinate check. */
export function scanText(text: string): PrivacyFinding[] {
  const match = ACTIVITIES_COORDINATE_PATTERN.exec(text);
  return match
    ? [{ where: 'text', what: `"${match[0]}" matches ${String(ACTIVITIES_COORDINATE_PATTERN)}` }]
    : [];
}

/** Every finding for a scene: its bytes, its decoded form and its published sidecar text. */
export function scanScene(
  { bytes, scene, sidecar }: { bytes: Uint8Array; scene: unknown; sidecar: string },
  secrets: LocationSecrets,
): PrivacyFinding[] {
  return [...scanBytes(bytes, secrets), ...scanObject(scene, secrets), ...scanText(sidecar)];
}
