import type { Story } from '@ladle/react';
import { useEffect, useState } from 'react';
import { realLoadRun } from '../../gpx/loadRun';
import { HeightfieldError } from '../../terrain/heightfield';
import { pendingLoadTerrain, realLoadTerrain } from '../hooks';
import type { LoadTerrain } from '../hooks';
import { Page } from '../Page';
import { INITIAL_PREFS } from '../state';
import type { PageState, Prefs } from '../state';
import type { Run } from '../types';

// The whole page in the View state with the real sample run: the GPX fetched from
// /samples/coosa-backcountry.gpx and parsed in the worker, the terrain built from elevation tiles
// through Ladle's /tiles proxy (.ladle/vite.config.ts), as the app does. Each story sets its width
// so Ladle renders it in an iframe of that size and media queries apply.
export default { title: 'Page / View' };

const status = { margin: 0, padding: 'var(--space-6)', fontFamily: 'var(--font-mono)' };

/** The sample run as the app loads it ("Try the sample run"). */
function useSampleRun(): Run | string | null {
  const [run, setRun] = useState<Run | string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    realLoadRun({ kind: 'sample' }, controller.signal).then(setRun, (error: unknown) => {
      if (!controller.signal.aborted) setRun(String(error));
    });
    return () => {
      controller.abort();
    };
  }, []);
  return run;
}

function LiveView({
  prefs = {},
  loadTerrain = realLoadTerrain,
}: {
  prefs?: Partial<Prefs>;
  loadTerrain?: LoadTerrain;
}) {
  const run = useSampleRun();
  if (run === null) return <p style={status}>Parsing the sample…</p>;
  if (typeof run === 'string') return <p style={status}>{run}</p>;
  const state: PageState = {
    screen: { name: 'view', runId: run.id },
    prefs: { ...INITIAL_PREFS, ...prefs },
  };
  return <Page initialRun={run} initialState={state} loadTerrain={loadTerrain} />;
}

export const View1440: Story = () => <LiveView />;
View1440.storyName = 'View 1440';
View1440.meta = { width: 1440 };

export const View900: Story = () => <LiveView />;
View900.storyName = 'View 900';
View900.meta = { width: 900 };

export const View390: Story = () => <LiveView />;
View390.storyName = 'View 390';
View390.meta = { width: 390 };

export const Imperial: Story = () => <LiveView prefs={{ units: 'imperial' }} />;
Imperial.meta = { width: 1440 };

/** Tiles never arrive: the box says "Loading terrain…". */
export const LoadingTerrain: Story = () => <LiveView loadTerrain={pendingLoadTerrain} />;
LoadingTerrain.storyName = 'Loading terrain';
LoadingTerrain.meta = { width: 1440 };

/** No tile loads (offline): the message and Try again (which fails again here). */
const offline: LoadTerrain = () =>
  Promise.reject(new HeightfieldError([{ z: 13, x: 0, y: 0 }], new TypeError('Failed to fetch')));

export const TerrainError: Story = () => <LiveView loadTerrain={offline} />;
TerrainError.storyName = 'Terrain error';
TerrainError.meta = { width: 1440 };

/** The real grid, reported as if one tile had failed: the note under the box. */
const oneTileFailed: LoadTerrain = async (run, signal) => {
  const heightfield = await realLoadTerrain(run, signal);
  return { ...heightfield, failedTiles: [{ z: heightfield.zoom, x: 0, y: 0 }] };
};

export const PartialTiles: Story = () => <LiveView loadTerrain={oneTileFailed} />;
PartialTiles.storyName = 'Some tiles failed';
PartialTiles.meta = { width: 1440 };

export const PartialTiles390: Story = () => <LiveView loadTerrain={oneTileFailed} />;
PartialTiles390.storyName = 'Some tiles failed 390';
PartialTiles390.meta = { width: 390 };
