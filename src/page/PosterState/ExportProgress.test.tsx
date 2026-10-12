import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { immediateSchedule } from '../hooks';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { PageState } from '../state';
import { ExportError, buildExportJob } from './exporter';
import type { ExportJob, ExportProgressReport, ExportResult, Exporter } from './exporter';
import {
  SIMULATED_TILES,
  SIMULATED_TILE_MS,
  createSimulatedExporter,
  simulateExport,
} from './simulateExport';

// jsdom has no WebGL: the View's lazy TerrainView is a fake (src/test/fakeTerrainView.tsx).
vi.mock('../../terrain/TerrainView', () => import('../../test/fakeTerrainView'));

const PNG = 'Download PNG · 5400 × 7200';
const PDF = 'Download PDF for print';
const FILE = 'vert-coosa-backcountry-trail-trail-sign-18x24.png';

interface Call {
  job: ExportJob;
  onProgress: (progress: ExportProgressReport) => void;
  signal: AbortSignal;
  resolve: (result: ExportResult) => void;
  reject: (error: Error) => void;
}

/** An exporter the test drives by hand: progress, resolve, reject. */
function manualExporter() {
  const calls: Call[] = [];
  const exporter: Exporter = (job, onProgress, signal) =>
    new Promise<ExportResult>((resolve, reject) => {
      calls.push({ job, onProgress, signal, resolve, reject });
    });
  const last = (): Call => {
    const call = calls.at(-1);
    if (!call) throw new Error('No export started');
    return call;
  };
  return { exporter, calls, last };
}

const POSTER: PageState = {
  screen: { name: 'poster', runId: SAMPLE_RUN.id, notice: null },
  prefs: {
    ...INITIAL_PREFS,
    poster: { ...INITIAL_PREFS.poster, ...posterTextFor(SAMPLE_RUN) },
  },
};

