import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import { expectNoAxeViolations } from '../test/axe';
import type { NightRidgeFigureData } from './figures';
import { NightRidgePoster, nightRidgeAriaLabel } from './NightRidgePoster';
import { ridgeExaggeration } from './ridges';
import type { RidgeFigure } from './ridges';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { NIGHT_RIDGE_PALETTE } from './styles';
import { posterContentFromRun } from './types';

/** WCAG 2 contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const NAME = SAMPLE_RUN.name;
const ALL = { distance: true, vert: true, time: true, highPoint: true };

const RIDGES: RidgeFigure = {
  width: 600,
  height: 300,
  rows: [
    { fill: 'M0,200L600,200L600,250L0,250Z', line: 'M0,200L600,200', opacity: 0.18 },
    { fill: 'M0,240L600,220L600,290L0,290Z', line: 'M0,240L600,220', opacity: 0.88 },
  ],
  route: 'M100,230L300,210L500,225',
  start: { x: 100, y: 230 },
  finish: null,
};

const DATA: NightRidgeFigureData = {
  ridges: RIDGES,
  sunrise: { clock: '07:31', distance: 14_800 },
  startClock: '05:42',
};

function renderPoster(
  size: PosterSizeId,
  {
    poster = {},
    prefs = {},
    data = DATA,
    figure,
  }: {
    poster?: Partial<PosterPrefs>;
    prefs?: Partial<typeof INITIAL_PREFS>;
    data?: NightRidgeFigureData | null;
    figure?: ReactNode;
  } = {},
) {
  const content = posterContentFromRun(SAMPLE_RUN, {
    ...INITIAL_PREFS,
    ...prefs,
    poster: { ...INITIAL_PREFS.poster, stats: ALL, ...poster },
  });
  const result = render(
    <NightRidgePoster
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

describe('NightRidgePoster', () => {
  it('is one image named by the poster summary; the drawn text is hidden', () => {
    const { root } = renderPoster('18x24');
    expect(root.getAttribute('aria-label')).toBe(
      `Poster: ${NAME}, SAT · 2026-10-03. Distance 21.5 km, vert +1,092 m, time 3:04:53, high point 1,267 m. Sample data. Start 05:42. Sunrise 07:31 at km 14.8. Elevation ×2.4.`,
    );
    expect(root.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(root.dataset.style).toBe('B');
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

  it('sets the Night Ridge palette on the root', () => {
    const { root } = renderPoster('18x24');
    expect(root.style.getPropertyValue('--nr-paper')).toBe(NIGHT_RIDGE_PALETTE.paper);
    expect(root.style.getPropertyValue('--nr-ink')).toBe(NIGHT_RIDGE_PALETTE.ink);
    expect(root.style.getPropertyValue('--nr-route')).toBe(NIGHT_RIDGE_PALETTE.route);
    expect(root.style.getPropertyValue('--nr-body')).toBe('#B9D3DE');
  });

  it.each(['18x24', 'a3', '4x5', '9x16'] as const)('%s: every slot, in order', (size) => {
    const { root, slot } = renderPoster(size, { poster: { signature: '@geekplux' } });
    expect(slot('header')?.textContent).toBe('VERT');
    expect(slot('eyebrow')?.textContent).toBe('05:42 START · SAT · 2026-10-03 · SAMPLE DATA');
    expect(slot('title')?.textContent).toBe(NAME);
    expect(slot('vert')?.textContent).toBe('+1,092 m');
    expect(slot('stats')?.textContent).toBe(
      '21.5 km · 3:04:53high point 1,267 m · sunrise at km 14.8',
    );
    expect(slot('sunrise')?.textContent).toBe('SUNRISE 07:31 · KM 14.8');
    expect(slot('profile')?.textContent).toBe('0 KMSUNRISE 07:31 · KM 14.821.5 KM');
    expect(slot('footer')?.textContent).toBe('ELEVATION ×2.4@geekplux');
    const order = ['header', 'eyebrow', 'title', 'vert', 'stats', 'figure', 'profile', 'footer'];
    const found = Array.from(root.querySelectorAll<HTMLElement>('[data-slot]'), (el) =>
      el.getAttribute('data-slot'),
    ).filter((name) => name !== null && order.includes(name));
    // The figure sits in the stage before the text column; the text is laid over it.
    expect(found).toEqual([
      'header',
      'figure',
      'eyebrow',
      'title',
      'vert',
      'stats',
      'profile',
      'footer',
    ]);
  });

  it('fits the title: 104 px on print, 156 px on the share card', () => {
    expect(renderPoster('18x24').slot('title')?.style.fontSize).toBe('104px');
  });

  it('draws the ridges back to front with the paper fill, then the glowing route', () => {
    const { root } = renderPoster('18x24');
    const svg = root.querySelector('[data-figure="ridges"]');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 600 300');
    const rows = svg?.querySelectorAll('g:not([data-marker])') ?? [];
    expect(rows).toHaveLength(2);
    const [fill, line] = Array.from(rows[0]?.querySelectorAll('path') ?? []);
    expect(fill?.getAttribute('fill')).toBe(NIGHT_RIDGE_PALETTE.paper);
    expect(line?.getAttribute('stroke')).toBe('#8EC5DA');
    expect(line?.getAttribute('stroke-opacity')).toBe('0.18');
    expect(rows[1]?.querySelectorAll('path')[1]?.getAttribute('stroke-opacity')).toBe('0.88');
    const glow = svg?.querySelector('[data-route="glow"]');
    const core = svg?.querySelector('[data-route="core"]');
    expect(glow?.getAttribute('stroke-opacity')).toBe('0.35');
    expect(core?.getAttribute('stroke')).toBe('#FFD9A0');
    expect(core?.getAttribute('stroke-width')).toBe('3');
    const start = svg?.querySelector('[data-marker="start"] [data-part="ring"]');
    expect(start?.getAttribute('fill')).toBe(NIGHT_RIDGE_PALETTE.paper);
    expect(start?.getAttribute('stroke')).toBe('#FFD9A0');
  });

  it('separates each marker ring from the route it sits on, and tells finish from start by shape', () => {
    const { root } = renderPoster('18x24', {
      data: { ...DATA, ridges: { ...RIDGES, finish: { x: 500, y: 225 } } },
    });
    const part = (marker: string, name: string) =>
      root.querySelector(`[data-marker="${marker}"] [data-part="${name}"]`);
    for (const marker of ['start', 'finish']) {
      const ring = part(marker, 'ring');
      const halo = part(marker, 'halo');
      const ringColour = ring?.getAttribute('stroke') ?? '';
      // Inside the ring: its fill; outside: the paper band, then the route and its glow.
      const inside = ring?.getAttribute('fill') ?? '';
      const outside = halo?.getAttribute('stroke') ?? '';
      expect(contrast(ringColour, inside)).toBeGreaterThanOrEqual(3);
      expect(contrast(ringColour, outside)).toBeGreaterThanOrEqual(3);
      expect(contrast(outside, NIGHT_RIDGE_PALETTE.route)).toBeGreaterThanOrEqual(3);
      // The band starts where the ring's stroke ends (r 7 + 1.5) and is 3 px wide.
      expect(halo?.getAttribute('r')).toBe('10');
      expect(halo?.getAttribute('stroke-width')).toBe('3');
    }
    expect(part('start', 'dot')).toBeNull();
    const dot = part('finish', 'dot');
    expect(dot?.getAttribute('fill')).toBe(NIGHT_RIDGE_PALETTE.route);
    expect(contrast(NIGHT_RIDGE_PALETTE.route, NIGHT_RIDGE_PALETTE.paper)).toBeGreaterThan(10);
  });

  it('scales strokes 1.5× on the share card (1080 wide)', () => {
    const { root } = renderPoster('4x5');
    expect(root.querySelector('[data-route="core"]')?.getAttribute('stroke-width')).toBe('4.5');
    expect(root.querySelector('[data-route="glow"]')?.getAttribute('stroke-width')).toBe('18');
  });

  it('marks the sunrise on the profile strip with a dashed route-coloured line', () => {
    const { slot } = renderPoster('18x24');
    const line = slot('profile')?.querySelector('[data-marker="sunrise"]');
    expect(line?.getAttribute('stroke')).toBe('#FFD9A0');
    expect(line?.getAttribute('stroke-dasharray')).toBe('3 3');
    // 14.8 of 21.48 km across the 624 px strip.
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo((14_800 / 21_480) * 624, 0);
    expect(slot('profile')?.querySelector('path')?.getAttribute('stroke')).toBe('#8EC5DA');
  });

  it('has no sunrise line or label when none was computed (no timestamps)', () => {
    const { slot } = renderPoster('18x24', {
      data: { ...DATA, sunrise: null, startClock: null },
    });
    expect(slot('sunrise')).toBeNull();
    expect(slot('profile')?.querySelector('[data-marker="sunrise"]')).toBeNull();
    expect(slot('eyebrow')?.textContent).toBe('SAT · 2026-10-03 · SAMPLE DATA');
    expect(slot('stats')?.textContent).toBe('21.5 km · 3:04:53high point 1,267 m');
  });

  it('shows the fallback figure until the ridges are built', () => {
    const { slot } = renderPoster('18x24', {
      data: null,
      figure: <canvas data-testid="placeholder" />,
    });
    expect(slot('figure')?.querySelector('canvas')).not.toBeNull();
    expect(slot('figure')?.querySelector('svg')).toBeNull();
  });

  it('leaves out the stats that are switched off', () => {
    const { slot } = renderPoster('18x24', {
      poster: { stats: { distance: true, vert: false, time: false, highPoint: false } },
    });
    expect(slot('vert')).toBeNull();
    expect(slot('stats')?.textContent).toBe('21.5 kmsunrise at km 14.8');
  });

  it('puts the subtitle before the exaggeration in the footer', () => {
    const { slot } = renderPoster('18x24', { poster: { subtitle: 'Vogel SP' } });
    expect(slot('footer')?.textContent).toBe('Vogel SP · ELEVATION ×2.4VERT.GEEKPLUX.COM');
  });

  it('prints the exaggeration the ridges are drawn at, from the one function', () => {
    // Setting ×2 → drawn (and printed) ×3, in the footer and in the accessible name.
    const { root, slot } = renderPoster('18x24', { prefs: { exaggeration: 2 } });
    expect(ridgeExaggeration(2)).toBe(3);
    expect(slot('footer')?.textContent).toBe('ELEVATION ×3.0VERT.GEEKPLUX.COM');
    expect(root.getAttribute('aria-label')).toMatch(/ Elevation ×3\.0\.$/);
  });

  it('names the start time and sunrise only when they were computed', () => {
    const { root } = renderPoster('18x24', { data: { ...DATA, sunrise: null, startClock: null } });
    expect(root.getAttribute('aria-label')).toBe(
      `Poster: ${NAME}, SAT · 2026-10-03. Distance 21.5 km, vert +1,092 m, time 3:04:53, high point 1,267 m. Sample data. Elevation ×2.4.`,
    );
    expect(
      nightRidgeAriaLabel(
        { ...posterContentFromRun(SAMPLE_RUN, { ...INITIAL_PREFS, units: 'imperial' }) },
        { startClock: '05:42', sunrise: { clock: '07:31', distance: 14_800 } },
      ),
    ).toMatch(/ Start 05:42\. Sunrise 07:31 at mi 9\.2\. Elevation ×2\.4\.$/);
  });

  it('has no axe violations', async () => {
    const { container } = renderPoster('18x24');
    await expectNoAxeViolations(container);
  });
});
