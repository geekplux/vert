import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { App } from './App';

describe('App', () => {
  it('renders the Upload header: tagline, About and GitHub', () => {
    render(<App />);
    const banner = screen.getByRole('banner');
    expect(banner.textContent).toContain('DROP A GPX. GET A POSTER.');
    expect(screen.getByRole('button', { name: 'About' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeDefined();
  });

  it('renders one main with the page heading', () => {
    render(<App />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Your run, as terrain.' })).toBeDefined();
  });

  it('has no axe violations', async () => {
    const { container } = render(<App />);
    await expectNoAxeViolations(container);
  });
});
