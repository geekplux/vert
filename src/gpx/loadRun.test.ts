// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunLoadError } from '../page/errors';
import { FakeWorker } from '../test/fakeWorker';
import { resetParseWorker } from './client';
import {
  SAMPLE_UNAVAILABLE_MESSAGE,
  SAMPLE_URL,
  UNREADABLE_FILE_MESSAGE,
  realLoadRun,
} from './loadRun';
import { GPX_ERROR_MESSAGES } from './types';

const sampleBytes = readFileSync(
  new URL('../../public/samples/coosa-backcountry.gpx', import.meta.url),
);

/** Every way a page could send data out, spied on. */
let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
let beaconSpy: ReturnType<typeof vi.fn>;
let xhrOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeWorker.reset();
  vi.stubGlobal('Worker', FakeWorker);
  fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(new Response(sampleBytes)));
  vi.stubGlobal('fetch', fetchSpy);
  beaconSpy = vi.fn(() => true);
  vi.stubGlobal('navigator', { sendBeacon: beaconSpy });
  xhrOpen = vi.fn();
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      open = xhrOpen;
      send = vi.fn();
    },
  );
});

afterEach(() => {
  resetParseWorker();
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

function expectNoOtherRequests() {
  expect(beaconSpy).not.toHaveBeenCalled();
  expect(xhrOpen).not.toHaveBeenCalled();
}

describe('realLoadRun: a user file', () => {
  it('parses the file locally, with no network request at all', async () => {
    const file = new File([sampleBytes], 'my-saturday-loop.gpx', { type: 'application/gpx+xml' });
    const run = await realLoadRun({ kind: 'file', file }, signal());

    expect(run).toMatchObject({ name: 'Coosa Backcountry Trail', isSample: false });
    expect(run.id).toMatch(/^run-\d+$/);
    expect(run.track.lat).toHaveLength(5623);
    expect(fetchSpy).not.toHaveBeenCalled();
    expectNoOtherRequests();
    // The bytes went to the worker, nowhere else.
    expect(FakeWorker.instances[0]?.received[0]).toMatchObject({
      kind: 'file',
      fileName: 'my-saturday-loop.gpx',
    });
  });

  it('names an unnamed track after the file', async () => {
    const text = `<gpx version="1.1" creator="t"><trk><trkseg>
      <trkpt lat="45" lon="7"/><trkpt lat="45.01" lon="7"/></trkseg></trk></gpx>`;
    const run = await realLoadRun(
      { kind: 'file', file: new File([text], 'evening_hill_reps.gpx') },
      signal(),
    );
    expect(run.name).toBe('Evening Hill Reps');
  });

  it('refuses a file over 20 MB without reading it', async () => {
    const arrayBuffer = vi.fn();
    const file = { name: 'huge.gpx', size: 25 * 1024 * 1024, arrayBuffer } as unknown as File;
    await expect(realLoadRun({ kind: 'file', file }, signal())).rejects.toThrow(
      new RunLoadError('That file is 25 MB. The limit is 20 MB.'),
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('shows the parser’s message for a file that is not a GPX', async () => {
    const file = new File(['<kml/>'], 'route.gpx');
    const loading = realLoadRun({ kind: 'file', file }, signal());
    await expect(loading).rejects.toThrow(RunLoadError);
    await expect(loading).rejects.toThrow(GPX_ERROR_MESSAGES['not-gpx']);
  });

  it('says so when the browser cannot read the file', async () => {
    const file = {
      name: 'gone.gpx',
      size: 10,
      arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotFoundError')),
    } as unknown as File;
    await expect(realLoadRun({ kind: 'file', file }, signal())).rejects.toThrow(
      new RunLoadError(UNREADABLE_FILE_MESSAGE),
    );
  });
});

describe('realLoadRun: the sample', () => {
  it('fetches only the same-origin sample file', async () => {
    const run = await realLoadRun({ kind: 'sample' }, signal());

    expect(SAMPLE_URL).toBe('/samples/coosa-backcountry.gpx');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/samples/coosa-backcountry.gpx');
    expectNoOtherRequests();

    expect(run).toMatchObject({
      id: 'sample-coosa-backcountry',
      name: 'Coosa Backcountry Trail',
      isSample: true,
    });
    expect(run.distance).toBeCloseTo(21_480, -2);
  });

  it('reports a failed fetch with its own message', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    await expect(realLoadRun({ kind: 'sample' }, signal())).rejects.toThrow(
      new RunLoadError(SAMPLE_UNAVAILABLE_MESSAGE),
    );
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(realLoadRun({ kind: 'sample' }, signal())).rejects.toThrow(
      new RunLoadError(SAMPLE_UNAVAILABLE_MESSAGE),
    );
  });

  it('rejects with an AbortError, not a load error, when aborted', async () => {
    const controller = new AbortController();
    fetchSpy.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const loading = realLoadRun({ kind: 'sample' }, controller.signal);
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    await expect(loading).rejects.not.toBeInstanceOf(RunLoadError);
  });
});
