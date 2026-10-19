import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { installDialogPolyfill } from '../../test/dialog';
import { immediateSchedule } from '../hooks';
import { Page } from '../Page';

let uninstall: () => void;
beforeEach(() => {
  uninstall = installDialogPolyfill();
});
afterEach(() => {
  uninstall();
});

function openAbout() {
  render(<Page schedule={immediateSchedule} />);
  const about = screen.getByRole('button', { name: 'About' });
  about.focus();
  fireEvent.click(about);
  return { about, dialog: screen.getByRole('dialog', { name: 'About Vert' }) };
}

describe('AboutDialog', () => {
  it('is closed until About is pressed', () => {
    render(<Page schedule={immediateSchedule} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal with its content and moves focus into it', () => {
    const { dialog } = openAbout();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));

    expect(dialog.textContent).toContain('one GPX file into 3D terrain, then into a poster');
    expect(dialog.textContent).toContain(
      'Your file is read in this browser. Nothing is uploaded. Only elevation tiles are fetched, by tile number.',
    );
    expect(dialog.textContent).toContain(
      'Elevation: AWS Terrain Tiles / Mapzen (various sources).',
    );
    // The elevation credit links the list of the tiles' sources (docs/INTEGRATION.md).
    const credit = within(dialog).getByRole('link', {
      name: 'AWS Terrain Tiles / Mapzen (various sources)',
    });
    expect(credit.getAttribute('href')).toBe(
      'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
    );
    expect(credit.hasAttribute('target')).toBe(false);
    expect(dialog.textContent).toContain('Sample route: © OpenStreetMap contributors, ODbL.');
    expect(dialog.textContent).toContain('Type: Archivo and IBM Plex Mono (SIL OFL).');
    const github = within(dialog).getByRole('link', { name: 'geekplux on GitHub' });
    expect(github.getAttribute('href')).toBe('https://github.com/geekplux');
  });

  it('closes with the Close button and returns focus to About', () => {
    const { about, dialog } = openAbout();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(about);
  });

  it('closes with Esc and returns focus to About', () => {
    const { about } = openAbout();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(about);
  });

  // A browser restores focus itself, then fires `close` as a queued task. A quick Tab in between
  // moves focus on; the late `close` must not pull it back to About.
  it('leaves focus alone when it has moved on before the close event', () => {
    const { about, dialog } = openAbout();
    const github = screen.getByRole('link', { name: 'GitHub' });
    dialog.removeAttribute('open');
    github.focus();
    fireEvent(dialog, new Event('close'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(github);
    expect(document.activeElement).not.toBe(about);
  });

  it('returns focus to About when the browser left it on <body>', () => {
    const { about, dialog } = openAbout();
    (document.activeElement as HTMLElement | null)?.blur();
    dialog.removeAttribute('open');
    expect(document.activeElement).toBe(document.body);
    fireEvent(dialog, new Event('close'));
    expect(document.activeElement).toBe(about);
  });

  it('opens again after closing', () => {
    const { about } = openAbout();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(about);
    expect(screen.getByRole('dialog', { name: 'About Vert' })).toBeDefined();
  });

  it('has no axe violations while open', async () => {
    const { dialog } = openAbout();
    await expectNoAxeViolations(dialog);
  });
});
