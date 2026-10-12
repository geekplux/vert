/**
 * Canvas size limits, measured where they matter rather than assumed (DESIGN-SPEC §4: canvases are
 * commonly capped at 8192–16384 px per side, phones far lower in area). A canvas past the limit
 * does not throw on creation: it stays blank, or `getContext` returns null. So a canvas is
 * verified by drawing one opaque pixel at its far corner and reading it back.
 *
 * Probing is lazy and only for what an export needs: the export verifies its own output canvas
 * right after creating it (no separate allocation, no up-front 16384² probe, which costs ~1 GB on
 * a desktop and can kill a phone tab). Results are cached per size, so a size that failed once
 * fails fast next time, and `canvasDiagnostics()` reports what has been seen.
 */

/** Tiles are never larger than this a side; a 4096² canvas works even on iOS (16.7 Mpx). */
export const MAX_TILE = 4096;

/** A canvas-like surface: OffscreenCanvas where available, else a DOM canvas. */
export type ProbeCanvas = OffscreenCanvas | HTMLCanvasElement;

/** Creates a canvas of `width × height`: OffscreenCanvas where available, else a DOM canvas. */
export function createProbeCanvas(width: number, height: number): ProbeCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A 2D context of either kind of canvas (their 2D APIs are the same for what Vert draws). */
export function context2d(
  canvas: ProbeCanvas,
  options?: CanvasRenderingContext2DSettings,
): OffscreenCanvasRenderingContext2D | null {
  return (canvas as OffscreenCanvas).getContext('2d', options);
}

const results = new Map<string, boolean>();
const key = (width: number, height: number) => `${String(width)}x${String(height)}`;

/** What is known about a `width × height` canvas: true / false once verified, else undefined. */
export function knownCanvasResult(width: number, height: number): boolean | undefined {
  const exact = results.get(key(width, height));
  if (exact !== undefined) return exact;
  // A size no larger than one that worked works; one no smaller than one that failed fails.
  for (const [size, ok] of results) {
    const [w = 0, h = 0] = size.split('x').map(Number);
    if (ok && width <= w && height <= h) return true;
    if (!ok && width >= w && height >= h) return false;
  }
  return undefined;
}

/**
 * Whether `canvas` really has its size: draws one opaque pixel at the far corner and reads it
 * back (the caller paints over it). Records the result for `knownCanvasResult`.
 */
export function verifyCanvas(canvas: ProbeCanvas, expectWidth: number, expectHeight: number) {
  let ok = false;
  try {
    if (canvas.width === expectWidth && canvas.height === expectHeight) {
      const context = context2d(canvas);
      if (context) {
        context.fillStyle = '#ff0000';
        context.fillRect(expectWidth - 1, expectHeight - 1, 1, 1);
        const pixel = context.getImageData(expectWidth - 1, expectHeight - 1, 1, 1).data;
        ok = pixel[0] === 255 && pixel[3] === 255;
      }
    }
  } catch {
    ok = false;
  }
  results.set(key(expectWidth, expectHeight), ok);
  return ok;
}

/**
 * Whether a `width × height` canvas works, allocating one only if the answer is not known yet
 * (it is freed at once). For checks ahead of time; the export verifies its real canvas instead.
 */
export function canvasWorks(
  width: number,
  height: number,
  create: (width: number, height: number) => ProbeCanvas = createProbeCanvas,
): boolean {
  const known = knownCanvasResult(width, height);
  if (known !== undefined) return known;
  let canvas: ProbeCanvas | null = null;
  try {
    canvas = create(width, height);
    return verifyCanvas(canvas, width, height);
  } catch {
    results.set(key(width, height), false);
    return false;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export interface CanvasDiagnostics {
  /** Sizes verified to work, e.g. "5400x7200". */
  readonly working: readonly string[];
  /** Sizes that failed. */
  readonly failing: readonly string[];
}

/** The canvas sizes verified so far in this session (for diagnostics and PROGRESS.md). */
export function canvasDiagnostics(): CanvasDiagnostics {
  const working: string[] = [];
  const failing: string[] = [];
  for (const [size, ok] of results) (ok ? working : failing).push(size);
  return { working, failing };
}

/** Forgets every result (tests). */
export function resetCanvasResults(): void {
  results.clear();
}
