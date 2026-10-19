import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { AppHeader } from './AppHeader';
import { PosterNav } from './PosterNav';
import { UploadNav } from './UploadNav';
import { ViewNav } from './ViewNav';

function viewNavProps() {
  return {
    units: 'metric' as const,
    onUnitsChange: vi.fn(),
    onNewFile: vi.fn(),
    onMakePoster: vi.fn(),
  };
}

describe('AppHeader', () => {
  it('is the banner landmark with the wordmark', () => {
    render(<AppHeader state="upload" />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Vert')).toBeDefined();
    expect(within(banner).queryByRole('heading')).toBeNull();
  });

  it('shows the tagline for each state', () => {
    const { rerender } = render(<AppHeader state="upload" />);
    expect(screen.getByText('DROP A GPX. GET A POSTER.')).toBeDefined();

    rerender(<AppHeader state="view" />);
    expect(screen.getByText('TRAIL RUNS AS TERRAIN')).toBeDefined();

    rerender(<AppHeader state="poster" routeName="Coosa Backcountry Trail" />);
    expect(screen.getByText('POSTER · COOSA BACKCOUNTRY TRAIL')).toBeDefined();
  });

  it('renders its children on the right', () => {
    render(
      <AppHeader state="poster" routeName="Loop">
        <PosterNav onBack={vi.fn()} />
      </AppHeader>,
    );
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: 'Back to the run' })).toBeDefined();
  });
});

describe('AppHeader home link', () => {
  /** Clicks the wordmark link; returns whether the click's default (following "/") was prevented. */
  function clickHome(init: MouseEventInit = {}) {
    const link = screen.getByRole('link', { name: 'Vert, home' });
    return !fireEvent.click(link, { button: 0, ...init });
  }

  it('is plain text without onHome', () => {
    render(<AppHeader state="view" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(within(screen.getByRole('banner')).getByText('Vert')).toBeDefined();
  });

  it('makes the name a link to "/" named "Vert, home"; the tagline stays outside it', () => {
    render(<AppHeader state="upload" onHome={vi.fn()} />);
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: 'Vert, home' });
    expect(link.getAttribute('href')).toBe('/');
    expect(link.textContent).toBe('Vert');
    expect(screen.getByText('DROP A GPX. GET A POSTER.').closest('a')).toBeNull();
  });

  it('handles a plain primary click itself: prevents the navigation and calls onHome', () => {
    const onHome = vi.fn();
    render(<AppHeader state="view" onHome={onHome} />);
    expect(clickHome()).toBe(true);
    expect(onHome).toHaveBeenCalledOnce();
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('leaves a %s click to the browser (a new tab or window)', (_name, init) => {
    const onHome = vi.fn();
    render(<AppHeader state="view" onHome={onHome} />);
    expect(clickHome(init)).toBe(false);
    expect(onHome).not.toHaveBeenCalled();
  });

  it('with homeDisabled: stays a focusable link, ignores a plain click, and does not leave', () => {
    const onHome = vi.fn();
    render(<AppHeader state="poster" routeName="Loop" onHome={onHome} homeDisabled />);
    const link = screen.getByRole('link', { name: 'Vert, home' });
    expect(link.getAttribute('aria-disabled')).toBe('true');
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(clickHome()).toBe(true);
    expect(onHome).not.toHaveBeenCalled();
  });
});

describe('UploadNav', () => {
  it('has About as a button and GitHub as a link, in a named nav', () => {
    render(<UploadNav onAbout={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Site' });
    expect(within(nav).getByRole('button', { name: 'About' })).toBeDefined();
    const github = within(nav).getByRole<HTMLAnchorElement>('link', { name: 'GitHub' });
    expect(github.getAttribute('href')).toBe('https://github.com/geekplux');
  });

  it('calls onAbout', () => {
    const onAbout = vi.fn();
    render(<UploadNav onAbout={onAbout} />);
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(onAbout).toHaveBeenCalledOnce();
  });
});

describe('ViewNav', () => {
  it('has the Units group and both buttons', () => {
    render(<ViewNav {...viewNavProps()} />);
    expect(screen.getByRole('radiogroup', { name: 'Units' })).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'km' }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'mi' }).checked).toBe(false);
    expect(screen.getByRole('button', { name: 'New file' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Make a poster' })).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('calls its callbacks', () => {
    const props = viewNavProps();
    render(<ViewNav {...props} />);
    fireEvent.click(screen.getByRole('radio', { name: 'mi' }));
    expect(props.onUnitsChange).toHaveBeenCalledWith('imperial');
    fireEvent.click(screen.getByRole('button', { name: 'New file' }));
    expect(props.onNewFile).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    expect(props.onMakePoster).toHaveBeenCalledOnce();
  });
});

describe('PosterNav', () => {
  it('calls onBack', () => {
    const onBack = vi.fn();
    render(<PosterNav onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the run' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('AppHeader accessibility', () => {
  it('has no axe violations in each state', async () => {
    const upload = render(
      <AppHeader state="upload" onHome={vi.fn()}>
        <UploadNav onAbout={vi.fn()} />
      </AppHeader>,
    );
    await expectNoAxeViolations(upload.container);
    upload.unmount();

    const view = render(
      <AppHeader state="view" onHome={vi.fn()}>
        <ViewNav {...viewNavProps()} />
      </AppHeader>,
    );
    await expectNoAxeViolations(view.container);
    view.unmount();

    const poster = render(
      <AppHeader state="poster" routeName="Loop" onHome={vi.fn()} homeDisabled>
        <PosterNav onBack={vi.fn()} disabled />
      </AppHeader>,
    );
    await expectNoAxeViolations(poster.container);
  });
});
