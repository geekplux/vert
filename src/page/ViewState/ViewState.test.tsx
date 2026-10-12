import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { immediateSchedule } from '../hooks';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS } from '../state';
import type { PageState, Prefs } from '../state';
import type { Run } from '../types';

// jsdom has no WebGL: the View's lazy TerrainView is a fake (src/test/fakeTerrainView.tsx).
vi.mock('../../terrain/TerrainView', () => import('../../test/fakeTerrainView'));

const ROUTE = 'Coosa Backcountry Trail';

function viewState(prefs: Partial<Prefs> = {}): PageState {
  return {
    screen: { name: 'view', runId: SAMPLE_RUN.id },
    prefs: { ...INITIAL_PREFS, ...prefs },
  };
}

function renderView(prefs: Partial<Prefs> = {}, run: Run = SAMPLE_RUN) {
  return render(
    <Page schedule={immediateSchedule} initialRun={run} initialState={viewState(prefs)} />,
  );
}

const aside = () => screen.getByRole('complementary', { name: 'Run details' });
const main = () => screen.getByRole('main');
const profile = () => screen.getByRole('slider', { name: 'Elevation profile' });
const exaggeration = () => screen.getByRole('slider', { name: 'Vertical exaggeration' });
const elevationSection = () => screen.getByRole('region', { name: /^Elevation · / });

/** The stat grid as "label: value" pairs, in order. */
function stats(): string[] {
  const grid = aside().querySelector('dl');
  if (!grid) throw new Error('no stat grid');
  return [...grid.querySelectorAll('dt')].map(
    (term) => `${term.textContent}: ${term.nextElementSibling?.textContent ?? ''}`,
  );
}

function climbRows(): string[] {
  const list = within(screen.getByRole('region', { name: 'Climbs' })).getByRole('list');
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [...item.children].map((cell) => cell.textContent).join(' | '));
}

const readout = () => elevationSection().querySelector('p')?.textContent;

/**
 * Waits until focus is on the h1 named `name`, re-querying it on every try: the page moves focus in
 * an effect after the screen changes, and a remount (the View is keyed by run) replaces the
 * element, so a reference taken earlier could never match. A generous timeout: under the full,
 * parallel suite the lazy View can take more than the default second to settle.
 */
async function expectHeadingFocused(name: string) {
  await waitFor(
    () => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name }));
    },
    { timeout: 5000 },
  );
}

