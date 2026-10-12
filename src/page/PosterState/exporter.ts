/**
 * The poster exporter's contract, the job Poster mode hands it, and the exporter the app uses.
 *
 * Download builds an `ExportJob` with `buildExportJob` (the run, every preference that affects
 * the output, the poster's content, the format and the file name) and passes it to `exporter`,
 * which owns the rest: it decides how many tiles to render, reports `{ done, total }` through
 * `onProgress` (the first report replaces "Preparing…" with "Rendering tile 1 of N"), saves the
 * file, and resolves with its name. Aborting `signal` (Cancel) must stop the work; the page ignores
 * anything the exporter does after that. A rejection shows "The export failed. Try again.", or the
 * rejection's own message when it is an `ExportError`.
 *
 * `defaultExporter` is `posterExporter` (`posterExporter.ts`): it renders the same poster the
 * preview shows (`LivePoster` in export mode) at the output size with the export engine
 * (`src/poster/export/export.ts`: tiles, style A's terrain layer, PNG / PDF) and saves the file.
 * `simulateExport` remains for stories and tests that need an exporter without a browser canvas.
 */
import { ExportError } from '../../poster/export/errors';
import { posterSizeById } from '../../poster/sizes';
import type { PosterSize } from '../../poster/sizes';
import { posterContentFromRun } from '../../poster/types';
import type { PosterContent } from '../../poster/types';
import type { LoadFigureTerrain } from '../hooks';
import type { Prefs } from '../state';
import type { Run, Terrain } from '../types';
import { posterFileName } from './posterCopy';
import { posterExporter } from './posterExporter';

export type ExportFormat = 'png' | 'pdf';

/** Everything an export needs: what to draw, how, at which size, into which file. */
export interface ExportJob {
  /** The run: track, bounds, profile, stats. */
  readonly run: Run;
  /**
   * Every preference the output depends on: `units`, `exaggeration`, and `poster` (style, size,
   * title, subtitle, signature, which stats show, hideEnds).
   */
  readonly prefs: Prefs;
  /** The poster's text and stats as the preview draws them (`posterContentFromRun`). */
  readonly content: PosterContent;
  /** `prefs.poster.size` resolved: the output's pixel size and use. */
  readonly size: PosterSize;
  readonly format: ExportFormat;
  /** e.g. "vert-coosa-backcountry-trail-18x24.png" (`posterFileName`). */
  readonly fileName: string;
  /** Where the figures' height grids come from: the preview's, so the export draws the same. */
  readonly sources?: ExportSources;
}

/** The terrain Poster mode already has, handed to the exporter so it need not fetch it again. */
export interface ExportSources {
  /** The run's terrain (`useTerrain()`): style A draws from its grid unless the ends are hidden. */
  readonly terrain: Terrain;
  /** The figures' own grids (`useFigureTerrainLoader()`: cached by bounds, as in the preview). */
  readonly loadFigureTerrain: LoadFigureTerrain;
}

/** Tiles finished out of the total; `total` is an integer ≥ 1 and may be revised. */
export interface ExportProgressReport {
  readonly done: number;
  readonly total: number;
}

export interface ExportResult {
  /** The file the browser saved ("Saved <fileName>"). */
  readonly fileName: string;
}

/** Renders and saves a poster. */
export type Exporter = (
  job: ExportJob,
  onProgress: (progress: ExportProgressReport) => void,
  signal: AbortSignal,
) => Promise<ExportResult>;

/**
 * A failure whose message is fit to show the user (any other rejection shows a generic one).
 * Defined with the export engine (`src/poster/export/errors.ts`), which must not import page code.
 */
export { ExportError };

export const GENERIC_EXPORT_ERROR = 'The export failed. Try again.';

/** What to tell the user when an export rejects with `error`. */
export function exportErrorMessage(error: unknown): string {
  return error instanceof ExportError && error.message ? error.message : GENERIC_EXPORT_ERROR;
}

/** The one place an export job is built, from the run and the current preferences. */
export function buildExportJob(
  run: Run,
  prefs: Prefs,
  format: ExportFormat,
  sources?: ExportSources,
): ExportJob {
  const size = posterSizeById(prefs.poster.size);
  const content = posterContentFromRun(run, prefs);
  return {
    run,
    prefs,
    content,
    size,
    format,
    fileName: posterFileName(content.title, size.id, format),
    ...(sources ? { sources } : {}),
  };
}

/** The exporter the app uses: the real one (`posterExporter.ts`). */
export const defaultExporter: Exporter = posterExporter;
