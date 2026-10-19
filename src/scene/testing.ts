/**
 * Synthetic terrain for scene tests, where real tiles are not available offline.
 *
 * - {@link syntheticHeightfield}: a scene grid made directly (no tiles, so no pixel lattice): a
 *   smooth relief plus Gaussian noise whose gradient-predictor residual has the root-mean-square
 *   measured on real grids (docs/SCENE.md, "Sizes"). For a given variance, Gaussian noise has the
 *   highest entropy, so it costs at least as many bits per sample as the real grid it stands in for
 *   (the size tests check that too).
 * - {@link syntheticTiles}: Terrarium-like tiles for `buildHeightfield`, rough at the pixel level,
 *   so the privacy tests can run the real mosaic → sampler path and look for the pixel pitch.
 */
import { buildRun, type RunSummary } from '../gpx/handler';
import { parseGpx } from '../gpx/parse';
import {
  MERCATOR_RADIUS_M,
  lonLatToWorld,
  worldToLonLat,
  type Bounds,
  type TileCoord,
} from '../lib/geo';
import type { RunTrack } from '../page/types';
import type { Heightfield } from '../terrain/heightfield';
import { sceneGridShape } from './build';
import { HEADER_BYTES, SCENE_LONG_SIDE, SECTION_HEADER_BYTES } from './format';

/**
 * The real scene grids of the four routes in docs/SCENE.md ("Sizes"): built from AWS Terrain Tiles
 * as the bake builds them (`SCENE_HEIGHTFIELD_OPTIONS`, framed on the route trimmed by 200 m, 15%
 * padding), at the default elevation step. Spacing (m), residual RMS of the W + N − NW predictor
 * (m), elevation range (m) and the grid stream's bits per sample.
 */
export const MEASURED_TERRAIN = {
  coosa: { spacing: 21.17, residualRms: 0.932, range: 751.5, bitsPerSample: 4.341 },
  lavaredo: { spacing: 20.84, residualRms: 0.622, range: 1927.2, bitsPerSample: 3.25 },
  eiger: { spacing: 60.17, residualRms: 4.244, range: 3055.0, bitsPerSample: 4.82 },
  ccc: { spacing: 122.79, residualRms: 11.993, range: 4274.7, bitsPerSample: 5.41 },
} as const;

/** Deterministic uniform numbers in [0, 1) (mulberry32). */
export function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticTerrain {
  /** Residual RMS of the gradient predictor, metres (the measured roughness). */
  readonly residualRms: number;
  /** Peak-to-peak height of the smooth relief, metres. */
  readonly range: number;
  /** Lowest elevation of the relief, metres. */
  readonly base?: number;
  readonly zoom?: number;
  readonly longSide?: number;
  readonly seed?: number;
}

/**
 * A heightfield over `bounds` (used as the padded grid bounds as they are), laid out as
 * `buildHeightfield` lays one out at `longSide`, with synthetic elevations. Made sample by sample
 * with no source raster, it carries no pixel pitch, so it is marked `sampling: 'smooth'` as
 * `buildScene` requires.
 */
export function syntheticHeightfield(
  bounds: Bounds,
  {
    residualRms,
    range,
    base = 500,
    zoom = 13,
    longSide = SCENE_LONG_SIDE,
    seed = 1,
  }: SyntheticTerrain,
): Heightfield {
  const { width, height } = sceneGridShape({ bounds }, longSide);
  const random = randomStream(seed);
  // White noise of σ gives a gradient-predictor residual of 2σ (four independent samples).
  const sigma = residualRms / 2;
  const gaussian = () => {
    const u = 1 - random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const elevations = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const u = i / (width - 1);
      const v = j / (height - 1);
      const relief =
        0.5 +
        0.3 * Math.sin(2 * Math.PI * (1.3 * u + 0.2)) * Math.cos(2 * Math.PI * (0.9 * v)) +
        0.2 * Math.sin(2 * Math.PI * (3.1 * u + 2.3 * v));
      const e = base + range * relief + sigma * gaussian();
      elevations[j * width + i] = e;
      const stored = elevations[j * width + i] ?? e;
      if (stored < min) min = stored;
      if (stored > max) max = stored;
    }
  }
  const nw = lonLatToWorld(bounds.west, bounds.north);
  const se = lonLatToWorld(bounds.east, bounds.south);
  const centreLat = worldToLonLat(0, (nw.y + se.y) / 2).lat;
  const metresPerWorldUnit =
    2 * Math.PI * MERCATOR_RADIUS_M * Math.cos((centreLat * Math.PI) / 180);
  return {
    bounds,
    zoom,
    width,
    height,
    elevations,
    min,
    max,
    metresPerSample: {
      x: ((se.x - nw.x) / (width - 1)) * metresPerWorldUnit,
      y: ((se.y - nw.y) / (height - 1)) * metresPerWorldUnit,
    },
    failedTiles: [],
    sampling: 'smooth',
  };
}

/** A hash of a tile pixel into [−0.5, 0.5): independent noise per pixel, the same on every run. */
function pixelNoise(z: number, x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul(z + 1, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 2 ** 32 - 0.5;
}

/**
 * A tile source for `buildHeightfield`: rolling relief of `range` metres plus independent noise
 * of `noise` metres (peak to peak) at every tile pixel. Pixel-level noise is the worst case for
 * the pixel pitch: every pixel is a knot of the source lattice.
 */
export function syntheticTiles({
  range = 600,
  noise = 6,
  base = 500,
  seed = 7,
}: { range?: number; noise?: number; base?: number; seed?: number } = {}) {
  return ({ z, x, y }: TileCoord): Promise<Float32Array> => {
    const size = 256;
    const out = new Float32Array(size * size);
    const n = 2 ** z * size;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const X = x * size + px;
        const Y = y * size + py;
        const { lon, lat } = worldToLonLat((X + 0.5) / n, (Y + 0.5) / n);
        const relief = 0.5 + 0.5 * Math.sin(lon * 90) * Math.cos(lat * 120);
        out[py * size + px] = base + range * relief + noise * pixelNoise(z, X, Y, seed);
      }
    }
    return Promise.resolve(out);
  };
}

/** `bounds` grown by `fraction` of its width and height on every side (buildHeightfield's 15%). */
export function padded(bounds: Bounds, fraction = 0.15): Bounds {
  const x = (bounds.east - bounds.west) * fraction;
  const y = (bounds.north - bounds.south) * fraction;
  return {
    west: bounds.west - x,
    east: bounds.east + x,
    south: bounds.south - y,
    north: bounds.north + y,
  };
}

/** A parsed GPX as the app holds it: the run's figures and its whole track. */
export function runFromGpx(text: string): { run: RunSummary; track: RunTrack } {
  const { run, points } = buildRun(parseGpx(text), 'test.gpx', false);
  return { run, track: points };
}

/** Byte length of each section of a scene file, by tag (header and padding not included). */
export function sectionLengths(bytes: Uint8Array): Record<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, number> = {};
  for (let offset = HEADER_BYTES; offset + SECTION_HEADER_BYTES <= bytes.length;) {
    const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    out[tag] = length;
    offset += SECTION_HEADER_BYTES + length;
  }
  return out;
}
