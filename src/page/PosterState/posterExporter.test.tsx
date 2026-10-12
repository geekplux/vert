import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { trimTrack } from '../../gpx/trim';
import { padBounds, trackBounds } from '../../poster/figures';
import { ExportError, TOO_LARGE_MESSAGE } from '../../poster/export/errors';
import type { ExportPosterOptions } from '../../poster/export/export';
import type { FigureTile } from '../../poster/export/rasterize';
import type { TerrainFigureScene } from '../../poster/terrainFigure';
import type { Heightfield } from '../../terrain/heightfield';
import { DEFAULT_VIEW_CAMERA } from '../../terrain/camera';
import type { ViewCamera } from '../../terrain/camera';
import { hills } from '../../terrain/testing';
import type { LoadFigureTerrain, LoadTerrain } from '../hooks';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { PosterPrefs, Prefs } from '../state';
import type { Terrain } from '../types';
import { buildExportJob } from './exporter';
import type { ExportFormat, ExportProgressReport } from './exporter';
import { LivePoster } from './LivePoster';
import type { LivePosterProps } from './LivePoster';
import {
  TERRAIN_DRAW_MESSAGE,
  TERRAIN_UNAVAILABLE_MESSAGE,
  createPosterExporter,
} from './posterExporter';
import type { ExportEngine, FigureRenderer, PosterExporterDeps } from './posterExporter';

vi.mock('../../poster/fonts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../poster/fonts')>();
  return { ...actual, loadPosterFonts: vi.fn(() => Promise.resolve()) };
});

/** Every observed element is laid out at this size (jsdom has no layout). */
const BOX = { width: 600, height: 400 };

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    queueMicrotask(() => {
      this.callback(
        [{ target, contentRect: { ...BOX, x: 0, y: 0 } } as unknown as ResizeObserverEntry],
        this,
      );
    });
  }
  unobserve(): void {
    // Nothing is watched between reports.
  }
  disconnect(): void {
    // As above.
  }
}

const restore: (() => void)[] = [];
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  for (const [name, value] of [
    ['offsetWidth', BOX.width],
    ['offsetHeight', BOX.height],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
    restore.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, name, before);
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
    restore.push(() => {
      delete (Range.prototype as Partial<Range>).getClientRects;
    });
  }
});
afterAll(() => {
  vi.unstubAllGlobals();
  for (const undo of restore) undo();
});

const CAMERA: ViewCamera = { ...DEFAULT_VIEW_CAMERA, azimuth: 0.7, polar: 0.9, zoom: 1.2 };

function prefsWith(poster: Partial<PosterPrefs> = {}, rest: Partial<Prefs> = {}): Prefs {
  return {
    ...INITIAL_PREFS,
    exaggeration: 2.2,
    units: 'imperial',
    ...rest,
    poster: {
      ...INITIAL_PREFS.poster,
      ...posterTextFor(SAMPLE_RUN),
      camera: CAMERA,
      ...poster,
    },
  };
}

const READY = (heightfield: Heightfield): Terrain => ({
  status: 'ready',
  heightfield,
  failedTiles: [],
  totalTiles: 4,
});

/** The figure tile the fake engine asks for (18×24: the top-left quarter of a figure box). */
const TILE: FigureTile = {
  x: 0,
  y: 0,
  width: 2340,
  height: 600,
  scale: 7.5,
  boxWidth: 4680,
  boxHeight: 2250,
};

interface EngineOptions {
  /** Called once the poster is ready, before the figure tile and the result. */
  afterReady?: (options: ExportPosterOptions) => void | Promise<void>;
  /** Thrown instead of returning a file. */
  fail?: Error;
}

/**
 * A fake export engine: mounts the element (as the real one does), awaits `waitFor`, reports two
 * tiles, renders one figure tile when there is a figure layer, and returns a small Blob.
 */
