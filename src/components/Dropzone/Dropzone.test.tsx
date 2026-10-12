import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Dropzone } from './Dropzone';

const MB = 1024 * 1024;

function gpx(name = 'run.gpx', type = 'application/gpx+xml'): File {
  return new File(['<gpx/>'], name, { type });
}

function sized(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function setup(props: Partial<Parameters<typeof Dropzone>[0]> = {}) {
  const onFile = vi.fn<(file: File) => void>();
  const onSample = vi.fn<() => void>();
  const view = render(<Dropzone onFile={onFile} onSample={onSample} {...props} />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  const zone = screen.getByRole('group');
  return { ...view, onFile, onSample, input, zone };
}

function choose(input: HTMLInputElement, ...files: File[]) {
  fireEvent.change(input, { target: { files } });
}

describe('Dropzone', () => {
  it('renders the title and the two buttons in the line', () => {
    const { zone } = setup();
    expect(screen.getByText('Drop a .gpx file here')).toBeDefined();
    expect(screen.getByRole('button', { name: 'choose a file' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'try a sample run' })).toBeDefined();
    expect(zone.textContent).toContain('or choose a file · or try a sample run');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(zone.getAttribute('data-state')).toBe('rest');
  });

  it('is a group named by its title, so the buttons are announced in context', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Drop a .gpx file here' })).toBeDefined();
  });

  it('has a hidden file input that takes .gpx by default and stays out of the tab order', () => {
    const { input } = setup();
    expect(input.accept).toBe('.gpx');
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens the file input from "choose a file"', () => {
    const { input } = setup();
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'choose a file' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('calls onFile with a chosen .gpx file and resets the input', () => {
    const { input, onFile } = setup();
    const file = gpx();
    choose(input, file);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('accepts .GPX regardless of case and of an empty or odd MIME type', () => {
    const { input, onFile } = setup();
    choose(input, gpx('MORNING.GPX', ''));
    choose(input, gpx('trail.gpx', 'application/octet-stream'));
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it('rejects a wrong type with an alert and does not call onFile', () => {
    const { input, onFile, zone } = setup();
    choose(input, new File(['x'], 'run.fit', { type: 'application/octet-stream' }));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      "That's a .fit file. Vert reads .gpx files in v1.",
    );
    expect(zone.getAttribute('data-state')).toBe('error');
  });

  it('rejects a file larger than maxBytes', () => {
    const { input, onFile } = setup();
    choose(input, sized(gpx(), 24.3 * MB));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('That file is 24.3 MB. The limit is 20 MB.');
  });

  it('accepts a file exactly at the limit', () => {
    const { input, onFile } = setup();
    choose(input, sized(gpx(), 20 * MB));
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('clears an error after a valid file', () => {
    const { input } = setup();
    choose(input, new File(['x'], 'run.tcx'));
    expect(screen.getByRole('alert')).toBeDefined();
    choose(input, gpx());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls onFile with a dropped .gpx file', () => {
    const { zone, onFile } = setup();
    const file = gpx();
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('uses the first .gpx of several dropped files and ignores the rest', () => {
    const { zone, onFile } = setup();
    const first = gpx('a.gpx');
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [new File(['x'], 'photo.jpg'), first, gpx('b.gpx')],
        types: ['Files'],
      },
    });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(first);
  });

  it('shows an error when none of the dropped files is a .gpx', () => {
    const { zone, onFile } = setup();
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(['x'], 'photo.jpg'), new File(['x'], 'run.fit')] },
    });
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      "That's a .jpg file. Vert reads .gpx files in v1.",
    );
  });

  it('shows the drag-over title while a file is over the zone, without flickering on children', () => {
    const { zone } = setup();
    const dataTransfer = { types: ['Files'] };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(screen.getByText('Release to open the file')).toBeDefined();
    expect(zone.getAttribute('data-state')).toBe('dragover');

    // Crossing into a child fires enter on the child, then leave on the zone.
    const title = screen.getByText('Release to open the file');
    fireEvent.dragEnter(title, { dataTransfer });
    fireEvent.dragLeave(zone, { dataTransfer });
    expect(zone.getAttribute('data-state')).toBe('dragover');

    fireEvent.dragLeave(title, { dataTransfer });
    expect(screen.getByText('Drop a .gpx file here')).toBeDefined();
    expect(zone.getAttribute('data-state')).toBe('rest');
  });

  it('allows the drop by cancelling dragover', () => {
    const { zone } = setup();
    const allowed = fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } });
    expect(allowed).toBe(false);
  });

  it('leaves the drag-over state after a drop', () => {
    const { zone } = setup();
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(zone, { dataTransfer: { files: [gpx()], types: ['Files'] } });
    expect(zone.getAttribute('data-state')).toBe('rest');
  });

  it('shows an external error as an alert', () => {
    const { zone } = setup({ error: 'Vert could not read that file. Is it a GPX export?' });
    expect(screen.getByRole('alert').textContent).toBe(
      'Vert could not read that file. Is it a GPX export?',
    );
    expect(zone.getAttribute('data-state')).toBe('error');
  });

  it('while busy: names the file, disables the buttons, sets aria-busy and ignores drops', () => {
    const { input, zone, onFile, rerender, onSample } = setup();
    choose(input, gpx('coosa.gpx'));
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy />);

    expect(screen.getByText('Reading coosa.gpx…')).toBeDefined();
    expect(zone.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'choose a file' }).disabled).toBe(
      true,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'try a sample run' }).disabled,
    ).toBe(true);

    fireEvent.drop(zone, { dataTransfer: { files: [gpx('other.gpx')], types: ['Files'] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('prefers the fileName prop for the busy title', () => {
    setup({ busy: true, fileName: 'given.gpx' });
    expect(screen.getByText('Reading given.gpx…')).toBeDefined();
  });

  it('calls onSample from "try a sample run"', () => {
    const { onSample } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'try a sample run' }));
    expect(onSample).toHaveBeenCalledTimes(1);
  });

  it('draws the drag-over state when forced through state', () => {
    const { zone } = setup({ state: 'dragover' });
    expect(zone.getAttribute('data-state')).toBe('dragover');
    expect(screen.getByText('Release to open the file')).toBeDefined();
  });

  it('has no axe violations at rest', async () => {
    const { container } = setup();
    await expectNoAxeViolations(container);
  });

  it('has no axe violations with an error', async () => {
    const { container, input } = setup();
    choose(input, new File(['x'], 'run.fit'));
    await expectNoAxeViolations(container);
  });
});
