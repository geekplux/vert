/**
 * The page's side of the parse worker: `parseInWorker` sends a GPX to one long-lived module
 * worker (`worker.ts`, created on first use and reused) and resolves with the finished `Run`.
 *
 * - Size: inputs over {@link MAX_FILE_BYTES} (20 MB) are refused before anything is sent.
 * - Abort: the promise rejects at once with an `AbortError`; the worker finishes its current
 *   parse and its late reply is ignored (the worker is not torn down, so the next file does not
 *   pay for a new one).
 * - Timeout: a parse that takes longer than {@link PARSE_TIMEOUT_MS} terminates the worker (it is
 *   stuck or swamped) and rejects with a `RunLoadError`; the next call starts a fresh worker.
 * - A worker that fails to start or crashes rejects everything pending and is replaced next time.
 *
 * Nothing here touches the network: the bytes go from the page to the worker and back.
 */

import { RunLoadError } from '../page/errors';
import type { Run } from '../page/types';
import type { ParseRequest, ParseResponse } from './handler';
import { MAX_FILE_BYTES } from './limits';

export { MAX_FILE_BYTES };

/** A parse taking longer than this (ms) is abandoned. */
export const PARSE_TIMEOUT_MS = 20_000;

/** Shown when a parse times out. */
export const TIMEOUT_MESSAGE = 'Reading this file took too long. Try a shorter activity.';

/** What to parse: bytes (transferred to the worker, so detached afterwards) or text. */
export type ParseInput =
  | {
      readonly kind: 'file';
      readonly buffer: ArrayBuffer;
      readonly fileName: string;
      readonly isSample?: boolean;
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly fileName: string;
      readonly isSample?: boolean;
    };

export interface ParseOptions {
  /** Overrides {@link PARSE_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

const MB = 1024 * 1024;

/** "24.3", "20": megabytes rounded up to one decimal, as the Dropzone prints them. */
function formatMegabytes(bytes: number): string {
  const rounded = Math.ceil((bytes / MB) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Throws the user-facing size error when `bytes` is over {@link MAX_FILE_BYTES}. */
export function assertFileSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new RunLoadError(
      `That file is ${formatMegabytes(bytes)} MB. The limit is ${formatMegabytes(MAX_FILE_BYTES)} MB.`,
    );
  }
}

interface Pending {
  readonly resolve: (run: Run) => void;
  readonly reject: (error: Error) => void;
  readonly isSample: boolean;
}

let worker: Worker | null = null;
let nextId = 1;
let nextRunNumber = 1;
const pending = new Map<number, Pending>();

function startWorker(): Worker {
  const started = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  started.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
    settle(event.data);
  });
  started.addEventListener('error', (event) => {
    event.preventDefault();
    failAll(started, new Error('The parse worker failed.'));
  });
  return started;
}

/** Terminates `target` (if it is still the current worker) and rejects every pending parse. */
function failAll(target: Worker, error: Error): void {
  if (worker !== target) return;
  target.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const entry of waiting) entry.reject(error);
}

function settle(response: ParseResponse): void {
  const entry = pending.get(response.id);
  if (!entry) return; // aborted or timed out: the late reply is dropped
  pending.delete(response.id);
  if (response.ok) {
    const id = entry.isSample ? 'sample-coosa-backcountry' : `run-${String(nextRunNumber++)}`;
    entry.resolve({ ...response.run, id, track: response.points });
  } else if (response.code === 'internal') {
    entry.reject(new Error(response.message)); // the page shows its generic message
  } else {
    entry.reject(new RunLoadError(response.message));
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The load was cancelled.', 'AbortError');
}

/**
 * Parses a GPX in the worker and resolves with the `Run`. Rejects with a `RunLoadError` (message
 * fit for the UI) when the file is too big, is not a usable GPX, or takes too long; with an
 * `AbortError` when `signal` aborts.
 */
export function parseInWorker(
  input: ParseInput,
  signal: AbortSignal,
  options: ParseOptions = {},
): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    assertFileSize(input.kind === 'file' ? input.buffer.byteLength : input.text.length);

    const id = nextId++;
    const target = (worker ??= startWorker());
    const timer = setTimeout(() => {
      failAll(target, new RunLoadError(TIMEOUT_MESSAGE));
    }, options.timeoutMs ?? PARSE_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (!pending.delete(id)) return;
      done();
      reject(abortError(signal));
    };
    pending.set(id, {
      resolve: (run) => {
        done();
        resolve(run);
      },
      reject: (error) => {
        done();
        reject(error);
      },
      isSample: input.isSample ?? false,
    });
    signal.addEventListener('abort', onAbort, { once: true });

    const base = { id, fileName: input.fileName, isSample: input.isSample ?? false };
    if (input.kind === 'file') {
      const request: ParseRequest = { ...base, kind: 'file', buffer: input.buffer };
      target.postMessage(request, [input.buffer]);
    } else {
      const request: ParseRequest = { ...base, kind: 'text', text: input.text };
      target.postMessage(request);
    }
  });
}

/** Terminates the worker and forgets pending parses (their promises never settle). For tests. */
export function resetParseWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}
