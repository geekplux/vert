import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('renders the name as a word', () => {
    render(<Wordmark />);
    expect(screen.getByText('Vert')).toBeTruthy();
  });

  it('renders no tagline when none is given', () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toBe('Vert');
  });

  it('renders the tagline as given', () => {
    render(<Wordmark tagline="DROP A GPX. GET A POSTER." />);
    expect(screen.getByText('DROP A GPX. GET A POSTER.')).toBeTruthy();
  });

  it('is not a heading', () => {
    render(<Wordmark tagline="TRAIL RUNS AS TERRAIN" />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('accepts a className', () => {
    const { container } = render(<Wordmark className="extra" />);
    expect(container.firstElementChild?.classList.contains('extra')).toBe(true);
  });

  it('is plain text, not a link, without `link`', () => {
    render(<Wordmark tagline="TRAIL RUNS AS TERRAIN" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('with `link`, makes the name (not the tagline) a link with the given name and click', () => {
    const onClick = vi.fn();
    render(
      <Wordmark
        tagline="DROP A GPX. GET A POSTER."
        link={{ href: '/', label: 'Vert, home', onClick }}
      />,
    );
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: 'Vert, home' });
    expect(link.getAttribute('href')).toBe('/');
    expect(link.textContent).toBe('Vert');
    expect(link.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.getByText('DROP A GPX. GET A POSTER.').closest('a')).toBeNull();
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('marks a disabled link aria-disabled and keeps it focusable', () => {
    render(<Wordmark link={{ href: '/', label: 'Vert, home', disabled: true }} />);
    const link = screen.getByRole('link', { name: 'Vert, home' });
    expect(link.getAttribute('aria-disabled')).toBe('true');
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Wordmark tagline="POSTER · CHATTAHOOCHEE LOOP" />);
    await expectNoAxeViolations(container);
  });

  it('has no axe violations as a link', async () => {
    const { container } = render(
      <Wordmark tagline="POSTER · CHATTAHOOCHEE LOOP" link={{ href: '/', label: 'Vert, home' }} />,
    );
    await expectNoAxeViolations(container);
  });
});
