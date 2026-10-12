import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { immediateSchedule } from '../hooks';
import type { Schedule } from '../hooks';
import { Page } from '../Page';
import { INITIAL_PREFS, INITIAL_SCREEN } from '../state';
import type { PageState, UploadScreen } from '../state';

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

const dropzone = () => screen.getByRole('group', { name: /gpx file|Reading/ });

function dropFile(file: File) {
  fireEvent.drop(dropzone(), { dataTransfer: { files: [file], types: ['Files'] } });
}

describe('UploadState', () => {
  it('renders the headline, intro, Dropzone, note and sample preview', () => {
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
    expect(within(main).getByRole('group', { name: 'Drop a .gpx file here' })).toBeDefined();
    expect(within(main).getByRole('button', { name: 'choose a file' })).toBeDefined();
    expect(within(main).getByRole('button', { name: 'try a sample run' })).toBeDefined();
    expect(
      within(main).getByText(
        'GPX only in v1 · up to 20 MB · exported from Strava, Garmin, Coros, Suunto',
      ),
    ).toBeDefined();

    const image = within(main).getByRole('img', {
      name: 'Example: the sample trail run drawn as terrain, an orange loop over ridge lines',
    });
    expect(image.tagName).toBe('IMG');
    expect(image.getAttribute('src')).toMatch(/sample-terrain/);
  });

  it('shows the sample chip from the sample run’s data, in the chosen units', () => {
    const { unmount } = render(<Page schedule={immediateSchedule} />);
    expect(screen.getByText('SAMPLE · 21.5 km · +1,092 m')).toBeDefined();
    unmount();

    render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({}, { ...INITIAL_PREFS, units: 'imperial' })}
      />,
    );
    expect(screen.getByText('SAMPLE · 13.3 mi · +3,583 ft')).toBeDefined();
  });

  it('has one main and an empty status region when idle', () => {
    render(<Page schedule={immediateSchedule} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('goes to View when the sample is chosen', async () => {
    render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
    expect(screen.queryByRole('group', { name: /gpx file/ })).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('announces the sample loading, then shows View', async () => {
    const clock = manualSchedule();
    render(<Page schedule={clock.schedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));

    expect(screen.getByRole('status').textContent).toBe('Loading the sample run…');
    expect(dropzone().getAttribute('aria-busy')).toBe('true');

    await clock.flush();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' }),
    ).toBeDefined();
  });

  it('shows busy while a file is read, then View', async () => {
    const clock = manualSchedule();
    render(<Page schedule={clock.schedule} />);
    dropFile(new File(['<gpx/>'], 'morning-loop.gpx', { type: 'application/gpx+xml' }));

    expect(screen.getByRole('status').textContent).toBe('Reading morning-loop.gpx…');
    expect(screen.getByRole('group', { name: 'Reading morning-loop.gpx…' })).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'try a sample run' }).disabled,
    ).toBe(true);

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
    expect(screen.getByRole('status').textContent).toBe('Reading coosa.gpx…');
    expect(screen.getByRole('group', { name: 'Reading coosa.gpx…' })).toBeDefined();
  });

  it('shows the screen’s error in the Dropzone alert', () => {
    render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({ error: 'This file has no track points.' })}
      />,
    );
    const alert = within(dropzone()).getByRole('alert');
    expect(alert.textContent).toBe('This file has no track points.');
  });

  it('has no axe violations, idle and with an error', async () => {
    const idle = render(<Page schedule={immediateSchedule} />);
    await expectNoAxeViolations(idle.container);
    idle.unmount();

    const failed = render(
      <Page
        schedule={immediateSchedule}
        initialState={uploadState({ error: 'This file has no track points.' })}
      />,
    );
    await expectNoAxeViolations(failed.container);
  });
});
