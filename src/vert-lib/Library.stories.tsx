import type { Story } from '@ladle/react';
import { useEffect, useId, useMemo, useState, type CSSProperties, type ChangeEvent } from 'react';
import {
  ElevationProfile,
  SceneError,
  TERRAIN_ATTRIBUTION,
  TerrainView,
  VERT_LIB_VERSION,
  decodeScene,
  metresAtTime,
  sceneTimeRange,
  timeAtMetres,
  type Scene,
} from './index';
import styles from './Library.stories.module.css';

/**
 * The library as a host uses it (src/vert-lib/index.ts): a decoded scene drawn by `TerrainView`,
 * its `ElevationProfile` underneath, one scrub shared between them. "Coosa scene" loads the
 * committed fixture; "Open a scene file" reads any `.scene` from disk (a git-ignored one of your
 * own runs, say) without it ever being bundled; "Host sync" drives the scrub from a stand-in for
 * Activities' heart-rate chart, and the chart from the profile.
 */
export default { title: 'Library' };

// The committed fixture, as a URL, if it is there (src/scene/fixtures, written by `pnpm bake`).
const FIXTURES = import.meta.glob<string>('../scene/fixtures/*.scene', {
  query: '?url',
  import: 'default',
  eager: true,
});
const COOSA_URL = FIXTURES['../scene/fixtures/coosa-backcountry.scene'];

const page: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-4)',
  padding: 'var(--space-10) var(--space-4)',
  maxWidth: 1060,
  margin: '0 auto',
};

const box: CSSProperties = {
  position: 'relative',
  aspectRatio: '16 / 9',
  background: 'var(--surface)',
  borderRadius: 'var(--radius-panel)',
};

const note: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--muted)',
};

/**
 * A dark host (Activities' page is dark) with README.md's example: Vert's tokens set on a wrapper
 * around Vert, which both the terrain and the profile follow (no `palette` props needed).
 */
const DARK_HOST: CSSProperties & Record<`--${string}`, string> = {
  background: '#111214',
  color: '#e6edf3',
  minHeight: '100vh',
  '--surface': '#1d2a36',
  '--surface-strong': '#2a3a48',
  '--ink': '#e6edf3',
  '--muted': '#9aa8b5',
  '--route': '#ff8a3d',
  '--white': '#ffffff',
};

