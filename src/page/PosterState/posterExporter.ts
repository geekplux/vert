/**
 * The app's exporter (`defaultExporter`): renders the poster the preview shows, at the output
 * size, and saves it.
 *
 * 1. The element is `LivePoster` in export mode (`exportScale`): the same component, props and
 *    data as the preview (style, size, content, units, exaggeration, the View's camera, the
 *    trimmed track and the frame it gives for "Hide start and end"), with Night Ridge's and
 *    Survey Quad's lines sampled for the export scale (`posterLayout(size).scale`). Their height
 *    grids come from the preview's loader (`job.sources`), so they are usually cached already.
 * 2. Style A's terrain is a raster layer: the three.js figure (`TerrainFigureRenderer`, its own
 *    off-screen stage, loaded lazily) drawn per output tile with the whole figure's camera, a view
 *    offset and a bleed (`renderTerrainFigureTile`), at the export scale (route, halo, ridge lines
 *    and marker sprites scale with it), from the grid the poster reports through
 *    `onFigureStatus`. The renderer and its WebGL context are released when the export ends,
 *    however it ends.
 * 3. The terrain is waited for at most {@link TERRAIN_TIMEOUT_MS} (from Download until the figure
 *    is ready; the tiles are drawn after it without a limit). When it fails, Night Ridge and Survey
 *    Quad are exported as the preview shows them then: the figure box says "The terrain couldn’t
 *    be drawn." and the footer leaves out what describes the relief. Style A, whose poster is its
 *    terrain, fails with {@link TERRAIN_UNAVAILABLE_MESSAGE} ({@link TERRAIN_TOO_LARGE_MESSAGE}
 *    when the area is too large to fetch tiles for, which B and E also draw as the note); a terrain still loading at the limit
 *    (tiles never answered) fails every style with {@link TERRAIN_TIMEOUT_MESSAGE}.
 * 4. `exportPoster` (`src/poster/export/export.ts`, loaded on first use) does the rest; its tile
 *    reports are passed through (poster tiles plus figure tiles), and the Blob is saved with
 *    `downloadBlob` unless the export was cancelled meanwhile.
 *
 * Failures the user can act on are `ExportError`s: too large for this browser (from the engine),
 * the terrain could not be loaded (style A) or took too long (every style), the browser has no WebGL at all (style A cannot be exported
 * here; B and E can), or it has WebGL but could not draw the figure at this size. Only the last
 * two are told apart after the fact (`hasWebGL`), and "Try a smaller size" is advised only when a
 * smaller size exists.
 */
import { createElement } from 'react';
import type { FigureLayer, FigureTile } from '../../poster/export/rasterize';
import { ExportError } from '../../poster/export/errors';
import { posterLayout } from '../../poster/layout';
import { hasSmallerSize } from '../../poster/sizes';
import type { PosterSize } from '../../poster/sizes';
import type { TerrainFigureScene } from '../../poster/terrainFigure';
import { loadTerrainFigure } from '../../poster/terrainFigureChunk';
import { trimTrack } from '../../gpx/trim';
import { HeightfieldTooLargeError } from '../../terrain/heightfield';
import type { Heightfield } from '../../terrain/heightfield';
import { realLoadFigureTerrain, realLoadTerrain } from '../hooks';
import type { LoadFigureTerrain, LoadTerrain } from '../hooks';
import type { Terrain } from '../types';
import type { ExportJob, ExportProgressReport, ExportResult, Exporter } from './exporter';
import { LivePoster, trailSignOwnBounds } from './LivePoster';
import type { PosterFigureStatus } from './LivePoster';

/** When the figure's terrain cannot be built (offline, tile server down). */
export const TERRAIN_UNAVAILABLE_MESSAGE =
  'The terrain for this poster couldn’t be loaded. Check your connection and try again.';
