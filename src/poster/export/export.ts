/**
 * The poster export: one poster element in, one PNG or PDF Blob out, all in the browser.
 *
 * 1. Fail at once on a canvas size this browser already refused.
 * 2. Mount the poster off-screen at its logical size (its own React root, hidden from the
 *    accessibility tree), with every face it uses loaded first, so it never draws a fallback.
 * 3. Serialize it to a standalone SVG (`serialize.ts`): styles inlined, fonts and images embedded.
 * 4. Load the embedded font files in the page (`preloadFonts`), so SVG images never draw a face
 *    that is still loading; then rasterize at `scale = target / logical`, after a small draw that
 *    settles the fonts, tile by tile (`rasterize.ts`). The first progress report, `{ done: 0,
 *    total }`, comes once the tiles are planned (poster tiles ≤ 4096 px, plus a figure tile for
 *    each poster tile the raster figure layer overlaps), then one per tile; cancellable between
 *    tiles. Until then the page says "Preparing…". After each report the export waits for the
 *    next paint (`nextPaint`), so every "Rendering tile k of N" is seen. The output canvas is
 *    verified as it is made (no up-front canvas probe).
 * 5. Encode: `{ done: total, total, stage: 'encode' }` ("Saving the file…") and a paint, then PNG
 *    (marked 300 dpi for print sizes) or a single-image PDF (`pdf.ts`). The encode cannot be
 *    interrupted, but an abort rejects at once and the canvas is released.
 *
 * `downloadBlob` is the only place a file is handed to the browser.
 */
import { createElement, Fragment } from 'react';
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
// Types only: the engine never imports page code at runtime (no import cycle with exporter.ts).
import type { ExportFormat, ExportProgressReport } from '../../page/PosterState/exporter';
import { loadPosterFonts } from '../fonts';
import { posterLayout } from '../layout';
import type { PosterSize } from '../sizes';
import type { PosterStyleId } from '../styles';
import { MAX_TILE, knownCanvasResult, recordCanvasResult } from './canvasLimits';
import type { ProbeCanvas } from './canvasLimits';
import { ExportError, TOO_LARGE_MESSAGE, tooLargeMessage } from './errors';
import { preloadFonts } from './fontPreload';
import { PRINT_DPI, pdfPageSize, writeSingleImagePdf } from './pdf';
import { withPngDensity } from './png';
import { CanvasLimitError, rasterize } from './rasterize';
import type { FigureLayer, RasterizeOptions, SettleResult } from './rasterize';
import { posterSvg, serializePoster } from './serialize';
import type { SerializeOptions, SerializedPoster } from './serialize';

export { TOO_LARGE_MESSAGE };

/** JPEG quality inside the PDF: 1.0, the only quality at which Chromium writes 4:4:4 (pdf.ts). */
export const PDF_JPEG_QUALITY = 1;

export interface ExportPosterOptions {
  /** The poster, rendered at its logical size (`posterLayout(size)`), with its data ready. */
  readonly element: ReactElement;
  readonly size: PosterSize;
  /** The poster style: decides which faces are loaded before drawing. */
  readonly style: PosterStyleId;
  readonly format: ExportFormat;
  /** The file's name; the PDF's title defaults to it without the extension. */
  readonly fileName: string;
  /** The PDF's title (default: from `fileName`). */
  readonly title?: string;
  /** A raster figure composited over the `[data-slot="figure"]` box (the terrain, later). */
  readonly figure?: FigureLayer;
  /** Awaited after mounting, before serializing (e.g. until an async figure has drawn). */
  readonly waitFor?: (root: HTMLElement) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgressReport) => void;
  /** Diagnostics: how many small draws it took for the fonts to settle (`settleFonts`). */
  readonly onSettled?: (result: SettleResult) => void;
}

/** A poster mounted off-screen. */
export interface MountedPoster {
  /** The poster's root element. */
  readonly root: HTMLElement;
  unmount(): void;
}

