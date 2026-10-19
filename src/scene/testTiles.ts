/// <reference types="node" />
/**
 * Real elevation tiles for scene tests, from the local cache only (Node; tests never fetch).
 * `scripts/.cache/terrarium/{z}/{x}/{y}.png` is the git-ignored cache that `pnpm sample`
 * (scripts/make-sample.mjs) fills from AWS Terrain Tiles; tests that need tiles it lacks skip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildRun } from '../gpx/handler';
import { parseGpx } from '../gpx/parse';
import { trimTrack } from '../gpx/trim';
import { boundsOf, tilesForBounds, type Bounds, type TileCoord } from '../lib/geo';
import { decodeTerrarium } from '../lib/terrarium';
import type { Run, RunTrack } from '../page/types';
import { DEFAULT_PADDING, buildHeightfield, chooseHeightfieldZoom } from '../terrain/heightfield';
import { SCENE_HEIGHTFIELD_OPTIONS } from './build';

export const TILE_CACHE = new URL('../../scripts/.cache/terrarium/', import.meta.url);

const tileUrl = ({ z, x, y }: TileCoord) =>
  new URL(`${String(z)}/${String(x)}/${String(y)}.png`, TILE_CACHE);

/** Terrarium elevations of a cached PNG tile (8-bit RGB or RGBA, non-interlaced). */
export function readCachedTile(coord: TileCoord): Float32Array {
  const png = readFileSync(tileUrl(coord));
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)] ?? 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (px[row * stride + i - channels] ?? 0) : 0;
      const b = row > 0 ? (px[(row - 1) * stride + i] ?? 0) : 0;
      const c = i >= channels && row > 0 ? (px[(row - 1) * stride + i - channels] ?? 0) : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter] ?? 0;
      px[row * stride + i] = ((raw[row * (stride + 1) + 1 + i] ?? 0) + predictor) & 0xff;
    }
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = decodeTerrarium(
      px[i * channels] ?? 0,
      px[i * channels + 1] ?? 0,
      px[i * channels + 2] ?? 0,
    );
  }
  return out;
}

/** Whether every tile `buildHeightfield` would fetch for `bounds` (default options) is cached. */
export function hasCachedTiles(bounds: Bounds): boolean {
  const x = (bounds.east - bounds.west) * DEFAULT_PADDING;
  const y = (bounds.north - bounds.south) * DEFAULT_PADDING;
  const area = {
    west: bounds.west - x,
    east: bounds.east + x,
    south: bounds.south - y,
    north: bounds.north + y,
  };
  const zoom = chooseHeightfieldZoom(area);
  if (zoom === null || !existsSync(TILE_CACHE)) return false;
  return tilesForBounds(area, zoom).every((tile) => existsSync(tileUrl(tile)));
}

/** The bounds of a track's points. */
export function trackBounds(track: Pick<RunTrack, 'lat' | 'lon'>): Bounds {
  return boundsOf(Array.from(track.lat, (lat, k) => ({ lat, lon: track.lon[k] ?? 0 })));
}

/** A route of docs/SCENE.md whose GPX is in the repo (the sample) or in `fixtures/courses`. */
export interface RealRoute {
  readonly name: string;
  readonly run: Omit<Run, 'id' | 'track'>;
  readonly track: RunTrack;
  readonly drawn: RunTrack;
}

const SOURCES = [
  ['coosa', '../../public/samples/coosa-backcountry.gpx'],
  ['lavaredo', '../../fixtures/courses/lavaredo-20k.gpx'],
  ['eiger', '../../fixtures/courses/eiger-e51.gpx'],
  ['ccc', '../../fixtures/courses/montblanc-ccc.gpx'],
] as const;

/** The routes whose GPX is here, trimmed by `trim` metres. */
export function realRoutes(trim = 200): RealRoute[] {
  const out: RealRoute[] = [];
  for (const [name, path] of SOURCES) {
    const url = new URL(path, import.meta.url);
    if (!existsSync(url)) continue;
    const { run, points } = buildRun(parseGpx(readFileSync(url, 'utf8')), `${name}.gpx`, false);
    const drawn = trim > 0 ? trimTrack(points, trim) : points;
    if (drawn) out.push({ name, run, track: points, drawn });
  }
  return out;
}

/** The scene heightfield of `bounds` from cached tiles (check {@link hasCachedTiles} first). */
export function cachedSceneHeightfield(bounds: Bounds) {
  return buildHeightfield(bounds, {
    ...SCENE_HEIGHTFIELD_OPTIONS,
    fetchTile: (tile) => Promise.resolve(readCachedTile(tile)),
  });
}
