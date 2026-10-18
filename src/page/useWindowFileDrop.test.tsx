import { act, fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWindowFileDrop } from './useWindowFileDrop';

const FILES = { types: ['Files'] };

function gpx(name = 'run.gpx'): File {
  return new File(['<gpx/>'], name, { type: 'application/gpx+xml' });
}

function setup(disabled = false) {
  const onFiles = vi.fn<(files: File[]) => void>();
  const hook = renderHook(
    (props: { disabled: boolean }) => useWindowFileDrop({ onFiles, ...props }),
    {
      initialProps: { disabled },
    },
  );
  return { ...hook, onFiles };
}

describe('useWindowFileDrop', () => {
  it('is not dragging to start with', () => {
    const { result } = setup();
    expect(result.current.dragOver).toBe(false);
  });

  it('always cancels dragover and drop, so the browser never opens a stray file', () => {
    setup();
    expect(fireEvent.dragOver(document.body, { dataTransfer: FILES })).toBe(false);
    expect(fireEvent.dragOver(document.body, { dataTransfer: { types: ['text/plain'] } })).toBe(
      false,
    );
    expect(fireEvent.drop(document.body, { dataTransfer: { ...FILES, files: [gpx()] } })).toBe(
      false,
    );
    expect(fireEvent.drop(document.body, { dataTransfer: { types: ['text/plain'] } })).toBe(false);
  });

  it('allows copying a file drag and refuses anything else', () => {
    setup();
    const files = { ...FILES, dropEffect: 'none' };
    fireEvent.dragOver(document.body, { dataTransfer: files });
    expect(files.dropEffect).toBe('copy');
    const text = { types: ['text/plain'], dropEffect: 'copy' };
    fireEvent.dragOver(document.body, { dataTransfer: text });
    expect(text.dropEffect).toBe('none');
  });

  it('tracks a file drag across elements without flickering', () => {
    const { result } = setup();
    const child = document.createElement('span');
    document.body.append(child);

    fireEvent.dragEnter(document.body, { dataTransfer: FILES });
    expect(result.current.dragOver).toBe(true);
    // Into a child: enter on the child, then leave on the body.
    fireEvent.dragEnter(child, { dataTransfer: FILES });
    fireEvent.dragLeave(document.body, { dataTransfer: FILES });
    expect(result.current.dragOver).toBe(true);
    // Out of the window.
    fireEvent.dragLeave(child, { dataTransfer: FILES });
    expect(result.current.dragOver).toBe(false);
    child.remove();
  });

  it('forwards the files of a drop and stops dragging', () => {
    const { result, onFiles } = setup();
    const file = gpx();
    fireEvent.dragEnter(document.body, { dataTransfer: FILES });
    fireEvent.drop(document.body, { dataTransfer: { ...FILES, files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(result.current.dragOver).toBe(false);
  });

  it('ignores drags and drops that carry no files', () => {
    const { result, onFiles } = setup();
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ['text/plain'] } });
    expect(result.current.dragOver).toBe(false);
    fireEvent.drop(document.body, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('leaves a drop alone when an element on the page already handled it', () => {
    const { onFiles } = setup();
    const target = document.createElement('div');
    target.addEventListener('drop', (event) => {
      event.preventDefault();
    });
    document.body.append(target);
    fireEvent.drop(target, { dataTransfer: { ...FILES, files: [gpx()] } });
    expect(onFiles).not.toHaveBeenCalled();
    target.remove();
  });

  it('while disabled: shows no drag, still cancels the drop, and ignores its files', () => {
    const { result, onFiles } = setup(true);
    const files = { ...FILES, dropEffect: 'copy' };
    fireEvent.dragEnter(document.body, { dataTransfer: files });
    expect(result.current.dragOver).toBe(false);
    fireEvent.dragOver(document.body, { dataTransfer: files });
    expect(files.dropEffect).toBe('none');
    expect(fireEvent.drop(document.body, { dataTransfer: { ...FILES, files: [gpx()] } })).toBe(
      false,
    );
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('while a modal dialog is open: shows no drag, still cancels the drop, and ignores its files', () => {
    const { result, onFiles } = setup();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    fireEvent.dragEnter(document.body, { dataTransfer: FILES });
    expect(result.current.dragOver).toBe(false);
    expect(fireEvent.drop(document.body, { dataTransfer: { ...FILES, files: [gpx()] } })).toBe(
      false,
    );
    expect(onFiles).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('takes drops again once no longer disabled', () => {
    const { onFiles, rerender } = setup(true);
    rerender({ disabled: false });
    const file = gpx();
    fireEvent.drop(document.body, { dataTransfer: { ...FILES, files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('resets when the window loses focus, so a lost dragleave cannot leave it stuck', () => {
    const { result } = setup();
    fireEvent.dragEnter(document.body, { dataTransfer: FILES });
    fireEvent.dragEnter(document.body, { dataTransfer: FILES });
    expect(result.current.dragOver).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current.dragOver).toBe(false);
    // The count started again from zero: one enter and one leave end the next drag.
    fireEvent.dragEnter(document.body, { dataTransfer: FILES });
    fireEvent.dragLeave(document.body, { dataTransfer: FILES });
    expect(result.current.dragOver).toBe(false);
  });

  it('stops listening when unmounted', () => {
    const { unmount } = setup();
    unmount();
    expect(fireEvent.dragOver(document.body, { dataTransfer: FILES })).toBe(true);
  });
});