const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`;

/** Terrain and profile of one scene, with one scrub, as a host page would lay them out. */
function SceneDemo({ scene }: { scene: Scene }) {
  // A new scene comes with a new key (see the stories), so the scrub starts at its first point.
  const [scrub, setScrub] = useState<number | null>(scene.route.distance[0] ?? 0);
  const { summary } = scene;
  return (
    <>
      <div style={box}>
        <TerrainView
          scene={scene}
          exaggeration={1.6}
          scrub={scrub}
          ariaLabel={`3D terrain of a ${km(summary.distance)} run, ${km(summary.drawnLength)} drawn`}
        />
      </div>
      <ElevationProfile scene={scene} scrub={scrub} onScrub={setScrub} />
      <p style={note}>
        {km(summary.drawnLength)} drawn of {km(summary.distance)} (trim{' '}
        {Math.round(summary.trim.start)} m / {Math.round(summary.trim.end)} m) · Elevation:{' '}
        {TERRAIN_ATTRIBUTION} · Vert {VERT_LIB_VERSION}
      </p>
    </>
  );
}

/** Fetches and decodes the committed Coosa fixture. */
function useCoosaScene(): { scene: Scene | null; error: string | null } {
  const [state, setState] = useState<{ scene: Scene | null; error: string | null }>({
    scene: null,
    error: COOSA_URL ? null : 'src/scene/fixtures/coosa-backcountry.scene is not committed yet.',
  });
  useEffect(() => {
    if (!COOSA_URL) return;
    let live = true;
    fetch(COOSA_URL)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (live) setState({ scene: decodeScene(new Uint8Array(buffer)), error: null });
      })
      .catch((error: unknown) => {
        if (live) setState({ scene: null, error: String(error) });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export const CoosaScene: Story = () => {
  const { scene, error } = useCoosaScene();
  return (
    <main style={page}>
      {scene ? <SceneDemo scene={scene} /> : <p style={note}>{error ?? 'Loading the scene…'}</p>}
    </main>
  );
};
CoosaScene.storyName = 'Coosa scene';

export const CoosaSceneOnADarkHost: Story = () => {
  const { scene, error } = useCoosaScene();
  return (
    <div style={DARK_HOST}>
      <main style={page}>
        {scene ? <SceneDemo scene={scene} /> : <p style={note}>{error ?? 'Loading the scene…'}</p>}
      </main>
    </div>
  );
};
CoosaSceneOnADarkHost.storyName = 'Coosa scene on a dark host';

export const OpenASceneFile: Story = () => {
  const inputId = useId();
  const [opened, setOpened] = useState<{ scene: Scene; key: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .arrayBuffer()
      .then((buffer) => {
        const scene = decodeScene(new Uint8Array(buffer));
        setOpened((last) => ({ scene, key: (last?.key ?? 0) + 1 }));
        setMessage(null);
      })
      .catch((error: unknown) => {
        setOpened(null);
        setMessage(
          error instanceof SceneError
            ? `Not a valid scene (${error.reason}): ${error.message}`
            : `Could not read the file: ${String(error)}`,
        );
      });
  };
  return (
    <main style={page}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <label htmlFor={inputId} style={{ fontWeight: 600 }}>
          Open a .scene file
        </label>
        <input id={inputId} type="file" accept=".scene" onChange={onChange} />
      </div>
      {message && (
        <p role="alert" style={{ ...note, color: 'var(--ink)' }}>
          {message}
        </p>
      )}
      {opened && <SceneDemo key={opened.key} scene={opened.scene} />}
    </main>
  );
};
OpenASceneFile.storyName = 'Open a scene file';

/** h:mm:ss (or m:ss under an hour) for a number of seconds. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${String(h)}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Points in the stand-in series: Activities resamples heart rate to at most 48. */
const HR_POINTS = 48;

/** A made-up heart rate at `seconds` into the run, bpm: a warm-up, then two slow waves. */
function syntheticHeartRate(seconds: number, total: number): number {
  const warmUp = 1 - Math.exp(-seconds / 600);
  const t = total > 0 ? seconds / total : 0;
  return Math.round(
    112 + 38 * warmUp + 9 * Math.sin(t * Math.PI * 5) + 5 * Math.sin(t * Math.PI * 17),
  );
}

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 24,
  color: 'var(--ink)',
};

const CHART_W = 1000;
const CHART_H = 120;
const BPM_MIN = 90;
const BPM_MAX = 180;

const readout: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: 'var(--space-1) var(--space-3)',
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  color: 'var(--ink)',
};

const button: CSSProperties = {
  minHeight: 'var(--touch)',
  minWidth: 'var(--touch)',
  padding: '0 var(--space-4)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--white)',
  color: 'var(--ink)',
  font: 'inherit',
  justifySelf: 'start',
};

/**
 * A stand-in for Activities' heart-rate chart: a synthetic series over the whole run (0 to its
 * elapsed time) with the trimmed ends Vert does not draw hatched and labelled, a cursor at
 * `seconds`, and its own position control (a native range input: arrow keys, PageUp / PageDown,
 * Home / End, drag). Not part of the library.
 */
function HeartRateStandIn({
  total,
  drawn,
  seconds,
  onSeconds,
}: {
  /** The whole run's elapsed time, seconds. */
  total: number;
  /** The stretch Vert draws, seconds since the run's first point. */
  drawn: { start: number; end: number };
  seconds: number | null;
  onSeconds: (seconds: number) => void;
}) {
  const inputId = useId();
  const hatchId = useId();
  const x = (s: number) => (total > 0 ? (s / total) * CHART_W : 0);
  const y = (bpm: number) => CHART_H - ((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * CHART_H;
  const series = useMemo(
    () =>
      Array.from({ length: HR_POINTS }, (_, k) => {
        const s = (total * k) / (HR_POINTS - 1);
        return { s, bpm: syntheticHeartRate(s, total) };
      }),
    [total],
  );
  const bpms = series.map((p) => p.bpm);
  const low = Math.min(...bpms);
  const high = Math.max(...bpms);
  const line = series
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.s).toFixed(1)},${y(p.bpm).toFixed(1)}`)
    .join('');
  const whole = seconds === null ? null : Math.round(seconds);
  const bpmNow = whole === null ? null : syntheticHeartRate(whole, total);
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
      <figcaption style={{ ...note, color: 'var(--ink)' }}>
        Heart rate (synthetic stand-in for the host’s chart), 0:00 to {clock(total)}
      </figcaption>
      <svg
        viewBox={`0 0 ${String(CHART_W)} ${String(CHART_H)}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 100, display: 'block' }}
        role="img"
        aria-label={`Synthetic heart rate over the whole run, ${String(low)} to ${String(high)} bpm. The first ${clock(drawn.start)} and the last ${clock(total - drawn.end)} are hatched: Vert does not draw them.`}
      >
        <defs>
          <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M0,8 L8,0" stroke="var(--muted)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={x(drawn.start)} height={CHART_H} fill={`url(#${hatchId})`} />
        <rect
          x={x(drawn.end)}
          y={0}
          width={CHART_W - x(drawn.end)}
          height={CHART_H}
          fill={`url(#${hatchId})`}
        />
        <path
          d={line}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {seconds !== null && (
          <line
            x1={x(seconds)}
            x2={x(seconds)}
            y1={0}
            y2={CHART_H}
            stroke="var(--route)"
            strokeWidth={2}
            strokeDasharray="6 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...note }} aria-hidden="true">
        <span>Not drawn ↔ {clock(drawn.start)}</span>
        <span>{clock(drawn.end)} ↔ not drawn</span>
      </div>
      <label htmlFor={inputId} style={{ ...note, color: 'var(--ink)', fontWeight: 600 }}>
        Heart-rate chart position
      </label>
      <input
        id={inputId}
        type="range"
        min={0}
        max={Math.round(total)}
        // Whole seconds, as the value text reads them (the profile can report any time).
        step={1}
        value={whole ?? 0}
        aria-valuetext={
          whole === null || bpmNow === null
            ? 'No time selected'
            : `${clock(whole)} elapsed, ${String(bpmNow)} bpm`
        }
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onSeconds(Number(event.target.value));
        }}
        className={styles.control}
        style={{ width: '100%', height: 'var(--touch)', margin: 0, accentColor: 'var(--route)' }}
      />
    </figure>
  );
}