function renderPoster(exporter: Exporter, initialState: PageState = POSTER) {
  return render(
    <Page
      schedule={immediateSchedule}
      initialRun={SAMPLE_RUN}
      initialState={initialState}
      exporter={exporter}
    />,
  );
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const status = () => screen.getByRole('status');
const progressBar = () => screen.getByRole<HTMLProgressElement>('progressbar');
const label = () => screen.getByText(/^(Rendering tile \d+ of \d+|Preparing…|Saving the file…)$/);

/** Resolves the exporter's promise and lets React apply the result. */
async function settle(callback: () => void) {
  await act(async () => {
    callback();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Exporting overlay', () => {
  it('hands the exporter the whole job, built once from the run and the preferences', () => {
    const { exporter, last } = manualExporter();
    renderPoster(exporter, {
      ...POSTER,
      prefs: {
        ...POSTER.prefs,
        units: 'imperial',
        exaggeration: 2.2,
        poster: { ...POSTER.prefs.poster, signature: '@geekplux', hideEnds: 300 },
      },
    });
    fireEvent.click(button(PNG));

    const { job } = last();
    expect(job.run).toBe(SAMPLE_RUN);
    expect(job.prefs).toMatchObject({
      units: 'imperial',
      exaggeration: 2.2,
      poster: {
        style: 'A',
        size: '18x24',
        title: 'Coosa Backcountry Trail',
        subtitle: '',
        signature: '@geekplux',
        stats: { distance: true, vert: true, time: true, highPoint: false },
        hideEnds: 300,
      },
    });
    expect(job).toMatchObject({ format: 'png', fileName: FILE });
    expect([job.size.id, job.size.width, job.size.height]).toEqual(['18x24', 5400, 7200]);
    expect(job.content.title).toBe('Coosa Backcountry Trail');
    expect(job.content.signature).toBe('@geekplux');
    // The same job buildExportJob gives for that run and those preferences.
    expect(job).toEqual(buildExportJob(SAMPLE_RUN, job.prefs, 'png', job.sources));
    // With the terrain Poster mode has, for the figures.
    expect(job.sources?.terrain.status).toBeDefined();
    expect(typeof job.sources?.loadFigureTerrain).toBe('function');
  });

  it('says Preparing… until the exporter reports its tile count', () => {
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));

    const bar = progressBar();
    // Indeterminate: no value yet.
    expect(bar.hasAttribute('value')).toBe(false);
    expect(bar.getAttribute('aria-valuetext')).toBe('Preparing');
    expect(label().textContent).toBe('Preparing…');
    expect(document.activeElement).toBe(label());

    act(() => {
      last().onProgress({ done: 0, total: 12 });
    });
    expect([progressBar().value, progressBar().max]).toEqual([0, 12]);
    expect(label().textContent).toBe('Rendering tile 1 of 12');
    // Focus stays on the label as its text changes.
    expect(document.activeElement).toBe(label());

    // The exporter may revise the total.
    act(() => {
      last().onProgress({ done: 2, total: 20 });
    });
    expect(label().textContent).toBe('Rendering tile 3 of 20');
  });

  it('appears under Download with the bar, the label and Cancel, and takes focus', () => {
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));
    act(() => {
      last().onProgress({ done: 0, total: 12 });
    });

    const bar = progressBar();
    expect([bar.value, bar.max]).toEqual([0, 12]);
    expect(bar.getAttribute('aria-valuetext')).toBe('0 of 12 tiles rendered');
    expect(label().textContent).toBe('Rendering tile 1 of 12');
    // The bar is named by the label.
    expect(bar.getAttribute('aria-labelledby')).toBe(label().id);
    expect(document.activeElement).toBe(label());
    expect(label().getAttribute('tabindex')).toBe('-1');
    expect(button('Cancel').dataset.variant).toBe('quiet');

    // Under the Download button(s), before the tiles note, in the sticky Download block.
    const block = button(PNG).parentElement;
    if (!block) throw new Error('no Download block');
    const order = Array.from(block.children);
    expect(order.indexOf(bar.parentElement as Element)).toBeGreaterThan(order.indexOf(button(PDF)));
    expect(order.indexOf(bar.parentElement as Element)).toBeLessThan(
      order.indexOf(within(block).getByText(/^Rendered in your browser in tiles/)),
    );
    // Still Poster mode under the overlay.
    expect(screen.getByRole('heading', { level: 1, name: 'Make a poster' })).toBeDefined();
  });

  it('announces only the start and the outcome of an export that ends within 2 s', async () => {
    vi.useFakeTimers();
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));
    const said = [status().textContent];
    for (const done of [0, 3, 6, 9, 12]) {
      act(() => {
        vi.advanceTimersByTime(300);
        last().onProgress({ done, total: 12 });
      });
      // The label follows every tile all the same.
      expect(label().textContent).toBe(`Rendering tile ${String(Math.min(done + 1, 12))} of 12`);
      said.push(status().textContent);
    }
    act(() => {
      last().onProgress({ done: 12, total: 12, stage: 'encode' });
    });
    expect(label().textContent).toBe('Saving the file…');
    said.push(status().textContent);
    await settle(() => {
      last().resolve({ fileName: FILE });
    });
    said.push(status().textContent);
    expect([...new Set(said)]).toEqual([`Exporting ${FILE}.`, `Saved ${FILE}.`]);

    // The 2 s timer of a finished export does not reach the next one.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(button(PNG));
    act(() => {
      last().onProgress({ done: 6, total: 12 });
    });
    expect(status().textContent).toBe(`Exporting ${FILE}.`);
  });

  it('updates the bar and label every tile, the live region at quarters after 2 s', () => {
    vi.useFakeTimers();
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));
    expect(status().textContent).toBe(`Exporting ${FILE}.`);
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(status().textContent).toBe(`Exporting ${FILE}.`);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    act(() => {
      last().onProgress({ done: 0, total: 12 });
    });
    expect(status().textContent).toBe(`Exporting ${FILE}.`);
    act(() => {
      last().onProgress({ done: 1, total: 12 });
    });
    expect(label().textContent).toBe('Rendering tile 2 of 12');
    expect(progressBar().value).toBe(1);
    expect(status().textContent).toBe(`Exporting ${FILE}.`);

    act(() => {
      last().onProgress({ done: 3, total: 12 });
    });
    expect(label().textContent).toBe('Rendering tile 4 of 12');
    expect(progressBar().value).toBe(3);
    expect(progressBar().getAttribute('aria-valuetext')).toBe('3 of 12 tiles rendered');
    expect(status().textContent).toBe('Export 25% done.');

    act(() => {
      last().onProgress({ done: 5, total: 12 });
    });
    expect(label().textContent).toBe('Rendering tile 6 of 12');
    expect(status().textContent).toBe('Export 25% done.');

    act(() => {
      last().onProgress({ done: 6, total: 12 });
    });
    expect(status().textContent).toBe('Export 50% done.');
    act(() => {
      last().onProgress({ done: 9, total: 12 });
    });
    expect(status().textContent).toBe('Export 75% done.');
    act(() => {
      last().onProgress({ done: 12, total: 12 });
    });
    expect(label().textContent).toBe('Rendering tile 12 of 12');
    expect(status().textContent).toBe('Rendered 12 of 12 tiles.');

    // Then the file is written: the label says so, the live region stays as it was.
    act(() => {
      last().onProgress({ done: 12, total: 12, stage: 'encode' });
    });
    expect(label().textContent).toBe('Saving the file…');
    expect(document.activeElement).toBe(label());
    expect([progressBar().value, progressBar().max]).toEqual([12, 12]);
    expect(progressBar().getAttribute('aria-valuetext')).toBe(
      'All 12 tiles rendered, saving the file',
    );
    expect(status().textContent).toBe('Rendered 12 of 12 tiles.');
  });

  it('disables every control that could change the output, and Back to the run', () => {
    const { exporter } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));

    const aside = screen.getByRole('complementary', { name: 'Poster settings' });
    const inputs = within(aside).getAllByRole('radio');
    inputs.push(...within(aside).getAllByRole('textbox'));
    inputs.push(...within(aside).getAllByRole('checkbox'));
    inputs.push(within(aside).getByRole('slider'));
    expect(inputs).toHaveLength(15);
    for (const input of inputs) expect((input as HTMLInputElement).matches(':disabled')).toBe(true);

    for (const name of [PNG, PDF]) {
      expect(button(name).disabled).toBe(true);
      const describedBy = button(name).getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(describedBy)?.textContent).toBe(
        'Unavailable while the poster exports.',
      );
    }
    expect(button('Back to the run').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(false);
  });

  it('Cancel aborts the export, returns to Poster mode and focuses Download', () => {
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));
    act(() => {
      last().onProgress({ done: 4, total: 12 });
    });

    fireEvent.click(button('Cancel'));
    expect(last().signal.aborted).toBe(true);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.activeElement).toBe(button(PNG));
    expect(button(PNG).disabled).toBe(false);
    expect(button(PNG).getAttribute('aria-describedby')).toBeNull();
    expect(button('Back to the run').disabled).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Title' }).matches(':disabled')).toBe(false);
    expect(status().textContent).toBe('Export cancelled.');
    expect(screen.queryByText(/^Saved /)).toBeNull();

    // A late tick from the aborted export changes nothing.
    act(() => {
      last().onProgress({ done: 5, total: 12 });
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('on completion shows "Saved <file>" with a check and focuses Download', async () => {
    const { exporter, last } = manualExporter();
    const { container } = renderPoster(exporter);
    fireEvent.click(button(PNG));
    act(() => {
      last().onProgress({ done: 12, total: 12 });
    });
    await settle(() => {
      last().resolve({ fileName: FILE });
    });

    expect(screen.queryByRole('progressbar')).toBeNull();
    const saved = screen.getByText(`Saved ${FILE}`);
    // Not colour alone: a check glyph next to the words.
    expect(saved.parentElement?.querySelector('svg[aria-hidden="true"] polyline')).not.toBeNull();
    expect(saved.parentElement?.className).not.toMatch(/failed/);
    expect(status().textContent).toBe(`Saved ${FILE}.`);
    expect(document.activeElement).toBe(button(PNG));
    await expectNoAxeViolations(container);
  });

  it('returns focus to the PDF button when the PDF export started it', async () => {
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PDF));
    expect(last().job).toMatchObject({
      fileName: 'vert-coosa-backcountry-trail-trail-sign-18x24.pdf',
      format: 'pdf',
    });
    await settle(() => {
      last().resolve({ fileName: last().job.fileName });
    });
    expect(
      screen.getByText('Saved vert-coosa-backcountry-trail-trail-sign-18x24.pdf'),
    ).toBeDefined();
    expect(document.activeElement).toBe(button(PDF));

    fireEvent.click(button(PDF));
    fireEvent.click(button('Cancel'));
    expect(document.activeElement).toBe(button(PDF));
  });

  it('clears the saved notice on the next export and on Back to the run', async () => {
    const { exporter, last } = manualExporter();
    renderPoster(exporter);
    fireEvent.click(button(PNG));
    await settle(() => {
      last().resolve({ fileName: FILE });
    });
    expect(screen.getByText(`Saved ${FILE}`)).toBeDefined();

    fireEvent.click(button(PNG));
    expect(screen.queryByText(`Saved ${FILE}`)).toBeNull();
    await settle(() => {
      last().resolve({ fileName: FILE });
    });
    expect(screen.getByText(`Saved ${FILE}`)).toBeDefined();

    fireEvent.click(button('Back to the run'));
    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });

  it('on failure shows the error with a warning glyph, announces it, and focuses Download', async () => {
    const { exporter, last } = manualExporter();
    const { container } = renderPoster(exporter);
    fireEvent.click(button(PNG));
    act(() => {
      last().onProgress({ done: 5, total: 12 });
    });
    await settle(() => {
      last().reject(new Error('WebGL context lost at tile 6'));
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
    // Internal errors get the generic message.
    const error = screen.getByText('The export failed. Try again.', { selector: 'span' });
    const notice = error.parentElement;
    expect(notice?.querySelector('svg[aria-hidden="true"] path')).not.toBeNull();
    expect(notice?.className).toMatch(/failed/);
    expect(status().textContent).toBe('The export failed. Try again.');
    expect(document.activeElement).toBe(button(PNG));
    expect(button('Back to the run').disabled).toBe(false);
    expect(screen.queryByText(/^Saved /)).toBeNull();
    await expectNoAxeViolations(container);

    // An ExportError's message is shown as is; the next export clears the notice.
    fireEvent.click(button(PNG));
    expect(screen.queryByText('The export failed. Try again.', { selector: 'span' })).toBeNull();
    await settle(() => {
      last().reject(new ExportError('This browser cannot draw a 5400 × 7200 poster.'));
    });
    expect(
      screen.getByText('This browser cannot draw a 5400 × 7200 poster.', { selector: 'span' }),
    ).toBeDefined();
    expect(status().textContent).toBe('This browser cannot draw a 5400 × 7200 poster.');
  });

  it('treats an exporter that throws synchronously as a failed export', () => {
    const exporter: Exporter = () => {
      throw new Error('boom');
    };
    renderPoster(exporter);
    return settle(() => {
      fireEvent.click(button(PNG));
    }).then(() => {
      expect(screen.getByText('The export failed. Try again.', { selector: 'span' })).toBeDefined();
      expect(document.activeElement).toBe(button(PNG));
    });
  });

  it('has no axe violations mid-export', async () => {
    const { exporter, last } = manualExporter();
    const { container } = renderPoster(exporter);
    fireEvent.click(button(PNG));
    act(() => {
      last().onProgress({ done: 3, total: 12 });
    });
    await expectNoAxeViolations(container);
  });

  it('shows a stored exporting state (stories) without starting an export', () => {
    const exporter = vi.fn<Exporter>();
    renderPoster(exporter, {
      ...POSTER,
      screen: {
        name: 'exporting',
        runId: SAMPLE_RUN.id,
        fileName: FILE,
        progress: { done: 3, total: 12 },
      },
    });
    expect(label().textContent).toBe('Rendering tile 4 of 12');
    expect(exporter).not.toHaveBeenCalled();
    // Opening on the overlay does not steal focus; only starting an export does.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button('Cancel'));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  // The simulator is passed explicitly: this test is about `simulateExport`, and must not change
  // when phase 3 points `defaultExporter` at the real pipeline.
  it('runs end to end with the simulated exporter, without downloading', async () => {
    vi.useFakeTimers();
    // A download would click a link (or open a window); the simulation must do neither.
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPoster(simulateExport);
    fireEvent.click(button(PNG));

    expect(label().textContent).toBe('Preparing…');
    act(() => {
      vi.advanceTimersByTime(SIMULATED_TILE_MS);
    });
    // The simulator reports its own tile count.
    expect(label().textContent).toBe(`Rendering tile 1 of ${String(SIMULATED_TILES)}`);
    act(() => {
      vi.advanceTimersByTime(SIMULATED_TILE_MS * 4);
    });
    expect(label().textContent).toBe('Rendering tile 5 of 12');
    await act(async () => {
      vi.advanceTimersByTime(SIMULATED_TILE_MS * 8);
      await Promise.resolve();
    });
    expect(screen.getByText(`Saved ${FILE}`)).toBeDefined();
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
    open.mockRestore();
  });
});

describe('createSimulatedExporter', () => {
  const job = buildExportJob(SAMPLE_RUN, POSTER.prefs, 'png');

  it('reports its tile count after one step, ticks one tile per step, then resolves', async () => {
    vi.useFakeTimers();
    const exporter = createSimulatedExporter(undefined, undefined, 3);
    const progress: ExportProgressReport[] = [];
    const result = exporter(job, (p) => progress.push(p), new AbortController().signal);
    expect(progress).toEqual([]);
    vi.advanceTimersByTime(SIMULATED_TILE_MS);
    expect(progress).toEqual([{ done: 0, total: 3 }]);
    vi.advanceTimersByTime(SIMULATED_TILE_MS * 2);
    expect(progress.map((p) => p.done)).toEqual([0, 1, 2]);
    vi.advanceTimersByTime(SIMULATED_TILE_MS);
    await expect(result).resolves.toEqual({ fileName: FILE });
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 });
  });

  it('stops ticking and rejects when aborted', async () => {
    vi.useFakeTimers();
    const exporter = createSimulatedExporter();
    const controller = new AbortController();
    const progress: ExportProgressReport[] = [];
    const result = exporter(job, (p) => progress.push(p), controller.signal);
    vi.advanceTimersByTime(SIMULATED_TILE_MS * 2);
    controller.abort();
    await expect(result).rejects.toThrow();
    vi.advanceTimersByTime(SIMULATED_TILE_MS * 20);
    expect(progress).toEqual([
      { done: 0, total: 12 },
      { done: 1, total: 12 },
    ]);
  });
});
