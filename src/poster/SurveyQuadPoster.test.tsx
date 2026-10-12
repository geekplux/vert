import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import { expectNoAxeViolations } from '../test/axe';
import { scaleBarFor } from './contours';
import { SURVEY_QUAD_LABEL_FACE, faceTableMeasure } from './faceMeasure';
import { SCALE_BAR_MAX_PX } from './figures';
import type { SurveyQuadFigureData } from './figures';
import { posterLayout } from './layout';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { SURVEY_QUAD_PALETTE } from './styles';
import {
  SurveyQuadPoster,
  scaleLabelExtent,
  scaleLabelLayout,
  scaleLabelsShown,
  splitScaleLabel,
} from './SurveyQuadPoster';
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

/** Renders with other display units (the content's units drive the interval label). */
function renderWithUnits(
  size: PosterSizeId,
  data: SurveyQuadFigureData,
  units: 'metric' | 'imperial',
) {
  const content = posterContentFromRun(SAMPLE_RUN, {
    ...INITIAL_PREFS,
    units,
    poster: { ...INITIAL_PREFS.poster, stats: ALL },
  });
  const result = render(
    <SurveyQuadPoster content={content} size={posterSizeById(size)} figureData={data} />,
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
      'DISTANCE21.5 kmASCENT1,102 mTIME3:04:58HIGH POINT1,267 m',
    );
    expect(slot('legend')?.textContent).toBe(
      'Route runIndex contourIntermediate contourStart / finish',
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
    const start = svg?.querySelectorAll('[data-marker="start"] circle');
    expect(start).toHaveLength(1);
    expect(start?.[0]?.getAttribute('fill')).toBe('#FFFFFF');
    expect(start?.[0]?.getAttribute('stroke')).toBe('#1E1B18');
    expect(svg?.querySelector('[data-marker="finish"]')).toBeNull();
  });

  it('marks a point-to-point run ○ start and ◉ finish, and says so in the legend', () => {
    const map = DATA.map;
    if (!map) throw new Error('no map');
    const data: SurveyQuadFigureData = {
      ...DATA,
      map: {
        ...map,
        markers: [
          { x: 100, y: 100, kind: 'start' },
          { x: 500, y: 150, kind: 'finish' },
        ],
      },
    };
    const { root, slot } = renderPoster('18x24', { data });
    const svg = root.querySelector('[data-figure="contours"]');
    // The start is a hollow ring; the finish the same ring with an ink dot (shape, not colour).
    expect(svg?.querySelectorAll('[data-marker="start"] circle')).toHaveLength(1);
    const finish = Array.from(svg?.querySelectorAll('[data-marker="finish"] circle') ?? []);
    expect(finish.map((circle) => circle.getAttribute('fill'))).toEqual(['#FFFFFF', '#1E1B18']);
    // The start is drawn last, on top.
    expect(svg?.querySelector('g[data-marker]:last-of-type')?.getAttribute('data-marker')).toBe(
      'start',
    );
    const ends = slot('legend')?.querySelector('[data-legend="ends"]');
    expect(ends?.textContent).toBe('Start ·Finish');
    expect(ends?.querySelectorAll('svg')).toHaveLength(2);
    expect(ends?.querySelectorAll('svg')[1]?.querySelectorAll('circle')).toHaveLength(2);
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

  it('leaves the contour interval, contour legend and credit out when the contours could not be drawn', () => {
    const content = posterContentFromRun(SAMPLE_RUN, INITIAL_PREFS);
    render(
      <SurveyQuadPoster
        content={content}
        size={posterSizeById('18x24')}
        figureData={{ map: null, coordinates: null }}
        figure={<span>The terrain couldn’t be drawn.</span>}
        figureFailed
      />,
    );
    const root = screen.getByRole('img', { name: /^Poster: / });
    // The interval's line stays, empty (a no-break space), so the layout does not move.
    expect(root.querySelector('[data-slot="scale"]')?.textContent).toBe('\u00a0');
    // No contours drawn: no contour rows in the legend and no elevation-data credit.
    const legend = root.querySelector('[data-slot="legend"]');
    expect(legend?.textContent).not.toMatch(/contour/i);
    expect(legend?.textContent).toMatch(/Route run/);
    expect(legend?.textContent).toMatch(/Start \/ finish/);
    expect(root.querySelector('[data-slot="credit"]')?.textContent).not.toMatch(/MAPPED|ELEVATION/);
    expect(root.querySelector('[data-slot="figure"]')?.textContent).toBe(
      'The terrain couldn’t be drawn.',
    );
  });

  it('draws the route flat with the note when the terrain failed; a point-to-point key keeps ◉ Finish', () => {
    const content = posterContentFromRun(SAMPLE_RUN, INITIAL_PREFS);
    const base = DATA.map;
    if (!base) throw new Error('no map');
    const flat = {
      ...base,
      contours: { index: '', intermediate: '' },
      markers: [
        { x: 100, y: 100, kind: 'start' as const },
        { x: 500, y: 150, kind: 'finish' as const },
      ],
    };
    render(
      <SurveyQuadPoster
        content={content}
        size={posterSizeById('18x24')}
        figureData={{ map: flat, coordinates: DATA.coordinates }}
        figure={<span data-figure="placeholder">The terrain couldn’t be drawn.</span>}
        figureFailed
      />,
    );
    const root = screen.getByRole('img', { name: /^Poster: / });
    const figure = root.querySelector('[data-slot="figure"]');
    expect(figure?.querySelector('[data-route="line"]')?.getAttribute('d')).toMatch(/^M/);
    expect(figure?.querySelectorAll('[data-marker]')).toHaveLength(2);
    expect(figure?.textContent).toBe('The terrain couldn’t be drawn.');
    const rows = Array.from(root.querySelectorAll('[data-slot="legend"] > *'), (row) =>
      row.textContent.trim(),
    );
    // The two contour rows keep their place, empty.
    expect(rows).toEqual(['Route run', '', '', 'Start ·Finish']);
    expect(root.querySelectorAll('[data-legend="reserved"]')).toHaveLength(2);
    expect(root.querySelector('[data-slot="scale"] [data-scale-bar]')).not.toBeNull();
    expect(root.querySelector('[data-slot="scale"]')?.textContent).not.toMatch(/CONTOUR/);
  });

  it('keeps every row of the layout at its height when the terrain failed, the credit and key included', () => {
    const content = posterContentFromRun(SAMPLE_RUN, INITIAL_PREFS);
    const failed = render(
      <SurveyQuadPoster
        content={{ ...content, date: '' }}
        size={posterSizeById('18x24')}
        figureData={DATA}
        figureFailed
      />,
    );
    const root = failed.container;
    // A dateless run's credit row still has a line in it.
    expect(root.querySelector('[data-slot="credit"]')?.textContent).toBe('\u00a0');
    const legend = root.querySelector('[data-slot="legend"]');
    expect(legend?.children).toHaveLength(4);
    for (const row of root.querySelectorAll('[data-legend="reserved"]')) {
      expect(row.textContent).toBe('\u00a0');
      expect(row.querySelector('svg')?.getAttribute('height')).toBe(
        legend?.querySelector('[data-legend="index"] svg, svg')?.getAttribute('height'),
      );
    }
  });

  it('shows the subtitle in italic under the title; drops stats switched off', () => {
    const { slot } = renderPoster('18x24', {
      poster: {
        subtitle: 'Vogel State Park',
        stats: { distance: true, vert: true, time: false, highPoint: false },
      },
    });
    expect(slot('subtitle')?.textContent).toBe('Vogel State Park');
    expect(slot('stats')?.textContent).toBe('DISTANCE21.5 kmASCENT1,102 m');
    expect(slot('stats')?.style.getPropertyValue('--stat-columns')).toBe('2');
  });

  it('thins the scale labels by their real widths on their ticks', () => {
    const labels = ['0', '0.25', '0.5', '0.75', '1 km'];
    const measure = faceTableMeasure(SURVEY_QUAD_LABEL_FACE);
    const px = (text: string) => measure(text) * 18;
    const ticks = (segment: number) => labels.map((_, i) => i * segment);
    expect(scaleLabelsShown(labels, ticks(75), px, 9)).toEqual([true, true, true, true, true]);
    expect(scaleLabelsShown(labels, ticks(30), px, 9)).toEqual([true, false, true, false, true]);
    expect(scaleLabelsShown(labels, ticks(12), px, 9)).toEqual([true, false, false, false, true]);
    // Narrow digits fit where wide ones would not.
    const narrow = (text: string) => px(text) / 2;
    expect(scaleLabelsShown(labels, ticks(30), narrow, 9)).toEqual([true, true, true, true, true]);
  });

  it('places each scale label on its tick at every size', () => {
    const measure = faceTableMeasure(SURVEY_QUAD_LABEL_FACE);
    for (const size of ['18x24', 'a3', '4x5', '9x16'] as const) {
      const kind = posterLayout(posterSizeById(size)).kind;
      const labelPx = kind === 'print' ? 10 : 18;
      // The sample's map scale at this size (about 0.073 px/m in print, 0.092 on the share card).
      const bar = scaleBarFor(kind === 'print' ? 0.073 : 0.092, {
        maxPx: SCALE_BAR_MAX_PX[kind],
      });
      const map = DATA.map;
      if (!map) throw new Error('fixture');
      const { slot, unmount } = renderPoster(size, {
        data: { ...DATA, map: { ...map, scaleBar: bar } },
      });
      const svg = slot('scale')?.querySelector('[data-scale-bar]');
      const rects = Array.from(svg?.querySelectorAll('rect') ?? []);
      // Ticks: each segment's left edge, then the last one's right edge.
      const ticks = [
        ...rects.map((rect) => Number(rect.getAttribute('x'))),
        Number(rects.at(-1)?.getAttribute('x')) + Number(rects.at(-1)?.getAttribute('width')),
      ];
      const spans = Array.from(svg?.nextElementSibling?.children ?? []) as HTMLElement[];
      expect(spans).toHaveLength(bar.labels.length);
      const px = (text: string) => measure(text) * labelPx;
      spans.forEach((span, i) => {
        if (!span.textContent) return;
        expect(span.textContent).toBe(bar.labels[i]);
        if (i === 0) {
          // Documented exception: the first label starts at the bar's start.
          expect(span.style.marginLeft).toBe('');
          expect(scaleLabelExtent(bar.labels, 0, ticks[0] ?? 0, px)[0]).toBe(0);
          return;
        }
        // Anchored at the tick and centred there (the last: its number, the unit after it).
        expect(Math.abs(parseFloat(span.style.marginLeft) - (ticks[i] ?? NaN))).toBeLessThan(1);
        const [left, right] = scaleLabelExtent(bar.labels, i, ticks[i] ?? 0, px);
        const [number, unit] = splitScaleLabel(bar.labels[i] ?? '');
        const centre = i === bar.labels.length - 1 ? left + px(number) / 2 : (left + right) / 2;
        expect(Math.abs(centre - (ticks[i] ?? NaN))).toBeLessThan(1);
        expect(span.getAttribute('data-align')).toBe(
          i === bar.labels.length - 1 ? 'end' : 'centre',
        );
        if (i === bar.labels.length - 1) expect(unit).toMatch(/^ (km|m)$/);
      });
      // No two shown labels overlap.
      const shown = spans.flatMap((span, i) =>
        span.textContent ? [scaleLabelExtent(bar.labels, i, ticks[i] ?? 0, px)] : [],
      );
      for (let j = 1; j < shown.length; j++) {
        expect(shown[j]?.[0]).toBeGreaterThan((shown[j - 1]?.[1] ?? 0) + 0.4 * labelPx);
      }
      unmount();
    }
  });

  it('keeps every scale-bar text inside the scale block, so none crosses the column edge', () => {
    // The scale block sits at the right end of the key, ending at the column's (the map frame's)
    // right edge; its width is the bar plus the reserve. Every label must end inside it, at every
    // size and in imperial units, with the bar as long as it gets (SCALE_BAR_MAX_PX).
    const measure = faceTableMeasure(SURVEY_QUAD_LABEL_FACE);
    const cases = [
      ['18x24', 'metric'],
      ['a3', 'metric'],
      ['4x5', 'metric'],
      ['9x16', 'metric'],
      ['4x5', 'imperial'],
      ['18x24', 'imperial'],
    ] as const;
    for (const [size, units] of cases) {
      const layout = posterLayout(posterSizeById(size));
      const k = layout.width / 720;
      const labelPx = layout.kind === 'print' ? 10 : 18;
      const px = (text: string) => measure(text) * labelPx;
      for (const pxPerMetre of [0.06, 0.073, 0.0835, 0.092, 0.11]) {
        const bar = scaleBarFor(pxPerMetre, { maxPx: SCALE_BAR_MAX_PX[layout.kind], units });
        for (const room of [Infinity, bar.lengthPx + k]) {
          const placed = scaleLabelLayout(bar, k, px, 0.5 * labelPx, room);
          const blockRight = bar.lengthPx + placed.reserve;
          expect(placed.endFlush).toBe(room !== Infinity);
          bar.labels.forEach((_, i) => {
            if (!placed.shown[i]) return;
            const [left, right] = scaleLabelExtent(
              bar.labels,
              i,
              placed.ticks[i] ?? 0,
              px,
              placed.endFlush,
            );
            expect(left).toBeGreaterThanOrEqual(0);
            expect(right).toBeLessThanOrEqual(blockRight + 1e-9);
          });
          // The bar's own stroke is inside too.
          expect(placed.reserve).toBeGreaterThanOrEqual(k);
          if (room !== Infinity) expect(blockRight).toBeLessThanOrEqual(room + 1e-9);
        }
      }
      // The rendered block reserves that room (width = bar + reserve, the reserve as padding).
      const bar = scaleBarFor(0.073, { maxPx: SCALE_BAR_MAX_PX[layout.kind], units });
      const map = DATA.map;
      if (!map) throw new Error('fixture');
      const { slot, unmount } = renderPoster(size, {
        data: { ...DATA, map: { ...map, scaleBar: bar } },
      });
      const block = slot('scale')?.querySelector<HTMLElement>('[data-scale-bar]')?.parentElement;
      const placed = scaleLabelLayout(bar, k, px, 0.5 * labelPx);
      expect(parseFloat(block?.style.width ?? '')).toBeCloseTo(bar.lengthPx + placed.reserve, 6);
      expect(parseFloat(block?.style.paddingRight ?? '')).toBeCloseTo(placed.reserve, 6);
      unmount();
    }
  });

  it('ends the last label flush with the bar when the hanging unit has no room', () => {
    const bar = scaleBarFor(200 / 4500, { maxPx: 200 });
    const px = (text: string) => faceTableMeasure(SURVEY_QUAD_LABEL_FACE)(text) * 10;
    const roomy = scaleLabelLayout(bar, 1, px, 5);
    expect(roomy.endFlush).toBe(false);
    expect(roomy.reserve).toBeGreaterThan(10); // " km" hangs past the bar
    const tight = scaleLabelLayout(bar, 1, px, 5, bar.lengthPx + 5);
    expect(tight.endFlush).toBe(true);
    expect(tight.reserve).toBe(1);
    const last = bar.labels.length - 1;
    const [, right] = scaleLabelExtent(bar.labels, last, tight.ticks[last] ?? 0, px, true);
    expect(right).toBeCloseTo(bar.lengthPx + 0.5, 1); // the tick, rounded to 0.01 px
  });

  it('states the contour interval in feet in imperial units', () => {
    const map = DATA.map;
    if (!map) throw new Error('fixture');
    const withMap = renderWithUnits(
      '18x24',
      { ...DATA, map: { ...map, interval: 15.24 } },
      'imperial',
    );
    expect(withMap.slot('scale')?.lastElementChild?.textContent).toBe('CONTOUR INTERVAL 50 FEET');
    withMap.unmount();
    const without = renderWithUnits('18x24', { map: null, coordinates: null }, 'imperial');
    expect(without.slot('scale')?.textContent).toBe('CONTOUR INTERVAL 50 FEET');
  });

  it('has no axe violations', async () => {
    const { container } = renderPoster('4x5');
    await expectNoAxeViolations(container);
  });
});
