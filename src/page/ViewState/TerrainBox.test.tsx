import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hills } from '../../terrain/testing';
import { expectNoAxeViolations } from '../../test/axe';
import { fakeTerrainView } from '../../test/fakeTerrainView';
import {
  TERRAIN_DECODE_ERROR,
  TERRAIN_OFFLINE_ERROR,
  TERRAIN_TOO_LARGE_ERROR,
  immediateSchedule,
} from '../hooks';
import type { LoadTerrain } from '../hooks';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS } from '../state';
import type { PageState } from '../state';
import type { Run, Terrain } from '../types';
import { TerrainChunkError } from '../terrainChunk';
import {
  ROTATE_STEP,
  TERRAIN_CHUNK_ERROR,
  TERRAIN_DRAW_ERROR,
  TERRAIN_LOADING_TEXT,
  TERRAIN_RECOVERED_TEXT,
  TerrainBox,
} from './TerrainBox';
import type { TerrainBoxProps } from './TerrainBox';
import { PHONE_QUERY } from '../../hooks/useMediaQuery';

// jsdom has no WebGL: the lazy TerrainView module is a fake that records its props.
vi.mock('../../terrain/TerrainView', () => import('../../test/fakeTerrainView'));

const fake = fakeTerrainView;
const lastProps = () => fakeTerrainView.last();

const HEIGHTFIELD = hills();
const READY: Terrain = {
  status: 'ready',
  heightfield: HEIGHTFIELD,
  failedTiles: [],
  totalTiles: 4,
};
const LOOP_LABEL =
  '3D terrain of Coosa Backcountry Trail: 21.5 km loop, start and finish marked with a circle, summit 1,267 m marked with a triangle';