/**
 * Activities' sync, both ways: the stand-in chart's position drives the scrub through
 * `metresAtTime` (null in the trimmed ends: the scrub hides), and the profile's `onScrub` drives
 * the chart's cursor through `timeAtMetres` (Escape in the profile clears both).
 */
function HostSyncDemo({ scene }: { scene: Scene }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const range = sceneTimeRange(scene);
  const { summary } = scene;
  if (!range) {
    return <p style={note}>This scene has no times, so nothing can drive its scrub by time.</p>;
  }
  // The host knows its run's elapsed time; here, estimate the trimmed end at the drawn pace.
  const pace = (range.end - range.start) / Math.max(1, summary.drawnLength);
  const total = range.end + pace * summary.trim.end;
  const fromChart = (s: number) => {
    setSeconds(s);
    setScrub(metresAtTime(scene, s));
  };
  const fromProfile = (metres: number | null) => {
    setScrub(metres);
    setSeconds(metres === null ? null : timeAtMetres(scene, metres));
  };
  const scrubText =
    scrub !== null
      ? `km ${(scrub / 1000).toFixed(2)} from the start`
      : seconds !== null
        ? 'Not on the drawn route (a trimmed end): no scrub'
        : 'No position selected';
  return (
    <>
      <div style={box}>
        <TerrainView
          scene={scene}
          exaggeration={1.6}
          scrub={scrub}
          ariaLabel={`3D terrain of a ${km(summary.distance)} run, ${km(summary.drawnLength)} drawn`}
        />
      </div>
      <ElevationProfile scene={scene} scrub={scrub} onScrub={fromProfile} />
      <HeartRateStandIn total={total} drawn={range} seconds={seconds} onSeconds={fromChart} />
      <dl style={readout}>
        <dt>Time</dt>
        <dd style={{ margin: 0 }}>
          {seconds === null ? 'No time selected' : `${clock(seconds)} elapsed`}
        </dd>
        <dt>Scrub</dt>
        <dd style={{ margin: 0 }}>{scrubText}</dd>
      </dl>
      <button
        type="button"
        className={styles.control}
        style={button}
        onClick={() => {
          fromProfile(null);
        }}
      >
        Clear position
      </button>
      <p style={note}>
        Move the chart position (arrow keys, PageUp / PageDown) to scrub Vert; scrub the profile to
        move the chart’s cursor; Escape on the profile clears both. Elevation: {TERRAIN_ATTRIBUTION}
      </p>
    </>
  );
}

export const HostSync: Story = () => {
  const { scene, error } = useCoosaScene();
  return (
    <main style={page}>
      <h1 style={heading}>Host sync</h1>
      {scene ? <HostSyncDemo scene={scene} /> : <p style={note}>{error ?? 'Loading the scene…'}</p>}
    </main>
  );
};
HostSync.storyName = 'Host sync';
