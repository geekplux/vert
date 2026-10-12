/**
 * Draws a serialized poster at its output size, in tiles.
 *
 * The output is split into tiles of at most `tileSize` px a side (4096). Each tile is the poster SVG with its own viewBox, so the browser rasterizes only
 * that piece, at the output resolution (text and vector figures stay sharp), straight into its
 * place in one output canvas the size of the poster. Tile edges fall on whole output pixels, so
 * adjacent tiles meet without seams.
 *
 * A raster figure layer (the three.js terrain, later) is rendered per tile too and composited over
 * the figure box; the poster's own figure slot is hidden underneath (`hideFigure`).
 *
 * Fonts: Chrome does not hold an SVG image's `decode()` for the web fonts its text triggers, and
 * draws text in a face that is still loading as nothing (the block period). The export therefore
 * loads every embedded face in the page first (`preloadFonts`: an SVG image then finds them already
 * decoded), and `settleFonts` draws the whole poster small, in fresh images, until two draws in a
 * row are identical, before any tile is drawn.
 */
import {
  MAX_TILE,
  context2d,
  createProbeCanvas,
  knownCanvasResult,
  recordAuxiliaryCanvasFailure,
  recordCanvasResult,
  verifyCanvas,
} from './canvasLimits';
import type { ProbeCanvas } from './canvasLimits';
import type { Box, ViewBox } from './serialize';

/** One tile of the output, in output px. */
export interface Tile {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Splits `length` into `parts` contiguous whole-pixel spans of near-equal size. */
function spans(length: number, parts: number): [number, number][] {
  const result: [number, number][] = [];
  for (let i = 0; i < parts; i += 1) {
    const start = Math.round((i * length) / parts);
    const end = Math.round(((i + 1) * length) / parts);
    result.push([start, end - start]);
  }
  return result;
}

/**
 * The tiles covering a `width × height` output exactly (no gaps, no overlaps), each at most
 * `maxTile` px a side, in reading order. Columns and rows are as few as the limit allows and of
 * near-equal size (18×24 at 4096: 2 × 2 tiles of 2700 × 3600).
 */
export function planTiles(width: number, height: number, maxTile: number): Tile[] {
  if (!(width > 0 && height > 0 && maxTile > 0)) throw new RangeError('Invalid tile plan');
  const columns = spans(width, Math.ceil(width / maxTile));
  const rows = spans(height, Math.ceil(height / maxTile));
  const tiles: Tile[] = [];
  for (const [y, h] of rows) {
    for (const [x, w] of columns) {
      tiles.push({ index: tiles.length, x, y, width: w, height: h });
    }
  }
  return tiles;
}

/** The part of the figure a tile needs, in output px relative to the figure box's corner. */
export interface FigureTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Output px per logical px. */
  readonly scale: number;
  /** The whole figure box in output px (for a scissored camera: `setViewOffset`). */
  readonly boxWidth: number;
  readonly boxHeight: number;
}

/** A figure drawn separately from the HTML layer (e.g. WebGL), tile by tile. */
export interface FigureLayer {
  /** Renders the given part of the figure; the result is drawn at `width × height` px. */
  render(tile: FigureTile): Promise<CanvasImageSource> | CanvasImageSource;
}

/** An image ready to draw, and how to free it. */
export interface LoadedImage {
  readonly image: CanvasImageSource;
  release(): void;
}

/**
 * Loads an SVG document as an image, decoded before drawing. A data URL, not an object URL:
 * Chrome taints a canvas that draws a `blob:` SVG holding `<foreignObject>`, but not a `data:` one.
 */
export async function loadSvgImage(svg: string): Promise<LoadedImage> {
  const image = new Image();
  image.decoding = 'sync';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
  } catch (error) {
    throw new Error('The poster image could not be decoded', { cause: error });
  }
  return {
    image,
    release: () => {
      image.src = '';
    },
  };
}