function fakeEngine({ afterReady, fail }: EngineOptions = {}) {
  const calls: ExportPosterOptions[] = [];
  const figureParts: unknown[] = [];
  const downloads: { blob: Blob; fileName: string }[] = [];
  const blob = new Blob(['file'], { type: 'image/png' });
  const exportPoster = vi.fn(async (options: ExportPosterOptions) => {
    calls.push(options);
    const view = render(options.element);
    try {
      const root = view.container.firstElementChild as HTMLElement;
      await options.waitFor?.(root);
      await afterReady?.(options);
      options.signal?.throwIfAborted();
      if (fail) throw fail;
      options.onProgress?.({ done: 0, total: 2 });
      if (options.figure) figureParts.push(await options.figure.render(TILE));
      options.onProgress?.({ done: 1, total: 2 });
      options.onProgress?.({ done: 2, total: 2 });
      return blob;
    } finally {
      view.unmount();
    }
  });
  const engine: ExportEngine = {
    exportPoster,
    downloadBlob: vi.fn((file: Blob, fileName: string) => {
      downloads.push({ blob: file, fileName });
    }),
  };
  return { engine, calls, figureParts, downloads, blob, exportPoster };
}

function fakeRenderer(fail?: Error) {
  const scenes: TerrainFigureScene[] = [];
  const tiles: FigureTile[] = [];
  const dispose = vi.fn();
  const renderer: FigureRenderer = {
    renderTile: vi.fn((scene: TerrainFigureScene, tile: FigureTile, into?: HTMLCanvasElement) => {
      if (fail) throw fail;
      scenes.push(scene);
      tiles.push(tile);
      const canvas = into ?? document.createElement('canvas');
      canvas.width = tile.width;
      canvas.height = tile.height;
      return canvas;
    }),
    dispose,
  };
  return { renderer, scenes, tiles, dispose };
}

function setup({
  engine = fakeEngine(),
  renderer = fakeRenderer(),
  loadTerrain = vi.fn<LoadTerrain>(() => Promise.resolve(hills())),
  loadFigureTerrain = vi.fn<LoadFigureTerrain>(() => Promise.resolve(hills())),
  createFigureRenderer,
}: {
  engine?: ReturnType<typeof fakeEngine>;
  renderer?: ReturnType<typeof fakeRenderer>;
  loadTerrain?: LoadTerrain;
  loadFigureTerrain?: LoadFigureTerrain;
  createFigureRenderer?: PosterExporterDeps['createFigureRenderer'];
} = {}) {
  const deps: PosterExporterDeps = {
    loadEngine: () => Promise.resolve(engine.engine),
    createFigureRenderer: createFigureRenderer ?? (() => Promise.resolve(renderer.renderer)),
    loadTerrain,
    loadFigureTerrain: vi.fn<LoadFigureTerrain>(() => Promise.reject(new Error('unused'))),
  };
  const exporter = createPosterExporter(deps);
  return { exporter, engine, renderer, loadTerrain, loadFigureTerrain };
}

function jobFor(
  prefs: Prefs,
  format: ExportFormat,
  terrain: Terrain,
  loadFigureTerrain: LoadFigureTerrain,
) {
  return buildExportJob(SAMPLE_RUN, prefs, format, { terrain, loadFigureTerrain });
}

const props = (element: ReactElement) => element.props as LivePosterProps;

