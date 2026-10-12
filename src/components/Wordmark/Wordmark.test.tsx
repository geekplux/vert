import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('has no axe violations', async () => {
    const { container } = render(<Wordmark tagline="POSTER · CHATTAHOOCHEE LOOP" />);
    await expectNoAxeViolations(container);
  });
});