/** When style A's terrain covers more ground than the tiles can be fetched for (as the View says). */
export const TERRAIN_TOO_LARGE_MESSAGE =
  'This route covers too much ground to draw its terrain, so Trail Sign posters can’t be made from it.';
/** When the figure's terrain is still loading after {@link TERRAIN_TIMEOUT_MS} (tiles hanging). */
export const TERRAIN_TIMEOUT_MESSAGE =
  'The terrain for this poster is taking too long to load. Check your connection and try again.';
/** When the browser has WebGL but could not draw style A's terrain at this size. */
export const TERRAIN_DRAW_MESSAGE =
  'This browser couldn’t draw the terrain for this poster. Try a smaller size.';
/** The same at the smallest size, where there is no smaller one to suggest. */
export const TERRAIN_DRAW_SMALLEST_MESSAGE =
  'This browser couldn’t draw the terrain for this poster. Try again.';
/** When the browser has no WebGL at all: style A cannot be exported, the SVG styles can. */
export const NO_WEBGL_MESSAGE =
  'This browser can’t draw 3D terrain, so Trail Sign posters can’t be exported here. Night Ridge and Survey Quad still work.';

/** What to say when style A's terrain could not be drawn. */
export function terrainDrawMessage(
  size: Pick<PosterSize, 'width' | 'height'>,
  webgl: boolean,
): string {
  if (!webgl) return NO_WEBGL_MESSAGE;
  return hasSmallerSize(size) ? TERRAIN_DRAW_MESSAGE : TERRAIN_DRAW_SMALLEST_MESSAGE;
}

/** Whether this browser can make a WebGL 2 context at all (three.js needs WebGL 2). */
export function browserHasWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** A figure counts as ready once its state has not changed for this long, ms. */
export const FIGURE_STABLE_MS = 50;

/**
 * The longest an export waits for its figure's terrain, ms, counted from Download: long enough
 * for a cold grid of 32 tiles on a slow connection, short enough that hanging tiles end in a
 * message rather than an export that never finishes.
 */
export const TERRAIN_TIMEOUT_MS = 20_000;

/** What the export engine provides (`src/poster/export/export.ts`). */
export interface ExportEngine {
  exportPoster: typeof import('../../poster/export/export').exportPoster;
  downloadBlob: (blob: Blob, fileName: string) => void;
}

/** Draws style A's terrain figure tile by tile (`TerrainFigureRenderer`). */
export interface FigureRenderer {
  renderTile(
    scene: TerrainFigureScene,
    tile: FigureTile,
    into?: HTMLCanvasElement,
  ): CanvasImageSource;
  dispose(): void;
}

export interface PosterExporterDeps {
  /** Loads the export engine (a lazy chunk). */
  readonly loadEngine: () => Promise<ExportEngine>;
  /** Makes a terrain figure renderer (three.js, a lazy chunk); may throw without WebGL. */
  readonly createFigureRenderer: () => Promise<FigureRenderer>;
  /** Builds the run's grid when the job has none ready (style A with the whole route drawn). */
  readonly loadTerrain: LoadTerrain;
  /** Builds a figure's own grid when the job brings no loader. */
  readonly loadFigureTerrain: LoadFigureTerrain;
  /** Whether WebGL works at all; asked only after the figure failed to draw. */
  readonly hasWebGL: () => boolean;
  /** How long to wait for the figure's terrain, ms (default {@link TERRAIN_TIMEOUT_MS}). */
  readonly terrainTimeoutMs?: number;
}

export const defaultPosterExporterDeps: PosterExporterDeps = {
  loadEngine: () => import('../../poster/export/export'),
  createFigureRenderer: () =>
    loadTerrainFigure().then((module) => new module.TerrainFigureRenderer()),
  loadTerrain: realLoadTerrain,
  loadFigureTerrain: realLoadFigureTerrain,
  hasWebGL: browserHasWebGL,
};

