import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { fakeTerrainView } from '../../test/fakeTerrainView';
import { trimTrack } from '../../gpx/trim';
import {
  nightRidgeFigureData,
  padBounds,
  surveyQuadFigureData,
  trackBounds,
} from '../../poster/figures';
import type { Bounds } from '../../lib/geo';
import { loadPosterFonts } from '../../poster/fonts';
import type { TerrainFigureInput } from '../../poster/terrainFigure';
import { DEFAULT_VIEW_CAMERA } from '../../terrain/camera';
import type { ViewCamera } from '../../terrain/camera';
import { hills } from '../../terrain/testing';
import type { RunTrack } from '../types';
import { immediateSchedule } from '../hooks';
import type { LoadFigureTerrain, LoadTerrain } from '../hooks';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { PageState, PosterPrefs } from '../state';
import { HeightfieldError, HeightfieldTooLargeError } from '../../terrain/heightfield';
import type { Exporter } from './exporter';
import { FIGURE_RECOVERED_TEXT } from './FigureRetry';
import { FIGURE_ERROR_TEXT, FIGURE_LOADING_TEXT } from './LivePoster';

// jsdom has no WebGL: the View's TerrainView and style A's figure renderer are fakes.
vi.mock('../../terrain/TerrainView', () => import('../../test/fakeTerrainView'));

const figure = vi.hoisted(() => ({
  renders: [] as TerrainFigureInput[],
  release: vi.fn(),
}));
vi.mock('../../poster/terrainFigureChunk', () => ({
  loadTerrainFigure: () =>
    Promise.resolve({
      renderTerrainFigure: (input: TerrainFigureInput, into?: HTMLCanvasElement) => {
        figure.renders.push(input);
        const canvas = into ?? document.createElement('canvas');
        canvas.width = Math.round(input.width * input.pixelScale);
        canvas.height = Math.round(input.height * input.pixelScale);
        return canvas;
      },
    }),
  releaseLoadedTerrainFigure: figure.release,
}));

// The B and E figure builders, spied on (the real ones still run).
vi.mock('../../poster/figures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../poster/figures')>();
  return {
    ...actual,
    nightRidgeFigureData: vi.fn(actual.nightRidgeFigureData),
    surveyQuadFigureData: vi.fn(actual.surveyQuadFigureData),
  };
});

vi.mock('../../poster/fonts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../poster/fonts')>();
  return { ...actual, loadPosterFonts: vi.fn(() => Promise.resolve()) };
});

/** Every observed element is laid out at this size (jsdom has no layout). */
const BOX = { width: 600, height: 400 };

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    queueMicrotask(() => {
      this.callback(
        [{ target, contentRect: { ...BOX, x: 0, y: 0 } } as unknown as ResizeObserverEntry],
        this,
      );
    });
  }
  unobserve(): void {
    // Nothing is watched between reports.
  }
  disconnect(): void {
    // As above.
  }
}

const restore: (() => void)[] = [];
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  for (const [name, value] of [
    ['offsetWidth', BOX.width],
    ['offsetHeight', BOX.height],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
    restore.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, name, before);
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
    restore.push(() => {
      delete (Range.prototype as Partial<Range>).getClientRects;
    });
  }
});
afterAll(() => {
  vi.unstubAllGlobals();
  for (const undo of restore) undo();
});
beforeEach(() => {
  figure.renders.length = 0;
  figure.release.mockClear();
  fakeTerrainView.reset();
  vi.mocked(nightRidgeFigureData).mockClear();
  vi.mocked(surveyQuadFigureData).mockClear();
  vi.mocked(loadPosterFonts).mockClear();
  vi.mocked(loadPosterFonts).mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  vi.useRealTimers();
});

const readyTerrain: LoadTerrain = () => Promise.resolve(hills());
const readyFigureTerrain: LoadFigureTerrain = () => Promise.resolve(hills());

function posterState(poster: Partial<PosterPrefs> = {}): PageState {
  return {
    screen: { name: 'poster', runId: SAMPLE_RUN.id, notice: null },
    prefs: {
      ...INITIAL_PREFS,
      poster: { ...INITIAL_PREFS.poster, ...posterTextFor(SAMPLE_RUN), ...poster },
    },
  };
}

