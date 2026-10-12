import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Button } from './Button';

const RotateIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </svg>
);

describe('Button', () => {
  it.each([
    ['primary', 'Make a poster'],
    ['secondary', 'New file'],
    ['quiet', 'Cancel'],
  ] as const)('renders the %s variant as a native button', (variant, text) => {
    render(<Button variant={variant}>{text}</Button>);
    const button = screen.getByRole('button', { name: text });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('data-variant')).toBe(variant);
    expect(button.getAttribute('data-size')).toBe('md');
  });

  it('exposes the icon variant’s aria-label as its accessible name', () => {
    render(
      <Button variant="icon" aria-label="Rotate view">
        <RotateIcon />
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Rotate view' });
    expect(button.getAttribute('data-variant')).toBe('icon');
  });

  it('requires aria-label on the icon variant at the type level', () => {
    // @ts-expect-error: an icon button without aria-label must not compile
    const element = <Button variant="icon">{<RotateIcon />}</Button>;
    expect(element).toBeTruthy();
  });

  it('defaults type to "button" and lets callers override it', () => {
    render(
      <>
        <Button variant="primary">Make a poster</Button>
        <Button variant="secondary" type="submit">
          Save
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Make a poster' }).getAttribute('type')).toBe(
      'button',
    );
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('submit');
  });

  it('reflects size lg', () => {
    render(
      <Button variant="primary" size="lg">
        Download PNG · 5400 × 7200
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Download PNG · 5400 × 7200' });
    expect(button.getAttribute('data-size')).toBe('lg');
  });

  it('merges a caller className and forwards native props', () => {
    render(
      <Button variant="secondary" className="extra" aria-describedby="hint" name="file">
        New file
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'New file' });
    expect(button.classList.contains('extra')).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('hint');
    expect(button.getAttribute('name')).toBe('file');
  });

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button variant="primary" ref={ref}>
        Make a poster
      </Button>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Make a poster' }));
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Make a poster
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make a poster' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is keyboard operable: focusable, and Enter/Space activate it natively', () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" onClick={onClick}>
        New file
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'New file' });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.tabIndex).toBe(0);

    // jsdom has no keyboard activation behaviour. A native <button> is activated by the browser on
    // Enter (keydown) and Space (keyup), which dispatches a click; replay that sequence.
    if (fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })) fireEvent.click(button);
    fireEvent.keyUp(button, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(button, { key: ' ', code: 'Space' });
    if (fireEvent.keyUp(button, { key: ' ', code: 'Space' })) fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('is disabled for assistive tech and ignores clicks when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" disabled onClick={onClick}>
        Make a poster
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Make a poster' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a link with the same look when given href', () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Button variant="secondary" href="#view" ref={ref}>
        Back to the run
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Back to the run' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#view');
    expect(link.getAttribute('type')).toBeNull();
    expect(link.getAttribute('data-variant')).toBe('secondary');
    expect(ref.current).toBe(link);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not allow disabled on a link at the type level', () => {
    const element = (
      // @ts-expect-error: links cannot be disabled
      <Button variant="primary" href="#poster" disabled>
        Make a poster
      </Button>
    );
    expect(element).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Make a poster</Button>
        <Button variant="secondary">New file</Button>
        <Button variant="quiet">Cancel</Button>
        <Button variant="icon" aria-label="Rotate view">
          <RotateIcon />
        </Button>
        <Button variant="primary" size="lg" disabled>
          Download PNG · 5400 × 7200
        </Button>
        <Button variant="secondary" href="#view">
          Back to the run
        </Button>
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});
