/**
 * `.scene` bytes → Scene (docs/SCENE.md). The bytes come from a host's fetch, so nothing in them
 * is trusted: every size is checked against its limit before anything is allocated, every read is
 * bounds-checked, and every failure is a {@link SceneError} with a reason.
 */
import { SceneError } from './error';
import {
  CLIMB_BYTES,
  HEADER_BYTES,
  MARKER_BYTES,
  SCENE_LIMITS,
  SCENE_MAGIC,
  SCENE_VERSION,
  SECTION_HEADER_BYTES,
  SECTION_TAGS,
  checkSceneData,
  predictLevel,
  toScene,
  type ClimbData,
  type MarkerData,
  type SceneData,
  type SectionTag,
} from './format';
import { BitReader, readStream } from './rice';
import type { Scene } from './types';

export { SceneError, type SceneErrorReason } from './error';

/** Little-endian fixed-width fields from `bytes[start, end)`, bounds-checked. */
class FieldReader {
  private readonly view: DataView;
  private offset: number;
  private readonly end: number;
  constructor(bytes: Uint8Array, start: number, end: number) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = start;
    this.end = end;
  }
  get position(): number {
    return this.offset;
  }
  private take(n: number): number {
    if (this.offset + n > this.end) throw new SceneError('truncated', 'A section ends too soon');
    const at = this.offset;
    this.offset += n;
    return at;
  }
  u8() {
    return this.view.getUint8(this.take(1));
  }
  u16() {
    return this.view.getUint16(this.take(2), true);
  }
  u32() {
    return this.view.getUint32(this.take(4), true);
  }
  i32() {
    return this.view.getInt32(this.take(4), true);
  }
}

function limit(value: number, min: number, max: number, what: string): number {
  if (value < min || value > max) {
    throw new SceneError(
      'range',
      `${what} ${String(value)} is outside ${String(min)}–${String(max)}`,
    );
  }
  return value;
}

function reserved(value: number, what: string): void {
  if (value !== 0) throw new SceneError('corrupt', `${what} is not zero`);
}

/** The reader of a section's trailing streams must end exactly at the section's end. */
function expectEnd(position: number, end: number, tag: SectionTag): void {
  if (position !== end) {
    throw new SceneError(
      'length',
      `Section ${tag} is ${String(end - position)} bytes longer than its fields`,
    );
  }
}

function readGrid(bytes: Uint8Array, start: number, end: number): SceneData['grid'] {
  const f = new FieldReader(bytes, start, end);
  const L = SCENE_LIMITS;
  const width = limit(f.u16(), L.minGridSide, L.maxGridSide, 'Grid width');
  const height = limit(f.u16(), L.minGridSide, L.maxGridSide, 'Grid height');
  const zoom = f.u8();
  reserved(f.u8(), 'The grid reserved byte');
  const stepMm = f.u16();
  const mpsX = f.u32();
  const mpsY = f.u32();
  const offset = f.i32();
  const reader = new BitReader(bytes, f.position, end);
  // Each value takes at least one bit: a stream shorter than that is truncated, not a big alloc.
  if ((end - f.position) * 8 < width * height) {
    throw new SceneError('truncated', 'The grid stream is shorter than its samples');
  }
  const residuals = readStream(reader, width * height);
  expectEnd(reader.position, end, 'GRID');
  const levels = new Int32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const at = j * width + i;
      const level = (residuals[at] ?? 0) + predictLevel(levels, width, i, j);
      // Checked as it is rebuilt, so a corrupt stream cannot run the predictor off into huge values.
      if (level < 0 || level > L.maxGridLevel) {
        throw new SceneError('range', `Grid level ${String(level)} is out of range`);
      }
      levels[at] = level;
    }
  }
  return { width, height, zoom, stepMm, mpsX, mpsY, offset, levels };
}

/** Running sums of first differences (the inverse of the encoder's `differences`). */
function sums(residuals: Int32Array, what: string): Int32Array {
  const out = new Int32Array(residuals.length);
  let value = 0;
  for (let k = 0; k < residuals.length; k++) {
    value += residuals[k] ?? 0;
    if (Math.abs(value) > 0x7fff_ffff) throw new SceneError('range', `${what} overflows`);
    out[k] = value;
  }
  return out;
}

function readRoute(bytes: Uint8Array, start: number, end: number): SceneData['route'] {
  const f = new FieldReader(bytes, start, end);
  const count = limit(
    f.u32(),
    SCENE_LIMITS.minRoutePoints,
    SCENE_LIMITS.maxRoutePoints,
    'Route points',
  );
  const flags = f.u8();
  if ((flags & ~1) !== 0) throw new SceneError('corrupt', 'Unknown route flags');
  reserved(f.u8() | f.u8() | f.u8(), 'The route reserved bytes');
  const routeStart = f.u32();
  const routeEnd = f.u32();
  const streams = flags & 1 ? 4 : 3;
  if ((end - f.position) * 8 < streams * count) {
    throw new SceneError('truncated', 'The route streams are shorter than their points');
  }
  const reader = new BitReader(bytes, f.position, end);
  const x = sums(readStream(reader, count), 'Route x');
  const y = sums(readStream(reader, count), 'Route y');
  const elevation = sums(readStream(reader, count), 'Route elevation');
  const time = flags & 1 ? sums(readStream(reader, count), 'Route time') : null;
  expectEnd(reader.position, end, 'ROUT');
  return { start: routeStart, end: routeEnd, x, y, elevation, time };
}