/** The output (or a tile) does not fit in a canvas this browser can make. */
export class CanvasLimitError extends Error {
  override name = 'CanvasLimitError';
}

export interface RasterizeOptions {
  /** The poster SVG showing `view` at `width × height` px (`posterSvg`). */
  readonly svg: (view: ViewBox, width: number, height: number) => string;
  /** Output size, px. */
  readonly width: number;
  readonly height: number;
  /** Output px per logical px. */
  readonly scale: number;
  /** Largest tile side (default `MAX_TILE`). */
  readonly tileSize?: number;
  /** Draw the poster small until stable before the tiles (default true; see `settleFonts`). */
  readonly settle?: boolean;
  /** Called with the result of `settleFonts`. */
  readonly onSettled?: (result: SettleResult) => void;
  /** A raster figure and its box in logical px. */
  readonly figure?: { readonly layer: FigureLayer; readonly box: Box };
  /** Painted under the poster (the poster is opaque; this only fills sub-pixel edges). */
  readonly background?: string;
  readonly signal?: AbortSignal;
  /**
   * Called with `(0, total)` once the tiles are planned, then after each step with the steps done
   * and the total. A step is one poster tile, or one figure tile (the part of the figure layer
   * inside a poster tile): 18×24 with style A's terrain is 4 poster + 4 figure tiles.
   */
  readonly onTile?: (done: number, total: number) => void;
  readonly createCanvas?: (width: number, height: number) => ProbeCanvas;
  readonly loadImage?: (svg: string) => Promise<LoadedImage>;
}

export interface SettleResult {
  /** Draws made (fresh images each). */
  readonly attempts: number;
  /** Whether the last two draws matched. */
  readonly stable: boolean;
}

/** Waits between settle attempts, ms. */
export const SETTLE_DELAYS = [0, 100, 200, 400, 800] as const;

/** The reason a signal was aborted with, as an Error (an AbortError unless it gave its own). */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError');
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      if (signal) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A preview no wider than this is enough to see every text run change. */
const SETTLE_WIDTH = 720;

