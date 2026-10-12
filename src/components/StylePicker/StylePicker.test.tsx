import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { POSTER_STYLES, StylePicker } from './StylePicker';

const noop = () => undefined;

describe('StylePicker', () => {
  it('is a radiogroup named by its label', () => {
    render(<StylePicker styles={POSTER_STYLES} value="A" onChange={noop} label="Style" />);
    expect(screen.getByRole('radiogroup', { name: 'Style' })).toBeTruthy();
  });

  it('renders one named radio per style, sharing one name', () => {
    render(<StylePicker styles={POSTER_STYLES} value="A" onChange={noop} label="Style" />);
    const group = screen.getByRole('radiogroup', { name: 'Style' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios).toHaveLength(3);
    for (const name of ['A Trail Sign', 'B Night Ridge', 'E Survey Quad']) {
      expect(within(group).getByRole('radio', { name })).toBeTruthy();
    }
    const names = new Set(radios.map((radio) => radio.name));
    expect(names.size).toBe(1);
    expect(radios[0]?.name).not.toBe('');
  });

  it('checks the radio that matches value', () => {
    const { rerender } = render(
      <StylePicker styles={POSTER_STYLES} value="A" onChange={noop} label="Style" />,
    );
    const a = screen.getByRole<HTMLInputElement>('radio', { name: 'A Trail Sign' });
    const b = screen.getByRole<HTMLInputElement>('radio', { name: 'B Night Ridge' });
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);

    rerender(<StylePicker styles={POSTER_STYLES} value="B" onChange={noop} label="Style" />);
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);
  });

  it('reports the clicked style id', () => {
    const onChange = vi.fn();
    render(<StylePicker styles={POSTER_STYLES} value="A" onChange={onChange} label="Style" />);
    fireEvent.click(screen.getByText('E Survey Quad'));
    expect(onChange).toHaveBeenLastCalledWith('E');
    fireEvent.click(screen.getByRole('radio', { name: 'B Night Ridge' }));
    expect(onChange).toHaveBeenLastCalledWith('B');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('stays controlled: selection does not move until value does', () => {
    render(<StylePicker styles={POSTER_STYLES} value="A" onChange={noop} label="Style" />);
    fireEvent.click(screen.getByRole('radio', { name: 'E Survey Quad' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'A Trail Sign' }).checked).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'E Survey Quad' }).checked).toBe(
      false,
    );
  });

  it('uses the given name for the radios', () => {
    render(
      <StylePicker
        styles={POSTER_STYLES}
        value="A"
        onChange={noop}
        label="Style"
        name="poster-style"
      />,
    );
    for (const radio of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(radio.name).toBe('poster-style');
    }
  });

  it('hides the decorative swatch hints from assistive tech', () => {
    const { container } = render(
      <StylePicker styles={POSTER_STYLES} value="A" onChange={noop} label="Style" />,
    );
    const svgs = container.querySelectorAll('svg');
    // Three terrain hints plus the selected option's check badge.
    expect(svgs).toHaveLength(4);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('marks only the selected swatch with the check badge, and moves it with value', () => {
    const { container, rerender } = render(
      <StylePicker styles={POSTER_STYLES} value="A" onChange={noop} label="Style" />,
    );
    const markedOption = () => {
      const marks = container.querySelectorAll('[data-selected-mark]');
      expect(marks).toHaveLength(1);
      const mark = marks[0];
      expect(mark?.getAttribute('aria-hidden')).toBe('true');
      return mark?.closest('label')?.querySelector('input')?.value;
    };
    expect(markedOption()).toBe('A');
    rerender(<StylePicker styles={POSTER_STYLES} value="B" onChange={noop} label="Style" />);
    expect(markedOption()).toBe('B');
    // The badge adds no text to the radio's accessible name.
    expect(screen.getByRole('radio', { name: 'B Night Ridge' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <StylePicker styles={POSTER_STYLES} value="B" onChange={noop} label="Style" />,
    );
    await expectNoAxeViolations(container);
  });
});
