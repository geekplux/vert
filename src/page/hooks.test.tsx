import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENERIC_LOAD_ERROR,
  PLACEHOLDER_DELAY_MS,
  RunLoadError,
  RunProvider,
  immediateSchedule,
  pendingLoadTerrain,
  placeholderLoadRun,
  useRun,
  useRunChooser,
  useRunLoader,
  useTerrain,
} from './hooks';
import type { Run } from './types';
import type { LoadRun, LoadTerrain, RunProviderProps, Schedule } from './hooks';
import { hills } from '../terrain/testing';
import { SAMPLE_RUN } from './sample';
import { INITIAL_PAGE_STATE, usePageState } from './state';
import { resetParseWorker } from '../gpx/client';
import { FakeWorker } from '../test/fakeWorker';

/** A scheduler the test fires by hand. */
function manualSchedule() {
  const queue = new Set<() => void>();
  const schedule: Schedule = (callback) => {
    queue.add(callback);
    return () => queue.delete(callback);
  };
  const flush = () => {
    act(() => {
      for (const callback of [...queue]) {
        queue.delete(callback);
        callback();
      }
    });
  };
  return { schedule, flush, pending: () => queue.size };
}

/** A stand-in page: the state machine, the chooser, and what the hooks return. */
function Probe() {
  const { state, dispatch } = usePageState();
  const { chooseFile, chooseSample, newFile } = useRunChooser(dispatch);
  const run = useRun();
  const terrain = useTerrain();
  const { screen: page } = state;
  return (
    <>
      <p>screen: {page.name}</p>
      <p>busy: {page.name === 'upload' ? page.busy.kind : '–'}</p>
      <p>
        reading: {page.name === 'upload' && page.busy.kind === 'reading' ? page.busy.fileName : '–'}
      </p>
      <p>error: {page.name === 'upload' ? (page.error ?? '–') : '–'}</p>
      <p>run: {run?.name ?? 'none'}</p>
      <p>terrain: {terrain.status}</p>
      <p>poster title: {state.prefs.poster.title || '–'}</p>
      <button type="button" onClick={chooseSample}>
        Try the sample
      </button>
      <button type="button" onClick={newFile}>
        New file
      </button>
      <button
        type="button"
        onClick={() => {
          chooseFile(new File(['<gpx/>'], 'loop.gpx', { type: 'application/gpx+xml' }));
        }}
      >
        Choose a file
      </button>
    </>
  );
}

/** Tests here make no tile requests unless they pass a terrain loader. */
function renderProbe(props: Omit<RunProviderProps, 'children'> = {}) {
  return render(
    <RunProvider loadTerrain={pendingLoadTerrain} {...props}>
      <Probe />
    </RunProvider>,
  );
}

function wrapper(props: Omit<RunProviderProps, 'children'> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RunProvider loadTerrain={pendingLoadTerrain} {...props}>
        {children}
      </RunProvider>
    );
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useRun / useTerrain', () => {
  it('have no run and idle terrain before anything is chosen', () => {
    renderProbe();
    expect(screen.getByText('run: none')).toBeDefined();
    expect(screen.getByText('terrain: idle')).toBeDefined();
  });

  it('return a run given up front, its terrain loading, then ready', async () => {
    const heightfield = hills();
    const loadTerrain: LoadTerrain = () => Promise.resolve(heightfield);
    const { result } = renderHook(() => ({ run: useRun(), terrain: useTerrain() }), {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain }),
    });
    expect(result.current.run).toBe(SAMPLE_RUN);
    expect(result.current.terrain).toEqual({ status: 'loading' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.terrain).toEqual({
      status: 'ready',
      heightfield,
      failedTiles: [],
      totalTiles: 4,
    });
  });

  it('throw a clear error outside RunProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useRun())).toThrow('useRun must be used inside <RunProvider>');
    expect(() => renderHook(() => useTerrain())).toThrow(/useTerrain/);
    vi.mocked(console.error).mockRestore();
  });
});

