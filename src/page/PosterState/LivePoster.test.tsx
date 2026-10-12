import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { fakeTerrainView } from '../../test/fakeTerrainView';
import { trimTrack } from '../../gpx/trim';
import { nightRidgeFigureData, surveyQuadFigureData } from '../../poster/figures';
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
import { FIGURE_LOADING_TEXT } from './LivePoster';

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
  { loadTerrain = readyTerrain }: { loadTerrain?: LoadTerrain } = {},
) {
  return render(
    <Page
      schedule={immediateSchedule}
      initialRun={SAMPLE_RUN}
      initialState={initialState}
      loadTerrain={loadTerrain}
      loadFigureTerrain={readyFigureTerrain}
    />,
  );
}

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
    renderPage(posterState(), { loadTerrain: pending });
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
