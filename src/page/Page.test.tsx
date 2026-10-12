import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { immediateSchedule } from './hooks';
import type { LoadRun } from './hooks';
import { Page } from './Page';
import { SAMPLE_RUN } from './sample';
import { INITIAL_PREFS } from './state';
import type { Run } from './types';

const h1 = (name: string) => screen.getByRole('heading', { level: 1, name });

describe('Page', () => {
  it('walks Upload → View → Poster → View → Upload with one main throughout', async () => {
    render(<Page schedule={immediateSchedule} />);
    expect(screen.getByRole('button', { name: 'About' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    expect(screen.getByRole('status').textContent).toBe('Loading the sample run…');
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
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' });
    fireEvent.click(screen.getByRole('radio', { name: 'mi' }));
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(screen.getByText('SAMPLE · 13.3 mi · +3,583 ft')).toBeDefined();
  });

  it('has no axe violations in the View', async () => {
    const { container } = render(<Page schedule={immediateSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    await screen.findByRole('heading', { level: 1, name: 'Coosa Backcountry Trail' });
    await expectNoAxeViolations(container);
  });
});
