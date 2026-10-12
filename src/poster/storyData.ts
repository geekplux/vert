/**
 * Story-only helpers for the B and E poster stories: the real sample run parsed on the main thread
 * and heightfields built through the dev /tiles proxy. Not imported by the app.
 */
import { useEffect, useState } from 'react';
import { buildRun, decodeGpxBytes } from '../gpx/handler';
import { parseGpx } from '../gpx/parse';
import type { Run } from '../page/types';
import { buildHeightfield } from '../terrain/heightfield';
import type { BuildHeightfieldOptions, Heightfield } from '../terrain/heightfield';
import type { Bounds } from '../lib/geo';

const SAMPLE_URL = '/samples/coosa-backcountry.gpx';

let samplePromise: Promise<Run> | null = null;

/** The bundled sample GPX, parsed in the page (stories only; the app parses in a worker). */
export function loadSampleRun(): Promise<Run> {
  samplePromise ??= fetch(SAMPLE_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const parsed = parseGpx(decodeGpxBytes(buffer));
      const { run, points } = buildRun(parsed, 'coosa-backcountry.gpx', true);
      return { ...run, id: 'story-sample', track: points };
    });
  return samplePromise;
}

export function useSampleRun(): Run | null {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    let live = true;
    loadSampleRun()
      .then((loaded) => {
        if (live) setRun(loaded);
      })
      .catch((error: unknown) => {
        console.error(error);
      });
    return () => {
      live = false;
    };
  }, []);
  return run;
}

const heightfields = new Map<string, Promise<Heightfield>>();

/** A heightfield for `bounds`, built once per bounds and options. */
export function useHeightfield(
  bounds: Bounds | null,
  options: Pick<BuildHeightfieldOptions, 'padding'> = {},
): Heightfield | null {
  const [heightfield, setHeightfield] = useState<Heightfield | null>(null);
  const key = bounds
    ? [bounds.west, bounds.south, bounds.east, bounds.north, options.padding ?? 'default']
        .map((v) => (typeof v === 'number' ? v.toFixed(5) : v))
        .join(',')
    : '';
  useEffect(() => {
    if (!bounds) return;
    let live = true;
    let promise = heightfields.get(key);
    if (!promise) {
      promise = buildHeightfield(bounds, options);
      heightfields.set(key, promise);
    }
    promise
      .then((built) => {
        if (live) setHeightfield(built);
      })
      .catch((error: unknown) => {
        console.error(error);
      });
    return () => {
      live = false;
    };
    // `key` stands for `bounds` and `options`.
  }, [key]);
  return heightfield;
}
