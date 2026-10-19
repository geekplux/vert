import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { immediateSchedule } from '../hooks';
import type { Schedule } from '../hooks';
import { Page } from '../Page';
import { INITIAL_PREFS, INITIAL_SCREEN } from '../state';
import type { PageState, UploadScreen } from '../state';

// jsdom has no WebGL: the View's lazy TerrainView is a fake (src/test/fakeTerrainView.tsx).
vi.mock('../../terrain/TerrainView', () => import('../../test/fakeTerrainView'));

/** A scheduler the test fires by hand, so the busy state can be seen before the run loads. */
function manualSchedule() {
  const queue = new Set<() => void>();
  const schedule: Schedule = (callback) => {
    queue.add(callback);
    return () => queue.delete(callback);
  };
  const flush = async () => {
    await act(async () => {
      for (const callback of [...queue]) {
        queue.delete(callback);
        callback();
      }
      await Promise.resolve();
    });
  };
  return { schedule, flush };
}

function uploadState(screen: Partial<UploadScreen>, prefs = INITIAL_PREFS): PageState {
  return { screen: { ...INITIAL_SCREEN, ...screen }, prefs };
}

/** Upload's own region, in main (the page has another, for the drop overlay). */
const uploadStatus = () => within(screen.getByRole('main')).getByRole('status');
const dropzone = () => screen.getByRole('group', { name: 'Upload a GPX file' });
const CARD_NAME = 'Drop a .gpx file here. or click to choose one';
const NOTE = 'GPX only · up to 20 MB · from Strava, Garmin, Coros, Suunto';
const SAMPLE_LINK = { name: 'Try the sample run' };
const PREVIEW_NAME = 'TRY THE SAMPLE RUN · 21.5 km · +1,102 m';

function dropFile(file: File) {
  fireEvent.drop(dropzone(), { dataTransfer: { files: [file], types: ['Files'] } });
}

/** A drop outside the Dropzone, e.g. on the headline. */
function dropOnPage(...files: File[]) {
  const target = screen.getByRole('heading', { level: 1 });
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } });
  fireEvent.drop(target, { dataTransfer: { files, types: ['Files'] } });
}

/** The decorative frame round the viewport: aria-hidden, so not reachable by role. */
const dropFrame = () => screen.queryByTestId('drop-frame');

