import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import { expectNoAxeViolations } from '../test/axe';
import { scaleBarFor } from './contours';
import type { SurveyQuadFigureData } from './figures';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { SURVEY_QUAD_PALETTE } from './styles';
import { SurveyQuadPoster, scaleLabelsShown } from './SurveyQuadPoster';
import { posterContentFromRun } from './types';

const NAME = SAMPLE_RUN.name;
const ALL = { distance: true, vert: true, time: true, highPoint: true };

const DATA: SurveyQuadFigureData = {
  map: {
    width: 600,
    height: 450,
    contours: { index: 'M0,100L600,120', intermediate: 'M0,50L600,60M0,150L600,170' },
    interval: 20,
    route: 'M100,100L300,200L500,150',
    markers: [{ x: 100, y: 100, kind: 'start' }],
    scaleBar: scaleBarFor(200 / 4500, { maxPx: 200 }),
    pxPerMetre: 200 / 4500,
  },
  coordinates: { lat: '34°46′ N', lon: '83°57′ W' },
};

function renderPoster(
  size: PosterSizeId,
  {
    poster = {},
    data = DATA,
    figure,
  }: {
    poster?: Partial<PosterPrefs>;
    data?: SurveyQuadFigureData | null;
    figure?: ReactNode;
  } = {},
) {
  const content = posterContentFromRun(SAMPLE_RUN, {
    ...INITIAL_PREFS,
    poster: { ...INITIAL_PREFS.poster, stats: ALL, ...poster },
  });
  const result = render(
    <SurveyQuadPoster
      content={content}
      size={posterSizeById(size)}
      figureData={data}
      figure={figure}
    />,
  );
  const root = screen.getByRole('img', { name: /^Poster: / });
  const slot = (name: string) => root.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  return { ...result, root, slot };
}

