import { createRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { COARSE_POINTER_QUERY, Dropzone } from './Dropzone';
import type { DropzoneHandle } from './Dropzone';

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
  // The card is the group's first button; its name changes with the state.
  const card = within(zone).getAllByRole<HTMLButtonElement>('button')[0];
  if (!card) throw new Error('no card');
  return { ...view, onFile, onSample, input, zone, card };
}

const REST_NAME = 'Drop a .gpx file here. or click to choose one';
const sampleLink = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Try the sample run' });

afterEach(() => {
  vi.unstubAllGlobals();
});

function choose(input: HTMLInputElement, ...files: File[]) {
  fireEvent.change(input, { target: { files } });
}

describe('Dropzone', () => {
  it('renders the card as one button, then the sample line', () => {
    const { zone, card } = setup();
    expect(card).toBe(screen.getByRole('button', { name: REST_NAME }));
    expect(card.type).toBe('button');
    expect(sampleLink()).toBeDefined();
    expect(zone.textContent).toContain('No file handy? Try the sample run');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card.getAttribute('data-state')).toBe('rest');
  });

  it('is a group with a fixed name, whatever the card says', () => {
    const { rerender, onFile, onSample } = setup();
    expect(screen.getByRole('group', { name: 'Upload a GPX file' })).toBeDefined();
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy fileName="a.gpx" />);
    expect(screen.getByRole('group', { name: 'Upload a GPX file' })).toBeDefined();
  });

  it('holds only phrasing content inside the card', () => {
    const { card } = setup();
    expect(card.querySelector('div, p, h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('is described by the element the page names', () => {
    render(
      <>
        <Dropzone onFile={vi.fn()} onSample={vi.fn()} describedBy="note" />
        <p id="note">GPX only · up to 20 MB</p>
      </>,
    );
    expect(
      screen.getByRole('button', { name: REST_NAME, description: 'GPX only · up to 20 MB' }),
    ).toBeDefined();
  });

  it('says "choose" and "tap" on touch screens', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === COARSE_POINTER_QUERY,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    setup();
    expect(
      screen.getByRole('button', { name: 'Choose a .gpx file. Tap to open your files' }),
    ).toBeDefined();
    expect(screen.queryByText('Drop a .gpx file here')).toBeNull();
  });

  it('has a hidden file input that takes .gpx by default and stays out of the tab order', () => {
    const { input } = setup();
    expect(input.accept).toBe('.gpx');
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens the file input when the card is clicked', () => {
    const { input, card } = setup();
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(card);
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
    const { input, onFile, card } = setup();
    choose(input, new File(['x'], 'run.fit', { type: 'application/octet-stream' }));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      "That's a .fit file. Vert reads .gpx files in v1.",
    );
    expect(card.getAttribute('data-state')).toBe('error');
  });

  it('shows the error under the card, outside it, and keeps the card clickable', () => {
    const { input, zone, card } = setup();
    choose(input, new File(['x'], 'run.fit'));
    const alert = screen.getByRole('alert');
    expect(card.contains(alert)).toBe(false);
    expect(zone.contains(alert)).toBe(true);
    // In document order: card, alert, sample line.
    expect(card.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      alert.compareDocumentPosition(sampleLink()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(card.disabled).toBe(false);
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(card);
    expect(click).toHaveBeenCalledTimes(1);
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

  it('shows the drag-over copy while a file is over the zone, without flickering on children', () => {
    const { zone, card } = setup();
    const dataTransfer = { types: ['Files'] };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(
      screen.getByRole('button', { name: 'Release to open the file. Anywhere on this page works' }),
    ).toBe(card);
    expect(card.getAttribute('data-state')).toBe('dragover');

    // Crossing into a child fires enter on the child, then leave on the zone.
    const title = screen.getByText('Release to open the file');
    fireEvent.dragEnter(title, { dataTransfer });
    fireEvent.dragLeave(zone, { dataTransfer });
    expect(card.getAttribute('data-state')).toBe('dragover');

    fireEvent.dragLeave(title, { dataTransfer });
    expect(screen.getByRole('button', { name: REST_NAME })).toBe(card);
    expect(card.getAttribute('data-state')).toBe('rest');
  });

  it('ignores a drag that carries no files, or no types at all', () => {
    const { zone, card } = setup();
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'] } });
    fireEvent.dragEnter(zone, { dataTransfer: {} });
    expect(card.getAttribute('data-state')).toBe('rest');
  });

  it('leaves the drag-over state when the window loses focus', () => {
    const { zone, card } = setup();
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(card.getAttribute('data-state')).toBe('dragover');
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(card.getAttribute('data-state')).toBe('rest');
  });

  it('accepts a drop on the error line or the sample line too', () => {
    const { input, onFile } = setup();
    choose(input, new File(['x'], 'run.fit'));
    const file = gpx();
    fireEvent.drop(screen.getByRole('alert'), {
      dataTransfer: { files: [file], types: ['Files'] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
    fireEvent.drop(sampleLink(), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it('allows the drop by cancelling dragover', () => {
    const { zone } = setup();
    const allowed = fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } });
    expect(allowed).toBe(false);
  });

  it('leaves the drag-over state after a drop', () => {
    const { zone, card } = setup();
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(zone, { dataTransfer: { files: [gpx()], types: ['Files'] } });
    expect(card.getAttribute('data-state')).toBe('rest');
  });

  it('marks a drop it handled, so a page-wide listener leaves it alone', () => {
    const { zone } = setup();
    const notHandled = fireEvent.drop(zone, { dataTransfer: { files: [gpx()], types: ['Files'] } });
    expect(notHandled).toBe(false);
  });

  it('shows an external error as an alert', () => {
    const { card } = setup({ error: 'Vert could not read that file. Is it a GPX export?' });
    expect(screen.getByRole('alert').textContent).toBe(
      'Vert could not read that file. Is it a GPX export?',
    );
    expect(card.getAttribute('data-state')).toBe('error');
  });

  it('while busy: names the file, disables the card and the link, sets aria-busy, ignores drops', () => {
    const { input, zone, card, onFile, rerender, onSample } = setup();
    choose(input, gpx('coosa.gpx'));
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy fileName="coosa.gpx" />);

    expect(
      screen.getByRole('button', {
        name: 'Reading coosa.gpx… Parsed in your browser, nothing is uploaded',
      }),
    ).toBe(card);
    expect(card.disabled).toBe(true);
    expect(card.getAttribute('data-state')).toBe('busy');
    expect(zone.getAttribute('aria-busy')).toBe('true');
    expect(sampleLink().disabled).toBe(true);

    fireEvent.drop(zone, { dataTransfer: { files: [gpx('other.gpx')], types: ['Files'] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('says "Reading…" while busy without a file name', () => {
    setup({ busy: true });
    expect(screen.getByText('Reading…')).toBeDefined();
  });

  it('does not draw drag-over while busy, even when the page asks', () => {
    const { card } = setup({ busy: true, dragOver: true });
    expect(card.getAttribute('data-state')).toBe('busy');
  });

  it('says "Loading the sample run…" while the page loads the sample', () => {
    setup({ busy: true, busyKind: 'sample' });
    expect(screen.getByText('Loading the sample run…')).toBeDefined();
  });

  it('puts focus back on the card when a load fails, so it is not lost to the page', () => {
    const { card, onFile, onSample, rerender } = setup();
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy fileName="bad.gpx" />);
    // A browser drops focus from the disabled card to <body>; start from there.
    expect(document.activeElement).toBe(document.body);
    rerender(
      <Dropzone onFile={onFile} onSample={onSample} error="This file has no track points." />,
    );
    expect(document.activeElement).toBe(card);
  });

  it('leaves focus alone after a load that fails while the user is elsewhere', () => {
    const { onFile, onSample, rerender } = setup();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy />);
    elsewhere.focus();
    rerender(
      <Dropzone onFile={onFile} onSample={onSample} error="This file has no track points." />,
    );
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('does not move focus when a load succeeds or an error shows without a load', () => {
    const { onFile, onSample, rerender } = setup();
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy />);
    rerender(<Dropzone onFile={onFile} onSample={onSample} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Dropzone onFile={onFile} onSample={onSample} error="Later error." />);
    expect(document.activeElement).toBe(document.body);
  });

  it('forgets its own error when a load starts, so only the page’s error shows after it', () => {
    const { input, onFile, onSample, rerender } = setup();
    choose(input, new File(['x'], 'run.fit'));
    rerender(<Dropzone onFile={onFile} onSample={onSample} busy busyKind="sample" />);
    rerender(<Dropzone onFile={onFile} onSample={onSample} error="The sample failed." />);
    expect(screen.getByRole('alert').textContent).toBe('The sample failed.');
  });

  it('calls onSample from "Try the sample run"', () => {
    const { onSample } = setup();
    fireEvent.click(sampleLink());
    expect(onSample).toHaveBeenCalledTimes(1);
  });

  it('draws the drag-over state when the page says a file is over it', () => {
    const { card } = setup({ dragOver: true });
    expect(card.getAttribute('data-state')).toBe('dragover');
    expect(screen.getByText('Release to open the file')).toBeDefined();
    expect(screen.getByText('Anywhere on this page works')).toBeDefined();
  });

  describe('through its ref', () => {
    function setupWithRef(props: Partial<Parameters<typeof Dropzone>[0]> = {}) {
      const ref = createRef<DropzoneHandle>();
      const result = setup({ ref, ...props });
      if (!ref.current) throw new Error('no handle');
      return { ...result, handle: ref.current };
    }

    it('takes files dropped elsewhere with the same checks', () => {
      const { handle, onFile } = setupWithRef();
      act(() => {
        handle.takeFiles([new File(['x'], 'run.fit')]);
      });
      expect(onFile).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toBe(
        "That's a .fit file. Vert reads .gpx files in v1.",
      );
      const file = gpx('loop.gpx');
      act(() => {
        handle.takeFiles([file]);
      });
      expect(onFile).toHaveBeenCalledWith(file);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('ignores files while busy', () => {
      const { handle, onFile } = setupWithRef({ busy: true });
      act(() => {
        handle.takeFiles([gpx()]);
      });
      expect(onFile).not.toHaveBeenCalled();
    });
  });

  it('has no axe violations at rest', async () => {
    const { container } = setup();
    await expectNoAxeViolations(container);
  });

  it('has no axe violations while a file is dragged over', async () => {
    const { container } = setup({ dragOver: true });
    await expectNoAxeViolations(container);
  });

  it('has no axe violations while busy', async () => {
    const { container } = setup({ busy: true, fileName: 'coosa.gpx' });
    await expectNoAxeViolations(container);
  });

  it('has no axe violations with an error', async () => {
    const { container, input } = setup();
    choose(input, new File(['x'], 'run.fit'));
    await expectNoAxeViolations(container);
  });
});
