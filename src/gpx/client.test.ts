// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunLoadError } from '../page/errors';
import { FakeWorker } from '../test/fakeWorker';
import { MAX_FILE_BYTES, TIMEOUT_MESSAGE, parseInWorker, resetParseWorker } from './client';
import { GPX_ERROR_MESSAGES } from './types';

const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Lunch Run</name><trkseg>
<trkpt lat="45.0" lon="7.0"><ele>1000</ele><time>2026-05-01T06:00:00Z</time></trkpt>
<trkpt lat="45.001" lon="7.0"><ele>1010</ele><time>2026-05-01T06:00:20Z</time></trkpt>
</trkseg></trk></gpx>`;

const bytes = () => new TextEncoder().encode(GPX).buffer;

beforeEach(() => {
  FakeWorker.reset();
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  resetParseWorker();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseInWorker', () => {
  it('resolves with a Run from one module worker, reused for the next file', async () => {
    const signal = new AbortController().signal;
    const first = await parseInWorker(
      { kind: 'file', buffer: bytes(), fileName: 'lunch.gpx' },
      signal,
    );
    const second = await parseInWorker({ kind: 'text', text: GPX, fileName: 'lunch.gpx' }, signal);

    expect(FakeWorker.instances).toHaveLength(1);
    const [worker] = FakeWorker.instances;
    expect(worker?.url).toMatch(/\/worker\.ts$/);
    expect(worker?.options).toEqual({ type: 'module' });
    expect(worker?.received.map((r) => r.kind)).toEqual(['file', 'text']);

    expect(first).toMatchObject({ name: 'Lunch Run', isSample: false, hasTime: true });
    expect(first.id).not.toBe(second.id);
    expect(first.track.lat).toHaveLength(2);
    expect(first.track.cumulative[1]).toBeCloseTo(first.distance, 9);
  });

  it('gives the sample its fixed id', async () => {
    const run = await parseInWorker(
      { kind: 'text', text: GPX, fileName: 'coosa-backcountry.gpx', isSample: true },
      new AbortController().signal,
    );
    expect(run).toMatchObject({ id: 'sample-coosa-backcountry', isSample: true });
  });

  it('rejects with the parser’s message as a RunLoadError', async () => {
    const loading = parseInWorker(
      { kind: 'text', text: '<html/>', fileName: 'x.gpx' },
      new AbortController().signal,
    );
    await expect(loading).rejects.toThrow(RunLoadError);
    await expect(loading).rejects.toThrow(GPX_ERROR_MESSAGES['not-gpx']);
  });

  it('rejects an internal failure with a plain Error (the page shows its generic copy)', async () => {
    const spy = vi.spyOn(FakeWorker.prototype, 'postMessage').mockImplementation(function (
      this: FakeWorker,
      data,
    ) {
      setTimeout(() => {
        const response = { id: data.id, ok: false, code: 'internal', message: 'Boom.' };
        this.dispatchEvent(new MessageEvent('message', { data: response }));
      }, 0);
    });
    const loading = parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      new AbortController().signal,
    );
    await expect(loading).rejects.toThrow('Boom.');
    await expect(loading).rejects.not.toBeInstanceOf(RunLoadError);
    spy.mockRestore();
  });

  it('refuses a file over 20 MB before sending it', async () => {
    const big = new ArrayBuffer(MAX_FILE_BYTES + 1);
    const loading = parseInWorker(
      { kind: 'file', buffer: big, fileName: 'huge.gpx' },
      new AbortController().signal,
    );
    await expect(loading).rejects.toThrow(
      new RunLoadError('That file is 20.1 MB. The limit is 20 MB.'),
    );
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('rejects with an AbortError on abort and ignores the late reply', async () => {
    const controller = new AbortController();
    const loading = parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      controller.signal,
    );
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    // The reply still arrives and is dropped; the worker stays up for the next file.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const next = await parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      new AbortController().signal,
    );
    expect(next.name).toBe('Lunch Run');
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('rejects at once for a signal that is already aborted, sending nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseInWorker({ kind: 'text', text: GPX, fileName: 'x.gpx' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('times out a stuck worker with a RunLoadError and starts a fresh one next time', async () => {
    FakeWorker.hang = true;
    const loading = parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      new AbortController().signal,
      { timeoutMs: 20 },
    );
    await expect(loading).rejects.toThrow(new RunLoadError(TIMEOUT_MESSAGE));
    expect(FakeWorker.instances[0]?.terminated).toBe(true);

    FakeWorker.hang = false;
    await parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      new AbortController().signal,
    );
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('rejects pending parses when the worker crashes, and replaces it', async () => {
    FakeWorker.hang = true;
    const loading = parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      new AbortController().signal,
    );
    FakeWorker.instances[0]?.crash();
    await expect(loading).rejects.toThrow('The parse worker failed.');
    await expect(loading).rejects.not.toBeInstanceOf(RunLoadError);

    FakeWorker.hang = false;
    await parseInWorker(
      { kind: 'text', text: GPX, fileName: 'x.gpx' },
      new AbortController().signal,
    );
    expect(FakeWorker.instances).toHaveLength(2);
  });
});
