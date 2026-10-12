import { afterEach, describe, expect, it, vi } from 'vitest';
import { posterLayout } from '../layout';
import { POSTER_SIZES, posterSizeById } from '../sizes';
import { knownCanvasResult, resetCanvasResults } from './canvasLimits';
import { CanvasLimitError, planTiles, rasterize, settleFonts } from './rasterize';
import type { FigureTile, LoadedImage, Tile } from './rasterize';
import type { ViewBox } from './serialize';
import { fakeCanvas } from './testFakes';
import type { FakeCanvas } from './testFakes';

/**
 * The tiles cover the output exactly: all inside it, no two overlapping, and their areas add up
 * to the output's (so there is no gap either).
 */
function expectExactCover(tiles: readonly Tile[], width: number, height: number) {
  let area = 0;
  tiles.forEach((a, i) => {
    expect(a.x >= 0 && a.y >= 0 && a.x + a.width <= width && a.y + a.height <= height).toBe(true);
    area += a.width * a.height;
    for (const b of tiles.slice(i + 1)) {
      const overlap =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
  });
  expect(area).toBe(width * height);
}

describe('planTiles', () => {
  it.each([
    ['18x24', 4096, 4, [2700, 3600]],
    ['a3', 4096, 2, [3508, 2481]],
    ['4x5', 4096, 1, [1080, 1350]],
    ['9x16', 4096, 1, [1080, 1920]],
    ['18x24', 2048, 12, [1800, 1800]],
    ['18x24', 8192, 1, [5400, 7200]],
  ] as const)('%s at %i px: %i tiles', (id, limit, count, firstSize) => {
    const { width, height } = posterSizeById(id);
    const tiles = planTiles(width, height, limit);
    expect(tiles).toHaveLength(count);
    expect([tiles[0]?.width, tiles[0]?.height]).toEqual(firstSize);
    for (const tile of tiles) {
      expect(tile.width).toBeLessThanOrEqual(limit);
      expect(tile.height).toBeLessThanOrEqual(limit);
      expect(Number.isInteger(tile.x) && Number.isInteger(tile.width)).toBe(true);
    }
    expect(tiles.map((tile) => tile.index)).toEqual(tiles.map((_, i) => i));
  });

  it.each([4096, 2048, 1000])('covers every size exactly at %i px', (limit) => {
    for (const { width, height } of POSTER_SIZES) {
      expectExactCover(planTiles(width, height, limit), width, height);
    }
  });

  it('rejects an empty plan', () => {
    expect(() => planTiles(0, 10, 4096)).toThrow(RangeError);
  });
});

interface Harness {
  canvas: FakeCanvas | null;
  views: { view: ViewBox; width: number; height: number }[];
  loads: number;
}

function setup() {
  const harness: Harness = { canvas: null, views: [], loads: 0 };
  const svg = (view: ViewBox, width: number, height: number) => {
    harness.views.push({ view, width, height });
    return `svg-${String(harness.views.length)}`;
  };
  const loadImage = (source: string): Promise<LoadedImage> => {
    harness.loads += 1;
    return Promise.resolve({ image: source as unknown as CanvasImageSource, release: vi.fn() });
  };
  const createCanvas = (width: number, height: number) => {
    harness.canvas = fakeCanvas(width, height);
    return harness.canvas;
  };
  return { harness, svg, loadImage, createCanvas };
}

afterEach(() => {
  resetCanvasResults();
});

describe('rasterize', () => {
  const size = posterSizeById('18x24');
  const { scale } = posterLayout(size);

  it('draws each tile with its own view box into its place', async () => {
    const { harness, ...hooks } = setup();
    const onTile = vi.fn();
    const canvas = await rasterize({
      ...hooks,
      width: size.width,
      height: size.height,
      scale,
      settle: false,
      onTile,
    });
    expect(canvas).toBe(harness.canvas);
    expect([canvas.width, canvas.height]).toEqual([5400, 7200]);
    expect(harness.views).toEqual([
      { view: { x: 0, y: 0, width: 360, height: 480 }, width: 2700, height: 3600 },
      { view: { x: 360, y: 0, width: 360, height: 480 }, width: 2700, height: 3600 },
      { view: { x: 0, y: 480, width: 360, height: 480 }, width: 2700, height: 3600 },
      { view: { x: 360, y: 480, width: 360, height: 480 }, width: 2700, height: 3600 },
    ]);
    expect(harness.canvas?.draws.map(({ image, x, y }) => [image, x, y])).toEqual([
      ['svg-1', 0, 0],
      ['svg-2', 2700, 0],
      ['svg-3', 0, 3600],
      ['svg-4', 2700, 3600],
    ]);
    expect(onTile.mock.calls).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it('composites a figure layer over the figure box, tile by tile', async () => {
    const { harness, ...hooks } = setup();
    const parts: FigureTile[] = [];
    // Box at logical (48, 400), 624 × 300 → output (360, 3000), 4680 × 2250.
    await rasterize({
      ...hooks,
      width: size.width,
      height: size.height,
      scale,
      settle: false,
      figure: {
        box: { x: 48, y: 400, width: 624, height: 300 },
        layer: {
          render: (tile) => {
            parts.push(tile);
            return `figure-${String(parts.length)}` as unknown as CanvasImageSource;
          },
        },
      },
    });
    const common = { scale, boxWidth: 4680, boxHeight: 2250 };
    expect(parts).toEqual([
      { x: 0, y: 0, width: 2340, height: 600, ...common },
      { x: 2340, y: 0, width: 2340, height: 600, ...common },
      { x: 0, y: 600, width: 2340, height: 1650, ...common },
      { x: 2340, y: 600, width: 2340, height: 1650, ...common },
    ]);
    const figureDraws = harness.canvas?.draws.filter((draw) =>
      String(draw.image).startsWith('figure'),
    );
    expect(figureDraws?.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
      [360, 3000, 2340, 600],
      [2700, 3000, 2340, 600],
      [360, 3600, 2340, 1650],
      [2700, 3600, 2340, 1650],
    ]);
  });

  it('stops between tiles when aborted', async () => {
    const { harness, ...hooks } = setup();
    const controller = new AbortController();
    const result = rasterize({
      ...hooks,
      width: size.width,
      height: size.height,
      scale,
      settle: false,
      signal: controller.signal,
      onTile: (done) => {
        if (done === 1) controller.abort();
      },
    });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.loads).toBe(1);
    // The output canvas is released.
    expect(harness.canvas?.width).toBe(0);
  });

  it('verifies the output canvas itself and remembers a size that failed', async () => {
    const { ...hooks } = setup();
    const tooLarge = {
      ...hooks,
      createCanvas: (w: number, h: number) => fakeCanvas(w, h, { works: false }),
    };
    await expect(
      rasterize({ ...tooLarge, width: 5400, height: 7200, scale, settle: false }),
    ).rejects.toBeInstanceOf(CanvasLimitError);
    expect(knownCanvasResult(5400, 7200)).toBe(false);
    // Next time it fails before allocating anything.
    const create = vi.fn(fakeCanvas);
    await expect(
      rasterize({ ...hooks, createCanvas: create, width: 5400, height: 7200, scale }),
    ).rejects.toBeInstanceOf(CanvasLimitError);
    expect(create).not.toHaveBeenCalled();
    await expect(
      rasterize({
        ...hooks,
        createCanvas: (w, h) => fakeCanvas(w, h, { context: false }),
        width: 1080,
        height: 1350,
        scale: 1,
        settle: false,
      }),
    ).rejects.toBeInstanceOf(CanvasLimitError);
  });

  it('settles the fonts on a small whole-poster draw before the tiles', async () => {
    const { harness, ...hooks } = setup();
    const onSettled = vi.fn();
    await rasterize({ ...hooks, width: size.width, height: size.height, scale, onSettled });
    // First the whole poster at 720 px wide (same svg each draw), then the four tiles.
    expect(harness.views[0]).toEqual({
      view: { x: 0, y: 0, width: 720, height: 960 },
      width: 720,
      height: 960,
    });
    expect(harness.views).toHaveLength(5);
    expect(onSettled).toHaveBeenCalledWith({ attempts: 2, stable: true });
  });
});

describe('settleFonts', () => {
  const scale = 1;
  const svg = () => 'poster';

  it('redraws in fresh images until two draws in a row match', async () => {
    // The first image is drawn before its faces load; from the second on, the text is there.
    const images = ['no text', 'with text', 'with text'];
    const loadImage = vi.fn(() =>
      Promise.resolve({
        image: (images.shift() ?? 'with text') as unknown as CanvasImageSource,
        release: vi.fn(),
      }),
    );
    const result = await settleFonts({
      svg,
      width: 1080,
      height: 1350,
      scale,
      loadImage,
      createCanvas: fakeCanvas,
      delays: [0, 0, 0, 0],
    });
    expect(result).toEqual({ attempts: 3, stable: true });
    expect(loadImage).toHaveBeenCalledTimes(3);
  });

  it('gives up after its delays, reporting instability', async () => {
    let n = 0;
    const loadImage = () =>
      Promise.resolve({
        image: `draw ${String((n += 1))}` as unknown as CanvasImageSource,
        release: () => undefined,
      });
    const result = await settleFonts({
      svg,
      width: 1080,
      height: 1350,
      scale,
      loadImage,
      createCanvas: fakeCanvas,
      delays: [0, 0, 0],
    });
    expect(result).toEqual({ attempts: 3, stable: false });
  });
});