/** The steps, replaceable in tests. */
export interface ExportDeps {
  /** What is known about a canvas size (`knownCanvasResult`): false fails the export at once. */
  readonly canvasKnown: (width: number, height: number) => boolean | undefined;
  /** Loads the embedded font files in the page; resolves with their release. */
  readonly preloadFonts: (urls: readonly string[]) => Promise<() => void>;
  readonly mount: (element: ReactElement, width: number, height: number) => Promise<MountedPoster>;
  /** Loads the faces the poster uses and lets it settle. */
  readonly prepare: (root: HTMLElement, style: PosterStyleId) => Promise<void>;
  readonly serialize: (root: HTMLElement, options: SerializeOptions) => Promise<SerializedPoster>;
  readonly rasterize: (options: RasterizeOptions) => Promise<ProbeCanvas>;
  readonly encode: (canvas: ProbeCanvas, type: string, quality?: number) => Promise<Blob>;
  /** Lets the page paint the latest progress report (`nextPaint`). */
  readonly paint: () => Promise<void>;
}

/** Lets React commit and the browser lay out: timers, not frames (frames stop in hidden tabs). */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

/** Mounts `element` in a hidden container of the poster's logical size, far off-screen. */
export async function mountOffscreen(
  element: ReactElement,
  width: number,
  height: number,
): Promise<MountedPoster> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  host.dataset.vertExport = '';
  // Not `visibility: hidden` or `display: none`: the poster must lay out and its computed styles
  // must be the visible ones.
  host.style.cssText =
    `position:fixed;top:0;left:${String(-Math.ceil(width) - 1000)}px;` +
    `width:${String(width)}px;height:${String(height)}px;overflow:hidden;pointer-events:none;`;
  document.body.appendChild(host);
  const reactRoot = createRoot(host);
  const unmount = () => {
    reactRoot.unmount();
    host.remove();
  };
  try {
    flushSync(() => {
      reactRoot.render(createElement(Fragment, null, element));
    });
    await settle();
    const root = host.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error('The poster did not render');
    return { root, unmount };
  } catch (error) {
    unmount();
    throw error;
  }
}

/** The User Timing measure each {@link nextPaint} wait is recorded under (diagnostics). */
export const PAINT_WAIT_MEASURE = 'vert:export-paint-wait';

/** Longest wait for a frame, ms: a tab hidden meanwhile never runs the frame callback. */
const PAINT_WAIT_MAX_MS = 100;

/**
 * Resolves just after the next frame has been painted (a frame callback, then a task), so a
 * progress report made before it is on screen before the export goes on. At once in a hidden tab
 * (nothing is painted; frames do not run there). Each wait is recorded as a User Timing measure
 * ({@link PAINT_WAIT_MEASURE}) so the cost can be checked.
 */
export function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden') {
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      try {
        performance.measure(PAINT_WAIT_MEASURE, { start });
      } catch {
        // Diagnostics only.
      }
      resolve();
    };
    const fallback = setTimeout(finish, PAINT_WAIT_MAX_MS);
    requestAnimationFrame(() => {
      setTimeout(finish, 0);
    });
  });
}

/** Loads every face the mounted poster's text needs, then waits for the layout to settle. */
export async function preparePoster(root: HTMLElement, style: PosterStyleId): Promise<void> {
  await loadPosterFonts(style, root.textContent || 'Aa0', { subtitle: true });
  if ('fonts' in document) await document.fonts.ready;
  // Title measures re-render once their face is in; give them a turn.
  await settle();
  await settle();
}

/** A canvas's pixels as a file of `type`. */
export async function encodeCanvas(
  canvas: ProbeCanvas,
  type: string,
  quality?: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new CanvasLimitError('The canvas could not be encoded'));
      },
      type,
      quality,
    );
  });
}

export const defaultExportDeps: ExportDeps = {
  canvasKnown: knownCanvasResult,
  preloadFonts,
  mount: mountOffscreen,
  prepare: preparePoster,
  serialize: serializePoster,
  rasterize,
  encode: encodeCanvas,
  paint: nextPaint,
};

const TOO_LARGE_DOM_ERRORS = new Set([
  'EncodingError',
  'IndexSizeError',
  'InvalidStateError',
  'NotReadableError',
  'QuotaExceededError',
  'UnknownError',
]);

/** Whether `error` means the browser could not hold or encode a canvas this large. */
export function isCanvasLimitError(error: unknown): boolean {
  return (
    error instanceof CanvasLimitError ||
    error instanceof RangeError ||
    (error instanceof DOMException && TOO_LARGE_DOM_ERRORS.has(error.name))
  );
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof DOMException && reason.name === 'AbortError'
    ? reason
    : new DOMException('The export was cancelled.', 'AbortError');
}

