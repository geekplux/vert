import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('takes its accessible name from the label', () => {
    render(<Checkbox label="Distance" checked onChange={() => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'Distance' })).toBeTruthy();
  });

  it('reflects the checked prop', () => {
    const { rerender } = render(<Checkbox label="Vert" checked onChange={() => undefined} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Vert' });
    expect(box.checked).toBe(true);
    rerender(<Checkbox label="Vert" checked={false} onChange={() => undefined} />);
    expect(box.checked).toBe(false);
  });

  it('reports the next state when the label text is clicked', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Checkbox label="High point" checked={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText('High point'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Checkbox label="High point" checked onChange={onChange} />);
    fireEvent.click(screen.getByText('High point'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('stays controlled: the box does not change until the prop does', () => {
    render(<Checkbox label="Time" checked={false} onChange={() => undefined} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Time' });
    fireEvent.click(box);
    expect(box.checked).toBe(false);
  });

  it('is announced as disabled and blocks onChange', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Time" checked disabled onChange={onChange} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Time' });
    expect(box.disabled).toBe(true);
    fireEvent.click(screen.getByText('Time'));
    fireEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards native input props', () => {
    render(
      <Checkbox
        label="Distance"
        id="stat-distance"
        name="stats"
        value="distance"
        checked
        onChange={() => undefined}
      />,
    );
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Distance' });
    expect(box.id).toBe('stat-distance');
    expect(box.name).toBe('stats');
    expect(box.value).toBe('distance');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Checkbox label="Distance" checked onChange={() => undefined} />
        <Checkbox label="High point" checked={false} disabled onChange={() => undefined} />
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});