/** FNV-1a over the pixels. */
function pixelHash(data: Uint8ClampedArray): number {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Draws the whole poster small, each time in a fresh image (as every tile is), until two draws in
 * a row are pixel-identical (bounded by `SETTLE_DELAYS`). A face whose load an image triggered
 * late shows up as a difference, and once it is in the page's memory cache every later image draws
 * with it. Aborting `signal` stops it at once: the wait between draws rejects, and every draw is
 * followed by a check.
 */
export async function settleFonts({
  svg,
  width,
  height,
  scale,
  createCanvas: create = createProbeCanvas,
  loadImage = loadSvgImage,
  delays = SETTLE_DELAYS,
  signal,
}: Pick<
  RasterizeOptions,
  'svg' | 'width' | 'height' | 'scale' | 'createCanvas' | 'loadImage' | 'signal'
> & {
  delays?: readonly number[];
}): Promise<SettleResult> {
  signal?.throwIfAborted();
  const logicalWidth = width / scale;
  const logicalHeight = height / scale;
  const k = Math.min(1, SETTLE_WIDTH / logicalWidth);
  const w = Math.max(1, Math.round(logicalWidth * k));
  const h = Math.max(1, Math.round(logicalHeight * k));
  const canvas = create(w, h);
  const context = context2d(canvas, { willReadFrequently: true });
  if (!context) {
    recordAuxiliaryCanvasFailure(w, h);
    throw new CanvasLimitError('No 2D context for the settle canvas');
  }
  const source = svg({ x: 0, y: 0, width: logicalWidth, height: logicalHeight }, w, h);
  let previous: number | null = null;
  let attempts = 0;
  try {
    for (const delay of delays) {
      if (delay > 0) await abortableDelay(delay, signal);
      signal?.throwIfAborted();
      const loaded = await loadImage(source);
      try {
        signal?.throwIfAborted();
        context.clearRect(0, 0, w, h);
        context.drawImage(loaded.image, 0, 0, w, h);
      } finally {
        loaded.release();
      }
      attempts += 1;
      const hash = pixelHash(context.getImageData(0, 0, w, h).data);
      if (hash === previous) return { attempts, stable: true };
      previous = hash;
    }
    return { attempts, stable: false };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The figure box in whole output px. */
function figurePixels(box: Box, scale: number) {
  const x0 = Math.round(box.x * scale);
  const y0 = Math.round(box.y * scale);
  const x1 = Math.round((box.x + box.width) * scale);
  const y1 = Math.round((box.y + box.height) * scale);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The part of `tile` inside the figure box (output px), or null when they do not overlap. */
function figureIntersection(
  tile: Tile,
  box: { x: number; y: number; width: number; height: number },
) {
  const x0 = Math.max(tile.x, box.x);
  const y0 = Math.max(tile.y, box.y);
  const x1 = Math.min(tile.x + tile.width, box.x + box.width);
  const y1 = Math.min(tile.y + tile.height, box.y + box.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Renders the poster into one canvas of the output size, tile by tile. */
export async function rasterize({
  svg,
  width,
  height,
  scale,
  tileSize = MAX_TILE,
  settle = true,
  onSettled,
  figure,
  background = '#ffffff',
  signal,
  onTile,
  createCanvas: create = createProbeCanvas,
  loadImage = loadSvgImage,
}: RasterizeOptions): Promise<ProbeCanvas> {
  if (knownCanvasResult(width, height) === false) {
    throw new CanvasLimitError(`A ${String(width)} × ${String(height)} canvas failed before`);
  }
  const tiles = planTiles(width, height, tileSize);
  const box = figure ? figurePixels(figure.box, scale) : null;
  const figureParts = new Map(
    box ? tiles.map((tile) => [tile.index, figureIntersection(tile, box)] as const) : [],
  );
  const total = tiles.length + [...figureParts.values()].filter((part) => part !== null).length;
  let done = 0;
  signal?.throwIfAborted();
  onTile?.(0, total);
  if (settle) {
    const result = await settleFonts({
      svg,
      width,
      height,
      scale,
      createCanvas: create,
      loadImage,
      signal,
    });
    onSettled?.(result);
    signal?.throwIfAborted();
  }
  let canvas: ProbeCanvas;
  try {
    canvas = create(width, height);
  } catch (error) {
    // Some browsers throw instead of handing back a dead canvas: remember the size all the same.
    recordCanvasResult(width, height, false);
    throw new CanvasLimitError(`A ${String(width)} × ${String(height)} canvas could not be made`, {
      cause: error,
    });
  }
  try {
    // The real output canvas is the probe: far-corner pixel drawn and read back.
    const context = context2d(canvas);
    if (!context) recordCanvasResult(width, height, false);
    if (!context || !verifyCanvas(canvas, width, height)) {
      throw new CanvasLimitError(
        `A ${String(width)} × ${String(height)} canvas does not work here`,
      );
    }
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    for (const tile of tiles) {
      signal?.throwIfAborted();
      const view: ViewBox = {
        x: tile.x / scale,
        y: tile.y / scale,
        width: tile.width / scale,
        height: tile.height / scale,
      };
      const loaded = await loadImage(svg(view, tile.width, tile.height));
      try {
        signal?.throwIfAborted();
        context.drawImage(loaded.image, tile.x, tile.y, tile.width, tile.height);
      } finally {
        loaded.release();
      }

      done += 1;
      onTile?.(done, total);

      const part = figureParts.get(tile.index);
      if (figure && box && part) {
        const image = await figure.layer.render({
          x: part.x - box.x,
          y: part.y - box.y,
          width: part.width,
          height: part.height,
          scale,
          boxWidth: box.width,
          boxHeight: box.height,
        });
        signal?.throwIfAborted();
        context.drawImage(image, part.x, part.y, part.width, part.height);
        done += 1;
        onTile?.(done, total);
      }
    }
    return canvas;
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
}