/** A phone-width viewport for `useMediaQuery(PHONE_QUERY)`. */
function mockPhone(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === PHONE_QUERY ? matches : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  fakeTerrainView.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBox(overrides: Partial<TerrainBoxProps> = {}) {
  const props: TerrainBoxProps = {
    terrain: READY,
    onRetry: vi.fn(),
    track: SAMPLE_RUN.track,
    scrub: 1000,
    exaggeration: 1.6,
    ariaLabel: LOOP_LABEL,
    summit: 'Summit 1,267 m',
    exaggerationLabel: 'Vertical ×1.6',
    flat: false,
    onToggleFlat: vi.fn(),
    overlaysBelow: false,
    ...overrides,
  };
  return { props, ...render(<TerrainBox {...props} />) };
}

const status = () => screen.getByRole('status');

/** SAMPLE_RUN's track with its last point moved ~1.1 km north: a point-to-point run. */
const ONE_WAY_TRACK = {
  ...SAMPLE_RUN.track,
  lat: Float64Array.from(SAMPLE_RUN.track.lat, (value, i) =>
    i === SAMPLE_RUN.track.lat.length - 1 ? value + 0.01 : value,
  ),
};

/**
 * The box under a parent that owns the terrain like `RunProvider`: Try again (`onRetry`) switches
 * it to loading in the same update; the test settles it with `settle`.
 */
function renderRetrying(initial: Terrain) {
  let settle: (terrain: Terrain) => void = () => undefined;
  function Host() {
    const [terrain, setTerrain] = useState(initial);
    settle = setTerrain;
    return (
      <TerrainBox
        terrain={terrain}
        onRetry={() => {
          setTerrain({ status: 'loading' });
        }}
        track={SAMPLE_RUN.track}
        scrub={1000}
        exaggeration={1.6}
        ariaLabel={LOOP_LABEL}
        summit="Summit 1,267 m"
        exaggerationLabel="Vertical ×1.6"
        flat={false}
        onToggleFlat={() => undefined}
        overlaysBelow={false}
      />
    );
  }
  render(<Host />);
  return {
    settle: (terrain: Terrain) => {
      act(() => {
        settle(terrain);
      });
    },
  };
}

describe('TerrainBox', () => {
  it('says "Loading terrain…" in a polite status while the tiles load, the view empty', async () => {
    renderBox({ terrain: { status: 'loading' } });
    expect(status().textContent).toBe(TERRAIN_LOADING_TEXT);
    // The view mounts early (its chunk loads alongside the tiles) but has nothing to draw.
    await screen.findByRole('img', { name: LOOP_LABEL });
    expect(lastProps().heightfield).toBeNull();
    expect(status().textContent).toBe(TERRAIN_LOADING_TEXT);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // The overlays are there from the start, so the layout does not jump.
    expect(screen.getByRole('button', { name: 'Rotate view' })).toBeDefined();
    expect(screen.getByText('Start / finish')).toBeDefined();
  });

  it('keeps the loading text up until TerrainView reports its first frame', async () => {
    fake.ready = false;
    renderBox();
    const canvas = await screen.findByRole('img', { name: LOOP_LABEL });
    expect(canvas).toBeDefined();
    expect(status().textContent).toBe(TERRAIN_LOADING_TEXT);
    act(() => {
      lastProps().onReady?.();
    });
    expect(status().textContent).toBe('');
  });

  it('renders TerrainView with the heightfield, track, scrub, exaggeration, view and label', async () => {
    renderBox();
    await screen.findByRole('img', { name: LOOP_LABEL });
    const props = lastProps();
    expect(props.heightfield).toBe(HEIGHTFIELD);
    expect(props.track).toBe(SAMPLE_RUN.track);
    expect(props.scrub).toBe(1000);
    expect(props.exaggeration).toBe(1.6);
    expect(props.view).toBe('oblique');
    expect(props.ariaLabel).toBe(LOOP_LABEL);
    // The box draws the view's focus ring (TerrainBox.module.css), so it marks the view.
    expect(props.className).toBeTruthy();
    // Its first frame clears the loading text.
    await waitFor(() => {
      expect(status().textContent).toBe('');
    });
  });

  it('shows the error with a Try again button that asks for a rebuild', () => {
    const { props } = renderBox({ terrain: { status: 'error', error: TERRAIN_OFFLINE_ERROR } });
    expect(status().textContent).toBe(TERRAIN_OFFLINE_ERROR);
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no Try again when the route is too large to draw (it would fail the same way)', () => {
    renderBox({ terrain: { status: 'error', error: TERRAIN_TOO_LARGE_ERROR } });
    expect(status().textContent).toBe(TERRAIN_TOO_LARGE_ERROR);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('keeps Try again for tiles that arrived but could not be read', () => {
    renderBox({ terrain: { status: 'error', error: TERRAIN_DECODE_ERROR } });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('catches a view that cannot draw (no WebGL) and remounts it on Try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.fail = true;
    const { props } = renderBox();
    await screen.findByRole('button', { name: 'Try again' });
    expect(status().textContent).toBe(TERRAIN_DRAW_ERROR);
    // The rest of the box still works.
    expect(screen.getByRole('button', { name: 'Flat map' })).toBeDefined();

    fake.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: LOOP_LABEL })).toBeDefined();
    // The tiles were fine: only the view is remade, the terrain is not rebuilt.
    expect(props.onRetry).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });

  it('says the 3D view did not load when its code fails to download, and fetches it again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.fail = true;
    fake.error = new TerrainChunkError(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    const { props } = renderBox();
    await screen.findByRole('button', { name: 'Try again' });
    expect(status().textContent).toBe(TERRAIN_CHUNK_ERROR);
    expect(TERRAIN_CHUNK_ERROR).toBe(
      "Vert couldn't load the 3D view. Check your connection and try again.",
    );
    fake.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: LOOP_LABEL })).toBeDefined();
    expect(props.onRetry).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });

  it('moves focus after Try again to the loading text, then the drawn terrain, and says so', async () => {
    const { settle } = renderRetrying({ status: 'error', error: TERRAIN_OFFLINE_ERROR });
    const button = screen.getByRole('button', { name: 'Try again' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => {
      expect(document.activeElement).toBe(status());
    });
    expect(status().textContent).toBe(TERRAIN_LOADING_TEXT);
    expect(status().getAttribute('tabindex')).toBe('-1');

    settle(READY);
    const canvas = await screen.findByRole('img', { name: LOOP_LABEL });
    await waitFor(() => {
      expect(document.activeElement).toBe(canvas.parentElement);
    });
    expect(status().textContent).toBe(TERRAIN_RECOVERED_TEXT);
  });

  it('puts focus back on Try again when the retry fails too', async () => {
    const { settle } = renderRetrying({ status: 'error', error: TERRAIN_OFFLINE_ERROR });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(status());
    });
    settle({ status: 'error', error: TERRAIN_OFFLINE_ERROR });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
    });
  });

  it('puts focus back on Try again when the browser still cannot draw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.fail = true;
    renderBox();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(status().textContent).toBe(TERRAIN_DRAW_ERROR);
    vi.mocked(console.error).mockRestore();
  });

  it('keeps Rotate view and Flat map focusable but inert, with the reason, until the terrain is drawn', async () => {
    fake.ready = false;
    const { props } = renderBox();
    await screen.findByRole('img', { name: LOOP_LABEL });
    const rotate = screen.getByRole('button', { name: 'Rotate view' });
    const flat = screen.getByRole('button', { name: 'Flat map' });
    for (const button of [rotate, flat]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')).toBe(status());
    }
    fireEvent.click(rotate);
    fireEvent.click(flat);
    expect(fake.rotateBy).not.toHaveBeenCalled();
    expect(props.onToggleFlat).not.toHaveBeenCalled();

    act(() => {
      lastProps().onReady?.();
    });
    for (const button of [rotate, flat]) {
      expect(button.hasAttribute('aria-disabled')).toBe(false);
      expect(button.hasAttribute('aria-describedby')).toBe(false);
    }
  });

  it('keeps them inert on an error, described by the error', () => {
    renderBox({ terrain: { status: 'error', error: TERRAIN_OFFLINE_ERROR } });
    const flat = screen.getByRole('button', { name: 'Flat map' });
    expect(flat.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(flat.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      TERRAIN_OFFLINE_ERROR,
    );
  });

  it('shows "Start / finish" for a loop, and separate ○ Start and ◉ Finish for a point-to-point run', async () => {
    const loop = renderBox();
    await screen.findByRole('img', { name: LOOP_LABEL });
    expect(screen.getByText('Start / finish')).toBeDefined();
    expect(screen.queryByText('Finish')).toBeNull();
    loop.unmount();

    renderBox({ track: ONE_WAY_TRACK });
    await screen.findByRole('img', { name: LOOP_LABEL });
    expect(screen.queryByText('Start / finish')).toBeNull();
    const start = screen.getByText('Start', { exact: true });
    const finish = screen.getByText('Finish', { exact: true });
    // ○: one circle; ◉: the circle and its centre dot. The summit entry stays.
    expect(start.querySelectorAll('svg circle')).toHaveLength(1);
    expect(finish.querySelectorAll('svg circle')).toHaveLength(2);
    expect(screen.getByText('Summit 1,267 m')).toBeDefined();
    expect(start.closest('p')?.textContent).toBe('StartFinishSummit 1,267 mVertical ×1.6');
  });

  it('notes tiles that failed and were filled from their neighbours', async () => {
    renderBox({
      terrain: { ...READY, failedTiles: [{ z: 13, x: 1, y: 2 }], totalTiles: 6 },
    });
    await screen.findByRole('img', { name: LOOP_LABEL });
    expect(
      screen.getByText(
        "1 of 6 elevation tiles didn't load; that part of the terrain is filled in from around it.",
      ),
    ).toBeDefined();
  });

  it('says nothing about tiles when all of them loaded', async () => {
    renderBox();
    await screen.findByRole('img', { name: LOOP_LABEL });
    expect(screen.queryByText(/elevation tiles? didn't load/)).toBeNull();
  });

  it('turns the camera an eighth of a turn with Rotate view', async () => {
    renderBox();
    await screen.findByRole('img', { name: LOOP_LABEL });
    const rotate = screen.getByRole('button', { name: 'Rotate view' });
    // The canvas shows before its first frame: until then the button is inert.
    await waitFor(() => {
      expect(rotate.getAttribute('aria-disabled')).toBeNull();
    });
    fireEvent.click(rotate);
    expect(fake.rotateBy).toHaveBeenCalledWith(ROTATE_STEP);
    expect(ROTATE_STEP).toBeCloseTo(Math.PI / 4);
  });

  it('passes the flat view to TerrainView when Flat map is pressed', async () => {
    const { rerender, props } = renderBox();
    await screen.findByRole('img', { name: LOOP_LABEL });
    const flat = screen.getByRole('button', { name: 'Flat map' });
    // The canvas shows before its first frame: until then the button is inert.
    await waitFor(() => {
      expect(flat.getAttribute('aria-disabled')).toBeNull();
    });
    fireEvent.click(flat);
    expect(props.onToggleFlat).toHaveBeenCalledTimes(1);
    rerender(<TerrainBox {...props} flat />);
    expect(lastProps().view).toBe('flat');
    expect(screen.getByRole('button', { name: 'Flat map' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('overlays the chip and buttons on the terrain at 600px and wider', async () => {
    renderBox({ overlaysBelow: false });
    const canvas = await screen.findByRole('img', { name: LOOP_LABEL });
    const chip = screen.getByText('Start / finish').closest('p');
    const rotate = screen.getByRole('button', { name: 'Rotate view' });
    expect(chip?.parentElement?.contains(canvas)).toBe(true);
    expect(rotate.parentElement?.parentElement?.contains(canvas)).toBe(true);
  });

  it('moves the chip and buttons into a row under the terrain below 600px, no overlays', async () => {
    renderBox({ overlaysBelow: true });
    const canvas = await screen.findByRole('img', { name: LOOP_LABEL });
    const chip = screen.getByText('Start / finish').closest('p');
    const rotate = screen.getByRole('button', { name: 'Rotate view' });
    const row = chip?.parentElement;
    expect(row?.contains(canvas)).toBe(false);
    expect(row?.contains(rotate)).toBe(true);
    // The row comes after the terrain, chip first: Tab goes terrain → Rotate → Flat.
    expect(canvas.compareDocumentPosition(chip as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(lastProps().overlays).toEqual([]);
  });

  it('has no axe violations while loading, on error and when ready', async () => {
    const loading = renderBox({ terrain: { status: 'loading' } });
    await expectNoAxeViolations(loading.container);
    loading.unmount();
    const failed = renderBox({ terrain: { status: 'error', error: TERRAIN_OFFLINE_ERROR } });
    await expectNoAxeViolations(failed.container);
    failed.unmount();
    const ready = renderBox({ overlaysBelow: true });
    await screen.findByRole('img', { name: LOOP_LABEL });
    await expectNoAxeViolations(ready.container);
  });
});

/** The page with the terrain ready (a synthetic grid) and the live view faked. */
const readyTerrain: LoadTerrain = () => Promise.resolve(HEIGHTFIELD);

function renderView(run: Run = SAMPLE_RUN) {
  const state: PageState = { screen: { name: 'view', runId: run.id }, prefs: INITIAL_PREFS };
  return render(
    <Page
      schedule={immediateSchedule}
      initialRun={run}
      initialState={state}
      loadTerrain={readyTerrain}
    />,
  );
}

const profile = () => screen.getByRole('slider', { name: 'Elevation profile' });

describe('The View’s live terrain', () => {
  it('shares the scrub with the elevation profile: keys on the profile move the terrain marker', async () => {
    renderView();
    await screen.findByRole('img', { name: LOOP_LABEL });
    expect(lastProps().scrub).toBe(Number(profile().getAttribute('aria-valuenow')));

    fireEvent.keyDown(profile(), { key: 'Home' });
    expect(lastProps().scrub).toBe(0);
    fireEvent.keyDown(profile(), { key: 'End' });
    expect(lastProps().scrub).toBe(SAMPLE_RUN.distance);
    fireEvent.keyDown(profile(), { key: 'ArrowLeft', shiftKey: true });
    expect(lastProps().scrub).toBe(Number(profile().getAttribute('aria-valuenow')));
    expect(lastProps().scrub).toBeLessThan(SAMPLE_RUN.distance);
  });

  it('feeds the exaggeration slider and the Flat map toggle to the view', async () => {
    renderView();
    await screen.findByRole('img', { name: LOOP_LABEL });
    fireEvent.change(screen.getByRole('slider', { name: 'Vertical exaggeration' }), {
      target: { value: '2.4' },
    });
    expect(lastProps().exaggeration).toBe(2.4);
    const flat = screen.getByRole('button', { name: 'Flat map' });
    // The canvas shows before its first frame: until then the button is inert.
    await waitFor(() => {
      expect(flat.getAttribute('aria-disabled')).toBeNull();
    });
    fireEvent.click(flat);
    expect(lastProps().view).toBe('flat');
    expect(flat.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(flat);
    expect(lastProps().view).toBe('oblique');
  });

  it('labels a loop as a loop, a point-to-point run from start to finish, in the chosen units', async () => {
    renderView();
    expect(await screen.findByRole('img', { name: LOOP_LABEL })).toBeDefined();
    fireEvent.click(within(screen.getByRole('banner')).getByRole('radio', { name: 'mi' }));
    expect(
      screen.getByRole('img', { name: /: 13\.3 mi loop, .* summit 4,157 ft marked/ }),
    ).toBeDefined();
  });

  it('labels a run that ends far from its start "from start to finish"', async () => {
    const { lat, lon } = SAMPLE_RUN.track;
    const last = lat.length - 1;
    const oneWay: Run = {
      ...SAMPLE_RUN,
      id: 'one-way',
      track: {
        ...SAMPLE_RUN.track,
        lat: Float64Array.from(lat, (value, i) => (i === last ? value + 0.01 : value)),
        lon: Float64Array.from(lon),
      },
    };
    renderView(oneWay);
    expect(
      await screen.findByRole('img', {
        name: '3D terrain of Coosa Backcountry Trail: 21.5 km from start to finish, start marked with a circle, finish with a dotted circle, summit 1,267 m marked with a triangle',
      }),
    ).toBeDefined();
  });

  it('keeps the overlays in the box at desktop widths and under it on a phone', async () => {
    mockPhone(false);
    const desktop = renderView();
    let canvas = await screen.findByRole('img', { name: LOOP_LABEL });
    expect(screen.getByText('Start / finish').closest('p')?.parentElement?.contains(canvas)).toBe(
      true,
    );
    desktop.unmount();

    mockPhone(true);
    renderView();
    canvas = await screen.findByRole('img', { name: LOOP_LABEL });
    expect(screen.getByText('Start / finish').closest('p')?.parentElement?.contains(canvas)).toBe(
      false,
    );
    expect(lastProps().overlays).toEqual([]);
  });
});