describe('UploadState', () => {
  it('renders the headline, intro, Dropzone, note and sample preview button', () => {
    render(<Page schedule={immediateSchedule} />);
    const main = screen.getByRole('main');

    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(
      'Your run, as terrain.',
    );
    expect(within(main).getByRole('heading', { name: 'Your run, as terrain.' })).toBeDefined();
    expect(
      within(main).getByText(
        'Drop a GPX file. See the route on real elevation, turn it around, then make a poster. Nothing you upload leaves your browser.',
      ),
    ).toBeDefined();
    expect(within(main).getByRole('group', { name: 'Upload a GPX file' })).toBeDefined();
    // The card is described by the note, so the limits are read with it.
    expect(within(main).getByRole('button', { name: CARD_NAME, description: NOTE })).toBeDefined();
    expect(within(main).getByRole('button', SAMPLE_LINK)).toBeDefined();
    expect(within(main).getByText(NOTE)).toBeDefined();

    // The preview is a button named by its chip; its image is decorative.
    const preview = within(main).getByRole('button', { name: PREVIEW_NAME });
    const image = preview.querySelector('img');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('src')).toMatch(/sample-terrain/);
    expect(within(preview).queryByRole('img')).toBeNull();
  });

  it('shows the poster styles band after the hero: label, h2, line and three static posters', () => {
    render(<Page schedule={immediateSchedule} />);
    const main = screen.getByRole('main');
    const band = within(main).getByRole('region', { name: 'Three posters from one run.' });
    // After the hero in the document.
    const preview = within(main).getByRole('button', { name: PREVIEW_NAME });
    expect(preview.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(band).getByText('Poster styles')).toBeDefined();
    expect(within(band).getByRole('heading', { level: 2 }).textContent).toBe(
      'Three posters from one run.',
    );
    expect(
      within(band).getByText(
        'Made from the sample run. Yours render in your browser, up to 18 × 24 in at 300 dpi.',
      ),
    ).toBeDefined();

    const figures = within(band).getAllByRole('figure');
    expect(figures.map((figure) => figure.querySelector('figcaption')?.textContent)).toEqual([
      'A · Trail SignOblique 3D terrain',
      'B · Night RidgeRidge lines at night',
      'E · Survey QuadTopographic contours',
    ]);
    const images = within(band).getAllByRole<HTMLImageElement>('img');
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      expect.stringMatching(/trail-sign.*\.webp$/),
      expect.stringMatching(/night-ridge.*\.webp$/),
      expect.stringMatching(/survey-quad.*\.webp$/),
    ]);
    for (const image of images) {
      expect(image.alt).toMatch(
        /^The sample run as a (Trail Sign|Night Ridge|Survey Quad) poster: /,
      );
      expect(image.getAttribute('width')).toBe('600');
      expect(image.getAttribute('height')).toBe('800');
      expect(image.getAttribute('loading')).toBe('lazy');
      expect(image.getAttribute('decoding')).toBe('async');
    }
    // Static: nothing in the band can be pressed or followed.
    expect(within(band).queryAllByRole('button')).toEqual([]);
    expect(within(band).queryAllByRole('link')).toEqual([]);
  });

  it('shows the sample chip from the sample run’s data, in the chosen units', () => {
    const { unmount } = render(<Page schedule={immediateSchedule} />);
    expect(screen.getByRole('button', { name: PREVIEW_NAME })).toBeDefined();
    unmount();

    render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({}, { ...INITIAL_PREFS, units: 'imperial' })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'TRY THE SAMPLE RUN · 13.3 mi · +3,615 ft' }),
    ).toBeDefined();
  });

  it('opens the file picker from the card', () => {
    const { container } = render(<Page schedule={immediateSchedule} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: CARD_NAME }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('goes to View when the sample preview is chosen', async () => {
    render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: PREVIEW_NAME }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('says "Loading the sample run…" when the preview is chosen', () => {
    const clock = manualSchedule();
    render(<Page schedule={clock.schedule} />);
    fireEvent.click(screen.getByRole('button', { name: PREVIEW_NAME }));
    expect(within(dropzone()).getByText('Loading the sample run…')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: PREVIEW_NAME }).disabled).toBe(
      true,
    );
  });

  it('takes a file dropped anywhere on the page, framing the page while it is dragged', async () => {
    const clock = manualSchedule();
    render(<Page schedule={clock.schedule} />);
    expect(dropFrame()).toBeNull();

    const heading = screen.getByRole('heading', { level: 1 });
    fireEvent.dragEnter(heading, { dataTransfer: { types: ['Files'] } });
    expect(
      screen.getByRole('button', { name: 'Release to open the file. Anywhere on this page works' }),
    ).toBeDefined();
    expect(dropFrame()).not.toBeNull();

    fireEvent.drop(heading, {
      dataTransfer: {
        files: [new File(['<gpx/>'], 'harbour.gpx', { type: 'application/gpx+xml' })],
        types: ['Files'],
      },
    });
    expect(dropFrame()).toBeNull();
    expect(uploadStatus().textContent).toBe('Reading harbour.gpx…');

    await clock.flush();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('shows the error for a wrong file dropped on the page in the Dropzone alert', () => {
    render(<Page schedule={immediateSchedule} />);
    dropOnPage(new File(['x'], 'run.fit'));
    expect(within(dropzone()).getByRole('alert').textContent).toBe(
      "That's a .fit file. Vert reads .gpx files in v1.",
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Your run, as terrain.' })).toBeDefined();
  });

  it('reads a file dropped on the Dropzone once, not again at the page level', () => {
    const loadRun = vi.fn(() => new Promise<never>(() => undefined));
    render(<Page loadRun={loadRun} />);
    dropFile(new File(['<gpx/>'], 'loop.gpx', { type: 'application/gpx+xml' }));
    expect(loadRun).toHaveBeenCalledTimes(1);
  });

  it('ignores drops on the page while busy', () => {
    const loadRun = vi.fn(() => new Promise<never>(() => undefined));
    render(<Page loadRun={loadRun} />);
    fireEvent.click(screen.getByRole('button', SAMPLE_LINK));
    expect(loadRun).toHaveBeenCalledTimes(1);

    dropOnPage(new File(['<gpx/>'], 'other.gpx'));
    expect(loadRun).toHaveBeenCalledTimes(1);
    expect(dropFrame()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has one main and an empty status region when idle', () => {
    render(<Page schedule={immediateSchedule} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(uploadStatus().textContent).toBe('');
  });

  it('goes to View when the sample is chosen', async () => {
    render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', SAMPLE_LINK));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Upload a GPX file' })).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('announces the sample loading, then shows View', async () => {
    const clock = manualSchedule();
    render(<Page schedule={clock.schedule} />);
    // The live region is there, empty, before its text changes (or nothing would be read out).
    const region = uploadStatus();
    expect(region.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', SAMPLE_LINK));

    expect(uploadStatus()).toBe(region);
    expect(region.textContent).toBe('Loading the sample run…');
    // The Dropzone's title and the page's announcement use the same words.
    expect(within(dropzone()).getByText('Loading the sample run…')).toBeDefined();
    expect(dropzone().getAttribute('aria-busy')).toBe('true');
    // aria-busy holds back announcements inside the Dropzone only: the region is outside it, and
    // no ancestor of it is busy, so "Loading the sample run…" is read out.
    expect(dropzone().contains(region)).toBe(false);
    expect(region.closest('[aria-busy="true"]')).toBeNull();
    expect(region.getAttribute('aria-live') ?? 'polite').toBe('polite');

    await clock.flush();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('shows busy while a file is read, then View', async () => {
    const clock = manualSchedule();
    render(<Page schedule={clock.schedule} />);
    dropFile(new File(['<gpx/>'], 'morning-loop.gpx', { type: 'application/gpx+xml' }));

    expect(uploadStatus().textContent).toBe('Reading morning-loop.gpx…');
    expect(within(dropzone()).getByText('Reading morning-loop.gpx…')).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Reading morning-loop.gpx… Parsed in your browser, nothing is uploaded',
      }).disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', SAMPLE_LINK).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: PREVIEW_NAME }).disabled).toBe(
      true,
    );

    await clock.flush();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('shows a busy state injected from outside', () => {
    render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({ busy: { kind: 'reading', fileName: 'coosa.gpx' } })}
      />,
    );
    expect(uploadStatus().textContent).toBe('Reading coosa.gpx…');
    expect(within(dropzone()).getByText('Reading coosa.gpx…')).toBeDefined();
  });

  it('shows the screen’s error in the Dropzone alert, under the card', () => {
    render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({ error: 'This file has no track points.' })}
      />,
    );
    const alert = within(dropzone()).getByRole('alert');
    expect(alert.textContent).toBe('This file has no track points.');
    expect(screen.getByRole('button', { name: CARD_NAME }).contains(alert)).toBe(false);
  });

  it('has no axe violations, idle, dragging, busy and with an error', async () => {
    const idle = render(<Page schedule={immediateSchedule} />);
    await expectNoAxeViolations(idle.container);
    fireEvent.dragEnter(screen.getByRole('heading', { level: 1 }), {
      dataTransfer: { types: ['Files'] },
    });
    expect(dropFrame()).not.toBeNull();
    await expectNoAxeViolations(idle.container);
    idle.unmount();

    const busy = render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({ busy: { kind: 'reading', fileName: 'coosa.gpx' } })}
      />,
    );
    await expectNoAxeViolations(busy.container);
    busy.unmount();

    const failed = render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({ error: 'This file has no track points.' })}
      />,
    );
    await expectNoAxeViolations(failed.container);
  });
});
