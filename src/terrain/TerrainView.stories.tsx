import type { Story } from '@ladle/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '../components/Button/Button';
import { ElevationProfile } from '../components/ElevationProfile/ElevationProfile';
import { Marker } from '../components/Marker/Marker';
import { Slider } from '../components/Slider/Slider';
import { realLoadRun } from '../gpx/loadRun';
import { boundsOf, type LatLon } from '../lib/geo';
import type { Run } from '../page/types';
import { buildHeightfield, type Heightfield } from './heightfield';
import { TerrainView, type TerrainViewHandle } from './TerrainView';
import type { Insets, TerrainStage, TerrainViewMode } from './stage';

export default { title: 'Terrain / TerrainView' };

const page: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-6)',
  padding: 'var(--space-10)',
  width: 1060 + 80,
};

/** The terrain box of frame 02 View. */
const box: CSSProperties = {
  position: 'relative',
  width: 1060,
  height: 700,
  background: 'var(--surface)',
  borderRadius: 'var(--radius-panel)',
};

const status: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--muted)',
};

const controls: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-6)',
};

const times = (v: number) => `${v.toFixed(1)}×`;

const RotateIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </svg>
);

const MapIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
    <path d="M9 3v15M15 6v15" />
  </svg>
);

/**
 * For the verification scripts: per-frame render times (`window.__terrainFrames`) and the stage
 * (`window.__terrainStage`).
 */
declare global {
  interface Window {
    __terrainFrames?: { t: number; ms: number }[];
    __terrainStage?: TerrainStage | null;
  }
}
const recordFrame = (ms: number) => {
  (window.__terrainFrames ??= []).push({ t: performance.now(), ms });
};

/**
 * Track points from a GPX string. Story-only stand-in until `src/gpx/parse.ts` lands: reads the
 * lat/lon attributes of every `<trkpt>`, in either order.
 */
function trackPoints(gpx: string): LatLon[] {
  const points: LatLon[] = [];
  for (const [tag] of gpx.matchAll(/<trkpt\b[^>]*>/g)) {
    const lat = /\blat="([^"]+)"/.exec(tag)?.[1];
    const lon = /\blon="([^"]+)"/.exec(tag)?.[1];
    if (lat !== undefined && lon !== undefined) points.push({ lat: Number(lat), lon: Number(lon) });
  }
  return points;
}

function useSampleHeightfield() {
  const [heightfield, setHeightfield] = useState<Heightfield | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const response = await fetch('/samples/coosa-backcountry.gpx', { signal: controller.signal });
      const points = trackPoints(await response.text());
      setHeightfield(await buildHeightfield(boundsOf(points), { signal: controller.signal }));
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => {
      controller.abort();
    };
  }, []);
  return { heightfield, error };
}

/** Gaussian hills on a 200 × 150 grid at 30 m: no network needed. */
function syntheticHeightfield(): Heightfield {
  const width = 200;
  const height = 150;
  const elevations = new Float32Array(width * height);
  const hills = [
    { x: 0.35, y: 0.4, r: 0.18, h: 420 },
    { x: 0.65, y: 0.3, r: 0.12, h: 520 },
    { x: 0.55, y: 0.7, r: 0.22, h: 260 },
  ];
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = i / (width - 1);
      const y = j / (height - 1);
      let e = 300 + 30 * Math.sin(x * 25) * Math.cos(y * 19);
      for (const hill of hills) {
        e += hill.h * Math.exp(-((x - hill.x) ** 2 + (y - hill.y) ** 2) / hill.r ** 2);
      }
      elevations[j * width + i] = e;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
  }
  return {
    bounds: { west: -83.97, south: 34.73, east: -83.9, north: 34.77 },
    zoom: 13,
    width,
    height,
    elevations,
    min,
    max,
    metresPerSample: { x: 30, y: 30 },
    failedTiles: [],
  };
}

/** The sample run parsed by the app's real loader (parse worker) and the terrain under it. */
function useSampleRun() {
  const [run, setRun] = useState<Run | null>(null);
  const [heightfield, setHeightfield] = useState<Heightfield | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const loaded = await realLoadRun({ kind: 'sample' }, controller.signal);
      setRun(loaded);
      setHeightfield(await buildHeightfield(loaded.bounds, { signal: controller.signal }));
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(String(reason));
    });
    return () => {
      controller.abort();
    };
  }, []);
  return { run, heightfield, error };
}

/** Story-only stand-in for the page's legend chip (frame 02 View), top-left of the box. */
const legend: CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  height: 46,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '0 14px',
  background: 'var(--white)',
  borderRadius: 'var(--radius-panel)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--ink)',
  zIndex: 1,
};

