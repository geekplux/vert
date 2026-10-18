import { useEffect, useEffectEvent, useState } from 'react';

export interface WindowFileDropOptions {
  /** Called with the files of a drop anywhere on the page that no element handled itself. */
  onFiles: (files: File[]) => void;
  /**
   * Files can't be taken now (a load or an export is running): drops are still cancelled, so the
   * browser never opens the file, but their files are ignored and `dragOver` stays false.
   */
  disabled?: boolean;
}

/** Whether the drag carries files (from the desktop or a file manager), not text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** A modal dialog (About) is open: the page under it takes no files. */
function dialogOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/**
 * Lets a file be dropped anywhere on the page, on every screen. Listens on `window`:
 *
 * - `dragover` and `drop` are always cancelled, so a file dropped outside a target never makes the
 *   browser navigate away to it.
 * - Only drags that carry files count. `dragOver` is true from the first `dragenter` to the
 *   matching last `dragleave` (each element crossed fires one of each, so they are counted to keep
 *   the state from flickering), and false again after a drop or when the window loses focus.
 * - A drop calls `onFiles`, unless `disabled`, a modal dialog is open, or an element on the page
 *   already handled it by calling `preventDefault()` (the Dropzone does, for drops on itself).
 *   While disabled or under a dialog, `dragOver` stays false too.
 */
export function useWindowFileDrop({ onFiles, disabled = false }: WindowFileDropOptions): {
  dragOver: boolean;
} {
  const [dragging, setDragging] = useState(false);
  const isDisabled = useEffectEvent(() => disabled);
  const deliver = useEffectEvent((files: File[]) => {
    onFiles(files);
  });

  useEffect(() => {
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      if (!dialogOpen()) setDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect =
          carriesFiles(event) && !isDisabled() && !dialogOpen() ? 'copy' : 'none';
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event) || depth === 0) return;
      depth -= 1;
      if (depth === 0) setDragging(false);
    };

    const handleDrop = (event: DragEvent) => {
      const handled = event.defaultPrevented;
      event.preventDefault();
      reset();
      if (handled || isDisabled() || dialogOpen() || !carriesFiles(event)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) deliver(files);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return { dragOver: dragging && !disabled };
}
