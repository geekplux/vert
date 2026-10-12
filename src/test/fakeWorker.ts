/**
 * A stand-in for the browser's `Worker` that runs the parse worker's handler in-process, for
 * tests of `src/gpx/client.ts` and anything that loads a run through it. Install it with
 * `vi.stubGlobal('Worker', FakeWorker)`.
 */

import { handleMessage, type ParseRequest } from '../gpx/handler';

export class FakeWorker extends EventTarget {
  /** Every worker constructed since the last `reset()`. */
  static instances: FakeWorker[] = [];
  /** When true, requests are swallowed and never answered (a stuck worker). */
  static hang = false;

  static reset(): void {
    FakeWorker.instances = [];
    FakeWorker.hang = false;
  }

  readonly url: string;
  readonly options: WorkerOptions | undefined;
  readonly received: ParseRequest[] = [];
  terminated = false;

  constructor(url: string | URL, options?: WorkerOptions) {
    super();
    this.url = String(url);
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(data: ParseRequest): void {
    this.received.push(data);
    if (FakeWorker.hang) return;
    setTimeout(() => {
      if (this.terminated) return;
      const { response } = handleMessage(data);
      this.dispatchEvent(new MessageEvent('message', { data: response }));
    }, 0);
  }

  /** Simulates the worker script failing (a load error or an uncaught exception). */
  crash(): void {
    this.dispatchEvent(new Event('error', { cancelable: true }));
  }

  terminate(): void {
    this.terminated = true;
  }
}
