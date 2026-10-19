// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
/// <reference types="node" />
/**
 * Scene sizes against the budget (docs/SCENE.md, "Sizes"): at most 80 KB before compression for a
 * ~20 km route. Real tiles are not available offline, so the grids here are synthetic surfaces
 * with the roughness measured on the real terrain of each route (`MEASURED_TERRAIN`); each test
 * also checks that its synthetic grid costs at least as many bits per sample as the real one did,
 * so the sizes asserted here are no smaller than the real ones. Real scenes are checked too when
 * their tiles are in the local cache (testTiles.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { trimTrack } from '../gpx/trim';
import { boundsOf } from '../lib/geo';
import { buildScene } from './build';
import { decodeScene } from './decode';
import { encodeScene } from './encode';
import { HEADER_BYTES, SECTION_HEADER_BYTES } from './format';
import {
  MEASURED_TERRAIN,
  padded,
  runFromGpx,
  sectionLengths,
  syntheticHeightfield,
} from './testing';
import { cachedSceneHeightfield, hasCachedTiles, realRoutes, trackBounds } from './testTiles';

/** The budget, bytes. */
const BUDGET = 80_000;
/** Bytes of the grid section before its stream: the fixed fields. */
const GRID_FIELDS = 20;

function sceneOf(gpx: string, terrain: (typeof MEASURED_TERRAIN)[keyof typeof MEASURED_TERRAIN]) {
  const { run, track } = runFromGpx(gpx);
  const drawn = trimTrack(track, 200);
  if (!drawn) throw new Error('Route too short');
  const bounds = boundsOf(Array.from(drawn.lat, (lat, k) => ({ lat, lon: drawn.lon[k] ?? 0 })));
  const heightfield = syntheticHeightfield(padded(bounds), terrain);
  const scene = buildScene(heightfield, drawn, run);
  const bytes = encodeScene(scene);
  const lengths = sectionLengths(bytes);
  const gridBits = ((lengths.GRID ?? 0) - GRID_FIELDS) * 8;
  return {
    scene,
    bytes,
    bitsPerSample: gridBits / (scene.grid.width * scene.grid.height),
    routeBytes: lengths.ROUT ?? 0,
  };
}

function report(name: string, result: ReturnType<typeof sceneOf>) {
  const { scene, bytes, bitsPerSample, routeBytes } = result;
  console.log(
    `${name}: ${String(bytes.length)} B (grid ${String(scene.grid.width)}×${String(scene.grid.height)} at ${bitsPerSample.toFixed(2)} bits/sample, route ${String(scene.route.x.length)} points in ${String(routeBytes)} B)`,
  );
}

describe('scene size (synthetic terrain at measured roughness)', () => {
  it('Coosa sample (21.5 km): within 80 KB', () => {
    const result = sceneOf(sampleGpx, MEASURED_TERRAIN.coosa);
    report('coosa', result);
    expect(result.bitsPerSample).toBeGreaterThanOrEqual(MEASURED_TERRAIN.coosa.bitsPerSample);
    expect(result.bytes.length).toBeLessThanOrEqual(BUDGET);
    expect(result.bytes.length).toBeGreaterThan(HEADER_BYTES + 5 * SECTION_HEADER_BYTES);
  });

  const courses = [
    { name: 'lavaredo', file: 'lavaredo-20k.gpx' },
    { name: 'eiger', file: 'eiger-e51.gpx' },
    { name: 'ccc', file: 'montblanc-ccc.gpx' },
  ] as const;
  for (const { name, file } of courses) {
    const url = new URL(`../../fixtures/courses/${file}`, import.meta.url);
    describe.skipIf(!existsSync(url))(`${file} (fixture)`, () => {
      it('within 80 KB', () => {
        const result = sceneOf(readFileSync(url, 'utf8'), MEASURED_TERRAIN[name]);
        report(name, result);
        expect(result.bitsPerSample).toBeGreaterThanOrEqual(MEASURED_TERRAIN[name].bitsPerSample);
        expect(result.bytes.length).toBeLessThanOrEqual(BUDGET);
      });
    });
  }
});

describe('decode speed', () => {
  it('decodes the largest measured case quickly', () => {
    // The CCC (100 km, the largest real scene measured) when its fixture is here, else Coosa.
    const ccc = new URL('../../fixtures/courses/montblanc-ccc.gpx', import.meta.url);
    const { bytes } = existsSync(ccc)
      ? sceneOf(readFileSync(ccc, 'utf8'), MEASURED_TERRAIN.ccc)
      : sceneOf(sampleGpx, MEASURED_TERRAIN.coosa);
    decodeScene(bytes); // warm up
    const runs = 5;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) decodeScene(bytes);
    const ms = (performance.now() - t0) / runs;
    console.log(
      `decode ${existsSync(ccc) ? 'ccc' : 'coosa'} (${String(bytes.length)} B): ${ms.toFixed(1)} ms`,
    );
    expect(ms).toBeLessThan(250);
  });
});

describe('scene size on real terrain (cached tiles)', () => {
  for (const route of realRoutes(200)) {
    const bounds = trackBounds(route.drawn);
    it.skipIf(!hasCachedTiles(bounds))(`${route.name}: within 80 KB`, async () => {
      const heightfield = await cachedSceneHeightfield(bounds);
      const bytes = encodeScene(buildScene(heightfield, route.drawn, route.run));
      const runs = 5;
      decodeScene(bytes);
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) decodeScene(bytes);
      console.log(
        `${route.name} (real): ${String(bytes.length)} B, decode ${((performance.now() - t0) / runs).toFixed(1)} ms`,
      );
      expect(bytes.length).toBeLessThanOrEqual(BUDGET);
    });
  }
});