function readMarkers(bytes: Uint8Array, start: number, end: number): MarkerData[] {
  const f = new FieldReader(bytes, start, end);
  const count = limit(f.u8(), 1, 3, 'Markers');
  if (end - start !== 1 + MARKER_BYTES * count) {
    throw new SceneError('length', 'The marker section length does not match its count');
  }
  const markers: MarkerData[] = [];
  for (let k = 0; k < count; k++) {
    markers.push({ kind: f.u8(), distance: f.u32(), x: f.i32(), y: f.i32(), elevation: f.i32() });
  }
  return markers;
}

function readClimbs(bytes: Uint8Array, start: number, end: number): ClimbData[] {
  const f = new FieldReader(bytes, start, end);
  const count = f.u8();
  if (end - start !== 1 + CLIMB_BYTES * count) {
    throw new SceneError('length', 'The climb section length does not match its count');
  }
  const climbs: ClimbData[] = [];
  for (let k = 0; k < count; k++) {
    const climbStart = f.u32();
    const climbEnd = f.u32();
    const gain = f.u32();
    const grade = f.u16();
    const flags = f.u8();
    if ((flags & ~1) !== 0) throw new SceneError('corrupt', 'Unknown climb flags');
    climbs.push({ start: climbStart, end: climbEnd, gain, grade, steepest: flags === 1 });
  }
  return climbs;
}

function readSummary(bytes: Uint8Array, start: number, end: number): SceneData['summary'] {
  if (end - start !== 8) throw new SceneError('length', 'The summary section is not 8 bytes');
  const f = new FieldReader(bytes, start, end);
  return { distance: f.u32(), climb: f.u32() };
}

const isKnownTag = (tag: string): tag is SectionTag =>
  (SECTION_TAGS as readonly string[]).includes(tag);

/**
 * Decodes a `.scene` file. Sections with tags this version does not know are skipped (a newer
 * writer may add them within version 1); a file of another version is refused.
 *
 * @throws SceneError for anything that is not a valid version-1 scene; never another exception.
 */
export function decodeScene(input: ArrayBuffer | Uint8Array): Scene {
  try {
    return decode(input instanceof Uint8Array ? input : new Uint8Array(input));
  } catch (error) {
    if (error instanceof SceneError) throw error;
    // A bug here must still surface as "not a valid scene" to the host, with the cause kept.
    throw new SceneError('corrupt', `Unreadable scene: ${String(error)}`);
  }
}

function decode(bytes: Uint8Array): Scene {
  if (bytes.length < 4 || SCENE_MAGIC.some((byte, i) => bytes[i] !== byte)) {
    throw new SceneError('magic', 'Not a Vert scene (bad magic)');
  }
  if (bytes.length < HEADER_BYTES) throw new SceneError('truncated', 'The header is cut short');
  const header = new FieldReader(bytes, 4, HEADER_BYTES);
  const version = header.u16();
  if (version !== SCENE_VERSION) {
    throw new SceneError('version', `Scene format version ${String(version)} is not supported`);
  }
  reserved(header.u16(), 'The header reserved field');
  const length = header.u32();
  if (length > bytes.length)
    throw new SceneError('truncated', 'The file is shorter than its header says');
  if (length < bytes.length)
    throw new SceneError('length', 'The file is longer than its header says');

  const found = new Map<SectionTag, { start: number; end: number }>();
  let offset = HEADER_BYTES;
  while (offset < length) {
    if (offset + SECTION_HEADER_BYTES > length)
      throw new SceneError('truncated', 'A section header is cut short');
    const tagBytes = bytes.subarray(offset, offset + 4);
    if (tagBytes.some((b) => b < 0x21 || b > 0x7e)) {
      throw new SceneError('corrupt', 'A section tag is not four printable ASCII characters');
    }
    const tag = String.fromCharCode(...tagBytes);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const start = offset + SECTION_HEADER_BYTES;
    if (size > length - start)
      throw new SceneError('truncated', `Section ${tag} runs past the end`);
    if (isKnownTag(tag)) {
      if (found.has(tag)) throw new SceneError('length', `Section ${tag} appears twice`);
      found.set(tag, { start, end: start + size });
    }
    offset = start + size;
  }
  const at = (tag: SectionTag) => {
    const range = found.get(tag);
    if (!range) throw new SceneError('length', `Section ${tag} is missing`);
    return range;
  };
  const grid = at('GRID');
  const route = at('ROUT');
  const markers = at('MARK');
  const climbs = at('CLMB');
  const summary = at('SUMM');
  const data: SceneData = {
    grid: readGrid(bytes, grid.start, grid.end),
    route: readRoute(bytes, route.start, route.end),
    markers: readMarkers(bytes, markers.start, markers.end),
    climbs: readClimbs(bytes, climbs.start, climbs.end),
    summary: readSummary(bytes, summary.start, summary.end),
  };
  checkSceneData(data);
  return toScene(data);
}