function renderPage(
  initialState: PageState,
  {
    loadTerrain = readyTerrain,
    loadFigureTerrain = readyFigureTerrain,
    exporter,
  }: { loadTerrain?: LoadTerrain; loadFigureTerrain?: LoadFigureTerrain; exporter?: Exporter } = {},
) {
  return render(
    <Page
      schedule={immediateSchedule}
      initialRun={SAMPLE_RUN}
      initialState={initialState}
      loadTerrain={loadTerrain}
      loadFigureTerrain={loadFigureTerrain}
      {...(exporter ? { exporter } : {})}
    />,
  );
}

/** A tile failure, as `buildHeightfield` reports one when no tile loads. */
const offline = () =>
  new HeightfieldError([{ z: 13, x: 0, y: 0 }], new TypeError('Failed to fetch'));

/**
 * A loader whose tiles are refused until `unblock()`; `calls` counts its builds. A new one per
 * test: the figure grids are cached per loader.
 */
function blockable() {
  const state = { blocked: true, calls: 0 };
  const load = () => {
    state.calls += 1;
    return state.blocked ? Promise.reject(offline()) : Promise.resolve(hills());
  };
  return {
    load,
    get calls() {
      return state.calls;
    },
    unblock() {
      state.blocked = false;
    },
  };
}

/** The row under the preview when its figure failed. */
const tryAgain = () => screen.queryByRole('button', { name: 'Try again' });
const previewNote = () =>
  screen.getByRole('img', { name: /^Poster: / }).querySelector('[data-figure="placeholder"]');
/** An exporter that never settles: the export runs on its own, the preview is what is checked. */
const pendingExporter: Exporter = () => new Promise<never>(() => undefined);

const lastRender = () => {
  const input = figure.renders.at(-1);
  if (!input) throw new Error('the terrain figure was not rendered');
  return input;
};

/** Metres along the whole run where a drawn track starts and ends. */
function drawnEnds(track: RunTrack | null | undefined): [number, number] {
  if (!track) throw new Error('no route drawn');
  return [track.cumulative[0] ?? NaN, track.cumulative.at(-1) ?? NaN];
}

