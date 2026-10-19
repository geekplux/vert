// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
/**
 * The pitch attack (pitchAttack.ts) against scene grids: the tiles' native pixel pitch, which with
 * the zoom gives the latitude, must not show. Synthetic tiles (noise at every pixel, the worst
 * case) go through the real mosaic → sampler path at pitches that alias into the spectrum for
 * downsampled and upsampled grids; with the bilinear sampler the attack must find the pitch (so
 * the test can see what it looks for), with the scene's smooth sampler it must not. Real Coosa and
 * Lavaredo terrain runs too when its tiles are in the local cache (testTiles.ts; never fetched).
 */
import { describe, expect, it } from 'vitest';
import { haversine, lonLatToWorld, worldToLonLat, type Bounds } from '../lib/geo';
import type { RunTrack } from '../page/types';
import { buildHeightfield, type Heightfield } from '../terrain/heightfield';
import { SCENE_HEIGHTFIELD_OPTIONS, buildScene, type SceneRun } from './build';
import { decodeScene } from './decode';
import { encodeScene } from './encode';
import {
  isPitchDetected,
  isPitchHidden,
  latitudeCandidates,
  nativePitch,
  pitchSignature,
} from './pitchAttack';
import { syntheticTiles } from './testing';
import { cachedSceneHeightfield, hasCachedTiles, realRoutes, trackBounds } from './testTiles';
import type { SceneGrid } from './types';

/** Latitude of a heightfield's Mercator centre (the latitude its spacing is measured at). */
function centreLatitude(hf: Heightfield): number {
  const nw = lonLatToWorld(hf.bounds.west, hf.bounds.north);
  const se = lonLatToWorld(hf.bounds.east, hf.bounds.south);
  return worldToLonLat(0, (nw.y + se.y) / 2).lat;
}

/** A straight two-point track across the middle of `bounds`. */
function lineAcross(bounds: Bounds): RunTrack {
  const a = {
    lat: (bounds.north * 2 + bounds.south) / 3,
    lon: bounds.west * 0.8 + bounds.east * 0.2,
  };
  const b = {
    lat: (bounds.north + bounds.south * 2) / 3,
    lon: bounds.west * 0.2 + bounds.east * 0.8,
  };
  return {
    lat: Float64Array.of(a.lat, b.lat),
    lon: Float64Array.of(a.lon, b.lon),
    ele: null,
    cumulative: Float64Array.of(0, haversine(a, b)),
    time: null,
  };
}

const NO_RUN: SceneRun = { distance: 0, vert: NaN, startTime: NaN, climbs: [] };

/** The decoded grid of the scene `buildScene` makes from `hf` and `track`. */
function sceneGrid(hf: Heightfield, track: RunTrack, run: SceneRun = NO_RUN): SceneGrid {
  const distance = Math.max(run.distance, track.cumulative.at(-1) ?? 0);
  return decodeScene(encodeScene(buildScene(hf, track, { ...run, distance }))).grid;
}

/** The same heightfield as a grid, without the scene (for the bilinear control). */
function rawGrid(hf: Heightfield): SceneGrid {
  return { ...hf, elevationStep: 0.001 };
}

/** The attack's verdict and the nearest candidate latitude to the truth, degrees. */
function attack(grid: SceneGrid, latitude: number) {
  const signature = pitchSignature(grid, latitude);
  const candidates = [
    ...latitudeCandidates(grid, signature.x.peak),
    ...latitudeCandidates(grid, signature.y.peak),
  ];
  const nearest = candidates.reduce((best, c) => Math.min(best, Math.abs(c - latitude)), Infinity);
  return { signature, nearest };
}

/** Synthetic areas: grid samples per native pixel from 0.7 (downsampled) to 2.3 (upsampled). */
const AREAS: { name: string; bounds: Bounds }[] = [
  { name: 'downsampled, z13', bounds: { west: -83.95, east: -83.9, south: 34.76, north: 34.8 } },
  {
    name: 'upsampled ×1.4, z14',
    bounds: { west: -83.93, east: -83.916, south: 34.774, north: 34.786 },
  },
  {
    name: 'upsampled ×2.3, z14',
    bounds: { west: 12.3, east: 12.309, south: 46.557, north: 46.563 },
  },
];

