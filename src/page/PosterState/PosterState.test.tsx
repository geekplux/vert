import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { immediateSchedule } from '../hooks';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { PageState, PosterPrefs } from '../state';
import { PosterState, figurePixelScale } from './PosterState';
import type { PosterStateAction } from './PosterState';

// jsdom has no WebGL: the View's lazy TerrainView is a fake (src/test/fakeTerrainView.tsx).
vi.mock('../../terrain/TerrainView', () => import('../../test/fakeTerrainView'));

function posterState(poster: Partial<PosterPrefs> = {}): PageState {
  return {
    screen: { name: 'poster', runId: SAMPLE_RUN.id, notice: null },
    prefs: {
      ...INITIAL_PREFS,
      poster: { ...INITIAL_PREFS.poster, ...posterTextFor(SAMPLE_RUN), ...poster },
    },
  };
}

function renderPoster(poster: Partial<PosterPrefs> = {}) {
  return render(
    <Page
      schedule={immediateSchedule}
      initialRun={SAMPLE_RUN}
      initialState={posterState(poster)}
    />,
  );
}

const aside = () => screen.getByRole('complementary', { name: 'Poster settings' });
const poster = () => screen.getByRole('img', { name: /^Poster: / });

/** The preview's frame: the box PosterPreview sizes to the poster's aspect. */
function previewFrame(): HTMLElement {
  const frame = poster().parentElement?.parentElement;
  if (!frame) throw new Error('PosterPreview structure changed');
  return frame;
}

/** The stats row's labels as the poster draws them. */
function posterStats(): string[] {
  return Array.from(
    poster().querySelectorAll('[data-slot="stats"] [data-stat]'),
    (stat) => stat.firstElementChild?.textContent ?? '',
  );
}