describe('Live poster figures', () => {
  it('cuts 200 m off each end of the drawn route (and nothing at 0 m)', () => {
    const trimmed = trimTrack(SAMPLE_RUN.track, 200);
    const [first, last] = drawnEnds(trimmed);
    expect(first).toBeGreaterThanOrEqual(199);
    expect(SAMPLE_RUN.distance - last).toBeGreaterThanOrEqual(199);
    expect(trimTrack(SAMPLE_RUN.track, 0)).toBe(SAMPLE_RUN.track);
  });

  it('A: a calm placeholder while the terrain loads, then the rendered figure', async () => {
    let finish: (value: ReturnType<typeof hills>) => void = () => undefined;
    const pending: LoadTerrain = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    // Nothing hidden: style A draws on the View's own grid.
    renderPage(posterState({ hideEnds: 0 }), { loadTerrain: pending });
    expect(await screen.findByText(FIGURE_LOADING_TEXT)).toBeDefined();
    expect(figure.renders).toHaveLength(0);

    act(() => {
      finish(hills());
    });
    await waitFor(() => {
      expect(document.querySelector('[data-figure="terrain"] canvas')).not.toBeNull();
    });
    expect(screen.queryByText(FIGURE_LOADING_TEXT)).toBeNull();
    const input = lastRender();
    expect(input.width).toBe(BOX.width);
    expect(input.height).toBe(BOX.height);
    expect(input.exaggeration).toBe(INITIAL_PREFS.exaggeration);
    expect(input.camera).toEqual(DEFAULT_VIEW_CAMERA);
    // The canvas is sized to the box at the preview's scale.
    const canvas = document.querySelector<HTMLCanvasElement>('[data-figure="terrain"] canvas');
    expect(canvas?.width).toBe(Math.round(BOX.width * input.pixelScale));
  });

  it('A: draws the trimmed route, and renders again (debounced) when hide-ends or exaggeration change', async () => {
    renderPage(posterState({ hideEnds: 200 }));
    await waitFor(() => {
      expect(figure.renders.length).toBeGreaterThan(0);
    });
    const [first] = drawnEnds(lastRender().track);
    expect(first).toBeGreaterThanOrEqual(199);

    const before = figure.renders.length;
    const slider = screen.getByRole('slider', { name: 'Hide start and end' });
    fireEvent.change(slider, { target: { value: '500' } });
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.change(slider, { target: { value: '500' } });
    await waitFor(() => {
      expect(drawnEnds(lastRender().track)[0]).toBeGreaterThanOrEqual(499);
    });
    // Three quick changes, one render.
    expect(figure.renders.length).toBe(before + 1);

    fireEvent.change(slider, { target: { value: '0' } });
    await waitFor(() => {
      expect(lastRender().track).toBe(SAMPLE_RUN.track);
    });
  });

  it('frames every style on the drawn route when the ends are hidden', async () => {
    const pending: LoadTerrain = () => new Promise(() => undefined);
    // A loader of its own: the figure grids are cached per loader.
    const grids: Bounds[] = [];
    const loadFigureTerrain: LoadFigureTerrain = (bounds) => {
      grids.push(bounds);
      return Promise.resolve(hills());
    };
    // The View's grid never arrives: with the ends hidden, A builds its own.
    renderPage(posterState({ hideEnds: 500 }), { loadTerrain: pending, loadFigureTerrain });
    await waitFor(() => {
      expect(figure.renders.length).toBeGreaterThan(0);
    });
    const drawn = trimTrack(SAMPLE_RUN.track, 500);
    const drawnBounds = drawn && trackBounds(drawn);
    if (!drawnBounds) throw new Error('nothing drawn');
    // The drawn route's bounds plus the View's 15%, not the whole run's.
    expect(grids[0]).toEqual(padBounds(drawnBounds, 0.15));
    expect(lastRender().heightfield).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'E Survey Quad' }));
    await waitFor(() => {
      const withGrid = vi
        .mocked(surveyQuadFigureData)
        .mock.calls.filter(([, heightfield, box]) => heightfield && box);
      expect(withGrid.length).toBeGreaterThan(0);
    });
    expect(vi.mocked(surveyQuadFigureData).mock.calls.at(-1)?.[3]?.frame).toEqual(drawnBounds);
    const quadGrid = grids.at(-1);
    if (!quadGrid) throw new Error('no grid');
    // Centred on the drawn route.
    expect((quadGrid.west + quadGrid.east) / 2).toBeCloseTo(
      (drawnBounds.west + drawnBounds.east) / 2,
      9,
    );
    expect((quadGrid.south + quadGrid.north) / 2).toBeCloseTo(
      (drawnBounds.south + drawnBounds.north) / 2,
      9,
    );
  });

  it('hands the View’s camera to the poster figure on Make a poster', async () => {
    const turned: ViewCamera = { azimuth: 2.1, polar: 0.8, zoom: 0.9, view: 'oblique' };
    renderPage({
      screen: { name: 'view', runId: SAMPLE_RUN.id },
      prefs: INITIAL_PREFS,
    });
    fakeTerrainView.camera = turned;
    fireEvent.click(await screen.findByRole('button', { name: 'Make a poster' }));
    await waitFor(() => {
      expect(figure.renders.length).toBeGreaterThan(0);
    });
    expect(lastRender().camera).toEqual(turned);
    const mount = document.querySelector('[data-figure="terrain"]');
    expect(mount?.getAttribute('data-camera')).toBe('oblique 120.3 45.8 0.900');
  });

  it('starts the View from the poster’s camera on Back to the run; New file resets it', async () => {
    const flat: ViewCamera = { azimuth: 0, polar: 0.0001, zoom: 0.8, view: 'flat' };
    const rendered = async () => {
      await waitFor(() => {
        expect(fakeTerrainView.props.length).toBeGreaterThan(0);
      });
      return fakeTerrainView.last();
    };
    renderPage({ screen: { name: 'view', runId: SAMPLE_RUN.id }, prefs: INITIAL_PREFS });
    // A fresh run plays the intro.
    expect((await rendered()).initialCamera).toBeUndefined();
    fakeTerrainView.camera = flat;
    fireEvent.click(await screen.findByRole('button', { name: 'Make a poster' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the run' }));
    fakeTerrainView.props.length = 0;
    expect((await rendered()).initialCamera).toEqual(flat);
    // Its flat flag too: the Flat map button is pressed and the view is flat.
    expect(fakeTerrainView.last().view).toBe('flat');
    expect(screen.getByRole('button', { name: 'Flat map' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // A second Make a poster keeps the angle.
    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    await waitFor(() => {
      expect(figure.renders.length).toBeGreaterThan(0);
    });
    expect(lastRender().camera).toEqual(flat);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New file' }));
    fakeTerrainView.props.length = 0;
    fireEvent.click(await screen.findByRole('button', { name: 'try a sample run' }));
    const fresh = await rendered();
    expect(fresh.initialCamera).toBeUndefined();
    expect(fresh.view).toBe('oblique');
  });

  it('releases the figure renderer when Poster mode closes', async () => {
    renderPage(posterState());
    await waitFor(() => {
      expect(figure.renders.length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    expect(figure.release).toHaveBeenCalledTimes(1);
  });

  it('B and E: draw their figures from the trimmed route; stats keep the whole run', async () => {
    renderPage(posterState({ style: 'B', hideEnds: 200 }));
    await waitFor(() => {
      expect(screen.getByRole('img', { name: /^Poster: / }).dataset.style).toBe('B');
    });
    await waitFor(() => {
      const withGrid = vi
        .mocked(nightRidgeFigureData)
        .mock.calls.filter(([, heightfield, box]) => heightfield && box);
      expect(withGrid.length).toBeGreaterThan(0);
    });
    const ridge = vi.mocked(nightRidgeFigureData).mock.calls.at(-1);
    expect(drawnEnds(ridge?.[3]?.drawnTrack)[0]).toBeGreaterThanOrEqual(199);
    // The run itself (sunrise, start time) is whole.
    expect(ridge?.[0]).toBe(SAMPLE_RUN);
    expect(screen.getByRole('img', { name: /^Poster: / }).getAttribute('aria-label')).toContain(
      '21.5 km',
    );

    fireEvent.click(screen.getByRole('radio', { name: 'E Survey Quad' }));
    await waitFor(() => {
      const withGrid = vi
        .mocked(surveyQuadFigureData)
        .mock.calls.filter(([, heightfield, box]) => heightfield && box);
      expect(withGrid.length).toBeGreaterThan(0);
    });
    const quad = vi.mocked(surveyQuadFigureData).mock.calls.at(-1);
    expect(drawnEnds(quad?.[3]?.drawnTrack)[0]).toBeGreaterThanOrEqual(199);
    expect(quad?.[0]).toBe(SAMPLE_RUN);
    // The real map is drawn: no placeholder left.
    await waitFor(() => {
      expect(document.querySelector('[data-figure="placeholder"]')).toBeNull();
    });
  });

  it('B and E: show the poster only once its fonts have loaded', async () => {
    let fontsLoaded: () => void = () => undefined;
    vi.mocked(loadPosterFonts).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          fontsLoaded = resolve;
        }),
    );
    renderPage(posterState({ style: 'E' }));
    expect(vi.mocked(loadPosterFonts)).toHaveBeenCalledWith(
      'E',
      expect.stringContaining('Coosa Backcountry Trail'),
      { subtitle: false },
    );
    expect(screen.getByRole('img', { name: 'Survey Quad preview, loading.' })).toBeDefined();
    expect(screen.queryByRole('img', { name: /^Poster: / })).toBeNull();
    expect(vi.mocked(surveyQuadFigureData)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ width: BOX.width }),
      expect.anything(),
    );

    await act(async () => {
      fontsLoaded();
      await Promise.resolve();
    });
    expect(await screen.findByRole('img', { name: /^Poster: / })).toBeDefined();
    expect(screen.queryByRole('img', { name: 'Survey Quad preview, loading.' })).toBeNull();
  });

  it('B: a failed figure offers Try again under the preview, which draws it once the tiles are back', async () => {
    const tiles = blockable();
    const { container } = renderPage(posterState({ style: 'B' }), {
      loadFigureTerrain: tiles.load,
    });
    await screen.findByRole('button', { name: 'Try again' });
    // Past the box debounce: the layout has settled, so no relayout builds a grid of its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(previewNote()?.textContent).toBe(FIGURE_ERROR_TEXT);
    // Outside the poster (one image, exported as drawn): no button in the file.
    expect(screen.getByRole('img', { name: /^Poster: / }).contains(button)).toBe(false);
    expect(screen.getByText(FIGURE_ERROR_TEXT, { selector: 'p' })).toBeDefined();
    await expectNoAxeViolations(container);

    // Still refused: it fails again, focus back on Try again.
    const before = tiles.calls;
    button.focus();
    fireEvent.click(button);
    await waitFor(() => {
      expect(tryAgain()).not.toBeNull();
    });
    expect(tiles.calls).toBeGreaterThan(before);
    expect(document.activeElement).toBe(tryAgain());

    tiles.unblock();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(previewNote()).toBeNull();
      // The row goes once the drawn figure is reported (an effect after it is drawn).
      expect(screen.queryByText(FIGURE_LOADING_TEXT)).toBeNull();
      expect(tryAgain()).toBeNull();
    });
    expect(screen.getByText(FIGURE_RECOVERED_TEXT)).toBeDefined();
    expect(document.activeElement?.textContent).toMatch(/^Download PNG/);
  });

  it('E: Download asks again for a failed preview figure, so the preview shows what the file shows', async () => {
    const tiles = blockable();
    renderPage(posterState({ style: 'E' }), {
      loadFigureTerrain: tiles.load,
      exporter: pendingExporter,
    });
    await screen.findByRole('button', { name: 'Try again' });
    // Past the box debounce: the layout has settled, so no relayout builds a grid of its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(previewNote()?.textContent).toBe(FIGURE_ERROR_TEXT);
    tiles.unblock();
    const before = tiles.calls;
    fireEvent.click(screen.getByRole('button', { name: /^Download PNG/ }));
    await waitFor(() => {
      expect(previewNote()).toBeNull();
      expect(tryAgain()).toBeNull();
    });
    expect(tiles.calls).toBe(before + 1);
    // The legend describes the contours again.
    expect(
      screen.getByRole('img', { name: /^Poster: / }).querySelector('[data-legend="index"]'),
    ).not.toBeNull();
  });

  it.each(['cancelled', 'left running'] as const)(
    'B: Download with Try again focused, export %s: focus never drops to the page as the preview recovers',
    async (ending) => {
      let mode: 'refuse' | 'hold' = 'refuse';
      let release: () => void = () => undefined;
      const load: LoadFigureTerrain = () =>
        mode === 'refuse'
          ? Promise.reject(offline())
          : new Promise((resolve) => {
              release = () => {
                resolve(hills());
              };
            });
      renderPage(posterState({ style: 'B' }), {
        loadFigureTerrain: load,
        exporter: pendingExporter,
      });
      await screen.findByRole('button', { name: 'Try again' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
      mode = 'hold';
      screen.getByRole('button', { name: 'Try again' }).focus();
      fireEvent.click(screen.getByRole('button', { name: /^Download PNG/ }));
      // The quiet retry: "Drawing the terrain…", no Try again; focus on the export's progress.
      await waitFor(() => {
        expect(screen.getByText(FIGURE_LOADING_TEXT, { selector: 'p' })).toBeDefined();
      });
      expect(document.activeElement).not.toBe(document.body);
      if (ending === 'cancelled') {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(document.activeElement?.textContent).toMatch(/^Download PNG/);
      }
      await act(async () => {
        release();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(previewNote()).toBeNull();
        expect(screen.queryByText(FIGURE_LOADING_TEXT, { selector: 'p' })).toBeNull();
      });
      expect(screen.getByText(FIGURE_RECOVERED_TEXT)).toBeDefined();
      expect(document.activeElement).not.toBe(document.body);
      if (ending === 'cancelled') {
        expect(document.activeElement?.textContent).toMatch(/^Download PNG/);
      }
    },
  );

  it('A drawn from the View’s grid: Try again and Download build the run’s terrain again', async () => {
    const tiles = blockable();
    renderPage(posterState({ style: 'A', hideEnds: 0 }), {
      loadTerrain: tiles.load,
      exporter: pendingExporter,
    });
    await screen.findByRole('button', { name: 'Try again' });
    expect(previewNote()?.textContent).toBe(FIGURE_ERROR_TEXT);
    const before = tiles.calls;
    fireEvent.click(screen.getByRole('button', { name: /^Download PNG/ }));
    await waitFor(() => {
      expect(tiles.calls).toBe(before + 1);
    });
    await screen.findByRole('button', { name: 'Try again' });

    tiles.unblock();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(document.querySelector('[data-figure="terrain"] canvas')).not.toBeNull();
      expect(tryAgain()).toBeNull();
    });
  });

  it('offers no Try again when the area is too large to fetch tiles for', async () => {
    const tooLarge: LoadFigureTerrain = () => Promise.reject(new HeightfieldTooLargeError(40));
    renderPage(posterState({ style: 'B' }), { loadFigureTerrain: tooLarge });
    await waitFor(() => {
      expect(previewNote()?.textContent).toBe(FIGURE_ERROR_TEXT);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(tryAgain()).toBeNull();
  });

  it('has no axe violations with live figures in every style', async () => {
    const { container } = renderPage(posterState());
    await waitFor(() => {
      expect(document.querySelector('[data-figure="terrain"] canvas')).not.toBeNull();
    });
    await expectNoAxeViolations(container);
    for (const name of ['B Night Ridge', 'E Survey Quad']) {
      fireEvent.click(screen.getByRole('radio', { name }));
      await waitFor(() => {
        expect(document.querySelector('[data-figure="placeholder"]')).toBeNull();
      });
      await expectNoAxeViolations(container);
    }
  });
});