/** The terrain figure could not be drawn (mapped to {@link terrainDrawMessage}). */
class FigureDrawError extends Error {
  override name = 'FigureDrawError';
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof DOMException && reason.name === 'AbortError'
    ? reason
    : new DOMException('The export was cancelled.', 'AbortError');
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Follows the exported poster's figure state (`onFigureStatus`). */
export class FigureTracker {
  private current: PosterFigureStatus = { status: 'loading' };
  private version = 0;
  private readonly listeners = new Set<() => void>();

  /** For `onFigureStatus`. */
  readonly set = (status: PosterFigureStatus): void => {
    this.current = status;
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  };

  get status(): PosterFigureStatus {
    return this.current;
  }

  /** Resolves at the next change, or rejects when `signal` aborts. */
  private changed(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        this.listeners.delete(done);
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        this.listeners.delete(done);
        reject(abortReason(signal));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      this.listeners.add(done);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Resolves once the figure is ready and has stayed so for {@link FIGURE_STABLE_MS} (a late
   * relayout, say a title re-measured in its loaded face, lays the figure out again); rejects
   * when `signal` aborts. When its terrain fails it rejects with an `ExportError`, or, with
   * `failureIsFinal` (B and E, which draw a "couldn't be drawn" note in its place), resolves with
   * the error once that has stayed for {@link FIGURE_STABLE_MS} too.
   */
  async ready(signal: AbortSignal, failureIsFinal = false): Promise<PosterFigureStatus> {
    for (;;) {
      signal.throwIfAborted();
      const status = this.current;
      if (status.status === 'error' && !failureIsFinal) {
        throw new ExportError(
          status.tooLarge ? TERRAIN_TOO_LARGE_MESSAGE : TERRAIN_UNAVAILABLE_MESSAGE,
        );
      }
      if (status.status !== 'loading') {
        const version = this.version;
        await delay(FIGURE_STABLE_MS, signal);
        if (this.version === version) return status;
      } else {
        await this.changed(signal);
      }
    }
  }
}

/**
 * The time limit on the terrain: `signal` aborts when the export is cancelled or the limit
 * passes; {@link TerrainDeadline.run} turns the latter into {@link TERRAIN_TIMEOUT_MESSAGE}.
 */
class TerrainDeadline {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private expired = false;
  private readonly onAbort: () => void;
  private readonly parent: AbortSignal;

  constructor(parent: AbortSignal, ms: number) {
    this.parent = parent;
    this.onAbort = () => {
      this.controller.abort(parent.reason);
    };
    this.timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort(new DOMException('The terrain took too long.', 'TimeoutError'));
    }, ms);
    if (parent.aborted) this.onAbort();
    else parent.addEventListener('abort', this.onAbort, { once: true });
  }

  /** Aborts on Cancel or at the limit. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** `work(signal)`, its failure at the limit (not on Cancel) as the timeout message. */
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await work(this.signal);
    } catch (error) {
      if (this.expired && !this.parent.aborted) {
        throw new ExportError(TERRAIN_TIMEOUT_MESSAGE, { cause: error });
      }
      throw error;
    }
  }

  /** The terrain is in: no limit from here on. */
  clear(): void {
    clearTimeout(this.timer);
    this.parent.removeEventListener('abort', this.onAbort);
  }
}

/** The run's grid, ready: the job's when it has one, else built now (style A only). */
async function readyTerrain(
  job: ExportJob,
  deps: PosterExporterDeps,
  signal: AbortSignal,
): Promise<Terrain> {
  const terrain = job.sources?.terrain;
  if (terrain?.status === 'ready') return terrain;
  let heightfield: Heightfield;
  try {
    heightfield = await deps.loadTerrain(job.run, signal);
  } catch (error) {
    if (isAbort(error, signal)) throw abortReason(signal);
    const tooLarge = error instanceof HeightfieldTooLargeError;
    throw new ExportError(tooLarge ? TERRAIN_TOO_LARGE_MESSAGE : TERRAIN_UNAVAILABLE_MESSAGE, {
      cause: error,
    });
  }
  return { status: 'ready', heightfield, failedTiles: [], totalTiles: 0 };
}

