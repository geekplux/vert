import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeightfieldError } from '../terrain/heightfield';
import type { Heightfield } from '../terrain/heightfield';
import { hills } from '../terrain/testing';
import {
  RunProvider,
  TERRAIN_GENERIC_ERROR,
  TERRAIN_OFFLINE_ERROR,
  useRetryTerrain,
  useRun,
  useRunLoader,
  useTerrain,
} from './hooks';
import type { LoadRun, LoadTerrain, RunProviderProps } from './hooks';
import { SAMPLE_RUN } from './sample';
import type { Run } from './types';

/** A terrain loader the test settles by hand: one deferred build per call. */
function manualTerrain() {
  const builds: {
    run: Run;
    signal: AbortSignal;
    resolve: (heightfield: Heightfield) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const loadTerrain: LoadTerrain = (run, signal) =>
    new Promise<Heightfield>((resolve, reject) => {
      builds.push({ run, signal, resolve, reject });
    });
  const build = (index: number) => {
    const found = builds[index];
    if (!found) throw new Error(`no build #${String(index)}`);
    return found;
  };
  return { loadTerrain, builds, build };
}

function wrapper(props: Omit<RunProviderProps, 'children'>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <RunProvider {...props}>{children}</RunProvider>;
  };
}

function useTerrainProbe() {
  return { loader: useRunLoader(), run: useRun(), terrain: useTerrain(), retry: useRetryTerrain() };
}

/** Lets the loader's promise callbacks run. */
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

const OTHER_RUN: Run = { ...SAMPLE_RUN, id: 'other-run', name: 'Other' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTerrain lifecycle', () => {
  it('starts building as soon as a run loads, before any View mounts', async () => {
    const terrain = manualTerrain();
    const loadRun: LoadRun = () => Promise.resolve(SAMPLE_RUN);
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ loadRun, loadTerrain: terrain.loadTerrain }),
    });
    expect(result.current.terrain.status).toBe('idle');
    expect(terrain.builds).toHaveLength(0);

    await act(async () => {
      await result.current.loader.load({ kind: 'sample' });
    });
    expect(terrain.builds).toHaveLength(1);
    expect(terrain.build(0).run).toBe(SAMPLE_RUN);
    expect(result.current.terrain.status).toBe('loading');

    const heightfield = hills();
    terrain.build(0).resolve(heightfield);
    await settle();
    expect(result.current.terrain).toMatchObject({ status: 'ready', heightfield });
  });

  it('aborts the build when a new run loads, and ignores its late result', async () => {
    const terrain = manualTerrain();
    const loadRun: LoadRun = () => Promise.resolve(OTHER_RUN);
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadRun, loadTerrain: terrain.loadTerrain }),
    });
    expect(terrain.build(0).run).toBe(SAMPLE_RUN);

    await act(async () => {
      await result.current.loader.load({ kind: 'sample' });
    });
    expect(terrain.build(0).signal.aborted).toBe(true);
    expect(terrain.build(1).run).toBe(OTHER_RUN);
    expect(terrain.build(1).signal.aborted).toBe(false);

    // The first run's grid arrives late: it is not shown for the new run.
    terrain.build(0).resolve(hills());
    await settle();
    expect(result.current.terrain.status).toBe('loading');

    const heightfield: Heightfield = { ...hills(), zoom: 12 };
    terrain.build(1).resolve(heightfield);
    await settle();
    expect(result.current.terrain).toMatchObject({ status: 'ready', heightfield });
  });

  it('aborts the build on New file (clear) and goes back to idle', () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    act(() => {
      result.current.loader.clear();
    });
    expect(terrain.build(0).signal.aborted).toBe(true);
    expect(result.current.terrain.status).toBe('idle');
  });

  it('aborts the build on unmount', () => {
    const terrain = manualTerrain();
    const { unmount } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    unmount();
    expect(terrain.build(0).signal.aborted).toBe(true);
  });

  it('reports no tiles at all (offline) as an error, and builds again on retry', async () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    terrain.build(0).reject(new HeightfieldError([{ z: 13, x: 1, y: 1 }], new TypeError('down')));
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_OFFLINE_ERROR });

    act(() => {
      result.current.retry();
    });
    expect(result.current.terrain.status).toBe('loading');
    expect(terrain.builds).toHaveLength(2);
    const heightfield = hills();
    terrain.build(1).resolve(heightfield);
    await settle();
    expect(result.current.terrain).toMatchObject({ status: 'ready', heightfield });
  });

  it('says offline when the browser is offline, whatever the error', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const loadTerrain: LoadTerrain = () => Promise.reject(new Error('anything'));
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain }),
    });
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_OFFLINE_ERROR });
    vi.restoreAllMocks();
  });

  it('shows a generic message for any other failure, and ignores an abort', async () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    terrain.build(0).reject(new RangeError('No tiles cover the bounds'));
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_GENERIC_ERROR });

    act(() => {
      result.current.retry();
    });
    terrain.build(1).reject(new DOMException('Stopped', 'AbortError'));
    await settle();
    expect(result.current.terrain.status).toBe('loading');
  });

  it('is ready despite failed tiles, and says which and out of how many', async () => {
    const failedTiles = [{ z: 13, x: 2186, y: 3281 }];
    const heightfield: Heightfield = { ...hills(), failedTiles };
    const loadTerrain: LoadTerrain = () => Promise.resolve(heightfield);
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain }),
    });
    await settle();
    // hills() spans 0.04° × 0.02° at z13: 2 × 2 tiles.
    expect(result.current.terrain).toEqual({
      status: 'ready',
      heightfield,
      failedTiles,
      totalTiles: 4,
    });
  });

  it('uses the real loader by default: same-origin tile URLs only, aborted with the run', async () => {
    const requests: { url: string; signal: AbortSignal | null | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        requests.push({ url, signal: init?.signal });
        return new Promise(() => undefined);
      }),
    );
    const { unmount } = render(
      <RunProvider initialRun={SAMPLE_RUN}>
        <p>terrain</p>
      </RunProvider>,
    );
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    for (const { url } of requests) expect(url).toMatch(/^\/tiles\/\d+\/\d+\/\d+\.png$/);
    unmount();
    expect(requests.every(({ signal }) => signal?.aborted)).toBe(true);
  });

  it('builds nothing in placeholder mode unless a terrain loader is given', async () => {
    const fetchSpy = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, delayMs: 0 }),
    });
    await settle();
    expect(result.current.terrain.status).toBe('loading');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