describe('pitch attack on synthetic tiles (noise at every pixel)', () => {
  const tiles = syntheticTiles();
  for (const { name, bounds } of AREAS) {
    it(`${name}: bilinear shows the pitch, the scene sampler hides it`, async () => {
      const bilinear = await buildHeightfield(bounds, {
        gridSize: SCENE_HEIGHTFIELD_OPTIONS.gridSize,
        fetchTile: tiles,
      });
      const smooth = await buildHeightfield(bounds, {
        ...SCENE_HEIGHTFIELD_OPTIONS,
        fetchTile: tiles,
      });
      const latitude = centreLatitude(smooth);
      const pitch = nativePitch(latitude, smooth.metresPerSample.x, smooth.zoom);
      const control = attack(rawGrid(bilinear), latitude);
      const scene = attack(sceneGrid(smooth, lineAcross(bounds)), latitude);
      console.log(
        `${name}: ${pitch.toFixed(3)} samples/pixel; bilinear alias ×${control.signature.x.aliasPower.toFixed(1)}/${control.signature.y.aliasPower.toFixed(1)} (nearest candidate ${control.nearest.toFixed(3)}°); scene ×${scene.signature.x.aliasPower.toFixed(1)}/${scene.signature.y.aliasPower.toFixed(1)} (nearest ${scene.nearest.toFixed(2)}°)`,
      );
      expect(isPitchDetected(control.signature.x) || isPitchDetected(control.signature.y)).toBe(
        true,
      );
      expect(control.nearest).toBeLessThan(0.1);
      expect(isPitchHidden(scene.signature)).toBe(true);
      expect(scene.nearest).toBeGreaterThan(0.25);
    });
  }
});

/** The stretch of `track` between two distances. */
function stretch(track: RunTrack, from: number, to: number): RunTrack {
  const first = track.cumulative.findIndex((d) => d >= from);
  let last = track.cumulative.findIndex((d) => d > to);
  if (last < 0) last = track.cumulative.length;
  const cut = (a: Float64Array | null) => (a ? a.slice(first, last) : null);
  return {
    lat: track.lat.slice(first, last),
    lon: track.lon.slice(first, last),
    ele: cut(track.ele),
    cumulative: track.cumulative.slice(first, last),
    time: cut(track.time),
  };
}

describe('pitch attack on real terrain (cached tiles)', () => {
  for (const { name, run, drawn } of realRoutes().filter((r) =>
    ['coosa', 'lavaredo'].includes(r.name),
  )) {
    // The whole route, and shorter stretches of it: smaller areas sample finer zooms (z14), where
    // the grid is upsampled from the tiles.
    for (const [label, t, sceneRun] of [
      ['whole route', drawn, run],
      ['3.0–4.5 km', stretch(drawn, 3000, 4500), NO_RUN],
      ['3.0–6.0 km', stretch(drawn, 3000, 6000), NO_RUN],
      ['3.0–7.5 km', stretch(drawn, 3000, 7500), NO_RUN],
      ['3.0–9.0 km', stretch(drawn, 3000, 9000), NO_RUN],
    ] as const) {
      const bounds = trackBounds(t);
      it.skipIf(!hasCachedTiles(bounds))(`${name}, ${label}: the pitch does not show`, async () => {
        const hf = await cachedSceneHeightfield(bounds);
        const latitude = centreLatitude(hf);
        const { signature, nearest } = attack(sceneGrid(hf, t, sceneRun), latitude);
        console.log(
          `${name} ${label}: z${String(hf.zoom)}, alias ×${signature.x.aliasPower.toFixed(1)}/${signature.y.aliasPower.toFixed(1)} (neighbourhood ×${signature.x.neighbourPower.toFixed(1)}/${signature.y.neighbourPower.toFixed(1)}), nearest candidate ${nearest.toFixed(2)}°`,
        );
        expect(isPitchHidden(signature)).toBe(true);
        expect(nearest).toBeGreaterThan(0.25);
      });
    }
  }
});