/** Style A's terrain as a figure layer: one tile of the three.js figure per call. */
function terrainLayer(
  renderer: FigureRenderer,
  tracker: FigureTracker,
  signal: AbortSignal,
  canvas: HTMLCanvasElement,
): FigureLayer {
  return {
    render(tile) {
      signal.throwIfAborted();
      const status = tracker.status;
      if (status.status !== 'ready' || !status.scene) {
        throw new ExportError(TERRAIN_UNAVAILABLE_MESSAGE);
      }
      try {
        return renderer.renderTile(status.scene, tile, canvas);
      } catch (error) {
        throw new FigureDrawError('The terrain figure could not be drawn', { cause: error });
      }
    },
  };
}

/** An `Exporter` with its steps injected (tests use fakes). */
export function createPosterExporter(
  deps: PosterExporterDeps = defaultPosterExporterDeps,
): Exporter {
  return async (
    job: ExportJob,
    onProgress: (progress: ExportProgressReport) => void,
    signal: AbortSignal,
  ): Promise<ExportResult> => {
    const { run, prefs, content, size, format, fileName } = job;
    const style = prefs.poster.style;
    const layout = posterLayout(size);
    const loadFigureTerrain = job.sources?.loadFigureTerrain ?? deps.loadFigureTerrain;
    const tracker = new FigureTracker();
    const deadline = new TerrainDeadline(signal, deps.terrainTimeoutMs ?? TERRAIN_TIMEOUT_MS);
    let renderer: FigureRenderer | null = null;
    let canvas: HTMLCanvasElement | null = null;
    try {
      signal.throwIfAborted();
      const engine = await deps.loadEngine();
      signal.throwIfAborted();

      let terrain: Terrain = job.sources?.terrain ?? { status: 'idle' };
      let figure: FigureLayer | undefined;
      if (style === 'A') {
        // The View's grid is drawn from unless the ends are hidden (LivePoster: its own grid).
        const drawnTrack = trimTrack(run.track, prefs.poster.hideEnds);
        if (!trailSignOwnBounds(drawnTrack, prefs.poster.hideEnds)) {
          terrain = await deadline.run((limited) => readyTerrain(job, deps, limited));
        }
        try {
          renderer = await deps.createFigureRenderer();
        } catch (error) {
          if (isAbort(error, signal)) throw abortReason(signal);
          throw new FigureDrawError('No terrain figure renderer', { cause: error });
        }
        signal.throwIfAborted();
        canvas = document.createElement('canvas');
        figure = terrainLayer(renderer, tracker, signal, canvas);
      }

      const element = createElement(LivePoster, {
        run,
        prefs,
        size,
        content,
        terrain,
        loadFigureTerrain,
        pixelScale: layout.scale,
        exportScale: layout.scale,
        onFigureStatus: tracker.set,
      });
      const blob = await engine.exportPoster({
        element,
        size,
        style,
        format,
        fileName,
        title: content.title,
        ...(figure ? { figure } : {}),
        waitFor: async () => {
          // B and E draw a failed figure as the preview does; A's poster is its terrain.
          await deadline.run((limited) => tracker.ready(limited, style !== 'A'));
          deadline.clear();
        },
        signal,
        onProgress,
      });
      signal.throwIfAborted();
      engine.downloadBlob(blob, fileName);
      return { fileName };
    } catch (error) {
      if (isAbort(error, signal)) throw abortReason(signal);
      if (error instanceof FigureDrawError) {
        throw new ExportError(terrainDrawMessage(size, deps.hasWebGL()), { cause: error });
      }
      throw error;
    } finally {
      deadline.clear();
      renderer?.dispose();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  };
}

/** The exporter the app uses (`defaultExporter`). */
export const posterExporter: Exporter = createPosterExporter();
