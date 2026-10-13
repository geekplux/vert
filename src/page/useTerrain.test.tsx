import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeightfieldError, HeightfieldTooLargeError } from '../terrain/heightfield';
import { TileDecodeError, TileNotServedError } from '../terrain/tiles';
import type { Heightfield } from '../terrain/heightfield';
import { hills, makeTrack } from '../terrain/testing';
import {
  RunProvider,
  TERRAIN_DECODE_ERROR,
  TERRAIN_UNSERVED_ERROR,
  TERRAIN_GENERIC_ERROR,
  TERRAIN_OFFLINE_ERROR,
  TERRAIN_TOO_LARGE_ERROR,
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

  it('tells a decode failure apart from a network failure', async () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    const tile = { z: 13, x: 1, y: 1 };
    terrain.build(0).reject(new HeightfieldError([tile], new TileDecodeError(tile, 1), 'decode'));
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_DECODE_ERROR });
    expect(TERRAIN_DECODE_ERROR).not.toMatch(/connection/);
  });

  it('says the site serves no elevation data when every tile came back as a page', async () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    const tile = { z: 13, x: 1, y: 1 };
    terrain
      .build(0)
      .reject(new HeightfieldError([tile], new TileNotServedError(tile, 'text/html'), 'unserved'));
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_UNSERVED_ERROR });
    expect(TERRAIN_UNSERVED_ERROR).not.toMatch(/connection|browser/);
  });

  it('says a route too large for the tiles is too large, not a connection problem', async () => {
    const loadTerrain: LoadTerrain = () => Promise.reject(new HeightfieldTooLargeError(256));
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain }),
    });
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_TOO_LARGE_ERROR });
    expect(TERRAIN_TOO_LARGE_ERROR).toBe('This route covers too much ground to draw its terrain.');
    // Even offline: the size, not the connection, is why.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.terrain).toEqual({ status: 'error', error: TERRAIN_TOO_LARGE_ERROR });
    vi.restoreAllMocks();
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

describe('elevations from the terrain', () => {
  // 61 points over the hills, through the hill's top (34.714, -83.972) at index 40.
  const corners: [number, number][] = [
    [34.705, -83.995],
    [34.71, -83.985],
    [34.714, -83.972],
    [34.71, -83.965],
  ];
  const track = makeTrack(
    Array.from({ length: 61 }, (_, i): [number, number] => {
      const k = Math.min(2, Math.floor(i / 20));
      const f = (i - 20 * k) / 20;
      const [aLat, aLon] = corners[k] ?? [0, 0];
      const [bLat, bLon] = corners[k + 1] ?? [0, 0];
      return [aLat + (bLat - aLat) * f, aLon + (bLon - aLon) * f];
    }),
  );
  const NO_ELE: Run = {
    ...SAMPLE_RUN,
    id: 'no-ele',
    isSample: false,
    hasElevation: false,
    elevationSource: null,
    vert: NaN,
    descent: NaN,
    highPoint: NaN,
    lowPoint: NaN,
    profile: [],
    climbs: [],
    distance: track.cumulative.at(-1) ?? 0,
    track,
  };

  it('fills a run without <ele> from the grid in the render that reports it ready', async () => {
    const terrain = manualTerrain();
    const seen: { status: string; source: string | null }[] = [];
    function useProbe() {
      const probe = useTerrainProbe();
      seen.push({ status: probe.terrain.status, source: probe.run?.elevationSource ?? null });
      return probe;
    }
    const { result } = renderHook(useProbe, {
      wrapper: wrapper({ initialRun: NO_ELE, loadTerrain: terrain.loadTerrain }),
    });
    expect(result.current.run).toBe(NO_ELE);
    expect(result.current.terrain.status).toBe('loading');

    terrain.build(0).resolve(hills());
    await settle();
    const run = result.current.run;
    expect(run?.elevationSource).toBe('terrain');
    expect(run?.hasElevation).toBe(true);
    expect(run?.id).toBe(NO_ELE.id);
    expect(run?.highPoint).toBeGreaterThan(800);
    expect(run?.vert).toBeGreaterThan(300);
    expect(run?.profile.length).toBe(500);
    expect(run?.track.ele).toHaveLength(61);
    // Never "ready" with the unfilled run: the View draws the route once.
    expect(seen.filter((s) => s.status === 'ready' && s.source !== 'terrain')).toEqual([]);
    // The terrain is not built again for the filled run.
    expect(terrain.builds).toHaveLength(1);
  });

  it('leaves the elevation unknown when the terrain fails', async () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: NO_ELE, loadTerrain: terrain.loadTerrain }),
    });
    terrain.build(0).reject(new HeightfieldError([], new Error('offline')));
    await settle();
    expect(result.current.terrain.status).toBe('error');
    expect(result.current.run).toBe(NO_ELE);
  });

  it("interpolates a mostly recorded file's long gaps when the terrain fails, and fills them on retry", async () => {
    // Recorded 300–900 m, a gap (NaN) over the last third: mostly recorded.
    const partialEle = Float64Array.from({ length: 61 }, (_, i) => (i < 40 ? 300 + 15 * i : NaN));
    const GAPS: Run = { ...NO_ELE, id: 'gaps', track: { ...track, partialEle } };
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: GAPS, loadTerrain: terrain.loadTerrain }),
    });
    expect(result.current.run).toBe(GAPS);
    terrain.build(0).reject(new HeightfieldError([], new Error('offline')));
    await settle();
    expect(result.current.terrain.status).toBe('error');
    const run = result.current.run;
    expect(run?.elevationSource).toBe('interpolated');
    expect(run?.hasElevation).toBe(true);
    expect(Math.round(run?.highPoint ?? 0)).toBe(885);
    expect(Math.round(run?.vert ?? 0)).toBe(585);
    expect(run?.profile.length).toBe(500);

    act(() => {
      result.current.retry();
    });
    expect(result.current.run).toBe(GAPS);
    terrain.build(1).resolve(hills());
    await settle();
    expect(result.current.run?.elevationSource).toBe('mixed');
  });

  it('keeps a run with its own elevations as it is', async () => {
    const terrain = manualTerrain();
    const { result } = renderHook(useTerrainProbe, {
      wrapper: wrapper({ initialRun: SAMPLE_RUN, loadTerrain: terrain.loadTerrain }),
    });
    terrain.build(0).resolve(hills());
    await settle();
    expect(result.current.terrain.status).toBe('ready');
    expect(result.current.run).toBe(SAMPLE_RUN);
  });
});
