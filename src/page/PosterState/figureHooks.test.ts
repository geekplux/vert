import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { hills } from '../../terrain/testing';
import type { Heightfield } from '../../terrain/heightfield';
import type { LoadFigureTerrain } from '../hooks';
import { useFigureHeightfield } from './figureHooks';

const BOUNDS = { west: -84, south: 34.7, east: -83.9, north: 34.8 };

describe('useFigureHeightfield', () => {
  it('evicts a failed grid, so a new attempt builds it afresh', async () => {
    let fail = true;
    const load = vi.fn<LoadFigureTerrain>(() =>
      fail ? Promise.reject(new Error('offline')) : Promise.resolve(hills()),
    );
    const { result, rerender } = renderHook(
      ({ attempt }: { attempt: number }) => useFigureHeightfield(BOUNDS, load, attempt),
      { initialProps: { attempt: 0 } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(load).toHaveBeenCalledTimes(1);

    fail = false;
    rerender({ attempt: 1 });
    // Asking again is `loading` until it settles, never the old error.
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares a build in flight for the same bounds, and keeps a ready grid cached', async () => {
    let finish: (heightfield: Heightfield) => void = () => undefined;
    const load = vi.fn<LoadFigureTerrain>(
      () =>
        new Promise<Heightfield>((resolve) => {
          finish = resolve;
        }),
    );
    const a = renderHook(() => useFigureHeightfield(BOUNDS, load));
    const same = { ...BOUNDS };
    const b = renderHook(() => useFigureHeightfield(same, load));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(hills());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(a.result.current.status).toBe('ready');
      expect(b.result.current.status).toBe('ready');
    });
    renderHook(() => useFigureHeightfield(BOUNDS, load, 5));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
