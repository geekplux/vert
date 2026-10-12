import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLACEHOLDER_DELAY_MS,
  RunProvider,
  immediateSchedule,
  useRun,
  useRunChooser,
  useRunLoader,
  useTerrain,
} from './hooks';
import type { Run } from './types';
import type { RunProviderProps, Schedule } from './hooks';
import { SAMPLE_RUN } from './sample';
import { usePageState } from './state';

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
  const { chooseFile, chooseSample } = useRunChooser(dispatch);
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
      <p>run: {run?.name ?? 'none'}</p>
      <p>terrain: {terrain.status}</p>
      <p>poster title: {state.prefs.poster.title || '–'}</p>
      <button type="button" onClick={chooseSample}>
        Try the sample
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

function renderProbe(props: Omit<RunProviderProps, 'children'> = {}) {
  return render(
    <RunProvider {...props}>
      <Probe />
    </RunProvider>,
  );
}

function wrapper(props: Omit<RunProviderProps, 'children'> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <RunProvider {...props}>{children}</RunProvider>;
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

  it('return a run given up front, with ready (placeholder) terrain', () => {
    const { result } = renderHook(() => ({ run: useRun(), terrain: useTerrain() }), {
      wrapper: wrapper({ initialRun: SAMPLE_RUN }),
    });
    expect(result.current.run).toBe(SAMPLE_RUN);
    expect(result.current.terrain).toEqual({ status: 'ready', placeholder: true });
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
    expect(screen.getByText('run: Coosa Backcountry Loop')).toBeDefined();
    expect(screen.getByText('terrain: ready')).toBeDefined();
    expect(screen.getByText('poster title: Coosa Backcountry Loop')).toBeDefined();
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

  it('waits the placeholder delay on the real clock', async () => {
    vi.useFakeTimers();
    renderProbe();
    act(() => {
      screen.getByRole('button', { name: 'Try the sample' }).click();
    });
    expect(screen.getByText('busy: sample')).toBeDefined();

    await act(() => vi.advanceTimersByTimeAsync(PLACEHOLDER_DELAY_MS - 1));
    expect(screen.getByText('screen: upload')).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('screen: view')).toBeDefined();
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
    await expect(second).resolves.toBe(SAMPLE_RUN);
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
});
