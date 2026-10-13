import { describe, expect, it } from 'vitest';
import {
  MIN_SPIKE_M,
  decodeTerrarium,
  decodeTerrariumImage,
  removeSpikes,
  sampleBilinear,
  spikeThreshold,
} from './terrarium';

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

describe('removeSpikes', () => {
  const W = 40;
  const H = 30;
  /** A W × H grid of `f(x, y)`. */
  const grid = (f: (x: number, y: number) => number) =>
    Float32Array.from({ length: W * H }, (_, i) => f(i % W, Math.floor(i / W)));
  /** A harbour: sea at −3 to 0 m west of column 20, waterfront at 1–6 m east of it. */
  const harbour = (x: number, y: number) =>
    x < 20 ? -3 + ((x * 7 + y * 3) % 4) : 1 + ((x + y) % 6);

  it("replaces a coastal seam line, Terrarium's artefact: −7,000 m one pixel wide", () => {
    const g = grid(harbour);
    const clean = Float32Array.from(g);
    // An L of bad pixels along the coast, as in Hong Kong harbour at z14.
    for (let y = 0; y < 20; y++) g[y * W + 19] = -7004;
    for (let x = 12; x < 20; x++) g[0 * W + x] = -5465 + x;
    g[0 * W + 20] = -3916;
    g[0 * W + 21] = -1186;
    const replaced = removeSpikes(g, W, H, spikeThreshold(9));
    expect(replaced).toBe(20 + 8 + 2 - 1); // (19, 0) is in both lines
    let min = Infinity;
    for (const v of g) min = Math.min(min, v);
    expect(min).toBeGreaterThanOrEqual(-3);
    // Everything else is untouched.
    for (let i = 0; i < g.length; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (x === 19 && y < 20) continue;
      if (y === 0 && x >= 12 && x <= 21) continue;
      expect(g[i]).toBe(clean[i]);
    }
  });

  it('replaces the ringing coarser zooms show: a +1,820 m pixel and a blob of −200 to −500 m', () => {
    const g = grid(harbour);
    g[10 * W + 25] = 1820;
    for (const [x, y, v] of [
      [8, 15, -191],
      [9, 15, -249],
      [8, 16, -237],
      [9, 16, -322],
      [10, 16, -524],
    ] as const) {
      g[y * W + x] = v;
    }
    expect(removeSpikes(g, W, H, spikeThreshold(35))).toBe(6);
    expect(g[10 * W + 25]).toBeLessThan(10);
    expect(g[16 * W + 10]).toBeGreaterThan(-10);
  });

  it('leaves real relief alone: a 45° cone, a cliff, a steep plane, a narrow valley', () => {
    const mpp = 26; // z12 in the Alps
    const T = spikeThreshold(mpp);
    const cases = [
      // A summit on 45° slopes: 26 m of height per pixel in every direction.
      grid((x, y) => 3000 - mpp * Math.hypot(x - 20, y - 15)),
      // A 600 m cliff between two columns.
      grid((x) => (x < 20 ? 1000 : 1600)),
      // A 60° plane.
      grid((x, y) => 500 + 1.7 * mpp * (x + y)),
      // A V-shaped valley, 45° sides, one pixel at its floor.
      grid((x) => 800 + mpp * Math.abs(x - 20)),
    ];
    for (const g of cases) {
      const before = Float32Array.from(g);
      expect(removeSpikes(g, W, H, T)).toBe(0);
      expect(g).toEqual(before);
    }
  });

  it('judges pixels at the edges by the neighbours they have', () => {
    const g = grid(() => 5);
    g[0] = -6000;
    g[W * H - 1] = 2000;
    expect(removeSpikes(g, W, H, MIN_SPIKE_M)).toBe(2);
    expect(g[0]).toBe(5);
    expect(g[W * H - 1]).toBe(5);
  });

  it('scales the threshold with the pixel size, never under 100 m', () => {
    expect(spikeThreshold(9)).toBe(MIN_SPIKE_M);
    expect(spikeThreshold(105)).toBe(525);
    expect(() => removeSpikes(new Float32Array(3), 2, 2, 100)).toThrow(RangeError);
  });
});
