import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeScene } from '../scene/decode';
import type { Scene } from '../scene/types';
import { expectNoAxeViolations } from '../test/axe';
import { fakeTerrainView } from '../test/fakeTerrainView';
import { RunLoadError, immediateSchedule } from './hooks';
import type { LoadScene } from './hooks';
import { Page } from './Page';

// jsdom has no WebGL: the View's lazy TerrainView is a fake (src/test/fakeTerrainView.tsx).
vi.mock('../terrain/TerrainView', () => import('../test/fakeTerrainView'));

const SCENE: Scene = decodeScene(
  new Uint8Array(
    readFileSync(join(import.meta.dirname, '../scene/fixtures/coosa-backcountry.scene')),
  ),
);
const LINK = 'https://activities.geekplux.org/terrain/coosa-backcountry.scene';

const h1 = (name: string) => screen.getByRole('heading', { level: 1, name });

/** A scene loader that records the URLs asked for and settles when the test says. */
function pendingLoader() {
  const urls: string[] = [];
  let settle!: { resolve: (scene: Scene) => void; reject: (error: Error) => void };
  const loadScene = vi.fn<LoadScene>(
    (url) =>
      new Promise((resolve, reject) => {
        urls.push(url.href);
        settle = {
          resolve: (scene) => {
            resolve({ scene, host: url.hostname });
          },
          reject,
        };
      }),
  );
  return {
    urls,
    loadScene,
    resolve: (scene: Scene) => {
      settle.resolve(scene);
    },
    reject: (error: Error) => {
      settle.reject(error);
    },
  };
}

async function openLinked() {
  const loader = pendingLoader();
  const rendered = render(
    <Page schedule={immediateSchedule} sceneParam={LINK} loadScene={loader.loadScene} />,
  );
  await act(async () => {
    loader.resolve(SCENE);
    await Promise.resolve();
  });
  await screen.findByRole('heading', { level: 1, name: 'coosa-backcountry' });
  return { ...loader, ...rendered };
}

