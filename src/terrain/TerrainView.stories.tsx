import type { Story } from '@ladle/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../components/Button/Button';
import { Slider } from '../components/Slider/Slider';
import { boundsOf, type LatLon } from '../lib/geo';
import { buildHeightfield, type Heightfield } from './heightfield';
import { TerrainView, type TerrainViewHandle } from './TerrainView';
import type { TerrainViewMode } from './stage';

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

/** Per-frame render times, for the verification scripts (`window.__terrainFrames`). */
declare global {
  interface Window {
    __terrainFrames?: { t: number; ms: number }[];
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

function Playground({
  heightfield,
  error,
  label,
}: {
  heightfield: Heightfield | null;
  error?: string | null;
  label: string;
}) {
  const [exaggeration, setExaggeration] = useState(1.6);
  const [view, setView] = useState<TerrainViewMode>('oblique');
  const [ready, setReady] = useState(false);
  const handle = useRef<TerrainViewHandle>(null);
  return (
    <div style={page}>
      <div style={box} data-ready={ready || undefined} data-testid="terrain-box">
        {!heightfield && <p style={status}>{error ?? 'Loading elevation…'}</p>}
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
        />
      </div>
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

const synthetic = syntheticHeightfield();

export const SyntheticHills: Story = () => (
  <Playground heightfield={synthetic} label="3D terrain of three synthetic hills" />
);
