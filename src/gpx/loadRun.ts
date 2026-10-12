/**
 * The app's `LoadRun`: a file the user chose, or the bundled sample, parsed in the worker.
 *
 * Privacy: a user's file is read locally (`File.arrayBuffer()`) and handed to the worker; no
 * request is made. The sample is the only thing fetched, from the app's own origin.
 */

import { RunLoadError } from '../page/errors';
import type { LoadRun } from '../page/hooks';
import type { Run } from '../page/types';
import { assertFileSize, parseInWorker } from './client';

/** The bundled sample run (`public/samples/`), same origin. */
export const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/coosa-backcountry.gpx`;

/** Shown when the browser cannot read the chosen file (moved, deleted, permission revoked). */
export const UNREADABLE_FILE_MESSAGE = "Vert couldn't open this file. Try choosing it again.";

/** Shown when the sample cannot be fetched. */
export const SAMPLE_UNAVAILABLE_MESSAGE =
  "The sample run couldn't be loaded. Check your connection and try again.";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The load was cancelled.', 'AbortError');
  }
}

async function loadFile(file: File, signal: AbortSignal): Promise<Run> {
  assertFileSize(file.size); // before reading a byte of it
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new RunLoadError(UNREADABLE_FILE_MESSAGE);
  }
  throwIfAborted(signal);
  return parseInWorker({ kind: 'file', buffer, fileName: file.name }, signal);
}

async function loadSample(signal: AbortSignal): Promise<Run> {
  let buffer: ArrayBuffer;
  try {
    const response = await fetch(SAMPLE_URL, { signal });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    buffer = await response.arrayBuffer();
  } catch (error) {
    throwIfAborted(signal);
    throw new RunLoadError(SAMPLE_UNAVAILABLE_MESSAGE, { cause: error });
  }
  throwIfAborted(signal);
  return parseInWorker(
    { kind: 'file', buffer, fileName: 'coosa-backcountry.gpx', isSample: true },
    signal,
  );
}

/**
 * Parses the chosen file, or fetches and parses the sample, in the parse worker. Rejects with a
 * `RunLoadError` carrying the message to show (too big, not a GPX, no points, damaged…), or with
 * an `AbortError` when `signal` aborts.
 */
export const realLoadRun: LoadRun = (source, signal) =>
  source.kind === 'file' ? loadFile(source.file, signal) : loadSample(signal);
