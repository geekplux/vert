import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ExportProgressReport } from '../../page/PosterState/exporter';
import { posterSizeById } from '../sizes';
import type { PosterSizeId } from '../sizes';
import { canvasDiagnostics, knownCanvasResult, resetCanvasResults } from './canvasLimits';
import type { ProbeCanvas } from './canvasLimits';
import {
  TOO_LARGE_MESSAGE,
  downloadBlob,
  encodeCanvas,
  exportPoster,
  isCanvasLimitError,
  mountOffscreen,
} from './export';
import type { ExportDeps, ExportPosterOptions } from './export';
import { CanvasLimitError, rasterize } from './rasterize';
import type { LoadedImage, RasterizeOptions } from './rasterize';
import type { SerializedPoster } from './serialize';
import { ExportError, TOO_LARGE_SMALLEST_MESSAGE } from './errors';
import { fakeCanvas, fakeJpeg } from './testFakes';

const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

const SERIALIZED: SerializedPoster = {
  width: 720,
  height: 960,
  xhtml: '<div xmlns="http://www.w3.org/1999/xhtml"/>',
  css: '',
  faces: [],
  localFaces: [],
  images: [],
  figureBox: { x: 48, y: 400, width: 624, height: 300 },
  fontUrls: ['data:font/woff2;base64,AAAA', 'data:font/woff2;base64,BBBB'],
};

type Spy = Mock<(...args: unknown[]) => void>;

interface Spies {
  unmount: Spy;
  encode: Spy;
  serialize: Spy;
  paint: Spy;
  rasterizeOptions: RasterizeOptions[];
  events: string[];
}