describe('SurveyQuadPoster', () => {
  it('is one image named by the poster summary; the drawn text is hidden', () => {
    const { root } = renderPoster('18x24');
    expect(root.getAttribute('aria-label')).toMatch(new RegExp(`^Poster: ${NAME}, SAT`));
    expect(root.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(root.dataset.style).toBe('E');
  });

  it.each([
    ['18x24', 720, 960, 'print'],
    ['a3', 720, (720 * 4961) / 3508, 'print'],
    ['4x5', 1080, 1350, 'social'],
    ['9x16', 1080, 1920, 'social'],
  ] as const)('renders %s at its logical size %d × %d (%s)', (size, width, height, layout) => {
    const { root } = renderPoster(size);
    expect(root.style.width).toBe(`${String(width)}px`);
    expect(root.style.height).toBe(`${String(height)}px`);
    expect(root.dataset.layout).toBe(layout);
  });

  it('sets the Survey Quad palette on the root', () => {
    const { root } = renderPoster('18x24');
    expect(root.style.getPropertyValue('--sq-paper')).toBe(SURVEY_QUAD_PALETTE.paper);
    expect(root.style.getPropertyValue('--sq-ink')).toBe(SURVEY_QUAD_PALETTE.ink);
    expect(root.style.getPropertyValue('--sq-map')).toBe('#F7F5EE');
  });

  it.each(['18x24', 'a3', '4x5', '9x16'] as const)('%s: every slot with real data', (size) => {
    const { slot } = renderPoster(size, { poster: { signature: '@geekplux' } });
    expect(slot('header')?.textContent).toBe('VERT · TRAIL QUADRANGLE@geekplux');
    expect(slot('title')?.textContent).toBe(NAME);
    expect(slot('coordinates')?.textContent).toBe('34°46′ NSAMPLE DATA83°57′ W');
    expect(slot('credit')?.textContent).toBe(
      'MAPPED FROM GPX + PUBLIC ELEVATION DATASAT · 2026-10-03',
    );
    expect(slot('stats')?.textContent).toBe(
      'DISTANCE21.5 kmASCENT1,092 mTIME3:04:53HIGH POINT1,267 m',
    );
    expect(slot('legend')?.textContent).toBe(
      'Route runIndex contourIntermediate contourStart and finish',
    );
    expect(slot('scale')?.textContent).toBe('01234 kmCONTOUR INTERVAL 20 METRES');
    // No invented place names.
    expect(slot('figure')?.textContent).toBe('');
  });

  it('draws contours, the dashed route on its white halo and the ○ marker', () => {
    const { root } = renderPoster('18x24');
    const svg = root.querySelector('[data-figure="contours"]');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 600 450');
    const index = svg?.querySelector('[data-contour="index"]');
    const intermediate = svg?.querySelector('[data-contour="intermediate"]');
    expect(index?.getAttribute('stroke-width')).toBe('1.6');
    expect(intermediate?.getAttribute('stroke-width')).toBe('0.7');
    expect(index?.parentElement?.getAttribute('stroke')).toBe('#9A5B2E');
    const halo = svg?.querySelector('[data-route="halo"]');
    const line = svg?.querySelector('[data-route="line"]');
    expect(halo?.getAttribute('stroke')).toBe('#FFFFFF');
    expect(line?.getAttribute('stroke')).toBe('#1E1B18');
    expect(line?.getAttribute('stroke-width')).toBe('3.5');
    expect(line?.getAttribute('stroke-dasharray')).toBe('10 6');
    const start = svg?.querySelector('[data-marker="start"]');
    expect(start?.tagName).toBe('circle');
    expect(start?.getAttribute('fill')).toBe('#FFFFFF');
    expect(start?.getAttribute('stroke')).toBe('#1E1B18');
  });

  it('scales strokes 1.5× on the share card', () => {
    const { root } = renderPoster('9x16');
    expect(root.querySelector('[data-contour="index"]')?.getAttribute('stroke-width')).toBe('2.4');
    expect(root.querySelector('[data-route="line"]')?.getAttribute('stroke-width')).toBe('5.25');
  });

  it('draws the scale bar from the data: four alternating segments', () => {
    const { slot } = renderPoster('18x24');
    const bar = slot('scale')?.querySelector('[data-scale-bar]');
    expect(bar?.getAttribute('data-scale-bar')).toBe('4 km');
    const rects = Array.from(bar?.querySelectorAll('rect') ?? []);
    expect(rects.map((rect) => rect.getAttribute('fill'))).toEqual([
      '#1E1B18',
      '#F2EFE6',
      '#1E1B18',
      '#F2EFE6',
    ]);
    expect(Number(rects[1]?.getAttribute('width'))).toBeCloseTo(44.44, 1);
  });

  it('states the interval actually drawn', () => {
    const map = DATA.map;
    if (!map) throw new Error('fixture');
    const { slot } = renderPoster('18x24', { data: { ...DATA, map: { ...map, interval: 50 } } });
    expect(slot('scale')?.textContent).toBe('01234 kmCONTOUR INTERVAL 50 METRES');
  });

  it('without terrain: the fallback figure, no scale bar, the interval still stated', () => {
    const { slot } = renderPoster('18x24', {
      data: { map: null, coordinates: null },
      figure: <canvas />,
    });
    expect(slot('figure')?.querySelector('canvas')).not.toBeNull();
    expect(slot('scale')?.querySelector('[data-scale-bar]')).toBeNull();
    expect(slot('scale')?.textContent).toBe('CONTOUR INTERVAL 20 METRES');
    expect(slot('coordinates')?.textContent).toBe('SAMPLE DATA');
  });

  it('shows the subtitle in italic under the title; drops stats switched off', () => {
    const { slot } = renderPoster('18x24', {
      poster: {
        subtitle: 'Vogel State Park',
        stats: { distance: true, vert: true, time: false, highPoint: false },
      },
    });
    expect(slot('subtitle')?.textContent).toBe('Vogel State Park');
    expect(slot('stats')?.textContent).toBe('DISTANCE21.5 kmASCENT1,092 m');
    expect(slot('stats')?.style.getPropertyValue('--stat-columns')).toBe('2');
  });

  it('thins the scale labels when they would not fit under the bar', () => {
    const labels = ['0', '0.25', '0.5', '0.75', '1 km'];
    expect(scaleLabelsShown(labels, 300, 18)).toEqual([true, true, true, true, true]);
    expect(scaleLabelsShown(labels, 120, 18)).toEqual([true, false, true, false, true]);
    expect(scaleLabelsShown(labels, 60, 18)).toEqual([true, false, false, false, true]);
  });

  it('has no axe violations', async () => {
    const { container } = renderPoster('4x5');
    await expectNoAxeViolations(container);
  });
});