const overlayButtons: CSSProperties = {
  position: 'absolute',
  right: 16,
  bottom: 16,
  display: 'flex',
  gap: 8,
  zIndex: 1,
};

function Playground({
  heightfield,
  error,
  label,
  run = null,
  insets,
  overlays,
}: {
  heightfield: Heightfield | null;
  error?: string | null;
  label: string;
  run?: Run | null;
  insets?: Insets;
  overlays?: ReactNode;
}) {
  const [exaggeration, setExaggeration] = useState(1.6);
  const [view, setView] = useState<TerrainViewMode>('oblique');
  const [ready, setReady] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const handle = useRef<TerrainViewHandle>(null);
  useEffect(() => {
    window.__terrainStage = handle.current?.stage ?? null;
  });
  // Start the scrub marker part-way round once the run is known (the page keeps its own state).
  const shownScrub = scrub ?? (run ? run.distance * 0.57 : null);
  return (
    <div style={page}>
      <div style={box} data-ready={ready || undefined} data-testid="terrain-box">
        {!heightfield && <p style={status}>{error ?? 'Loading elevation…'}</p>}
        {overlays}
        <TerrainView
          ref={handle}
          heightfield={heightfield}
          exaggeration={exaggeration}
          view={view}
          ariaLabel={label}
          onReady={() => {
            setReady(true);
          }}
          onRenderFrame={recordFrame}
          track={run?.track ?? null}
          scrub={shownScrub}
          insets={insets}
        />
      </div>
      {run && run.profile.length > 0 && shownScrub !== null && (
        <ElevationProfile
          points={run.profile}
          climbs={run.climbs}
          scrub={shownScrub}
          onScrub={setScrub}
        />
      )}
      <div style={controls}>
        <div style={{ width: 288 }}>
          <Slider
            label="Vertical exaggeration"
            min={1}
            max={3}
            step={0.1}
            value={exaggeration}
            format={times}
            onChange={setExaggeration}
          />
        </div>
        <Button
          variant="secondary"
          aria-pressed={view === 'oblique'}
          onClick={() => {
            setView('oblique');
          }}
        >
          Oblique
        </Button>
        <Button
          variant="secondary"
          aria-pressed={view === 'flat'}
          onClick={() => {
            setView('flat');
          }}
        >
          Flat map
        </Button>
        <Button
          variant="icon"
          aria-label="Rotate view"
          onClick={() => handle.current?.rotateBy(Math.PI / 4)}
        >
          <RotateIcon />
        </Button>
      </div>
    </div>
  );
}

export const SampleRun: Story = () => {
  const { heightfield, error } = useSampleHeightfield();
  return (
    <Playground
      heightfield={heightfield}
      error={error}
      label="3D terrain around the Coosa Backcountry Trail loop, Vogel State Park, Georgia"
    />
  );
};

const ROUTE_LABEL =
  'The Coosa Backcountry Trail loop on 3D terrain, Vogel State Park, Georgia: start and finish ' +
  'marked with a circle, the summit with a triangle';

/** The sample run's route draped on the terrain, with the profile under it driving the scrub. */
export const SampleRoute: Story = () => {
  const { run, heightfield, error } = useSampleRun();
  return <Playground run={run} heightfield={heightfield} error={error} label={ROUTE_LABEL} />;
};

const LegendStandIn = () => (
  <div style={legend} data-testid="legend">
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Marker kind="start" size={14} /> Start / finish
    </span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Marker kind="summit" size={14} /> Summit
    </span>
    <span>Vertical ×1.6</span>
  </div>
);

/**
 * The page's overlays on top of the box: a legend-sized chip top left (62 px from the top edge to
 * its bottom) and two 44 px icon buttons bottom right (60 px from the bottom edge to their top).
 * The model is fitted inside the box minus these insets.
 */
export const WithInsets: Story = () => {
  const { run, heightfield, error } = useSampleRun();
  return (
    <Playground
      run={run}
      heightfield={heightfield}
      error={error}
      label={ROUTE_LABEL}
      insets={{ top: 62, right: 0, bottom: 60, left: 0 }}
      overlays={
        <>
          <LegendStandIn />
          <div style={overlayButtons} data-testid="overlay-buttons">
            <Button variant="icon" aria-label="Rotate view">
              <RotateIcon />
            </Button>
            <Button variant="icon" aria-label="Flat map">
              <MapIcon />
            </Button>
          </div>
        </>
      }
    />
  );
};

const synthetic = syntheticHeightfield();

export const SyntheticHills: Story = () => (
  <Playground heightfield={synthetic} label="3D terrain of three synthetic hills" />
);
