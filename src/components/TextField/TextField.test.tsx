import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { TextField, type TextFieldProps } from './TextField';

function setup(overrides: Partial<TextFieldProps> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <TextField
      label="Title"
      value="Coosa Backcountry Loop"
      maxLength={40}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...utils, onChange, input: screen.getByRole('textbox', { name: 'Title' }) };
}

function Controlled({ initial, maxLength }: { initial: string; maxLength: number }) {
  const [value, setValue] = useState(initial);
  return <TextField label="Title" value={value} maxLength={maxLength} onChange={setValue} />;
}

/** The accessible description: the text of every `aria-describedby` target, in order. */
function description(input: HTMLElement): string {
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

describe('TextField', () => {
  it('associates the visible label with the input', () => {
    const { input } = setup();
    expect(screen.getByLabelText('Title')).toBe(input);
    expect(input).toHaveProperty('type', 'text');
  });

  it('uses the given id for the label association', () => {
    const { input } = setup({ id: 'poster-title', name: 'title' });
    expect(input.id).toBe('poster-title');
    expect(input.getAttribute('name')).toBe('title');
    expect(screen.getByText('Title').getAttribute('for')).toBe('poster-title');
  });

  it('reflects the value prop', () => {
    const { input, rerender, onChange } = setup();
    expect(input).toHaveProperty('value', 'Coosa Backcountry Loop');
    rerender(<TextField label="Title" value="Vogel" maxLength={40} onChange={onChange} />);
    expect(input).toHaveProperty('value', 'Vogel');
  });

  it('calls onChange with the new string', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'Coosa Loop' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Coosa Loop');
  });

  it('updates when controlled by state', () => {
    render(<Controlled initial="" maxLength={40} />);
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: '@geekplux' } });
    expect(input).toHaveProperty('value', '@geekplux');
  });

  it('enforces maxLength natively', () => {
    const { input } = setup();
    expect(input.getAttribute('maxlength')).toBe('40');
  });

  it('shows the placeholder', () => {
    setup({ value: '', placeholder: 'Your name or handle' });
    expect(screen.getByPlaceholderText('Your name or handle')).toBeDefined();
  });

  describe('counter', () => {
    it('is hidden below 80% of maxLength', () => {
      const { input } = setup({ value: 'a'.repeat(31) });
      expect(screen.queryByText(/\/ 40/)).toBeNull();
      expect(input.hasAttribute('aria-describedby')).toBe(false);
    });

    it('appears at 80% of maxLength and describes the input', () => {
      const { input } = setup({ value: 'a'.repeat(32) });
      const counter = screen.getByText(/^32 \/ 40/);
      expect(input.getAttribute('aria-describedby')).toBe(counter.id);
      expect(counter.getAttribute('aria-live')).toBeNull();
      expect(screen.queryByText(/limit reached/)).toBeNull();
      expect(description(input)).toBe('32 / 40 characters');
    });

    it('appears when typing crosses the threshold', () => {
      render(<Controlled initial="abc" maxLength={10} />);
      expect(screen.queryByText(/\/ 10/)).toBeNull();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefgh' } });
      expect(screen.getByText(/^8 \/ 10/)).toBeDefined();
    });

    it('says "limit reached" in text at the max', () => {
      const { input } = setup({ value: 'a'.repeat(40) });
      const counter = screen.getByText(/^40 \/ 40/);
      expect(input.getAttribute('aria-describedby')).toBe(counter.id);
      expect(description(input)).toBe('40 / 40 characters · limit reached');
    });

    it('hides the word "characters" visually but keeps the visible text short', () => {
      setup({ value: 'a'.repeat(37) });
      const hidden = screen.getByText('characters');
      expect(hidden.className).toMatch(/srOnly/);
      expect(hidden.parentElement?.textContent).toBe('37 / 40 characters');
    });
  });

  it('links the hint and the counter with aria-describedby', () => {
    const { input } = setup({ value: 'a'.repeat(38), hint: 'Printed at the top.' });
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toEqual([
      screen.getByText('Printed at the top.').id,
      screen.getByText(/^38 \/ 40/).id,
    ]);
    expect(description(input)).toBe('Printed at the top. 38 / 40 characters');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <TextField label="Title" value="Coosa Backcountry Loop" maxLength={40} onChange={vi.fn()} />
        <TextField
          label="Signature"
          value={'a'.repeat(30)}
          maxLength={30}
          hint="Printed small in the corner."
          onChange={vi.fn()}
        />
        <TextField
          label="Subtitle"
          value=""
          maxLength={60}
          placeholder="Place · date"
          onChange={vi.fn()}
        />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});
