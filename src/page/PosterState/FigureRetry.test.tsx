import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FigureRetry } from './FigureRetry';
import { FigureRetryRow } from './FigureRetry';
import { FIGURE_LOADING_TEXT } from './LivePoster';

function retryWith(row: FigureRetry['row'], announcement = ''): FigureRetry {
  return {
    attempt: 0,
    onFigureStatus: () => undefined,
    retry: () => undefined,
    retryQuietly: () => undefined,
    row,
    announcement,
  };
}

function setup() {
  const focusAfter = vi.fn(() => {
    screen.getByRole('button', { name: 'Download PNG' }).focus();
  });
  const ui = (row: FigureRetry['row'], announcement?: string) => (
    <>
      <button type="button">Download PNG</button>
      <FigureRetryRow retry={retryWith(row, announcement)} focusAfter={focusAfter} />
    </>
  );
  const result = render(ui('failed'));
  return {
    focusAfter,
    rerender: (row: FigureRetry['row'], a?: string) => {
      result.rerender(ui(row, a));
    },
  };
}

describe('FigureRetryRow', () => {
  it('never drops focus to the page when the row changes or goes with focus in it', () => {
    const { focusAfter, rerender } = setup();
    screen.getByRole('button', { name: 'Try again' }).focus();

    // Asked again (Try again, Download or a relayout): the button goes, focus waits on the note.
    rerender('retrying');
    expect(document.activeElement?.textContent).toBe(FIGURE_LOADING_TEXT);
    // Failed again: back to Try again.
    rerender('failed');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
    // Drawn, straight from the failed row (a quiet retry): the row goes, focus moves on.
    rerender(null, 'Terrain loaded.');
    expect(focusAfter).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Download PNG' }));
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByText('Terrain loaded.')).toBeDefined();
  });

  it('leaves focus alone when it is elsewhere', () => {
    const { focusAfter, rerender } = setup();
    const png = screen.getByRole('button', { name: 'Download PNG' });
    png.focus();
    rerender('retrying');
    rerender(null);
    expect(focusAfter).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(png);
  });
});