describe('useRunChooser', () => {
  it('the sample: busy, then View with the sample run and the poster title seeded', async () => {
    const clock = manualSchedule();
    renderProbe({ schedule: clock.schedule });

    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    expect(screen.getByText('screen: upload')).toBeDefined();
    expect(screen.getByText('busy: sample')).toBeDefined();
    expect(screen.getByText('run: none')).toBeDefined();

    clock.flush();
    await screen.findByText('screen: view');
    expect(screen.getByText('run: Coosa Backcountry Trail')).toBeDefined();
    expect(screen.getByText('terrain: loading')).toBeDefined();
    expect(screen.getByText('poster title: Coosa Backcountry Trail')).toBeDefined();
  });

  it('a file: shows its name while reading, then the (placeholder) run', async () => {
    const clock = manualSchedule();
    renderProbe({ schedule: clock.schedule });

    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    expect(screen.getByText('busy: reading')).toBeDefined();
    expect(screen.getByText('reading: loop.gpx')).toBeDefined();

    clock.flush();
    await screen.findByText('screen: view');
    expect(screen.getByText(`run: ${SAMPLE_RUN.name}`)).toBeDefined();
  });

  it('with the immediate scheduler, goes straight to View', async () => {
    renderProbe({ schedule: immediateSchedule });
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    expect(await screen.findByText('screen: view')).toBeDefined();
  });

  it('defaults to the real loader: the sample is fetched and parsed in the worker', async () => {
    const gpx = `<gpx version="1.1" creator="t"><trk><name>Real Loop</name><trkseg>
      <trkpt lat="45" lon="7"><time>2026-05-01T06:00:00Z</time></trkpt>
      <trkpt lat="45.001" lon="7"><time>2026-05-01T06:00:20Z</time></trkpt></trkseg></trk></gpx>`;
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(gpx)));
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('fetch', fetchSpy);
    try {
      renderProbe();
      fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
      expect(await screen.findByText('screen: view')).toBeDefined();
      expect(screen.getByText('run: Real Loop')).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledWith('/samples/coosa-backcountry.gpx', expect.anything());
    } finally {
      resetParseWorker();
      vi.unstubAllGlobals();
    }
  });

  it('waits the placeholder delay on the real clock', async () => {
    vi.useFakeTimers();
    renderProbe({ delayMs: PLACEHOLDER_DELAY_MS });
    act(() => {
      screen.getByRole('button', { name: 'Try the sample' }).click();
    });
    expect(screen.getByText('busy: sample')).toBeDefined();

    await act(() => vi.advanceTimersByTimeAsync(PLACEHOLDER_DELAY_MS - 1));
    expect(screen.getByText('screen: upload')).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('screen: view')).toBeDefined();
  });

  it('a user-facing load error goes back to Upload with its message', async () => {
    const loadRun = vi.fn<LoadRun>(() =>
      Promise.reject(new RunLoadError('No track in this file.')),
    );
    renderProbe({ loadRun });

    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    expect(screen.getByText('busy: reading')).toBeDefined();
    expect(await screen.findByText('error: No track in this file.')).toBeDefined();
    expect(screen.getByText('screen: upload')).toBeDefined();
    expect(screen.getByText('busy: idle')).toBeDefined();
    expect(screen.getByText('run: none')).toBeDefined();
    expect(loadRun).toHaveBeenCalledTimes(1);
    const [source, signal] = loadRun.mock.calls[0] ?? [];
    expect(source).toMatchObject({ kind: 'file', file: { name: 'loop.gpx' } });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('any other load error shows the generic message', async () => {
    renderProbe({ loadRun: () => Promise.reject(new TypeError('x is undefined')) });
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    expect(await screen.findByText(`error: ${GENERIC_LOAD_ERROR}`)).toBeDefined();
    expect(GENERIC_LOAD_ERROR).toBe("Vert couldn't read this file.");
  });

  it('a loader that throws synchronously fails the same way', async () => {
    renderProbe({
      loadRun: () => {
        throw new RunLoadError('Not a GPX file.');
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    expect(await screen.findByText('error: Not a GPX file.')).toBeDefined();
  });

  it('after a failure, the next choice clears the error and can succeed', async () => {
    let fail = true;
    renderProbe({
      loadRun: () =>
        fail ? Promise.reject(new RunLoadError('Nope.')) : Promise.resolve(SAMPLE_RUN),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    await screen.findByText('error: Nope.');

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    expect(screen.getByText('error: –')).toBeDefined();
    expect(await screen.findByText('screen: view')).toBeDefined();
  });

  it('ignores a second choice while a load is in flight', async () => {
    const clock = manualSchedule();
    const loadRun = vi.fn(placeholderLoadRun(clock.schedule, 10));
    renderProbe({ loadRun });

    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    expect(screen.getByText('busy: sample')).toBeDefined();
    expect(loadRun).toHaveBeenCalledTimes(1);
    expect(clock.pending()).toBe(1);

    clock.flush();
    expect(await screen.findByText('screen: view')).toBeDefined();
  });

  it('newFile returns to Upload and forgets the run and terrain', async () => {
    renderProbe({ schedule: immediateSchedule });
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    await screen.findByText('screen: view');
    expect(screen.getByText('terrain: loading')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(screen.getByText('screen: upload')).toBeDefined();
    expect(screen.getByText('run: none')).toBeDefined();
    expect(screen.getByText('terrain: idle')).toBeDefined();
    expect(screen.getByText('poster title: –')).toBeDefined();
  });

  it('newFile through the hooks: useRun() is null and the terrain idle', () => {
    const { result } = renderHook(
      () => {
        const { state, dispatch } = usePageState({
          ...INITIAL_PAGE_STATE,
          screen: { name: 'view', runId: SAMPLE_RUN.id },
        });
        return { state, chooser: useRunChooser(dispatch), run: useRun(), terrain: useTerrain() };
      },
      { wrapper: wrapper({ initialRun: SAMPLE_RUN }) },
    );
    expect(result.current.run).toBe(SAMPLE_RUN);

    act(() => {
      result.current.chooser.newFile();
    });
    expect(result.current.state.screen.name).toBe('upload');
    expect(result.current.run).toBeNull();
    expect(result.current.terrain.status).toBe('idle');
  });

  it('newFile does nothing while a load is in flight', async () => {
    const clock = manualSchedule();
    renderProbe({ schedule: clock.schedule });
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(screen.getByText('busy: sample')).toBeDefined();
    expect(clock.pending()).toBe(1);

    clock.flush();
    expect(await screen.findByText('screen: view')).toBeDefined();
  });
});

describe('useRunLoader', () => {
  it('a second load supersedes the first, which resolves null', async () => {
    const clock = manualSchedule();
    const { result } = renderHook(() => ({ loader: useRunLoader(), run: useRun() }), {
      wrapper: wrapper({ schedule: clock.schedule }),
    });

    let first!: Promise<Run | null>;
    let second!: Promise<Run | null>;
    act(() => {
      first = result.current.loader.load({ kind: 'sample' });
      second = result.current.loader.load({ kind: 'sample' });
    });
    expect(clock.pending()).toBe(1);
    await expect(first).resolves.toBeNull();

    clock.flush();
    // The run is set once the loader's promise settles, a microtask after the timer.
    await act(async () => {
      await expect(second).resolves.toBe(SAMPLE_RUN);
    });
    expect(result.current.run).toBe(SAMPLE_RUN);
  });

  it('clear cancels a pending load and forgets the run', async () => {
    const clock = manualSchedule();
    const { result } = renderHook(() => ({ loader: useRunLoader(), run: useRun() }), {
      wrapper: wrapper({ schedule: clock.schedule, initialRun: SAMPLE_RUN }),
    });

    let loading!: Promise<Run | null>;
    act(() => {
      loading = result.current.loader.load({ kind: 'sample' });
      result.current.loader.clear();
    });
    await expect(loading).resolves.toBeNull();
    expect(clock.pending()).toBe(0);
    expect(result.current.run).toBeNull();
  });

  it('unmounting cancels a pending load', async () => {
    const clock = manualSchedule();
    const { result, unmount } = renderHook(() => useRunLoader(), {
      wrapper: wrapper({ schedule: clock.schedule }),
    });

    let loading!: Promise<Run | null>;
    act(() => {
      loading = result.current.load({ kind: 'sample' });
    });
    unmount();
    await expect(loading).resolves.toBeNull();
    expect(clock.pending()).toBe(0);
  });

  it('aborts an injected loader when superseded, resolving null even if it never settles', async () => {
    const signals: AbortSignal[] = [];
    const loadRun: LoadRun = (_source, signal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<Run>(() => undefined) : Promise.resolve(SAMPLE_RUN);
    };
    const { result } = renderHook(() => ({ loader: useRunLoader(), run: useRun() }), {
      wrapper: wrapper({ loadRun }),
    });

    let first!: Promise<Run | null>;
    let second!: Promise<Run | null>;
    act(() => {
      first = result.current.loader.load({ kind: 'sample' });
      second = result.current.loader.load({ kind: 'sample' });
    });
    await expect(first).resolves.toBeNull();
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      await expect(second).resolves.toBe(SAMPLE_RUN);
    });
    expect(signals[1]?.aborted).toBe(false);
    expect(result.current.run).toBe(SAMPLE_RUN);
  });

  it('ignores a late result or failure from an aborted loader', async () => {
    let finish!: (run: Run) => void;
    let fail!: (error: Error) => void;
    const calls: number[] = [];
    const loadRun: LoadRun = () =>
      new Promise<Run>((resolve, reject) => {
        calls.push(calls.length);
        finish = resolve;
        fail = reject;
      });
    const { result } = renderHook(() => ({ loader: useRunLoader(), run: useRun() }), {
      wrapper: wrapper({ loadRun }),
    });

    let loading!: Promise<Run | null>;
    act(() => {
      loading = result.current.loader.load({ kind: 'sample' });
      result.current.loader.clear();
    });
    await act(async () => {
      finish(SAMPLE_RUN);
      fail(new Error('late'));
      await expect(loading).resolves.toBeNull();
    });
    expect(result.current.run).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('rejects with the loader error', async () => {
    const error = new RunLoadError('No track in this file.');
    const { result } = renderHook(() => useRunLoader(), {
      wrapper: wrapper({ loadRun: () => Promise.reject(error) }),
    });
    let loading!: Promise<Run | null>;
    act(() => {
      loading = result.current.load({ kind: 'sample' });
    });
    await expect(loading).rejects.toBe(error);
  });
});
