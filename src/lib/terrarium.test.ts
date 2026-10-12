import { describe, expect, it } from 'vitest';
import { decodeTerrarium, decodeTerrariumImage, sampleBilinear } from './terrarium';

/** The Terrarium RGB triple for an elevation (inverse of the decode formula). */
function encode(metres: number): [number, number, number] {
  const v = metres + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v % 256);
  const b = Math.round((v - Math.floor(v)) * 256);
  return [r, g, b];
}

describe('decodeTerrarium', () => {
  it('decodes sea level as (128, 0, 0)', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
  });

  it('decodes the extremes of the range', () => {
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(255, 255, 255)).toBeCloseTo(32767.996, 3);
  });

  it('weights the channels 256, 1 and 1/256', () => {
    expect(decodeTerrarium(129, 0, 0)).toBe(256);
    expect(decodeTerrarium(128, 1, 0)).toBe(1);
    expect(decodeTerrarium(128, 0, 128)).toBe(0.5);
    expect(decodeTerrarium(128, 0, 1)).toBe(1 / 256);
  });

  it('decodes below-sea-level and mountain values', () => {
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
    expect(decodeTerrarium(127, 156, 0)).toBe(-100);
    // 820 m, the sample run's high point.
    expect(decodeTerrarium(131, 52, 0)).toBe(820);
    // 8,848 m, Everest.
    expect(decodeTerrarium(162, 144, 0)).toBe(8848);
  });

  it('round-trips with the encoder', () => {
    for (const m of [-10994, -0.5, 0, 0.25, 300, 640.75, 1070, 4807.5]) {
      expect(decodeTerrarium(...encode(m))).toBeCloseTo(m, 6);
    }
  });
});

describe('decodeTerrariumImage', () => {
  it('decodes each RGBA pixel row-major and ignores alpha', () => {
    const elevations = [0, 1, -1, 820, 8848, 0.5];
    const rgba = new Uint8ClampedArray(elevations.length * 4);
    elevations.forEach((m, i) => {
      rgba.set([...encode(m), i % 2 === 0 ? 255 : 0], i * 4);
    });
    const out = decodeTerrariumImage(rgba, 3, 2);
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual(elevations);
  });

  it('handles an empty image', () => {
    expect(decodeTerrariumImage(new Uint8ClampedArray(0), 0, 0)).toHaveLength(0);
  });

  it('decodes a full 256 × 256 tile', () => {
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let p = 0; p < rgba.length; p += 4) rgba.set([128, 100, 0, 255], p);
    const out = decodeTerrariumImage(rgba, 256, 256);
    expect(out).toHaveLength(65536);
    expect(out.every((m) => m === 100)).toBe(true);
  });

  it('rejects a buffer whose size does not match the dimensions', () => {
    expect(() => decodeTerrariumImage(new Uint8ClampedArray(12), 2, 2)).toThrow(RangeError);
    expect(() => decodeTerrariumImage(new Uint8ClampedArray(20), 2, 2)).toThrow(RangeError);
    expect(() => decodeTerrariumImage(new Uint8ClampedArray(4), 0.5, 2)).toThrow(RangeError);
  });
});

describe('sampleBilinear', () => {
  // 3 × 2 grid:
  //   0  10  20
  // 100 110 120
  const grid = new Float32Array([0, 10, 20, 100, 110, 120]);

  it('returns grid values exactly at integer coordinates', () => {
    expect(sampleBilinear(grid, 3, 2, 0, 0)).toBe(0);
    expect(sampleBilinear(grid, 3, 2, 2, 0)).toBe(20);
    expect(sampleBilinear(grid, 3, 2, 1, 1)).toBe(110);
    expect(sampleBilinear(grid, 3, 2, 2, 1)).toBe(120);
  });

  it('interpolates along x, along y and in both', () => {
    expect(sampleBilinear(grid, 3, 2, 0.5, 0)).toBe(5);
    expect(sampleBilinear(grid, 3, 2, 1.25, 0)).toBe(12.5);
    expect(sampleBilinear(grid, 3, 2, 0, 0.5)).toBe(50);
    expect(sampleBilinear(grid, 3, 2, 1.5, 0.5)).toBe(65);
    expect(sampleBilinear(grid, 3, 2, 0.25, 0.75)).toBeCloseTo(77.5, 10);
  });

  it('clamps coordinates outside the grid to its edge', () => {
    expect(sampleBilinear(grid, 3, 2, -5, -5)).toBe(0);
    expect(sampleBilinear(grid, 3, 2, 10, 10)).toBe(120);
    expect(sampleBilinear(grid, 3, 2, 0.5, -1)).toBe(5);
    expect(sampleBilinear(grid, 3, 2, 3, 0.5)).toBe(70);
  });

  it('works on 1 × 1 and single-row grids', () => {
    expect(sampleBilinear([42], 1, 1, 0.7, 0.3)).toBe(42);
    expect(sampleBilinear([0, 10], 2, 1, 0.3, 0.9)).toBeCloseTo(3, 10);
  });

  it('accepts plain arrays', () => {
    expect(sampleBilinear([0, 10, 20, 30], 2, 2, 0.5, 0.5)).toBe(15);
  });

  it('rejects an empty or undersized grid', () => {
    expect(() => sampleBilinear([], 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => sampleBilinear([1, 2, 3], 2, 2, 0, 0)).toThrow(RangeError);
  });
});