beforeEach(() => {
  fakeTerrainView.reset();
  window.history.replaceState(null, '', `/?scene=${encodeURIComponent(LINK)}`);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Page with ?scene=', () => {
  it('reads the scene on Upload ("Reading <id>.scene…"), then shows it in the View', async () => {
    const loader = pendingLoader();
    const { container } = render(
      <Page schedule={immediateSchedule} sceneParam={LINK} loadScene={loader.loadScene} />,
    );
    expect(loader.urls).toEqual([LINK]);
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe(
      'Reading coosa-backcountry.scene…',
    );

    await act(async () => {
      loader.resolve(SCENE);
      await Promise.resolve();
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'coosa-backcountry' }),
    ).toBeDefined();
    expect(screen.getByText('SCENE · ACTIVITIES.GEEKPLUX.ORG')).toBeDefined();

    // The stats the scene carries: the whole run's distance and climb, the drawn length and the
    // drawn route's high point; which ends are hidden.
    const aside = screen.getByRole('complementary', { name: 'Run details' });
    expect(within(aside).getByText('Distance').parentElement?.textContent).toMatch(/21\.5\s*km/);
    expect(within(aside).getByText('Vert').parentElement?.textContent).toMatch(/\+1,102\s*m/);
    expect(within(aside).getByText('Drawn').parentElement?.textContent).toMatch(/21\.1\s*km/);
    expect(within(aside).getByText('High point')).toBeDefined();
    expect(within(aside).queryByText('Moving time')).toBeNull();
    expect(
      within(aside).getByText('The first 200 m and the last 200 m of the run are not drawn.'),
    ).toBeDefined();
    expect(within(aside).getByRole('heading', { level: 2, name: 'Climbs' })).toBeDefined();

    // The terrain draws the scene itself (no heightfield, no track), labelled from its markers.
    const props = fakeTerrainView.last();
    expect(props.scene).toBe(SCENE);
    expect(props.heightfield).toBeUndefined();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /^3D terrain of coosa-backcountry: 21\.5 km /,
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Rotate view' }).getAttribute('aria-disabled'),
      ).toBe(null);
    });

    // No poster for a scene; New file and the units stay.
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('button', { name: 'Make a poster' })).toBeNull();
    expect(within(banner).getByRole('button', { name: 'New file' })).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('names the scene from &title= in the h1 and the tab, as text; the line keeps the host', async () => {
    const loader = pendingLoader();
    document.title = 'Vert · Drop a GPX. Get a poster.';
    const { unmount } = render(
      <Page
        schedule={immediateSchedule}
        sceneParam={LINK}
        titleParam={'  Translantau   <b>50</b> '}
        loadScene={loader.loadScene}
      />,
    );
    await act(async () => {
      loader.resolve(SCENE);
      await Promise.resolve();
    });
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Translantau <b>50</b>',
    });
    expect(heading.querySelector('b')).toBeNull();
    expect(screen.getByText('SCENE · ACTIVITIES.GEEKPLUX.ORG')).toBeDefined();
    expect(document.title).toBe('Translantau <b>50</b> · Vert');
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /^3D terrain of Translantau <b>50<\/b>: /,
    );
    unmount();
    expect(document.title).toBe('Vert · Drop a GPX. Get a poster.');
  });

  it('keeps the file name and the tab title when &title= is empty', async () => {
    document.title = 'Vert · Drop a GPX. Get a poster.';
    const loader = pendingLoader();
    render(
      <Page
        schedule={immediateSchedule}
        sceneParam={LINK}
        titleParam="   "
        loadScene={loader.loadScene}
      />,
    );
    await act(async () => {
      loader.resolve(SCENE);
      await Promise.resolve();
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'coosa-backcountry' }),
    ).toBeDefined();
    expect(document.title).toBe('Vert · Drop a GPX. Get a poster.');
  });

  it('opens the link under StrictMode too (the simulated unmount aborts the first fetch)', async () => {
    const signals: AbortSignal[] = [];
    const loadScene = vi.fn<LoadScene>((url, signal) => {
      signals.push(signal);
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ scene: SCENE, host: url.hostname });
        }, 10);
      });
    });
    render(
      <StrictMode>
        <Page schedule={immediateSchedule} sceneParam={LINK} loadScene={loadScene} />
      </StrictMode>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'coosa-backcountry' }),
    ).toBeDefined();
    // The first fetch was aborted by StrictMode's simulated unmount; the second one opened it.
    expect(loadScene).toHaveBeenCalledTimes(2);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });

  it('sanitises a file-name h1 as a title: no line breaks, at most 80 characters', async () => {
    const segment = encodeURIComponent(`${'x'.repeat(100)}\n\u000b\u202e${'y'.repeat(110)}`);
    const loader = pendingLoader();
    render(
      <Page
        schedule={immediateSchedule}
        sceneParam={`https://example.org/terrain/${segment}.scene`}
        loadScene={loader.loadScene}
      />,
    );
    await act(async () => {
      loader.resolve(SCENE);
      await Promise.resolve();
    });
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('x'.repeat(80));
  });

  it('scrubs the profile by keyboard, moving the terrain marker with it', async () => {
    await openLinked();
    const slider = screen.getByRole('slider', { name: 'Elevation profile' });
    const readout = () =>
      screen.getByRole('heading', { level: 2, name: /Elevation/ }).nextElementSibling?.textContent;
    const before = readout();
    const scrubBefore = fakeTerrainView.last().scrub;
    expect(before).toMatch(/^km \d+\.\d · [\d,]+ m · grade -?\d+% · \d+:\d\d \/km$/);
    slider.focus();
    fireEvent.keyDown(slider, { key: 'End' });
    expect(readout()).not.toBe(before);
    expect(readout()).toMatch(/^km 21\.3 · /);
    expect(fakeTerrainView.last().scrub).not.toBe(scrubBefore);
  });

  it('says why a scene could not be opened, over the Dropzone', async () => {
    const loader = pendingLoader();
    const { container } = render(
      <Page schedule={immediateSchedule} sceneParam={LINK} loadScene={loader.loadScene} />,
    );
    await act(async () => {
      loader.reject(new RunLoadError('Could not open that scene: the server answered 404.'));
      await Promise.resolve();
    });
    expect(h1('Your run, as terrain.')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not open that scene: the server answered 404.',
    );
    expect(screen.getByRole('button', { name: /Drop a \.gpx file here/ })).toBeDefined();
    await expectNoAxeViolations(container);
  });

  it('says so for a link it will not fetch, and fetches nothing', () => {
    const loader = pendingLoader();
    render(
      <Page
        schedule={immediateSchedule}
        sceneParam="http://example.com/x.scene"
        loadScene={loader.loadScene}
      />,
    );
    expect(loader.loadScene).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not open that scene: only https links can be opened.',
    );
  });

  it('shows a generic sentence for an unexpected failure', async () => {
    const loader = pendingLoader();
    render(<Page schedule={immediateSchedule} sceneParam={LINK} loadScene={loader.loadScene} />);
    await act(async () => {
      loader.reject(new Error('boom'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toBe('Could not open that scene.');
  });

  it('opens nothing without the parameter', () => {
    const loader = pendingLoader();
    render(<Page schedule={immediateSchedule} loadScene={loader.loadScene} />);
    expect(loader.loadScene).not.toHaveBeenCalled();
    expect(h1('Your run, as terrain.')).toBeDefined();
  });

  it('New file leaves the scene and takes ?scene= out of the address bar', async () => {
    await openLinked();
    expect(window.location.search).toContain('scene=');
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New file' }));
    expect(h1('Your run, as terrain.')).toBeDefined();
    expect(window.location.search).toBe('');
    expect(fakeTerrainView.props.length).toBeGreaterThan(0);
  });

  it('the sample after a failed link replaces it, and the address bar forgets the link', async () => {
    const loader = pendingLoader();
    render(<Page schedule={immediateSchedule} sceneParam={LINK} loadScene={loader.loadScene} />);
    await act(async () => {
      loader.reject(new RunLoadError('Could not open that scene: the file is not a Vert scene.'));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
    expect(window.location.search).toBe('');
    // A run again: Make a poster is back.
    expect(screen.getByRole('button', { name: 'Make a poster' })).toBeDefined();
  });
});
