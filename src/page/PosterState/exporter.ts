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
 * PHASE 3 (export, task 6): `src/poster/export.ts` implements `Exporter` for real (tiles,
 * stitching, PNG / PDF, the browser download) and `defaultExporter` below points at it instead of
 * `simulateExport`. That is the only change outside the new module.
 */
import { posterSizeById } from '../../poster/sizes';
import type { PosterSize } from '../../poster/sizes';
import { posterContentFromRun } from '../../poster/types';
import type { PosterContent } from '../../poster/types';
import type { Prefs } from '../state';
import type { Run } from '../types';
import { posterFileName } from './posterCopy';
import { simulateExport } from './simulateExport';

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

/** A failure whose message is fit to show the user (any other rejection shows a generic one). */
export class ExportError extends Error {
  override name = 'ExportError';
}

export const GENERIC_EXPORT_ERROR = 'The export failed. Try again.';

/** What to tell the user when an export rejects with `error`. */
export function exportErrorMessage(error: unknown): string {
  return error instanceof ExportError && error.message ? error.message : GENERIC_EXPORT_ERROR;
}

/** The one place an export job is built, from the run and the current preferences. */
export function buildExportJob(run: Run, prefs: Prefs, format: ExportFormat): ExportJob {
  const size = posterSizeById(prefs.poster.size);
  const content = posterContentFromRun(run, prefs);
  return {
    run,
    prefs,
    content,
    size,
    format,
    fileName: posterFileName(content.title, size.id, format),
  };
}

/** The exporter the app uses. PHASE 3 points this at `src/poster/export.ts`. */
export const defaultExporter: Exporter = simulateExport;