/** Real tile loop (`rasterize`) over a fake canvas and image loader; everything else faked. */
function fakeDeps(
  overrides: Partial<ExportDeps> = {},
  loadImage = vi.fn<(svg: string) => Promise<LoadedImage>>(),
) {
  const spies: Spies = {
    unmount: vi.fn<(...args: unknown[]) => void>(),
    encode: vi.fn<(...args: unknown[]) => void>(),
    serialize: vi.fn<(...args: unknown[]) => void>(),
    paint: vi.fn<(...args: unknown[]) => void>(),
    rasterizeOptions: [],
    events: [],
  };
  loadImage.mockImplementation(() =>
    Promise.resolve({ image: 'tile' as unknown as CanvasImageSource, release: () => undefined }),
  );
  const deps: ExportDeps = {
    canvasKnown: () => undefined,
    preloadFonts: (urls) => {
      spies.events.push(`preload ${String(urls.length)}`);
      return Promise.resolve(() => {
        spies.events.push('release fonts');
      });
    },
    mount: () => {
      spies.events.push('mount');
      return Promise.resolve({
        root: document.createElement('div'),
        unmount: () => {
          spies.events.push('unmount');
          spies.unmount();
        },
      });
    },
    prepare: () => {
      spies.events.push('prepare');
      return Promise.resolve();
    },
    serialize: (...args) => {
      spies.events.push('serialize');
      spies.serialize(...args);
      return Promise.resolve(SERIALIZED);
    },
    rasterize: (options) => {
      spies.rasterizeOptions.push(options);
      return rasterize({ ...options, settle: false, createCanvas: fakeCanvas, loadImage });
    },
    encode: (canvas: ProbeCanvas, type: string, quality?: number) => {
      spies.events.push(`encode ${type}`);
      spies.encode(canvas, type, quality);
      return Promise.resolve(
        type === 'image/png'
          ? new Blob([PNG_HEAD], { type })
          : new Blob([fakeJpeg(canvas.width, canvas.height)], { type }),
      );
    },
    paint: () => {
      spies.paint();
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, spies, loadImage };
}

function options(
  size: PosterSizeId,
  extra: Partial<ExportPosterOptions> = {},
): ExportPosterOptions & { progress: ExportProgressReport[] } {
  const progress: ExportProgressReport[] = [];
  return {
    element: createElement('div'),
    size: posterSizeById(size),
    style: 'A',
    format: 'png',
    fileName: 'vert-coosa-backcountry-trail-18x24.png',
    onProgress: (report) => progress.push(report),
    progress,
    ...extra,
  };
}

describe('exportPoster', () => {
  it('reports the tile total first, then each tile, then the encode, and returns the PNG', async () => {
    const { deps, spies } = fakeDeps();
    const job = options('18x24');
    const blob = await exportPoster(job, deps);
    expect(job.progress).toEqual([
      { done: 0, total: 4 },
      { done: 1, total: 4 },
      { done: 2, total: 4 },
      { done: 3, total: 4 },
      { done: 4, total: 4 },
      { done: 4, total: 4, stage: 'encode' },
    ]);
    // A paint after every report, so each label is seen.
    expect(spies.paint).toHaveBeenCalledTimes(6);
    expect(spies.events).toEqual([
      'mount',
      'prepare',
      'serialize',
      'unmount',
      'preload 2',
      'encode image/png',
      'release fonts',
    ]);
    expect(blob.type).toBe('image/png');
    // Print PNGs carry 300 dpi (pHYs right after IHDR).
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(37, 41))).toBe('pHYs');
    expect(spies.rasterizeOptions[0]).toMatchObject({ width: 5400, height: 7200, scale: 7.5 });
  });

  it('leaves social PNGs as encoded and uses one tile', async () => {
    const { deps } = fakeDeps();
    const job = options('4x5');
    const blob = await exportPoster(job, deps);
    expect(job.progress).toEqual([
      { done: 0, total: 1 },
      { done: 1, total: 1 },
      { done: 1, total: 1, stage: 'encode' },
    ]);
    expect(blob.size).toBe(PNG_HEAD.length);
  });

  it('writes a PDF from a JPEG of the canvas for print sizes', async () => {
    const { deps, spies } = fakeDeps();
    const blob = await exportPoster(options('a3', { format: 'pdf', title: 'Coosa' }), deps);
    expect(blob.type).toBe('application/pdf');
    expect(spies.encode).toHaveBeenCalledWith(expect.anything(), 'image/jpeg', 1);
    const text = Array.from(new Uint8Array(await blob.arrayBuffer()), (b) =>
      String.fromCharCode(b),
    ).join('');
    expect(text).toContain('/MediaBox [0 0 841.89 1190.55]');
    expect(text).toContain('/Width 3508 /Height 4961');
  });

  it('passes a figure layer with the figure box and hides the slot', async () => {
    const { deps, spies } = fakeDeps();
    const render = vi.fn(() => 'figure' as unknown as CanvasImageSource);
    await exportPoster(options('4x5', { figure: { render } }), deps);
    expect(spies.serialize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hideFigure: true }),
    );
    expect(spies.rasterizeOptions[0]?.figure?.box).toEqual(SERIALIZED.figureBox);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('stops between tiles when cancelled, rejecting with an AbortError', async () => {
    const controller = new AbortController();
    const { deps, spies, loadImage } = fakeDeps();
    const job = options('18x24', {
      signal: controller.signal,
      onProgress: ({ done }) => {
        if (done === 2) controller.abort();
      },
    });
    await expect(exportPoster(job, deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(spies.encode).not.toHaveBeenCalled();
    expect(spies.unmount).toHaveBeenCalledTimes(1);
  });

  it('waits for each paint before the next step', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const { deps, loadImage } = fakeDeps({
      paint: () => {
        order.push('paint');
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    loadImage.mockImplementation(() => {
      order.push('tile');
      return Promise.resolve({
        image: 'tile' as unknown as CanvasImageSource,
        release: () => undefined,
      });
    });
    const job = options('4x5');
    const result = exportPoster(job, deps);
    await vi.waitFor(() => {
      expect(order).toEqual(['paint']);
    });
    release();
    await vi.waitFor(() => {
      expect(order).toEqual(['paint', 'tile', 'paint']);
    });
    expect(job.progress.at(-1)).toEqual({ done: 1, total: 1 });
    release();
    await vi.waitFor(() => {
      expect(job.progress.at(-1)).toEqual({ done: 1, total: 1, stage: 'encode' });
    });
    release();
    await expect(result).resolves.toBeInstanceOf(Blob);
  });

  it('stops before the encode when cancelled while the last label paints', async () => {
    const controller = new AbortController();
    const { deps, spies } = fakeDeps({
      paint: () => {
        if (job.progress.at(-1)?.stage === 'encode') controller.abort();
        return Promise.resolve();
      },
    });
    const job = options('4x5', { signal: controller.signal });
    await expect(exportPoster(job, deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(spies.encode).not.toHaveBeenCalled();
  });

  it('rejects at once when cancelled during the encode, and releases the canvas', async () => {
    const controller = new AbortController();
    let canvas: ProbeCanvas | null = null;
    const { deps } = fakeDeps({
      encode: (target) => {
        canvas = target;
        controller.abort();
        // An encode that never finishes: the abort must not wait for it.
        return new Promise<Blob>(() => undefined);
      },
    });
    const job = options('4x5', { signal: controller.signal });
    await expect(exportPoster(job, deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvas).not.toBeNull();
    expect((canvas as ProbeCanvas | null)?.width).toBe(0);
  });

  it('counts the figure tiles in the total', async () => {
    const { deps } = fakeDeps();
    const job = options('4x5', {
      figure: { render: () => 'figure' as unknown as CanvasImageSource },
    });
    await exportPoster(job, deps);
    expect(job.progress).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
      { done: 2, total: 2, stage: 'encode' },
    ]);
  });

  it('does nothing when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, spies } = fakeDeps();
    const job = options('18x24', { signal: controller.signal });
    await expect(exportPoster(job, deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(spies.events).toEqual([]);
    expect(job.progress).toEqual([]);
  });

  it('unmounts the poster when cancelled while it is being prepared', async () => {
    const controller = new AbortController();
    const { deps, spies } = fakeDeps({
      prepare: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    await expect(
      exportPoster(options('4x5', { signal: controller.signal }), deps),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spies.unmount).toHaveBeenCalledTimes(1);
  });

  it('tells the user when the browser cannot hold the canvas', async () => {
    // A size that failed before fails at once, before anything is mounted.
    const { deps, spies } = fakeDeps({ canvasKnown: () => false });
    const job = options('18x24');
    const failure = exportPoster(job, deps);
    await expect(failure).rejects.toBeInstanceOf(ExportError);
    await expect(failure).rejects.toThrow(TOO_LARGE_MESSAGE);
    expect(spies.events).toEqual([]);
  });

  it('does not suggest a smaller size at the smallest one', async () => {
    const { deps } = fakeDeps({ canvasKnown: () => false });
    await expect(exportPoster(options('4x5'), deps)).rejects.toThrow(
      new ExportError(TOO_LARGE_SMALLEST_MESSAGE),
    );
    await expect(exportPoster(options('9x16'), deps)).rejects.toThrow(
      new ExportError(TOO_LARGE_MESSAGE),
    );
    expect(TOO_LARGE_SMALLEST_MESSAGE).not.toMatch(/smaller/);
  });

  it.each([
    ['a canvas limit', new CanvasLimitError('no context')],
    ['a failed encode', new DOMException('encoding failed', 'EncodingError')],
    ['an allocation failure', new RangeError('Array buffer allocation failed')],
  ])('maps %s to the too-large message', async (_, error) => {
    const { deps, spies } = fakeDeps({ encode: () => Promise.reject(error) });
    await expect(exportPoster(options('18x24'), deps)).rejects.toThrow(
      new ExportError(TOO_LARGE_MESSAGE),
    );
    expect(spies.events).toContain('unmount');
  });

  it('records a canvas that verifies but will not encode, so the retry policy applies', async () => {
    resetCanvasResults();
    // `toBlob` hands back null: the canvas verified, but its pixels cannot be written.
    const encode = (canvas: ProbeCanvas, type: string, quality?: number) =>
      encodeCanvas(
        Object.assign(canvas, {
          toBlob: (callback: BlobCallback) => {
            callback(null);
          },
        }),
        type,
        quality,
      );
    const { deps } = fakeDeps({ encode, canvasKnown: knownCanvasResult });
    const { width, height } = posterSizeById('18x24');
    await expect(exportPoster(options('18x24'), deps)).rejects.toThrow(
      new ExportError(TOO_LARGE_MESSAGE),
    );
    // One failure: worth another try (the verify that preceded it no longer counts as proof).
    expect(knownCanvasResult(width, height)).toBeUndefined();
    await expect(exportPoster(options('18x24', { format: 'pdf' }), deps)).rejects.toThrow(
      new ExportError(TOO_LARGE_MESSAGE),
    );
    // Two in a row: given up for the session, and the next Download fails at once.
    expect(knownCanvasResult(width, height)).toBe(false);
    const { deps: fresh, spies } = fakeDeps({ canvasKnown: knownCanvasResult });
    await expect(exportPoster(options('18x24'), fresh)).rejects.toThrow(
      new ExportError(TOO_LARGE_MESSAGE),
    );
    expect(spies.events).toEqual([]);
    resetCanvasResults();
  });

  it('records a size as working once its file is encoded, and a cancel as nothing', async () => {
    resetCanvasResults();
    const { width, height } = posterSizeById('4x5');
    const controller = new AbortController();
    const { deps } = fakeDeps({
      encode: () => {
        controller.abort();
        // An encode that never finishes: the abort rejects at once.
        return new Promise<Blob>(() => undefined);
      },
    });
    await expect(
      exportPoster(options('4x5', { signal: controller.signal }), deps),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(knownCanvasResult(width, height)).toBeUndefined();
    expect(canvasDiagnostics().failing).toEqual([]);
    await exportPoster(options('4x5'), fakeDeps().deps);
    expect(knownCanvasResult(width, height)).toBe(true);
    resetCanvasResults();
  });

  it('passes other failures through (the page shows its generic message)', async () => {
    const failure = new Error('The poster image could not be decoded');
    const { deps } = fakeDeps({ serialize: () => Promise.reject(failure) });
    await expect(exportPoster(options('4x5'), deps)).rejects.toBe(failure);
  });
});

describe('ExportError', () => {
  it('is the class the page re-exports', async () => {
    const page = await import('../../page/PosterState/exporter');
    expect(page.ExportError).toBe(ExportError);
    expect(page.exportErrorMessage(new ExportError(TOO_LARGE_MESSAGE))).toBe(TOO_LARGE_MESSAGE);
  });
});

describe('isCanvasLimitError', () => {
  it('recognises the browser’s canvas failures only', () => {
    expect(isCanvasLimitError(new CanvasLimitError('x'))).toBe(true);
    expect(isCanvasLimitError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isCanvasLimitError(new DOMException('x', 'AbortError'))).toBe(false);
    expect(isCanvasLimitError(new TypeError('x'))).toBe(false);
  });
});

describe('mountOffscreen', () => {
  it('mounts the element hidden, at the logical size, and unmounts it', async () => {
    const mounted = await mountOffscreen(
      createElement('div', { role: 'img', 'aria-label': 'Poster' }),
      720,
      960,
    );
    const host = mounted.root.parentElement;
    expect(mounted.root.getAttribute('aria-label')).toBe('Poster');
    expect(host?.getAttribute('aria-hidden')).toBe('true');
    expect(host?.style.width).toBe('720px');
    expect(host?.style.height).toBe('960px');
    expect(host?.style.visibility).toBe('');
    mounted.unmount();
    expect(host?.isConnected).toBe(false);
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a temporary download link and revokes its URL later', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vert/1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    downloadBlob(new Blob(['x']), 'vert-poster.png');
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('vert-poster.png');
    expect(link.href).toBe('blob:vert/1');
    expect(link.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:vert/1');
  });
});
