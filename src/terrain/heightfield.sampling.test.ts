import { describe, expect, it } from 'vitest';
import { worldToLonLat, type Bounds, type TileCoord } from '../lib/geo';
import { buildHeightfield, type BuildHeightfieldOptions, type Heightfield } from './heightfield';
import { TILE_SIZE } from './tiles';

/** Rough terrain at the tile pixels: smooth relief plus per-pixel noise (hash of the pixel). */
function noisyTile({ z, x, y }: TileCoord): Promise<Float32Array> {
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  const n = 2 ** z;
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const X = x * TILE_SIZE + px;
      const Y = y * TILE_SIZE + py;
      let h = Math.imul(X ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Y ^ 0xc2b2ae35, 0x27d4eb2f) ^ z;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
      h ^= h >>> 12;
      const { lon, lat } = worldToLonLat((X + 0.5) / (n * TILE_SIZE), (Y + 0.5) / (n * TILE_SIZE));
      out[py * TILE_SIZE + px] =
        800 + 300 * Math.sin(lon * 40) * Math.cos(lat * 55) + ((h >>> 0) / 2 ** 32 - 0.5) * 8;
    }
  }
  return Promise.resolve(out);
}

/** FNV-1a over a heightfield's shape, spacing and elevation bytes. */
function fingerprint(hf: Heightfield): string {
  const head = Float64Array.of(
    hf.width,
    hf.height,
    hf.zoom,
    hf.metresPerSample.x,
    hf.metresPerSample.y,
    hf.min,
    hf.max,
  );
  let hash = 0x811c9dc5;
  for (const bytes of [new Uint8Array(head.buffer), new Uint8Array(hf.elevations.buffer)]) {
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const CASES: { name: string; bounds: Bounds; options?: BuildHeightfieldOptions }[] = [
  { name: 'alps, native', bounds: { west: 7.4, south: 45.97, east: 7.5, north: 46.03 } },
  { name: 'small, z14', bounds: { west: -83.93, south: 34.76, east: -83.915, north: 34.77 } },
  {
    name: 'gridSize 320',
    bounds: { west: -83.95, south: 34.74, east: -83.9, north: 34.8 },
    options: { gridSize: 320 },
  },
  { name: 'long route', bounds: { west: 6.8, south: 45.8, east: 7.2, north: 46.1 } },
];

/**
 * The app's grids (the default `sampling: 'bilinear'`) must stay byte-identical to what they were
 * before the scene's smooth sampler was added: these fingerprints were taken from the code before
 * that change.
 */
const BEFORE: Record<string, string> = {
  'alps, native': 'b00cbe66',
  'small, z14': '688999cd',
  'gridSize 320': 'b4696a18',
  'long route': '98e8e762',
};

describe('buildHeightfield default sampling', () => {
  for (const { name, bounds, options } of CASES) {
    it(`is unchanged: ${name}`, async () => {
      const hf = await buildHeightfield(bounds, { ...options, fetchTile: noisyTile });
      expect(fingerprint(hf)).toBe(BEFORE[name]);
    });
  }
});
