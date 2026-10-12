/**
 * Canvas size limits, measured where they matter rather than assumed (DESIGN-SPEC §4: canvases are
 * commonly capped at 8192–16384 px per side, phones far lower in area). A canvas past the limit
 * does not throw on creation: it stays blank, or `getContext` returns null. So a canvas is
 * verified by drawing one opaque pixel at its far corner and reading it back.
 *
 * Probing is lazy and only for what an export needs: the export verifies its own output canvas
 * right after creating it (no separate allocation, no up-front 16384² probe, which costs ~1 GB on
 * a desktop and can kill a phone tab). Results are cached per size, and `canvasDiagnostics()`
 * reports what has been seen.
 *
 * A failure can be transient (another tab held the GPU memory, the page was under pressure), so
 * one failure does not condemn a size: the next Download tries it again. A size that has failed
 * {@link FAILURES_TO_GIVE_UP} times without working in between fails fast for the rest of the
 * session (and so does any size at least as large in both sides), so a browser that really cannot
 * hold it is not made to crash again and again. A size that works clears its failures and those of
 * every size no larger in both sides (18×24 working shows A3 fits). A failure is the newest
 * evidence: it drops any larger working size, so what is known never says both "works" and "given
 * up" about one size.
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

/** Failures in a row (without a success) after which a size is not tried again this session. */
export const FAILURES_TO_GIVE_UP = 2;

/** Sizes verified to work. */
const working = new Set<string>();
/** Failures in a row per size (cleared when the size, or one at least as large, works). */
const failures = new Map<string, number>();
/**
 * Failures of auxiliary canvases (the small settle canvas): kept for diagnostics only, never fed to
 * `knownCanvasResult`, so one transient failure on a small canvas cannot mark every poster size as
 * too large for the rest of the session.
 */
const auxiliaryFailures = new Set<string>();
const key = (width: number, height: number) => `${String(width)}x${String(height)}`;
/** The width and height a size key stands for. */
function sides(size: string): readonly [number, number] {
  const [w = 0, h = 0] = size.split('x').map(Number);
  return [w, h];
}
/** Whether `size` is no larger than `width × height` in both sides. */
function fitsIn(size: string, width: number, height: number): boolean {
  const [w, h] = sides(size);
  return w <= width && h <= height;
}

/** Whether `size` has failed often enough to give it up for the session. */
function givenUp(size: string): boolean {
  return (failures.get(size) ?? 0) >= FAILURES_TO_GIVE_UP;
}

/**
 * What is known about a `width × height` canvas: true once it (or a size at least as large in both
 * sides) worked, false once it (or a size no larger in both sides) has been given up
 * ({@link FAILURES_TO_GIVE_UP} failures in a row), else undefined: never tried, or failed only once,
 * which is worth one more try.
 */
export function knownCanvasResult(width: number, height: number): boolean | undefined {
  // A size no larger than one that worked works (a later failure would have dropped that one).
  for (const size of working) {
    const [w, h] = sides(size);
    if (width <= w && height <= h) return true;
  }
  // A size no smaller than one given up fails.
  for (const size of failures.keys()) {
    if (givenUp(size) && fitsIn(size, width, height)) return false;
  }
  return undefined;
}

/**
 * Records what a `width × height` canvas did (for a failure seen before any probe could run). A
 * success clears the failures of every size no larger in both sides; a failure drops every working
 * size at least as large in both sides.
 */
export function recordCanvasResult(width: number, height: number, ok: boolean): void {
  const size = key(width, height);
  if (ok) {
    working.add(size);
    for (const failed of [...failures.keys()]) {
      if (fitsIn(failed, width, height)) failures.delete(failed);
    }
  } else {
    for (const worked of [...working]) {
      const [w, h] = sides(worked);
      if (w >= width && h >= height) working.delete(worked);
    }
    failures.set(size, (failures.get(size) ?? 0) + 1);
  }
}

/**
 * Records that an auxiliary canvas (not the output) failed. Diagnostics only: it does not decide
 * whether any size, this one included, is tried again.
 */
export function recordAuxiliaryCanvasFailure(width: number, height: number): void {
  auxiliaryFailures.add(key(width, height));
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
  recordCanvasResult(expectWidth, expectHeight, ok);
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
    recordCanvasResult(width, height, false);
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
  /** Sizes that failed, with "×2" once given up (and "(settle)" for the settle canvas). */
  readonly failing: readonly string[];
}

/** The canvas sizes verified so far in this session (for diagnostics and PROGRESS.md). */
export function canvasDiagnostics(): CanvasDiagnostics {
  const failing: string[] = [];
  for (const [size, count] of failures) {
    failing.push(count > 1 ? `${size} ×${String(count)}` : size);
  }
  for (const size of auxiliaryFailures) failing.push(`${size} (settle)`);
  return { working: [...working], failing };
}

/** Forgets every result (tests). */
export function resetCanvasResults(): void {
  working.clear();
  failures.clear();
  auxiliaryFailures.clear();
}
