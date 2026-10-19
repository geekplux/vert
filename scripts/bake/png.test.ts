// @vitest-environment node
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeTerrarium } from '../../src/lib/terrarium';
import { PngError, decodePng, decodeTerrariumPngBytes } from './png';
import { encodePng, syntheticTilePng, terrariumRgb } from './testing';

const pixel = (x: number, y: number) => [(x * 37 + y) & 0xff, (y * 11) & 0xff, (x ^ y) & 0xff, 200];

describe('decodePng', () => {
  for (const channels of [3, 4] as const) {
    for (const filter of [0, 1, 2, 3, 4]) {
      it(`reads ${channels === 3 ? 'RGB' : 'RGBA'} with filter ${String(filter)}`, () => {
        const { width, height, rgba } = decodePng(encodePng(13, 7, pixel, { channels, filter }));
        expect([width, height]).toEqual([13, 7]);
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 13; x++) {
            const [r, g, b, a] = pixel(x, y);
            const i = (y * 13 + x) * 4;
            expect([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]).toEqual([
              r,
              g,
              b,
              channels === 4 ? a : 255,
            ]);
          }
        }
      });
    }
  }

  it('refuses what is not a PNG it can read', () => {
    const good = encodePng(4, 4, pixel);
    expect(() => decodePng(new TextEncoder().encode('<html>not a tile</html>'))).toThrow(PngError);
    expect(() => decodePng(good.subarray(0, good.length - 20))).toThrow(PngError);
    const damaged = Buffer.from(good);
    damaged[40] = (damaged[40] ?? 0) ^ 0xff; // inside IDAT: its CRC no longer matches
    expect(() => decodePng(damaged)).toThrow(/CRC/);
    // A 16-bit header, with a valid CRC.
    const deep = Buffer.from(good);
    deep[24] = 16;
    deep.writeUInt32BE(crc32(deep.subarray(12, 29)), 29);
    expect(() => decodePng(deep)).toThrow(/bit depth/);
  });
});

describe('decodeTerrariumPngBytes', () => {
  it('gives the elevations the Terrarium encoding stores', () => {
    const metres = (x: number, y: number) => -50 + x * 10.5 + y * 0.25;
    const png = encodePng(256, 256, (x, y) => terrariumRgb(metres(x, y)));
    const elevations = decodeTerrariumPngBytes(png);
    expect(elevations).toHaveLength(256 * 256);
    for (const [x, y] of [
      [0, 0],
      [255, 0],
      [17, 200],
      [255, 255],
    ] as const) {
      const [r, g, b] = terrariumRgb(metres(x, y));
      expect(elevations[y * 256 + x]).toBe(Math.fround(decodeTerrarium(r, g, b)));
      expect(elevations[y * 256 + x]).toBeCloseTo(metres(x, y), 1);
    }
  });

  it('refuses a tile that is not 256 × 256', () => {
    expect(() => decodeTerrariumPngBytes(encodePng(128, 256, pixel))).toThrow(/not 256/);
  });

  it('reads the synthetic test tiles', () => {
    const elevations = decodeTerrariumPngBytes(syntheticTilePng({ z: 13, x: 4275, y: 2911 }));
    for (const e of elevations) expect(e).toBeGreaterThan(500);
  });
});