/** `promise`, or a rejection as soon as `signal` aborts (the work itself runs on, unobserved). */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError(signal));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** The file name without its extension, as the PDF's title. */
function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/**
 * The output canvas as a file of `type`, and what the size did, for `knownCanvasResult`: it works
 * once encoded. A canvas that verified but cannot be encoded (`toBlob` hands back null,
 * `convertToBlob` rejects with an encoding error, the bytes do not fit) failed all the same:
 * recorded as an output-canvas failure, so the retry policy applies (two in a row and the size
 * fails at once). A cancel is neither.
 */
async function encodeOutput(
  deps: ExportDeps,
  canvas: ProbeCanvas,
  size: PosterSize,
  signal: AbortSignal | undefined,
  type: string,
  quality?: number,
): Promise<Blob> {
  try {
    const blob = await untilAborted(deps.encode(canvas, type, quality), signal);
    recordCanvasResult(size.width, size.height, true);
    return blob;
  } catch (error) {
    if (!signal?.aborted && isCanvasLimitError(error)) {
      recordCanvasResult(size.width, size.height, false);
    }
    throw error;
  }
}

/** Renders the poster and encodes it; resolves with the file's Blob. */
export async function exportPoster(
  options: ExportPosterOptions,
  deps: ExportDeps = defaultExportDeps,
): Promise<Blob> {
  const { element, size, style, format, fileName, figure, waitFor, signal, onProgress } = options;
  const layout = posterLayout(size);
  let mounted: MountedPoster | null = null;
  let canvas: ProbeCanvas | null = null;
  let releaseFonts: (() => void) | null = null;
  try {
    signal?.throwIfAborted();
    if (deps.canvasKnown(size.width, size.height) === false) {
      throw new CanvasLimitError('This canvas size failed before');
    }
    // Faces first, so the poster's first render already measures with them.
    await loadPosterFonts(style);
    signal?.throwIfAborted();
    mounted = await deps.mount(element, layout.width, layout.height);
    await deps.prepare(mounted.root, style);
    if (waitFor) await waitFor(mounted.root);
    signal?.throwIfAborted();

    const poster = await deps.serialize(mounted.root, { hideFigure: figure !== undefined, signal });
    mounted.unmount();
    mounted = null;
    signal?.throwIfAborted();
    releaseFonts = await deps.preloadFonts(poster.fontUrls);
    signal?.throwIfAborted();

    let tileTotal = 1;
    canvas = await deps.rasterize({
      svg: (view, width, height) => posterSvg(poster, view, width, height),
      width: size.width,
      height: size.height,
      scale: layout.scale,
      tileSize: MAX_TILE,
      onSettled: options.onSettled,
      figure: figure && poster.figureBox ? { layer: figure, box: poster.figureBox } : undefined,
      signal,
      // A size works once its file is written: recorded after the encode, below.
      recordSuccess: false,
      onTile: async (done, tiles) => {
        tileTotal = tiles;
        onProgress?.({ done, total: tiles });
        await deps.paint();
      },
    });
    signal?.throwIfAborted();
    onProgress?.({ done: tileTotal, total: tileTotal, stage: 'encode' });
    await deps.paint();
    signal?.throwIfAborted();

    if (format === 'pdf') {
      const jpeg = await encodeOutput(deps, canvas, size, signal, 'image/jpeg', PDF_JPEG_QUALITY);
      signal?.throwIfAborted();
      const page = pdfPageSize(size);
      return writeSingleImagePdf({
        jpeg: new Uint8Array(await jpeg.arrayBuffer()),
        pageWidth: page.width,
        pageHeight: page.height,
        title: options.title ?? titleFromFileName(fileName),
      });
    }
    const png = await encodeOutput(deps, canvas, size, signal, 'image/png');
    signal?.throwIfAborted();
    return size.use === 'print' ? await withPngDensity(png, PRINT_DPI) : png;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw abortError(signal);
    }
    if (isCanvasLimitError(error)) {
      throw new ExportError(tooLargeMessage(size), { cause: error });
    }
    throw error;
  } finally {
    mounted?.unmount();
    releaseFonts?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/** Saves `blob` as `fileName` through a temporary object URL and `<a download>`. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the browser has started the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}
