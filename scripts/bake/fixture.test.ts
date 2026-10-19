// @vitest-environment node
/**
 * The committed Coosa scene (`src/scene/fixtures/`, loaded by the library's story and bundle
 * smoke test) and real-terrain bakes. Re-baking needs the tiles in the local cache
 * (`scripts/.cache/terrarium`, filled by any `pnpm bake`); those tests skip without them, and
 * the UTMB ones also without the course files (`pnpm fixtures`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAMPLE_TOTALS } from '../../src/page/sample';
import { buildSidecar, decodeScene, scanScene, sidecarJson } from '../../src/scene/bake';
import { BakeError } from './errors';
import { readInput } from './input';
import { DEFAULT_TRIM_M, bakeScene, trackBounds } from './pipeline';
import { DEFAULT_CACHE_DIR, createTileSource } from './tiles';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const SAMPLE = path('../../public/samples/coosa-backcountry.gpx');
const FIXTURE = path('../../src/scene/fixtures/coosa-backcountry.scene');
const FIXTURE_SIDECAR = path('../../src/scene/fixtures/coosa-backcountry.scene.json');

/** The size budget for a ~20 km route (docs/SCENE.md, "Sizes"), bytes. */
const BUDGET = 80_000;

/** Bakes `input` from the local tile cache only; `null` when the cache lacks a tile. */
async function bakeOffline(inputPath: string, id: string) {
  const tiles = createTileSource({ cacheDir: DEFAULT_CACHE_DIR, offline: true });
  try {
    return await bakeScene(readInput(inputPath), { id, trim: DEFAULT_TRIM_M, tiles });
  } catch (error) {
    if (error instanceof BakeError && error.message.includes('not in the cache')) return null;
    throw error;
  }
}

describe('the committed Coosa scene', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const sidecar = readFileSync(FIXTURE_SIDECAR, 'utf8');

  it('decodes, within the size budget, with its sidecar', () => {
    const scene = decodeScene(bytes);
    expect(bytes.length).toBeLessThanOrEqual(BUDGET);
    expect(sidecar).toBe(sidecarJson(buildSidecar(bytes)));
    expect(scene.grid.zoom).toBe(13);
    expect(Math.max(scene.grid.width, scene.grid.height)).toBe(320);
    expect(scene.summary.trim).toEqual({ start: 200, end: 200 });
  });

  it("has the app's figures for the sample: 21.48 km, +1,102 m", () => {
    const { summary } = buildSidecar(bytes);
    expect(Math.abs(summary.distance - SAMPLE_TOTALS.distance)).toBeLessThan(5);
    expect(summary.climb).toBe(SAMPLE_TOTALS.vert);
  });

  it('gives no location away', () => {
    const { points } = readInput(SAMPLE);
    const findings = scanScene(
      { bytes, scene: decodeScene(bytes), sidecar },
      { lat: points.lat, lon: points.lon, bounds: [trackBounds(points)] },
    );
    expect(findings).toEqual([]);
  });

  it.skipIf(!existsSync(DEFAULT_CACHE_DIR))(
    'is what `pnpm bake` makes of the sample, byte for byte',
    async (context) => {
      const baked = await bakeOffline(SAMPLE, 'coosa-backcountry');
      if (!baked) {
        context.skip();
        return;
      }
      expect(Buffer.from(baked.bytes).equals(Buffer.from(bytes))).toBe(true);
      expect(baked.sidecarText).toBe(sidecar);
    },
  );
});

describe('real terrain: the UTMB courses', () => {
  for (const name of ['lavaredo-20k', 'eiger-e51', 'montblanc-ccc']) {
    const course = path(`../../fixtures/courses/${name}.gpx`);
    it.skipIf(!existsSync(course) || !existsSync(DEFAULT_CACHE_DIR))(
      `${name}: within the budget`,
      async (context) => {
        const baked = await bakeOffline(course, name);
        if (!baked) {
          context.skip();
          return;
        }
        const { grid } = baked.scene;
        console.log(
          `${name}: ${String(baked.bytes.length)} B, grid ${String(grid.width)}×${String(grid.height)} at z${String(grid.zoom)}`,
        );
        expect(baked.bytes.length).toBeLessThanOrEqual(BUDGET);
        expect(baked.privacy).toEqual({ findings: 0, pitchHidden: true });
      },
    );
  }
});
