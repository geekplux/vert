import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { POSTER_SIZES, SizePicker, sizeDetail, type PosterSizeId } from './SizePicker';

const POSTER_18X24 = '18 × 24 in, print · 5400 × 7200';
const A3 = 'A3, print · 3508 × 4961';
const SOCIAL = '4 : 5, social · 1080 × 1350';
const STORY = '9 : 16, story · 1080 × 1920';
const FULL_NAMES = [POSTER_18X24, A3, SOCIAL, STORY];

const noop = (): void => undefined;

/**
 * Matches a radio's accessible name, which comes from its label: "18 × 24 in", a visually hidden
 * ", ", a line break, then the sub-line. Chromium reads "18 × 24 in, print · 5400 × 7200"; jsdom's
 * accname drops the space after the comma, so whitespace is normalised before comparing.
 */
function named(expected: string): (accessibleName: string) => boolean {
  return (accessibleName) => accessibleName.replace(/,\s*/, ', ') === expected;
}

function radio(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('radio', { name: named(name) });
}

function Controlled({ initial = '18x24' }: { initial?: PosterSizeId }) {
  const [value, setValue] = useState<PosterSizeId>(initial);
  return <SizePicker sizes={POSTER_SIZES} value={value} onChange={setValue} label="Size" />;
}

describe('SizePicker', () => {
  it('renders a radiogroup named by its label', () => {
    render(<SizePicker sizes={POSTER_SIZES} value="18x24" onChange={noop} label="Size" />);
    expect(screen.getByRole('radiogroup', { name: 'Size' })).toBeTruthy();
  });

  it('renders four native radios in order, each named by its label: size and pixel target', () => {
    render(<SizePicker sizes={POSTER_SIZES} value="18x24" onChange={noop} label="Size" />);
    const group = screen.getByRole('radiogroup', { name: 'Size' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios).toHaveLength(4);
    // The visible label names the radio; no aria-label repeating it.
    for (const input of radios) {
      expect(input.hasAttribute('aria-label')).toBe(false);
      expect(input.labels?.[0]?.textContent).toMatch(/·/);
    }
    for (const [index, name] of FULL_NAMES.entries()) {
      expect(screen.getByRole('radio', { name: named(name) })).toBe(radios[index]);
      expect(radios[index]?.type).toBe('radio');
    }
    // One shared name, so the browser gives the group one tab stop and arrow-key selection.
    expect(new Set(radios.map((input) => input.name)).size).toBe(1);
  });

  it('shows the name and a derived sub-line for each size', () => {
    render(<SizePicker sizes={POSTER_SIZES} value="18x24" onChange={noop} label="Size" />);
    /** The sub-line is split into unbreakable parts; match the element holding all of it. */
    const subLine = (text: string) =>
      screen.getByText(
        (_, element) => element?.tagName === 'SPAN' && element.textContent === text,
        { ignore: false },
      );
    expect(screen.getByText('18 × 24 in')).toBeTruthy();
    expect(subLine('print · 5400 × 7200')).toBeTruthy();
    expect(screen.getByText('A3')).toBeTruthy();
    expect(subLine('print · 3508 × 4961')).toBeTruthy();
    expect(screen.getByText('4 : 5')).toBeTruthy();
    expect(subLine('social · 1080 × 1350')).toBeTruthy();
    expect(screen.getByText('9 : 16')).toBeTruthy();
    expect(subLine('story · 1080 × 1920')).toBeTruthy();
  });

  it('keeps the pixel size together: the sub-line wraps only after "print ·"', () => {
    render(<SizePicker sizes={POSTER_SIZES} value="18x24" onChange={noop} label="Size" />);
    const parts = screen
      .getAllByText((_, element) => element?.textContent === '5400 × 7200')
      .filter((element) => element.childElementCount === 0);
    expect(parts).toHaveLength(1);
    const pixels = parts[0];
    expect(pixels?.previousSibling?.textContent).toBe(' ');
    expect(pixels?.previousSibling?.previousSibling?.textContent).toBe('print ·');
    // Both parts are no-wrap spans (class from the CSS module).
    expect(pixels?.className).toBe(
      (pixels?.previousSibling?.previousSibling as HTMLElement | null)?.className,
    );
  });

  it('derives the sub-line from use, width and height with a real multiplication sign', () => {
    expect(sizeDetail({ id: 'x', name: 'X', use: 'social', width: 1200, height: 900 })).toBe(
      'social · 1200 × 900',
    );
  });

  it('checks the radio that matches value', () => {
    const { rerender } = render(
      <SizePicker sizes={POSTER_SIZES} value="18x24" onChange={noop} label="Size" />,
    );
    expect(radio(POSTER_18X24).checked).toBe(true);
    expect(radio(SOCIAL).checked).toBe(false);

    rerender(<SizePicker sizes={POSTER_SIZES} value="4x5" onChange={noop} label="Size" />);
    expect(radio(POSTER_18X24).checked).toBe(false);
    expect(radio(SOCIAL).checked).toBe(true);
  });

  it('calls onChange with the size id when a label is clicked', () => {
    const onChange = vi.fn();
    render(<SizePicker sizes={POSTER_SIZES} value="18x24" onChange={onChange} label="Size" />);
    fireEvent.click(screen.getByText('A3'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a3');
  });

  it('stays controlled: the checked radio follows value, not the click', () => {
    render(<SizePicker sizes={POSTER_SIZES} value="18x24" onChange={noop} label="Size" />);
    fireEvent.click(screen.getByText('9 : 16'));
    expect(radio(POSTER_18X24).checked).toBe(true);
    expect(radio(STORY).checked).toBe(false);
  });

  it('updates the selection when the parent stores the new value', () => {
    render(<Controlled />);
    fireEvent.click(screen.getByText('9 : 16'));
    expect(radio(STORY).checked).toBe(true);
    expect(radio(POSTER_18X24).checked).toBe(false);
  });

  it('uses a given name for the radios', () => {
    render(
      <SizePicker
        sizes={POSTER_SIZES}
        value="18x24"
        onChange={noop}
        label="Size"
        name="poster-size"
      />,
    );
    for (const input of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(input.name).toBe('poster-size');
    }
  });

  it('keeps radios focusable', () => {
    render(<Controlled />);
    const checked = radio(POSTER_18X24);
    checked.focus();
    expect(document.activeElement).toBe(checked);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Controlled initial="4x5" />);
    await expectNoAxeViolations(container);
  });
});
