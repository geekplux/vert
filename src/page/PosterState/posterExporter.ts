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
 * 3. `exportPoster` (`src/poster/export/export.ts`, loaded on first use) does the rest; its tile
 *    reports are passed through (poster tiles plus figure tiles), and the Blob is saved with
 *    `downloadBlob` unless the export was cancelled meanwhile.
 *
 * Failures the user can act on are `ExportError`s: too large for this browser (from the engine),
 * the terrain could not be loaded, or the browser could not draw it.
 */
import { createElement } from 'react';
import type { FigureLayer, FigureTile } from '../../poster/export/rasterize';
import { ExportError } from '../../poster/export/errors';
import { posterLayout } from '../../poster/layout';
import type { TerrainFigureScene } from '../../poster/terrainFigure';
import { loadTerrainFigure } from '../../poster/terrainFigureChunk';
import { trimTrack } from '../../gpx/trim';
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
/** When the browser cannot draw style A's terrain (no WebGL, or not at this size). */
export const TERRAIN_DRAW_MESSAGE =
  'This browser couldn’t draw the terrain for this poster. Try a smaller size.';

/** A figure counts as ready once its state has not changed for this long, ms. */
export const FIGURE_STABLE_MS = 50;

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
}

export const defaultPosterExporterDeps: PosterExporterDeps = {
  loadEngine: () => import('../../poster/export/export'),
  createFigureRenderer: () =>
    loadTerrainFigure().then((module) => new module.TerrainFigureRenderer()),
  loadTerrain: realLoadTerrain,
  loadFigureTerrain: realLoadFigureTerrain,
};

/** The terrain figure could not be drawn (mapped to {@link TERRAIN_DRAW_MESSAGE}). */
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
   * with an `ExportError` when its terrain fails, or when `signal` aborts.
   */
  async ready(signal: AbortSignal): Promise<PosterFigureStatus> {
    for (;;) {
      signal.throwIfAborted();
      const status = this.current;
      if (status.status === 'error') throw new ExportError(TERRAIN_UNAVAILABLE_MESSAGE);
      if (status.status === 'ready') {
        const version = this.version;
        await delay(FIGURE_STABLE_MS, signal);
        if (this.version === version) return status;
      } else {
        await this.changed(signal);
      }
    }
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
    throw new ExportError(TERRAIN_UNAVAILABLE_MESSAGE, { cause: error });
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
          terrain = await readyTerrain(job, deps, signal);
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
          await tracker.ready(signal);
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
        throw new ExportError(TERRAIN_DRAW_MESSAGE, { cause: error });
      }
      throw error;
    } finally {
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