describe('ViewState', () => {
  it('renders every element of DESIGN-SPEC §3 "02 View" from the run’s data', () => {
    renderView();

    // Aside: date line with the SAMPLE DATA tag, route name, stats, climbs, slider, help.
    expect(
      within(aside())
        .getByText(/^SAT · 2026-10-03/)
        .closest('p')?.textContent,
    ).toBe('SAT · 2026-10-03 · SAMPLE DATA');
    expect(within(aside()).getByText('SAMPLE DATA').tagName).toBe('SPAN');
    expect(within(aside()).getByRole('heading', { level: 1, name: ROUTE })).toBeDefined();
    expect(stats()).toEqual([
      'Distance: 21.5 km',
      'Vert: +1,102 m',
      'Moving time: 3:04:58',
      'High point: 1,267 m',
    ]);
    expect(climbRows()).toEqual([
      '1 | km 5.6 → 8.4 | +230 m',
      '2 | km 10.7 → 13.7 · steepest | +564 m',
      '3 | km 16.8 → 19.0 | +257 m',
    ]);
    const slider = exaggeration();
    expect(slider.getAttribute('min')).toBe('1');
    expect(slider.getAttribute('max')).toBe('3');
    expect(slider.getAttribute('step')).toBe('0.1');
    expect((slider as HTMLInputElement).value).toBe('1.6');
    // Spoken "1.6 times"; the visible value stays "1.6×".
    expect(slider.getAttribute('aria-valuetext')).toBe('1.6 times');
    expect(within(aside()).getByText('1.6×')).toBeDefined();
    expect(
      within(aside()).getByText(
        'Drag the terrain to orbit. Scrub the profile to move the runner along the route. Your file stays in this browser.',
      ),
    ).toBeDefined();

    // Main: the terrain box (loading here: placeholder mode never builds a terrain; the live view
    // is tested in TerrainBox.test.tsx), legend and buttons; the elevation section.
    expect(within(main()).getByRole('status').textContent).toBe('Loading terrain…');
    expect(within(main()).queryByRole('img')).toBeNull();
    expect(within(main()).getByText('Start / finish')).toBeDefined();
    expect(within(main()).getByText('Summit 1,267 m')).toBeDefined();
    expect(within(main()).getByText('Vertical ×1.6')).toBeDefined();
    expect(within(main()).getByRole('button', { name: 'Rotate view' })).toBeDefined();
    expect(
      within(main()).getByRole('button', { name: 'Flat map' }).getAttribute('aria-pressed'),
    ).toBe('false');

    expect(within(main()).getByRole('heading', { name: 'Elevation · 616–1,267 m' })).toBeDefined();
    // Default scrub: the steepest climb's midpoint, km 12.2; pace from the track's timestamps.
    expect(readout()).toBe('km 12.2 · 898 m · grade 24% · 8:37 /km');
    expect(profile().getAttribute('aria-valuetext')).toBe('km 12.2, 898 m, grade 24%, 8:37 /km');
  });

  it('leaves the SAMPLE DATA tag off a run from the user’s own file', () => {
    renderView({}, { ...SAMPLE_RUN, isSample: false });
    expect(
      within(aside())
        .getByText(/^SAT · /)
        .closest('p')?.textContent,
    ).toBe('SAT · 2026-10-03');
    expect(screen.queryByText('SAMPLE DATA')).toBeNull();
  });

  it('degrades for a file without timestamps: no date, moving time "–", no pace', () => {
    const timeless: Run = {
      ...SAMPLE_RUN,
      isSample: false,
      hasTime: false,
      startTime: Number.NaN,
      movingTime: Number.NaN,
      elapsedTime: Number.NaN,
      track: { ...SAMPLE_RUN.track, time: null },
    };
    renderView({}, timeless);
    expect(within(aside()).queryByText(/^SAT · /)).toBeNull();
    expect(aside().querySelector('p')?.textContent).not.toMatch(/·/);
    expect(stats()).toContain('Moving time: –');
    expect(readout()).toBe('km 12.2 · 898 m · grade 24%');
    expect(profile().getAttribute('aria-valuetext')).toBe('km 12.2, 898 m, grade 24%');
  });

  it('shows only the SAMPLE DATA tag for a timeless sample', () => {
    renderView({}, { ...SAMPLE_RUN, hasTime: false, startTime: Number.NaN });
    expect(within(aside()).getByText('SAMPLE DATA').closest('p')?.textContent).toBe('SAMPLE DATA');
  });

  it('shows "–" and no ▲ for a file without elevations until the terrain supplies them', () => {
    renderView(
      {},
      {
        ...SAMPLE_RUN,
        hasElevation: false,
        elevationSource: null,
        vert: Number.NaN,
        descent: Number.NaN,
        highPoint: Number.NaN,
        lowPoint: Number.NaN,
        profile: [],
        climbs: [],
      },
    );
    expect(stats()).toEqual(expect.arrayContaining(['Vert: –', 'High point: –']));
    expect(within(main()).getByRole('heading', { name: 'Elevation · –' })).toBeDefined();
    expect(within(aside()).getByRole('status').textContent).toBe(
      'This file has no usable elevation. Reading it from the terrain…',
    );
    expect(within(main()).queryByText(/Summit/)).toBeNull();
  });

  it('says in plain words when the elevations come from the terrain', () => {
    renderView({}, { ...SAMPLE_RUN, elevationSource: 'terrain' });
    expect(within(aside()).getByRole('status').textContent).toBe(
      'Elevation from terrain data. This file has no usable elevation.',
    );
    expect(stats()).toContain('Vert: +1,102 m');
  });

  it('draws no summit in the legend for a flat run, and says nothing about the source', () => {
    renderView({}, { ...SAMPLE_RUN, highPoint: 1.2, lowPoint: 0.3 });
    expect(within(main()).queryByText(/Summit/)).toBeNull();
    expect(within(aside()).queryByRole('status')).toBeNull();
  });

  it('lists climbs as an ordered list and marks the steepest in words, not only shading', () => {
    renderView();
    const region = screen.getByRole('region', { name: 'Climbs' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Climbs' })).toBeDefined();
    const list = within(region).getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.textContent.includes('steepest'))).toEqual([items[1]]);
  });

  it('says so when the run has no climbs', () => {
    renderView({}, { ...SAMPLE_RUN, climbs: [] });
    const region = screen.getByRole('region', { name: 'Climbs' });
    expect(within(region).queryByRole('list')).toBeNull();
    expect(within(region).getByText('No sustained climbs.')).toBeDefined();
  });

  it('sets the exaggeration preference from the slider and shows it in the legend', () => {
    renderView();
    fireEvent.change(exaggeration(), { target: { value: '2.3' } });
    expect((exaggeration() as HTMLInputElement).value).toBe('2.3');
    expect(exaggeration().getAttribute('aria-valuetext')).toBe('2.3 times');
    expect(within(aside()).getByText('2.3×')).toBeDefined();
    expect(within(main()).getByText('Vertical ×2.3')).toBeDefined();
    expect(screen.queryByText('Vertical ×1.6')).toBeNull();
  });

  it('switches stats, climbs, legend and profile header with the units toggle', () => {
    renderView();
    fireEvent.click(within(screen.getByRole('banner')).getByRole('radio', { name: 'mi' }));

    expect(stats()).toEqual([
      'Distance: 13.3 mi',
      'Vert: +3,615 ft',
      'Moving time: 3:04:58',
      'High point: 4,157 ft',
    ]);
    expect(climbRows()).toEqual([
      '1 | mi 3.5 → 5.2 | +755 ft',
      '2 | mi 6.6 → 8.5 · steepest | +1,850 ft',
      '3 | mi 10.4 → 11.8 | +843 ft',
    ]);
    expect(within(main()).getByText('Summit 4,157 ft')).toBeDefined();
    expect(
      within(main()).getByRole('heading', { name: 'Elevation · 2,021–4,157 ft' }),
    ).toBeDefined();
    expect(readout()).toBe('mi 7.6 · 2,946 ft · grade 24% · 13:51 /mi');

    fireEvent.click(within(screen.getByRole('banner')).getByRole('radio', { name: 'km' }));
    expect(stats()[0]).toBe('Distance: 21.5 km');
  });

  it('starts in imperial when the preference says so', () => {
    renderView({ units: 'imperial' });
    expect(stats()[0]).toBe('Distance: 13.3 mi');
  });

  it('updates the scrub readout from the profile’s keyboard input', () => {
    renderView();
    fireEvent.keyDown(profile(), { key: 'Home' });
    expect(readout()).toBe('km 0.0 · 709 m · grade 1% · 8:37 /km');
    fireEvent.keyDown(profile(), { key: 'End' });
    expect(readout()).toMatch(/^km 21\.5 · 709 m · grade /);
    fireEvent.keyDown(profile(), { key: 'Home' });
    fireEvent.keyDown(profile(), { key: 'ArrowRight', shiftKey: true });
    expect(readout()).toMatch(/^km 2\.1 · /);
    expect(profile().getAttribute('aria-valuetext')).toMatch(/^km 2\.1, /);
  });

  it('keeps Flat map (a toggle) and Rotate view (a plain button) inert while the terrain loads', () => {
    renderView();
    const flat = within(main()).getByRole('button', { name: 'Flat map' });
    const rotate = within(main()).getByRole('button', { name: 'Rotate view' });
    expect(flat.getAttribute('aria-pressed')).toBe('false');
    expect(rotate.hasAttribute('aria-pressed')).toBe(false);
    for (const button of [flat, rotate]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
    const reason = document.getElementById(flat.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('Loading terrain…');
    fireEvent.click(flat);
    expect(flat.getAttribute('aria-pressed')).toBe('false');
  });

  it('moves focus to the route name when the View opens, and to Upload’s h1 on New file', async () => {
    render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    await expectHeadingFocused(ROUTE);
    expect(screen.getByRole('heading', { level: 1, name: ROUTE }).getAttribute('tabindex')).toBe(
      '-1',
    );

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New file' }));
    await expectHeadingFocused('Your run, as terrain.');
  });

  it('does not steal focus on first render', () => {
    renderView();
    expect(document.activeElement).toBe(document.body);
  });

  it('goes to Poster mode with Make a poster, and focuses its h1', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    await expectHeadingFocused('Make a poster');

    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    await expectHeadingFocused(ROUTE);
  });

  it('goes back to Upload with New file', () => {
    renderView();
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New file' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your run, as terrain.' })).toBeDefined();
    expect(screen.queryByRole('complementary', { name: 'Run details' })).toBeNull();
  });

  it('has one main, and the aside before it in the DOM', () => {
    renderView();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(aside().compareDocumentPosition(main()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no axe violations, metric and imperial', async () => {
    const metric = renderView();
    await expectNoAxeViolations(metric.container);
    metric.unmount();

    const imperial = renderView({ units: 'imperial' });
    await expectNoAxeViolations(imperial.container);
  });
});