describe('PosterState', () => {
  it('shows every element of DESIGN-SPEC §3 "03 Poster mode"', () => {
    renderPoster();
    const banner = screen.getByRole('banner');
    expect(banner.textContent).toContain('POSTER · COOSA BACKCOUNTRY TRAIL');
    expect(within(banner).getByRole('button', { name: 'Back to the run' })).toBeDefined();

    const settings = within(aside());
    expect(settings.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeDefined();
    for (const label of ['Style', 'Size', 'Text', 'Stats · privacy']) {
      expect(settings.getByRole('heading', { level: 2, name: label })).toBeDefined();
    }
    const style = settings.getByRole('radiogroup', { name: 'Style' });
    expect(
      within(style)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toEqual(['A', 'B', 'E']);
    const size = settings.getByRole('radiogroup', { name: 'Size' });
    expect(within(size).getAllByRole('radio')).toHaveLength(4);
    expect(within(size).getByRole('radio', { name: /^18 × 24 in/ })).toHaveProperty(
      'checked',
      true,
    );
    expect(settings.getByRole('textbox', { name: 'Title' })).toHaveProperty('maxLength', 40);
    expect(settings.getByRole('textbox', { name: 'Subtitle' })).toHaveProperty('maxLength', 60);
    expect(settings.getByRole('textbox', { name: 'Signature' })).toHaveProperty('maxLength', 40);
    const checked = Object.fromEntries(
      ['Distance', 'Vert', 'Time', 'High point'].map((name) => [
        name,
        settings.getByRole<HTMLInputElement>('checkbox', { name }).checked,
      ]),
    );
    expect(checked).toEqual({ Distance: true, Vert: true, Time: true, 'High point': false });
    const hide = settings.getByRole('slider', { name: 'Hide start and end' });
    expect([hide.getAttribute('min'), hide.getAttribute('max'), hide.getAttribute('step')]).toEqual(
      ['0', '500', '100'],
    );
    expect((hide as HTMLInputElement).value).toBe('200');
    expect(hide.getAttribute('aria-valuetext')).toBe('200 metres');
    expect(settings.getByText('200 m')).toBeDefined();
    expect(settings.getByRole('button', { name: 'Download PNG · 5400 × 7200' })).toBeDefined();
    expect(settings.getByRole('button', { name: 'Download PDF for print' })).toBeDefined();
    expect(
      settings.getByText('Rendered in your browser in tiles. Large sizes take a few seconds.'),
    ).toBeDefined();

    const main = within(screen.getByRole('main'));
    expect(main.getByRole('img', { name: /^Poster: Coosa Backcountry Trail, SAT/ })).toBeDefined();
    expect(previewFrame().style.width).toBe('600px');
  });

  it('starts the title field empty-safe: the route name is its placeholder and the default', () => {
    renderPoster({ title: '' });
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title.getAttribute('placeholder')).toBe('Coosa Backcountry Trail');
    expect(poster().getAttribute('aria-label')).toMatch(/^Poster: Coosa Backcountry Trail,/);
  });

  it('updates the preview as the text fields change', () => {
    renderPoster();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Vogel Ridge' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Subtitle' }), {
      target: { value: 'Vogel SP' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Signature' }), {
      target: { value: '@geekplux' },
    });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Vogel Ridge');
    const label = poster().getAttribute('aria-label') ?? '';
    expect(label).toMatch(/^Poster: Vogel Ridge, SAT · 2026-10-03, Vogel SP\./);
    expect(label).toContain('By @geekplux.');
    expect(poster().querySelector('[data-slot="title"]')?.textContent).toBe('Vogel Ridge');
  });

  it('changes the preview’s aspect and the PNG size with the size picker', () => {
    renderPoster();
    expect(previewFrame().style.aspectRatio).toBe('720 / 960');

    fireEvent.click(screen.getByRole('radio', { name: /^A3/ }));
    expect(screen.getByRole('radio', { name: /^A3/ })).toHaveProperty('checked', true);
    expect(previewFrame().style.aspectRatio).toBe(`720 / ${String((720 * 4961) / 3508)}`);
    expect(screen.getByRole('button', { name: 'Download PNG · 3508 × 4961' })).toBeDefined();

    fireEvent.click(screen.getByRole('radio', { name: /^4 : 5/ }));
    expect(previewFrame().style.aspectRatio).toBe('1080 / 1350');
    expect(poster().dataset.layout).toBe('social');
    expect(screen.getByRole('button', { name: 'Download PNG · 1080 × 1350' })).toBeDefined();

    fireEvent.click(screen.getByRole('radio', { name: /^9 : 16/ }));
    expect(previewFrame().style.aspectRatio).toBe('1080 / 1920');
    expect(previewFrame().style.width).toBe('450px');
  });

  it('offers the PDF only for the print sizes, with a note otherwise', () => {
    for (const [size, pdf] of [
      ['18x24', true],
      ['a3', true],
      ['4x5', false],
      ['9x16', false],
    ] as const) {
      const { unmount } = renderPoster({ size });
      expect(screen.queryByRole('button', { name: 'Download PDF for print' }) !== null).toBe(pdf);
      expect(
        screen.queryByText('PDF is offered for the print sizes, 18 × 24 in and A3.') !== null,
      ).toBe(!pdf);
      unmount();
    }
  });

  it('shows and hides stats on the poster with the checkboxes', () => {
    renderPoster();
    expect(posterStats()).toEqual(['DISTANCE', 'VERT', 'TIME']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'High point' }));
    expect(screen.getByRole('checkbox', { name: 'High point' })).toHaveProperty('checked', true);
    expect(posterStats()).toEqual(['DISTANCE', 'VERT', 'TIME', 'HIGH POINT']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Vert' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Time' }));
    expect(posterStats()).toEqual(['DISTANCE', 'HIGH POINT']);
  });

  it('moves the hide start and end slider in 100 m steps', () => {
    renderPoster();
    const hide = screen.getByRole('slider', { name: 'Hide start and end' });
    fireEvent.change(hide, { target: { value: '400' } });
    expect((hide as HTMLInputElement).value).toBe('400');
    expect(hide.getAttribute('aria-valuetext')).toBe('400 metres');
    expect(within(aside()).getByText('400 m')).toBeDefined();
  });

  it('sends each control’s preference event', () => {
    const dispatch = vi.fn<(action: PosterStateAction) => void>();
    const state = posterState();
    render(
      <PosterState
        run={SAMPLE_RUN}
        screen={{ name: 'poster', runId: SAMPLE_RUN.id, notice: null }}
        prefs={state.prefs}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'B Night Ridge' }));
    fireEvent.click(screen.getByRole('radio', { name: /^A3/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Subtitle' }), {
      target: { value: 'Vogel SP' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Distance' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Hide start and end' }), {
      target: { value: '0' },
    });
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'SET_POSTER_STYLE', style: 'B' },
      { type: 'SET_POSTER_SIZE', size: 'a3' },
      { type: 'SET_POSTER_TEXT', field: 'subtitle', value: 'Vogel SP' },
      { type: 'SET_POSTER_STAT', stat: 'distance', shown: false },
      { type: 'SET_HIDE_ENDS', metres: 0 },
    ]);
  });

  it('shows the real Night Ridge and Survey Quad posters, figures pending their terrain', async () => {
    renderPoster();
    fireEvent.click(screen.getByRole('radio', { name: 'E Survey Quad' }));
    expect(screen.getByRole('radio', { name: 'E Survey Quad' })).toHaveProperty('checked', true);
    const quad = await screen.findByRole('img', { name: /^Poster: / });
    expect(quad.dataset.style).toBe('E');
    // Placeholder mode never builds terrain: the map frame says it is drawing.
    expect(within(quad).getByText('Drawing the terrain…')).toBeDefined();

    fireEvent.click(screen.getByRole('radio', { name: 'B Night Ridge' }));
    await waitFor(() => {
      expect(poster().dataset.style).toBe('B');
    });

    fireEvent.click(screen.getByRole('radio', { name: 'A Trail Sign' }));
    expect(poster().dataset.layout).toBe('print');
  });

  it('starts the export with the poster’s file name from Download', () => {
    const dispatch = vi.fn<(action: PosterStateAction) => void>();
    const state = posterState();
    const exporter = () => new Promise<never>(() => undefined);
    const { rerender } = render(
      <PosterState
        run={SAMPLE_RUN}
        screen={{ name: 'poster', runId: SAMPLE_RUN.id, notice: null }}
        prefs={state.prefs}
        dispatch={dispatch}
        exporter={exporter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG · 5400 × 7200' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF for print' }));

    rerender(
      <PosterState
        run={SAMPLE_RUN}
        screen={{ name: 'poster', runId: SAMPLE_RUN.id, notice: null }}
        prefs={{
          ...state.prefs,
          poster: { ...state.prefs.poster, size: 'a3', title: 'Côte Loop' },
        }}
        dispatch={dispatch}
        exporter={exporter}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download PNG · 3508 × 4961' }));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'EXPORT_STARTED',
        fileName: 'vert-coosa-backcountry-trail-18x24.png',
      },
      {
        type: 'EXPORT_STARTED',
        fileName: 'vert-coosa-backcountry-trail-18x24.pdf',
      },
      { type: 'EXPORT_STARTED', fileName: 'vert-cote-loop-a3.png' },
    ]);
  });

  it('goes back to the run from the header', () => {
    renderPoster();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('moves focus to the h1 on entering Poster mode, and back to the View’s on leaving', async () => {
    render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Coosa Backcountry Trail' },
      { timeout: 5000 },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
      await Promise.resolve();
    });
    // Re-queried on every try (a remount replaces the element), with room for a loaded suite.
    await waitFor(
      () => {
        expect(document.activeElement).toBe(
          screen.getByRole('heading', { level: 1, name: 'Make a poster' }),
        );
      },
      { timeout: 5000 },
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Make a poster' }).getAttribute('tabindex'),
    ).toBe('-1');
    // RUN_LOADED seeded the title with the route name and left the subtitle empty.
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty(
      'value',
      'Coosa Backcountry Trail',
    );
    expect(screen.getByRole('textbox', { name: 'Subtitle' })).toHaveProperty('value', '');

    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    await waitFor(
      () => {
        expect(document.activeElement).toBe(
          screen.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
        );
      },
      { timeout: 5000 },
    );
  });

  it('keeps reading order: style, size, text, stats, hide ends, then Download', () => {
    renderPoster();
    const controls = Array.from(aside().querySelectorAll('input, button'), (element) =>
      element instanceof HTMLInputElement ? element.type : element.textContent,
    );
    expect(controls).toEqual([
      ...Array<string>(3).fill('radio'),
      ...Array<string>(4).fill('radio'),
      ...Array<string>(3).fill('text'),
      ...Array<string>(4).fill('checkbox'),
      'range',
      'Download PNG · 5400 × 7200',
      'Download PDF for print',
    ]);
  });

  it('has no axe violations, for style A and Night Ridge', async () => {
    const { container } = renderPoster({ signature: '@geekplux' });
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('radio', { name: 'B Night Ridge' }));
    await screen.findByText('Drawing the terrain…');
    await expectNoAxeViolations(container);
  });
});

describe('figurePixelScale', () => {
  it('rounds the preview scale × device pixel ratio up to 1/20, never stretching the canvas', () => {
    const before = window.devicePixelRatio;
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
      // A 1080-wide share card in a 432 px preview: 0.4 × 2 = 0.8 exactly.
      expect(figurePixelScale(0.4)).toBe(0.8);
      // Just past a step rounds up, not to the nearest (which would upscale the canvas).
      expect(figurePixelScale(0.3787)).toBe(0.8);
      expect(figurePixelScale(0.3787)).toBeGreaterThanOrEqual(0.3787 * 2);
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
      // The ratio is capped at 2.
      expect(figurePixelScale(0.5)).toBe(1);
      expect(figurePixelScale(0.001)).toBe(0.05);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: before });
    }
  });
});
