import { render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import { expectNoAxeViolations } from '../test/axe';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { TrailSignPoster } from './TrailSignPoster';
import { SHARE_TITLE, fitTitle } from './titleFit';
import { posterContentFromRun } from './types';

const NAME = SAMPLE_RUN.name;
const ALL = { distance: true, vert: true, time: true, highPoint: true };

function renderPoster(size: PosterSizeId, poster: Partial<PosterPrefs> = {}) {
  const content = posterContentFromRun(SAMPLE_RUN, {
    ...INITIAL_PREFS,
    poster: { ...INITIAL_PREFS.poster, ...poster },
  });
  const result = render(
    <TrailSignPoster
      content={content}
      size={posterSizeById(size)}
      figure={<canvas width={1000} height={680} />}
    />,
  );
  const poster$ = screen.getByRole('img', { name: /^Poster: / });
  const slot = (name: string) => poster$.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  return { ...result, poster: poster$, slot };
}

describe('TrailSignPoster', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is one image with a summary as its name, its text hidden from assistive tech', () => {
    const { poster } = renderPoster('18x24');
    expect(poster).toHaveProperty(
      'ariaLabel',
      `Poster: ${NAME}, SAT · 2026-10-03. Distance 21.5 km, vert +1,092 m, time 3:04:53. Sample data.`,
    );
    const inner = poster.firstElementChild;
    expect(inner?.getAttribute('aria-hidden')).toBe('true');
    expect(within(poster).queryByText('VERT', { ignore: '[aria-hidden] *' })).toBeNull();
  });

  it.each([
    ['18x24', 720, 960],
    ['a3', 720, (720 * 4961) / 3508],
    ['4x5', 1080, 1350],
    ['9x16', 1080, 1920],
  ] as const)('renders %s at its logical size %d × %d', (size, width, height) => {
    const { poster } = renderPoster(size);
    expect(poster.style.width).toBe(`${String(width)}px`);
    expect(poster.style.height).toBe(`${String(height)}px`);
  });

  it('print sizes: header, title, figure, stats, profile strip and footer', () => {
    for (const size of ['18x24', 'a3'] as const) {
      const { slot, poster, unmount } = renderPoster(size);
      expect(poster.dataset.layout).toBe('print');
      expect(slot('header')?.textContent).toBe('VERTSAT · 2026-10-03');
      expect(slot('title')?.textContent).toBe(NAME);
      expect(slot('title')?.style.fontSize).toBe('104px');
      expect(slot('figure')?.querySelector('canvas')).not.toBeNull();
      expect(slot('stats')).not.toBeNull();
      expect(slot('profile')?.getAttribute('viewBox')).toBe('0 0 1000 120');
      expect(slot('profile')?.querySelector('path')?.getAttribute('d')).toMatch(/^M0,120 L/);
      expect(slot('footer')?.textContent).toBe('SAMPLE DATA · ELEVATION ×1.6VERT.GEEKPLUX.COM');
      expect(slot('headline')).toBeNull();
      unmount();
    }
  });

  it('social sizes: the share-card layout with the vert headline', () => {
    for (const size of ['4x5', '9x16'] as const) {
      const { slot, poster, unmount } = renderPoster(size, { stats: ALL, signature: '@geekplux' });
      expect(poster.dataset.layout).toBe('social');
      expect(slot('header')?.textContent).toBe('VERTSAT · 2026-10-03');
      expect(slot('headline')?.textContent).toBe(`+1,092 mof climbing in 21.5 km on ${NAME}`);
      expect(slot('figure')?.querySelector('canvas')).not.toBeNull();
      expect(slot('footer')?.textContent).toBe(
        'SAMPLE DATA · 3:04:53 · HIGH POINT 1,267 m@geekplux',
      );
      expect(slot('stats')).toBeNull();
      expect(slot('profile') !== null).toBe(size === '9x16');
      expect(slot('title')).toBeNull();
      unmount();
    }
  });

  it('social headline falls back to distance when vert is off', () => {
    const { slot } = renderPoster('4x5', { stats: { ...ALL, vert: false } });
    expect(slot('headline')?.textContent).toBe(`21.5 kmon ${NAME}`);
  });

  it('keeps the date in the header and puts the subtitle in the footer (print)', () => {
    const { slot } = renderPoster('18x24', { subtitle: 'Vogel SP' });
    expect(slot('header')?.lastElementChild?.textContent).toBe('SAT · 2026-10-03');
    expect(slot('footer')?.firstElementChild?.textContent).toBe(
      'SAMPLE DATA · Vogel SP · ELEVATION ×1.6',
    );
  });

  it('puts the subtitle after the date in the share-card header', () => {
    const { slot } = renderPoster('4x5', { subtitle: 'Vogel SP' });
    expect(slot('header')?.lastElementChild?.textContent).toBe('SAT · 2026-10-03 · Vogel SP');
  });

  it('social without vert or distance: the title takes the big slot, the line shows the rest', () => {
    const hpOnly = { distance: false, vert: false, time: true, highPoint: true };
    const { slot, unmount } = renderPoster('4x5', { stats: hpOnly, signature: '@geekplux' });
    const title = slot('title');
    expect(title?.textContent).toBe(NAME);
    expect(title?.style.fontSize).toBe(`${String(fitTitle(NAME, SHARE_TITLE).size)}px`);
    expect(slot('headline')?.lastElementChild?.textContent).toBe('3:04:53 · High point 1,267 m');
    // The footer does not repeat the stats the line already shows.
    expect(slot('footer')?.textContent).toBe('SAMPLE DATA@geekplux');
    unmount();

    const none = { distance: false, vert: false, time: false, highPoint: false };
    const story = renderPoster('9x16', { stats: none });
    expect(story.slot('title')?.textContent).toBe(NAME);
    expect(story.slot('headline')?.lastElementChild?.textContent).toBe('SAT · 2026-10-03');
  });

  it('sets wide-script titles with line-height 1', () => {
    const cjk = renderPoster('18x24', { title: '高尾山トレイル' });
    expect(cjk.slot('title')?.style.lineHeight).toBe('1');
    cjk.unmount();
    const latin = renderPoster('18x24');
    expect(latin.slot('title')?.style.lineHeight).toBe('');
  });

  it('uses the signature in the footer when there is one', () => {
    const { slot } = renderPoster('18x24', { signature: '@geekplux' });
    expect(slot('footer')?.lastElementChild?.textContent).toBe('@geekplux');
  });

  it.each([
    [{ distance: true, vert: false, time: false, highPoint: false }, ['DISTANCE']],
    [{ distance: true, vert: true, time: false, highPoint: false }, ['DISTANCE', 'VERT']],
    [{ distance: true, vert: true, time: true, highPoint: false }, ['DISTANCE', 'VERT', 'TIME']],
    [ALL, ['DISTANCE', 'VERT', 'TIME', 'HIGH POINT']],
  ])('stats grid has one column per stat shown (%o)', (stats, labels) => {
    const { slot } = renderPoster('18x24', { stats });
    const grid = slot('stats');
    expect(grid?.style.getPropertyValue('--stat-columns')).toBe(String(labels.length));
    expect([...(grid?.children ?? [])].map((cell) => cell.firstElementChild?.textContent)).toEqual(
      labels,
    );
  });

  it('drops the stats row when no stat is shown', () => {
    const none = { distance: false, vert: false, time: false, highPoint: false };
    const { slot } = renderPoster('18x24', { stats: none });
    expect(slot('stats')).toBeNull();
  });

  it('shrinks a long title by the fit rule', () => {
    const { slot } = renderPoster('18x24', {
      title: 'Chattahoochee National Forest Backcountry Ridge Traverse and Return Loop',
    });
    expect(slot('title')?.style.fontSize).toBe('58px');
  });

  it('sizes the figure box by the grow/cap rules', () => {
    const print = renderPoster('18x24');
    const printFigure = print.slot('figure');
    expect(printFigure?.style.flexGrow).toBe('1');
    expect(printFigure?.style.minHeight).toBe(`${String(624 * 0.68 * 0.75)}px`);
    expect(printFigure?.style.maxHeight).toBe('');
    print.unmount();

    const social = renderPoster('4x5');
    expect(social.slot('figure')?.style.flexGrow).toBe('0');
    expect(social.slot('figure')?.style.maxHeight).toBe('936px');
    expect(social.slot('body')?.style.maxHeight).toBe('');
    social.unmount();

    const story = renderPoster('9x16');
    expect(story.slot('figure')?.style.flexGrow).toBe('1');
    expect(story.slot('figure')?.style.maxHeight).toBe('936px');
    expect(story.slot('body')?.style.maxHeight).toBe(`${String(936 + 24 + 96)}px`);
    expect(story.slot('profile')?.style.height).toBe('96px');
  });

  it('reports the figure box size once per change', () => {
    let notify: (rect: { width: number; height: number }) => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(
          callback: (entries: { contentRect: { width: number; height: number } }[]) => void,
        ) {
          notify = (rect) => {
            callback([{ contentRect: rect }]);
          };
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    const onFigureBox = vi.fn();
    const content = posterContentFromRun(SAMPLE_RUN, INITIAL_PREFS);
    render(
      <TrailSignPoster
        content={content}
        size={posterSizeById('18x24')}
        figure={<canvas />}
        onFigureBox={onFigureBox}
      />,
    );
    act(() => {
      notify({ width: 624, height: 332.8 });
      notify({ width: 624, height: 332.8 });
      notify({ width: 624, height: 424.31 });
    });
    expect(onFigureBox.mock.calls).toEqual([
      [{ width: 624, height: 332.8 }],
      [{ width: 624, height: 424.31 }],
    ]);
  });

  it('fits a CJK title in three lines', () => {
    const { slot } = renderPoster('18x24', {
      title: '高尾山から陣馬山への縦走トレイルランニング大会コース',
    });
    expect(slot('title')?.style.fontSize).toBe('68px');
    expect(slot('title')?.dataset.lines).toBe('3');
  });

  it('keeps 104px for a short title', () => {
    const { slot } = renderPoster('18x24', { title: 'UTMB' });
    expect(slot('title')?.style.fontSize).toBe('104px');
    expect(slot('title')?.dataset.lines).toBe('1');
  });

  it('has no axe violations in either layout', async () => {
    const print = renderPoster('18x24');
    await expectNoAxeViolations(print.container);
    print.unmount();
    const social = renderPoster('9x16');
    await expectNoAxeViolations(social.container);
  });
});
