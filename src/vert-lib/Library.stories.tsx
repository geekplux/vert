import type { Story } from '@ladle/react';
import { useEffect, useId, useState, type CSSProperties, type ChangeEvent } from 'react';
import {
  ElevationProfile,
  SceneError,
  TERRAIN_ATTRIBUTION,
  TerrainView,
  VERT_LIB_VERSION,
  decodeScene,
  type Scene,
} from './index';

/**
 * The library as a host uses it (src/vert-lib/index.ts): a decoded scene drawn by `TerrainView`,
 * its `ElevationProfile` underneath, one scrub shared between them. "Coosa scene" loads the
 * committed fixture; "Open a scene file" reads any `.scene` from disk (a git-ignored one of your
 * own runs, say) without it ever being bundled.
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
  const [scrub, setScrub] = useState(scene.route.distance[0] ?? 0);
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
