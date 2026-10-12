import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Segmented } from './Segmented';

type Units = 'metric' | 'imperial';

const units = [
  { value: 'metric', label: 'km' },
  { value: 'imperial', label: 'mi' },
] as const;

function Controlled({ initial = 'metric' }: { initial?: Units }) {
  const [value, setValue] = useState<Units>(initial);
  return <Segmented label="Units" options={units} value={value} onChange={setValue} />;
}

function radio(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('radio', { name });
}

describe('Segmented', () => {
  it('renders a radiogroup named by label, with one named radio per option', () => {
    render(<Segmented label="Units" options={units} value="metric" onChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Units' });
    expect(group).toBeDefined();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(radio('km').value).toBe('metric');
    expect(radio('mi').value).toBe('imperial');
  });

  it('checks the radio that matches value', () => {
    const { rerender } = render(
      <Segmented label="Units" options={units} value="metric" onChange={vi.fn()} />,
    );
    expect(radio('km').checked).toBe(true);
    expect(radio('mi').checked).toBe(false);

    rerender(<Segmented label="Units" options={units} value="imperial" onChange={vi.fn()} />);
    expect(radio('km').checked).toBe(false);
    expect(radio('mi').checked).toBe(true);
  });

  it('calls onChange with the option value when a label is clicked', () => {
    const onChange = vi.fn<(value: Units) => void>();
    render(<Segmented label="Units" options={units} value="metric" onChange={onChange} />);
    fireEvent.click(screen.getByText('mi'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('imperial');
  });

  it('calls onChange when the radio itself is clicked', () => {
    const onChange = vi.fn<(value: Units) => void>();
    render(<Segmented label="Units" options={units} value="metric" onChange={onChange} />);
    fireEvent.click(radio('mi'));
    expect(onChange).toHaveBeenCalledWith('imperial');
  });

  it('does not call onChange when the selected option is clicked again', () => {
    const onChange = vi.fn<(value: Units) => void>();
    render(<Segmented label="Units" options={units} value="metric" onChange={onChange} />);
    fireEvent.click(radio('km'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the checked state in sync when controlled', () => {
    render(<Controlled />);
    fireEvent.click(screen.getByText('mi'));
    expect(radio('mi').checked).toBe(true);
    expect(radio('km').checked).toBe(false);
  });

  // jsdom has no tab order and does not move native radio selection with arrow keys. What makes the
  // group one tab stop with arrow-key movement is that every radio is native, focusable and shares
  // one name; a browser verifier checks Tab and arrow keys for real.
  it('builds one native radio group: shared name, focusable, no tabindex overrides', () => {
    render(<Segmented label="Units" options={units} value="metric" onChange={vi.fn()} />);
    const radios = screen.getAllByRole<HTMLInputElement>('radio');
    const names = new Set(radios.map((input) => input.name));
    expect(names.size).toBe(1);
    expect([...names][0]).not.toBe('');
    for (const input of radios) {
      expect(input.type).toBe('radio');
      expect(input.hasAttribute('tabindex')).toBe(false);
    }
    radio('km').focus();
    expect(document.activeElement).toBe(radio('km'));
  });

  it('uses the given name, and distinct generated names for separate groups', () => {
    render(
      <>
        <Segmented label="Units" options={units} value="metric" onChange={vi.fn()} />
        <Segmented label="Other units" options={units} value="metric" onChange={vi.fn()} />
        <Segmented label="Named" name="units" options={units} value="metric" onChange={vi.fn()} />
      </>,
    );
    const [first, second, third] = screen
      .getAllByRole('radiogroup')
      .map((group) => group.querySelector('input')?.name);
    expect(first).not.toBe(second);
    expect(third).toBe('units');
  });

  it('only accepts a value that is one of the options', () => {
    // Type-level check: `T` is inferred from `options`, so a stray `value` does not compile.
    render(
      // @ts-expect-error 'nautical' is not one of the options' values.
      <Segmented label="Units" options={units} value="nautical" onChange={vi.fn()} />,
    );
    expect(radio('km').checked).toBe(false);
    expect(radio('mi').checked).toBe(false);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Controlled initial="imperial" />);
    await expectNoAxeViolations(container);
  });
});
