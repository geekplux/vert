import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Slider, type SliderProps } from './Slider';

const times = (v: number) => `${v.toFixed(1)}×`;

function renderSlider(props: Partial<SliderProps> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <Slider
      label="Vertical exaggeration"
      min={1}
      max={3}
      step={0.1}
      value={1.6}
      format={times}
      onChange={onChange}
      {...props}
    />,
  );
  return { ...utils, onChange };
}

function Controlled() {
  const [value, setValue] = useState(200);
  return (
    <Slider
      label="Hide start and end"
      min={0}
      max={500}
      step={100}
      value={value}
      format={(v) => `${String(v)} m`}
      valueText={(v) => `${String(v)} metres`}
      onChange={setValue}
    />
  );
}

describe('Slider', () => {
  it('takes its accessible name from the label', () => {
    renderSlider();
    expect(screen.getByRole('slider', { name: 'Vertical exaggeration' })).toBeTruthy();
  });

  it('sets min, max, step and value on the native range input', () => {
    renderSlider();
    const input = screen.getByRole<HTMLInputElement>('slider');
    expect(input.type).toBe('range');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('3');
    expect(input.getAttribute('step')).toBe('0.1');
    expect(input.value).toBe('1.6');
  });

  it('shows the formatted value in the label row', () => {
    renderSlider();
    const label = screen.getByText('Vertical exaggeration').closest('label');
    expect(label?.textContent).toContain('1.6×');
  });

  it('uses the formatted value as aria-valuetext by default', () => {
    renderSlider();
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('1.6×');
  });

  it('uses valueText for aria-valuetext when given', () => {
    renderSlider({
      label: 'Hide start and end',
      min: 0,
      max: 500,
      step: 100,
      value: 200,
      format: (v) => `${String(v)} m`,
      valueText: (v) => `${String(v)} metres`,
    });
    const input = screen.getByRole('slider', { name: 'Hide start and end' });
    expect(input.getAttribute('aria-valuetext')).toBe('200 metres');
    expect(screen.getByText('200 m')).toBeTruthy();
  });

  it('calls onChange with a number', () => {
    const { onChange } = renderSlider();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '2.3' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2.3);
    expect(typeof onChange.mock.calls[0]?.[0]).toBe('number');
  });

  it('updates the shown value and aria-valuetext live when controlled', () => {
    render(<Controlled />);
    const input = screen.getByRole('slider', { name: 'Hide start and end' });
    fireEvent.change(input, { target: { value: '400' } });
    expect(screen.getByText('400 m')).toBeTruthy();
    expect(input.getAttribute('aria-valuetext')).toBe('400 metres');
  });

  it('links the hint with aria-describedby', () => {
    renderSlider({ hint: '0 shows the whole route.' });
    const input = screen.getByRole('slider');
    const hint = screen.getByText('0 shows the whole route.');
    expect(hint.id).not.toBe('');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('has no aria-describedby without a hint', () => {
    renderSlider();
    expect(screen.getByRole('slider').hasAttribute('aria-describedby')).toBe(false);
  });

  it('uses the given id', () => {
    renderSlider({ id: 'vx' });
    expect(screen.getByRole('slider').id).toBe('vx');
  });

  it('passes the filled fraction of the track to its styles', () => {
    renderSlider({ value: 1.6 });
    const input = screen.getByRole<HTMLInputElement>('slider');
    expect(Number(input.style.getPropertyValue('--slider-fill'))).toBeCloseTo(0.3);
  });

  it('can be disabled', () => {
    renderSlider({ disabled: true });
    expect(screen.getByRole<HTMLInputElement>('slider').disabled).toBe(true);
  });

  it('has no axe violations', async () => {
    const { container } = renderSlider({ hint: '0 shows the whole route.' });
    await expectNoAxeViolations(container);
  });

  it('has no axe violations when disabled', async () => {
    const { container } = renderSlider({ disabled: true });
    await expectNoAxeViolations(container);
  });
});