describe('posterExporter', () => {
  it('exports style A as the preview draws it: LivePoster at the export scale, the terrain as a tiled layer, then saves the file', async () => {
    const t = setup();
    const heightfield = hills();
    const prefs = prefsWith({ style: 'A', size: '18x24', hideEnds: 0 });
    const job = jobFor(prefs, 'png', READY(heightfield), t.loadFigureTerrain);
    const progress: ExportProgressReport[] = [];

    const result = await t.exporter(job, (p) => progress.push(p), new AbortController().signal);

    expect(result).toEqual({ fileName: 'vert-coosa-backcountry-trail-18x24.png' });
    const [options] = t.engine.calls;
    if (!options) throw new Error('exportPoster was not called');
    expect(options).toMatchObject({
      size: job.size,
      style: 'A',
      format: 'png',
      fileName: job.fileName,
      title: 'Coosa Backcountry Trail',
    });
    expect(options.element.type).toBe(LivePoster);
    expect(props(options.element)).toMatchObject({
      run: SAMPLE_RUN,
      prefs,
      size: job.size,
      content: job.content,
      terrain: job.sources?.terrain,
      loadFigureTerrain: t.loadFigureTerrain,
      exportScale: 7.5,
    });
    // The figure tile: the View's grid, the whole track, the poster's camera and exaggeration.
    expect(t.renderer.tiles).toEqual([TILE]);
    expect(t.renderer.scenes).toEqual([
      { heightfield, track: SAMPLE_RUN.track, camera: CAMERA, exaggeration: 2.2 },
    ]);
    expect(t.engine.downloads).toEqual([{ blob: t.engine.blob, fileName: job.fileName }]);
    expect(progress).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
    // The renderer (and its WebGL context) is released.
    expect(t.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(t.loadTerrain).not.toHaveBeenCalled();
  });

  it('draws the trimmed track on its own grid when the ends are hidden', async () => {
    const own = hills();
    const loadFigureTerrain = vi.fn<LoadFigureTerrain>(() => Promise.resolve(own));
    const t = setup({ loadFigureTerrain });
    const prefs = prefsWith({ style: 'A', hideEnds: 300 });
    const job = jobFor(prefs, 'pdf', { status: 'loading' }, loadFigureTerrain);

    await t.exporter(job, () => undefined, new AbortController().signal);

    const drawn = trimTrack(SAMPLE_RUN.track, 300);
    if (!drawn) throw new Error('nothing left');
    const bounds = trackBounds(drawn);
    if (!bounds) throw new Error('no bounds');
    expect(loadFigureTerrain).toHaveBeenCalledWith(padBounds(bounds), expect.any(AbortSignal));
    expect(t.renderer.scenes[0]?.heightfield).toBe(own);
    expect(t.renderer.scenes[0]?.track?.lat.length).toBe(drawn.lat.length);
    expect(t.engine.calls[0]?.format).toBe('pdf');
    expect(t.engine.downloads[0]?.fileName).toBe('vert-coosa-backcountry-trail-18x24.pdf');
    // The View's grid was not needed.
    expect(t.loadTerrain).not.toHaveBeenCalled();
  });

  it("builds the run's grid when the View's is not ready", async () => {
    const built = hills();
    const loadTerrain = vi.fn<LoadTerrain>(() => Promise.resolve(built));
    const t = setup({ loadTerrain });
    const job = jobFor(
      prefsWith({ style: 'A', hideEnds: 0 }),
      'png',
      { status: 'loading' },
      t.loadFigureTerrain,
    );
    await t.exporter(job, () => undefined, new AbortController().signal);
    expect(loadTerrain).toHaveBeenCalledWith(SAMPLE_RUN, expect.any(AbortSignal));
    const element = t.engine.calls[0]?.element;
    expect(element && props(element).terrain).toMatchObject({
      status: 'ready',
      heightfield: built,
    });
    expect(t.renderer.scenes[0]?.heightfield).toBe(built);
  });

  it.each(['B', 'E'] as const)(
    'exports style %s with its SVG figure drawn at the export scale and no raster layer',
    async (style) => {
      const create = vi.fn<PosterExporterDeps['createFigureRenderer']>();
      let figureInDom = false;
      const engine = fakeEngine({
        afterReady: () => {
          // Ready means the figure is in the poster that will be serialized.
          figureInDom =
            document.querySelector('[data-figure="ridges"], [data-figure="contours"]') !== null;
        },
      });
      const t = setup({ engine, createFigureRenderer: create });
      const job = jobFor(
        prefsWith({ style, size: '18x24', hideEnds: 0 }),
        'png',
        READY(hills()),
        t.loadFigureTerrain,
      );
      await t.exporter(job, () => undefined, new AbortController().signal);
      const options = t.engine.calls[0];
      expect(options?.style).toBe(style);
      expect(options?.figure).toBeUndefined();
      expect(options && props(options.element).exportScale).toBe(7.5);
      expect(figureInDom).toBe(true);
      expect(t.loadFigureTerrain).toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(t.engine.downloads).toHaveLength(1);
    },
  );

  it('uses the social layout scale for the share card (4:5: scale 1)', async () => {
    const t = setup();
    const job = jobFor(
      prefsWith({ style: 'A', size: '4x5', hideEnds: 0 }),
      'png',
      READY(hills()),
      t.loadFigureTerrain,
    );
    await t.exporter(job, () => undefined, new AbortController().signal);
    const element = t.engine.calls[0]?.element;
    expect(element && props(element).exportScale).toBe(1);
    expect(t.engine.downloads[0]?.fileName).toBe('vert-coosa-backcountry-trail-4x5.png');
  });

  it('stops on Cancel while the figure is still loading: no download, renderer released', async () => {
    const pending = vi.fn<LoadFigureTerrain>(() => new Promise<Heightfield>(() => undefined));
    const t = setup({ loadFigureTerrain: pending });
    const controller = new AbortController();
    const job = jobFor(prefsWith({ style: 'A', hideEnds: 300 }), 'png', READY(hills()), pending);
    const run = t.exporter(job, () => undefined, controller.signal);
    await vi.waitFor(() => {
      expect(pending).toHaveBeenCalled();
    });
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(t.engine.downloads).toEqual([]);
    expect(t.renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when cancelled as the file is made', async () => {
    const controller = new AbortController();
    const engine = fakeEngine();
    engine.exportPoster.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(engine.blob);
    });
    const t = setup({ engine });
    const job = jobFor(prefsWith({ style: 'B' }), 'png', READY(hills()), vi.fn());
    await expect(t.exporter(job, () => undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(engine.downloads).toEqual([]);
  });

  it('says the terrain could not be loaded when a figure grid fails', async () => {
    const failing = vi.fn<LoadFigureTerrain>(() => Promise.reject(new Error('offline')));
    const t = setup({ loadFigureTerrain: failing });
    const job = jobFor(prefsWith({ style: 'E' }), 'png', READY(hills()), failing);
    const error = await t
      .exporter(job, () => undefined, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect((error as Error).message).toBe(TERRAIN_UNAVAILABLE_MESSAGE);
    expect(t.engine.downloads).toEqual([]);
  });

  it("says the terrain could not be loaded when the run's grid cannot be built", async () => {
    const t = setup({ loadTerrain: vi.fn<LoadTerrain>(() => Promise.reject(new Error('down'))) });
    const job = jobFor(
      prefsWith({ style: 'A', hideEnds: 0 }),
      'png',
      { status: 'error', error: 'No tiles' },
      t.loadFigureTerrain,
    );
    await expect(t.exporter(job, () => undefined, new AbortController().signal)).rejects.toThrow(
      TERRAIN_UNAVAILABLE_MESSAGE,
    );
    expect(t.engine.calls).toEqual([]);
  });

  it('says the browser could not draw the terrain when WebGL fails, and still releases the renderer', async () => {
    const renderer = fakeRenderer(new Error('Error creating WebGL context.'));
    const t = setup({ renderer });
    const job = jobFor(prefsWith({ style: 'A', hideEnds: 0 }), 'png', READY(hills()), vi.fn());
    const error = await t
      .exporter(job, () => undefined, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect((error as Error).message).toBe(TERRAIN_DRAW_MESSAGE);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);

    const noRenderer = setup({
      createFigureRenderer: () => Promise.reject(new Error('no three.js chunk')),
    });
    await expect(
      noRenderer.exporter(job, () => undefined, new AbortController().signal),
    ).rejects.toThrow(TERRAIN_DRAW_MESSAGE);
  });

  it("passes the engine's own messages through (too large for this browser)", async () => {
    const t = setup({ engine: fakeEngine({ fail: new ExportError(TOO_LARGE_MESSAGE) }) });
    const job = jobFor(prefsWith({ style: 'B' }), 'png', READY(hills()), t.loadFigureTerrain);
    await expect(t.exporter(job, () => undefined, new AbortController().signal)).rejects.toThrow(
      TOO_LARGE_MESSAGE,
    );
    expect(t.engine.downloads).toEqual([]);
  });
});
