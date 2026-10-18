import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { installDialogPolyfill } from '../test/dialog';
import { immediateSchedule } from './hooks';
import type { LoadRun } from './hooks';
import { Page } from './Page';
import { SAMPLE_RUN } from './sample';
import { INITIAL_PREFS } from './state';
import type { Run } from './types';

// jsdom has no WebGL: the View's lazy TerrainView is a fake (src/test/fakeTerrainView.tsx).
vi.mock('../terrain/TerrainView', () => import('../test/fakeTerrainView'));

const h1 = (name: string) => screen.getByRole('heading', { level: 1, name });

describe('Page', () => {
  it('walks Upload → View → Poster → View → Upload with one main throughout', async () => {
    render(<Page schedule={immediateSchedule} />);
    expect(screen.getByRole('button', { name: 'About' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('banner').textContent).toContain('TRAIL RUNS AS TERRAIN');

    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    expect(h1('Make a poster')).toBeDefined();
    expect(screen.getByRole('banner').textContent).toContain('POSTER · COOSA BACKCOUNTRY TRAIL');

    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    expect(h1('Coosa Backcountry Trail')).toBeDefined();

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New file' }));
    expect(h1('Your run, as terrain.')).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('ignores New file while a run is loading: none is offered, and the load still lands in View', async () => {
    // The guard itself (`newFile` does nothing while a load is in flight) is tested in
    // hooks.test.tsx; here, the page never offers New file during a load.
    let finish!: (run: Run) => void;
    const loadRun: LoadRun = () =>
      new Promise<Run>((resolve) => {
        finish = resolve;
      });
    render(<Page loadRun={loadRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe(
      'Loading the sample run…',
    );
    expect(screen.queryByRole('button', { name: 'New file' })).toBeNull();

    await act(async () => {
      finish(SAMPLE_RUN);
      await Promise.resolve();
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('offers Cancel, not New file, while exporting (the state machine ignores NEW_FILE there)', () => {
    render(
      <Page
        schedule={immediateSchedule}
        initialRun={SAMPLE_RUN}
        initialState={{
          screen: {
            name: 'exporting',
            runId: SAMPLE_RUN.id,
            fileName: 'coosa-backcountry-loop-18x24.png',
            progress: { done: 1, total: 12 },
          },
          prefs: INITIAL_PREFS,
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'New file' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h1('Make a poster')).toBeDefined();
  });

  it('keeps the units preference: switched in View, shown on the sample chip after New file', async () => {
    render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' });
    fireEvent.click(screen.getByRole('radio', { name: 'mi' }));
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(
      screen.getByRole('button', { name: 'TRY THE SAMPLE RUN · 13.3 mi · +3,615 ft' }),
    ).toBeDefined();
  });

  it('has no axe violations in the View', async () => {
    const { container } = render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' });
    await expectNoAxeViolations(container);
  });
});

/** A drag of files over an element. Returns false when the page cancelled its dragover. */
function dragFiles(target: Element) {
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } });
  return fireEvent.dragOver(target, { dataTransfer: { types: ['Files'] } });
}

function dropFiles(target: Element, files: File[]) {
  return fireEvent.drop(target, { dataTransfer: { types: ['Files'], files } });
}

const gpxFile = (name: string) => new File(['<gpx/>'], name, { type: 'application/gpx+xml' });

/** A loader that records what it was asked for and loads the placeholder run for any file. */
function recordingLoader() {
  const sources: string[] = [];
  const loadRun: LoadRun = (source) => {
    sources.push(source.kind === 'file' ? source.file.name : 'sample');
    return Promise.resolve(
      source.kind === 'file'
        ? { ...SAMPLE_RUN, id: source.file.name, name: 'Harbour Loop' }
        : SAMPLE_RUN,
    );
  };
  return { sources, loadRun };
}

describe('Page: dropping a file on View and Poster mode', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installDialogPolyfill();
  });
  afterEach(() => {
    uninstall();
  });

  async function openSample(loadRun: LoadRun) {
    const view = render(<Page loadRun={loadRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' });
    return view;
  }

  it('shows the overlay while a file is dragged over the View, and cancels the browser’s drop', async () => {
    const { loadRun } = recordingLoader();
    await openSample(loadRun);
    expect(screen.queryByTestId('drop-frame')).toBeNull();
    const region = screen
      .getAllByRole('status')
      .find((element) => element.parentElement?.querySelector(':scope > header'));
    if (!region) throw new Error('no page status region');
    expect(region.textContent).toBe('');

    const cancelled = !dragFiles(screen.getByRole('main'));
    expect(cancelled).toBe(true);
    expect(screen.getByTestId('drop-frame')).toBeDefined();
    expect(screen.getByTestId('drop-wash')).toBeDefined();
    // The pill is drawn (aria-hidden); the page's always-present status region says its words.
    expect(screen.getByText('Drop to open a new run')).toBeDefined();
    expect(screen.getByText('Replaces Coosa Backcountry Trail')).toBeDefined();
    expect(region.textContent).toBe('Drop to open a new run. Replaces Coosa Backcountry Trail.');
    dropFiles(screen.getByRole('main'), []);
    expect(region.textContent).toBe('');
  });

  it('opens a file dropped on the View through Upload’s Dropzone, as if dropped there', async () => {
    const { sources, loadRun } = recordingLoader();
    await openSample(loadRun);
    dragFiles(screen.getByRole('main'));
    const cancelled = !dropFiles(screen.getByRole('main'), [gpxFile('harbour.gpx')]);
    expect(cancelled).toBe(true);
    expect(screen.queryByTestId('drop-frame')).toBeNull();

    expect(await screen.findByRole('heading', { level: 1, name: 'Harbour Loop' })).toBeDefined();
    expect(sources).toEqual(['sample', 'harbour.gpx']);
  });

  it('opens a file dropped in Poster mode', async () => {
    const { sources, loadRun } = recordingLoader();
    await openSample(loadRun);
    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    expect(h1('Make a poster')).toBeDefined();
    dragFiles(document.body);
    expect(screen.getByText('Drop to open a new run')).toBeDefined();
    dropFiles(document.body, [gpxFile('harbour.gpx')]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Harbour Loop' })).toBeDefined();
    expect(sources).toEqual(['sample', 'harbour.gpx']);
  });

  it('uses dropped files exactly once: New file afterwards opens an idle Upload', async () => {
    const { sources, loadRun } = recordingLoader();
    await openSample(loadRun);
    dropFiles(screen.getByRole('main'), [gpxFile('harbour.gpx')]);
    await screen.findByRole('heading', { level: 1, name: 'Harbour Loop' });

    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New file' }));
    expect(h1('Your run, as terrain.')).toBeDefined();
    const dropzone = screen.getByRole('group', { name: 'Upload a GPX file' });
    expect(dropzone.getAttribute('aria-busy')).toBeNull();
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe('');
    // Let any (wrong) second load settle before counting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(h1('Your run, as terrain.')).toBeDefined();
    expect(sources).toEqual(['sample', 'harbour.gpx']);
  });

  it('uses a rejected drop exactly once: no stale alert after the next run', async () => {
    const { loadRun } = recordingLoader();
    await openSample(loadRun);
    dropFiles(screen.getByRole('main'), [new File(['x'], 'run.fit')]);
    expect(screen.getByRole('alert')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Try the sample run' }));
    await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' });
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'New file' }));
    expect(h1('Your run, as terrain.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lands on Upload with the Dropzone’s error for a wrong file', async () => {
    const { sources, loadRun } = recordingLoader();
    await openSample(loadRun);
    dropFiles(screen.getByRole('main'), [new File(['x'], 'run.fit')]);
    expect(h1('Your run, as terrain.')).toBeDefined();
    expect(
      within(screen.getByRole('group', { name: 'Upload a GPX file' })).getByRole('alert')
        .textContent,
    ).toBe("That's a .fit file. Vert reads .gpx files in v1.");
    expect(sources).toEqual(['sample']);
  });

  it('while exporting: cancels the drop, shows no overlay and ignores the files', () => {
    const { sources, loadRun } = recordingLoader();
    render(
      <Page
        loadRun={loadRun}
        initialRun={SAMPLE_RUN}
        initialState={{
          screen: {
            name: 'exporting',
            runId: SAMPLE_RUN.id,
            fileName: 'coosa-backcountry-loop-18x24.png',
            progress: { done: 1, total: 12 },
          },
          prefs: INITIAL_PREFS,
        }}
      />,
    );
    expect(dragFiles(document.body)).toBe(false);
    expect(screen.queryByTestId('drop-frame')).toBeNull();
    expect(screen.queryByText('Drop to open a new run')).toBeNull();
    expect(dropFiles(document.body, [gpxFile('harbour.gpx')])).toBe(false);
    expect(h1('Make a poster')).toBeDefined();
    expect(sources).toEqual([]);
  });

  it('while the About dialog is open on Upload: cancels the drop, no frame, files ignored', () => {
    const { sources, loadRun } = recordingLoader();
    render(<Page loadRun={loadRun} initialAboutOpen />);
    expect(screen.getByRole('dialog', { name: 'About Vert' })).toBeDefined();
    dragFiles(document.body);
    expect(screen.queryByTestId('drop-frame')).toBeNull();
    expect(dropFiles(document.body, [gpxFile('harbour.gpx')])).toBe(false);
    expect(sources).toEqual([]);
  });

  it('has no axe violations with the overlay up', async () => {
    const { loadRun } = recordingLoader();
    const { container } = await openSample(loadRun);
    dragFiles(screen.getByRole('main'));
    await expectNoAxeViolations(container);
  });
});
