/**
 * Scene → `.scene` bytes (docs/SCENE.md). Little-endian, deterministic: the same scene always
 * gives the same bytes.
 */
import { SceneError } from './error';
import {
  CLIMB_BYTES,
  HEADER_BYTES,
  MARKER_BYTES,
  SCENE_MAGIC,
  SCENE_STEPS,
  SCENE_VERSION,
  SECTION_HEADER_BYTES,
  checkSceneData,
  predictLevel,
  toSceneData,
  type SceneData,
  type SectionTag,
} from './format';
import { BitWriter, writeStream } from './rice';
import type { Scene } from './types';

/**
 * Residuals of the grid's levels against the gradient predictor: the first sample against 0, the
 * rest of the first row against the sample to the west, the rest of the first column against the
 * sample to the north, every other sample against west + north − north-west.
 */
export function gridResiduals(levels: Int32Array, width: number, height: number): Int32Array {
  const out = new Int32Array(levels.length);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const at = j * width + i;
      out[at] = (levels[at] ?? 0) - predictLevel(levels, width, i, j);
    }
  }
  return out;
}

/** Each value minus the one before it (the first minus 0). */
function differences(values: Int32Array): Int32Array {
  const out = new Int32Array(values.length);
  for (let k = 0; k < values.length; k++)
    out[k] = (values[k] ?? 0) - (k > 0 ? (values[k - 1] ?? 0) : 0);
  return out;
}

/** Little-endian fixed-width fields into a byte array. */
class Fields {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  u8(v: number) {
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }
  u16(v: number) {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }
  u32(v: number) {
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
  }
  i32(v: number) {
    this.view.setInt32(this.offset, v, true);
    this.offset += 4;
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function gridSection(grid: SceneData['grid']): Uint8Array {
  const head = new Fields(20);
  head.u16(grid.width);
  head.u16(grid.height);
  head.u8(grid.zoom);
  head.u8(0);
  head.u16(grid.stepMm);
  head.u32(grid.mpsX);
  head.u32(grid.mpsY);
  head.i32(grid.offset);
  const writer = new BitWriter();
  writeStream(writer, gridResiduals(grid.levels, grid.width, grid.height));
  return concat([head.bytes, writer.finish()]);
}

function routeSection(route: SceneData['route']): Uint8Array {
  const head = new Fields(16);
  head.u32(route.x.length);
  head.u8(route.time ? 1 : 0);
  head.u8(0);
  head.u8(0);
  head.u8(0);
  head.u32(route.start);
  head.u32(route.end);
  const writer = new BitWriter();
  writeStream(writer, differences(route.x));
  writeStream(writer, differences(route.y));
  writeStream(writer, differences(route.elevation));
  if (route.time) writeStream(writer, differences(route.time));
  return concat([head.bytes, writer.finish()]);
}

function markerSection(markers: SceneData['markers']): Uint8Array {
  const fields = new Fields(1 + MARKER_BYTES * markers.length);
  fields.u8(markers.length);
  for (const m of markers) {
    fields.u8(m.kind);
    fields.u32(m.distance);
    fields.i32(m.x);
    fields.i32(m.y);
    fields.i32(m.elevation);
  }
  return fields.bytes;
}

function climbSection(climbs: SceneData['climbs']): Uint8Array {
  const fields = new Fields(1 + CLIMB_BYTES * climbs.length);
  fields.u8(climbs.length);
  for (const c of climbs) {
    fields.u32(c.start);
    fields.u32(c.end);
    fields.u32(c.gain);
    fields.u16(c.grade);
    fields.u8(c.steepest ? 1 : 0);
  }
  return fields.bytes;
}

function summarySection(summary: SceneData['summary']): Uint8Array {
  const fields = new Fields(8);
  fields.u32(summary.distance);
  fields.u32(summary.climb);
  return fields.bytes;
}

function section(tag: SectionTag, payload: Uint8Array): Uint8Array {
  const head = new Fields(SECTION_HEADER_BYTES);
  for (let i = 0; i < 4; i++) head.u8(tag.charCodeAt(i));
  head.u32(payload.length);
  return concat([head.bytes, payload]);
}

/**
 * Refuses what quantising would hide: a missing value (`NaN`, which an integer array stores as 0;
 * only the summary's climb may be `NaN`, meaning unknown) and route distances that are not evenly
 * spaced (only the two ends are stored).
 */
function checkValues(scene: Scene): void {
  const { grid, route, markers, climbs, summary } = scene;
  const finite = (values: ArrayLike<number>, what: string) => {
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) throw new RangeError(`${what}[${String(i)}] is not finite`);
    }
  };
  finite(grid.elevations, 'grid.elevations');
  finite([grid.metresPerSample.x, grid.metresPerSample.y, grid.elevationStep], 'grid spacing/step');
  finite(route.x, 'route.x');
  finite(route.y, 'route.y');
  finite(route.distance, 'route.distance');
  finite(route.elevation, 'route.elevation');
  if (route.time) finite(route.time, 'route.time');
  for (const m of [markers.start, markers.finish, markers.summit]) {
    if (m) finite([m.distance, m.x, m.y, m.elevation], 'marker');
  }
  for (const c of climbs) finite([c.start, c.end, c.gain, c.avgGrade], 'climb');
  finite([summary.distance], 'summary.distance');
  const count = route.distance.length;
  const first = route.distance[0] ?? NaN;
  const last = route.distance[count - 1] ?? NaN;
  for (let k = 1; k < count - 1; k++) {
    const even = first + ((last - first) * k) / (count - 1);
    if (Math.abs((route.distance[k] ?? NaN) - even) > SCENE_STEPS.distance) {
      throw new RangeError('Route distances must be evenly spaced');
    }
  }
}

/** The bytes of already-quantised, checked `data`. */
export function encodeSceneData(data: SceneData): Uint8Array {
  const sections = [
    section('GRID', gridSection(data.grid)),
    section('ROUT', routeSection(data.route)),
    section('MARK', markerSection(data.markers)),
    section('CLMB', climbSection(data.climbs)),
    section('SUMM', summarySection(data.summary)),
  ];
  const length = HEADER_BYTES + sections.reduce((sum, s) => sum + s.length, 0);
  const header = new Fields(HEADER_BYTES);
  for (const byte of SCENE_MAGIC) header.u8(byte);
  header.u16(SCENE_VERSION);
  header.u16(0);
  header.u32(length);
  return concat([header.bytes, ...sections]);
}

/**
 * The `.scene` bytes of `scene` (format version {@link SCENE_VERSION}). Each value is rounded to
 * its step (`SCENE_STEPS`); fields that follow from others (grid `min`/`max`, the summary's
 * drawn length, extent and trim) are not stored.
 *
 * @throws RangeError when the scene breaks a rule of the format (a size, a range, a marker or
 *   climb rule: the message says which).
 */
export function encodeScene(scene: Scene): Uint8Array {
  checkValues(scene);
  const data = toSceneData(scene);
  try {
    checkSceneData(data);
  } catch (error) {
    if (error instanceof SceneError) throw new RangeError(`Not a valid scene: ${error.message}`);
    throw error;
  }
  return encodeSceneData(data);
}
