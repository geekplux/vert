import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build, type Rolldown } from 'vite';
import { TILE_PATH, rgbPng, terrariumRgb } from './tiles';

/**
 * Guards Terrarium decoding against colour management. A tile's RGB bytes are elevation, so the
 * browser must hand them to `getImageData` untouched: no gamma or colour-profile conversion, no
 * premultiplication. The fixture tile carries a gAMA 1.0 chunk, which a colour-managing decode
 * rewrites; the app's own tile module (src/terrain/tiles.ts, bundled for this test) must still
 * read the exact elevations back, through fetch, decode and its loader.
 */

const TILES_MODULE = fileURLToPath(new URL('../src/terrain/tiles.ts', import.meta.url));

/** Known elevations: every byte value appears in r, g and b somewhere across the tile. */
const elevationAt = (px: number, py: number) => -11_000 + 128 * px + (py * 257) / 256;

/** Hand-checked samples of {@link elevationAt}: [px, py, metres]. */
const KNOWN: readonly [number, number, number][] = [
  [0, 0, -11_000],
  [100, 37, 1837.14453125],
  [86, 0, 8], // value 32776: r 128, g 8, b 0
  [255, 255, 21_895.99609375],
];

const COORD = { z: 12, x: 1093, y: 1625 };

/** src/terrain/tiles.ts as a classic script exposing `window.VertTiles`. */
async function bundleTilesModule(): Promise<string> {
  const output = (await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      // In memory only: never touches dist/, which the preview server is serving.
      write: false,
      emptyOutDir: false,
      outDir: 'test-results/terrarium-decode',
      minify: false,
      lib: { entry: TILES_MODULE, formats: ['iife'], name: 'VertTiles' },
    },
  })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
  const first = Array.isArray(output) ? output[0] : output;
  const chunk = first?.output.find((item) => item.type === 'chunk');
  if (!chunk) throw new Error('no bundle for src/terrain/tiles.ts');
  return chunk.code;
}

test('decodes a colour-tagged Terrarium tile to exact elevations', async ({ page }) => {
  for (const [px, py, metres] of KNOWN) expect(elevationAt(px, py)).toBe(metres);

  const png = rgbPng((px, py) => terrariumRgb(elevationAt(px, py)), { gamma: 1 });
  const requested: string[] = [];
  await page.route(TILE_PATH, async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });

  await page.goto('/');
  await page.addScriptTag({ content: await bundleTilesModule() });

  const result = await page.evaluate(
    async ({ coord, known, expected }) => {
      interface TilesModule {
        TileLoader: new () => { load(c: typeof coord): Promise<Float32Array> };
      }
      const tiles = (window as unknown as { VertTiles: TilesModule }).VertTiles;
      const elevations = await new tiles.TileLoader().load(coord);
      let maxError = 0;
      expected.forEach((metres, i) => {
        maxError = Math.max(maxError, Math.abs((elevations[i] ?? Number.NaN) - metres));
      });

      // The same bytes through a default (colour-managed) decode: proves the fixture would catch
      // a decoder that dropped `colorSpaceConversion: 'none'`.
      // arrayBuffer(), not blob(), as the app does: response blobs fail on a nearly full disk.
      const png = await (await fetch(`/tiles/${String(coord.z)}/0/0.png`)).arrayBuffer();
      const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
      const context = new OffscreenCanvas(256, 256).getContext('2d');
      if (!context) throw new Error('no 2D context');
      context.drawImage(bitmap, 0, 0);
      const managed = context.getImageData(0, 0, 256, 256).data;
      const [px, py] = known[1] ?? [0, 0];
      const i = (py * 256 + px) * 4;
      const managedMetres =
        (managed[i] ?? 0) * 256 + (managed[i + 1] ?? 0) + (managed[i + 2] ?? 0) / 256 - 32_768;

      return {
        length: elevations.length,
        samples: known.map(([x, y]) => elevations[y * 256 + x]),
        maxError,
        managedMetres,
      };
    },
    {
      coord: COORD,
      known: KNOWN,
      expected: Array.from({ length: 256 * 256 }, (_, i) =>
        elevationAt(i % 256, Math.floor(i / 256)),
      ),
    },
  );

  expect(requested[0]).toBe('/tiles/12/1093/1625.png');
  expect(result.length).toBe(256 * 256);
  expect(result.samples).toEqual(KNOWN.map(([, , metres]) => metres));
  expect(result.maxError).toBe(0);
  // Chromium honours gAMA in a default decode, so this pixel would come back wrong.
  expect(Math.abs(result.managedMetres - (KNOWN[1]?.[2] ?? 0))).toBeGreaterThan(1);
});
