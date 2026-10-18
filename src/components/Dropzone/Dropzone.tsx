import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, Ref } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { DEFAULT_ACCEPT, DEFAULT_MAX_BYTES, pickGpxFile } from './pickGpxFile';
import styles from './Dropzone.module.css';

/** Devices that tap rather than point: no "drop" or "click" in the copy there. */
export const COARSE_POINTER_QUERY = '(hover: none) and (pointer: coarse)';

/**
 * What a page can ask of the Dropzone through `ref`: `takeFiles` hands it files dropped elsewhere
 * on the page (`useWindowFileDrop`). They are checked like a drop on the zone, and a rejected file
 * shows its error in the zone's alert. Ignored while `busy`.
 */
export interface DropzoneHandle {
  takeFiles: (files: readonly File[]) => void;
}

export interface DropzoneProps {
  /** Called with a file that passed the extension and size checks. The page reads it. */
  onFile: (file: File) => void;
  /** Called when "Try the sample run" is pressed. */
  onSample: () => void;
  /** File extensions to take, comma-separated, as in `<input accept>`. Default ".gpx". */
  accept?: string;
  /** Largest file accepted, in bytes. Default 20 MB. */
  maxBytes?: number;
  /** An error from outside (e.g. the page could not parse the file). Shown like a local error. */
  error?: string;
  /** The page is reading a file: the title says so, controls are disabled, drops are ignored. */
  busy?: boolean;
  /**
   * What the page is loading while busy: `'file'` (default) titles "Reading <fileName>…" (or
   * "Reading…" without a name), `'sample'` titles "Loading the sample run…".
   */
  busyKind?: 'file' | 'sample';
  /** Name shown while busy reading a file ("Reading <fileName>…"). */
  fileName?: string;
  /**
   * A file is being dragged somewhere over the page (`useWindowFileDrop`): draw the drag-over
   * state even when the pointer is not over the zone. A drag over the zone itself draws it anyway.
   */
  dragOver?: boolean;
  /** Id of the element describing the accepted files (the page's note line), for the card. */
  describedBy?: string;
  /** See `DropzoneHandle`. */
  ref?: Ref<DropzoneHandle>;
  className?: string;
}

/** Whether the drag carries files, not text or a link. A drag without `types` carries none. */
function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer.types as readonly string[] | undefined;
  return Array.from(types ?? []).includes('Files');
}

/**
 * Upload target for one GPX file. The card is one button that opens the file picker; a file can
 * also be dropped anywhere on the zone (and, with `dragOver` and `ref`, anywhere on the page).
 * Under it are the error, if any, and "Try the sample run". Nothing is read or sent from here: a
 * valid file goes to `onFile` and the page parses it.
 */
export function Dropzone({
  onFile,
  onSample,
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  error,
  busy = false,
  busyKind = 'file',
  fileName,
  dragOver: pageDragOver = false,
  describedBy,
  ref,
  className,
}: DropzoneProps) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  // dragenter/dragleave fire for every child crossed; count them so the state doesn't flicker.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  // A drag that leaves the window can skip its last dragleave; start over when the window blurs.
  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('blur', reset);
    };
  }, []);
  const [localError, setLocalError] = useState<{ message: string; id: number } | null>(null);

  // A new load starts with no error of its own: after it, only the page's `error` (if any) shows.
  const [wasBusy, setWasBusy] = useState(busy);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (busy) setLocalError(null);
  }

  const dragOver = !busy && (pageDragOver || dragging);
  const message = busy ? undefined : (localError?.message ?? error);
  const visual = busy ? 'busy' : dragOver ? 'dragover' : message ? 'error' : 'rest';

  // While busy the card is disabled, so focus falls to <body>. When the load fails, put it back on
  // the card (the alert under it says what went wrong), unless the user has moved on to something
  // else in the meantime.
  const busyBefore = useRef(busy);
  useEffect(() => {
    const failed = busyBefore.current && !busy && message !== undefined;
    busyBefore.current = busy;
    if (!failed) return;
    const active = document.activeElement;
    if (!active || active === document.body) cardRef.current?.focus();
  }, [busy, message]);

  const [title, sub] = busy
    ? [
        busyKind === 'sample'
          ? 'Loading the sample run…'
          : fileName
            ? `Reading ${fileName}…`
            : 'Reading…',
        'Parsed in your browser, nothing is uploaded',
      ]
    : dragOver
      ? ['Release to open the file', 'Anywhere on this page works']
      : touch
        ? ['Choose a .gpx file', 'Tap to open your files']
        : ['Drop a .gpx file here', 'or click to choose one'];

  function take(files: readonly File[]) {
    if (busy) return;
    const result = pickGpxFile(files, accept, maxBytes);
    if (!result) return;
    if ('error' in result) {
      // A new id remounts the alert, so the same error is announced again on a second try.
      setLocalError((previous) => ({ message: result.error, id: (previous?.id ?? 0) + 1 }));
      return;
    }
    setLocalError(null);
    onFile(result.file);
  }

  useImperativeHandle(ref, () => ({ takeFiles: take }));

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (busy || !isFileDrag(event)) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // Without preventDefault the browser refuses the drop (or opens the file in the tab).
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  }

  function handleDragLeave() {
    if (dragDepth.current === 0) return;
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // preventDefault also tells a page-wide listener (useWindowFileDrop) this drop is handled.
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    take(Array.from(event.dataTransfer.files));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // Reset so choosing the same file again still fires a change.
    input.value = '';
    take(files);
  }

  return (
    // Only drag-and-drop listeners here, no click or key handlers: dropping is a pointer shortcut,
    // and the card button (which opens the file picker) is its keyboard and assistive-tech
    // equivalent.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={[styles.zone, className].filter(Boolean).join(' ')}
      role="group"
      aria-label="Upload a GPX file"
      aria-busy={busy || undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Phrasing content only inside a button: spans drawn as blocks, no divs or headings. */}
      <button
        ref={cardRef}
        type="button"
        className={styles.card}
        data-state={visual}
        disabled={busy}
        // The visible title and sub-line as one sentence pair, so the name does not run on
        // ("Choose a .gpx file. Tap to open your files"); it starts with the visible title.
        aria-label={title.endsWith('…') ? `${title} ${sub}` : `${title}. ${sub}`}
        aria-describedby={describedBy}
        onClick={() => inputRef.current?.click()}
      >
        <svg
          className={styles.icon}
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 16V4M6 10l6-6 6 6" />
          <path d="M4 20h16" />
        </svg>
        <span className={styles.title}>{title}</span> <span className={styles.sub}>{sub}</span>
        {busy ? (
          // Decorative: the title and the page's status region say that a file is being read.
          <span className={styles.progress} aria-hidden="true" />
        ) : null}
      </button>
      {message ? (
        <div key={localError?.id ?? 'external'} role="alert" className={styles.message}>
          <svg
            className={styles.warning}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 3 22 20H2Z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
          <span>{message}</span>
        </div>
      ) : null}
      <p className={styles.line}>
        No file handy?{' '}
        <button type="button" className={styles.link} disabled={busy} onClick={onSample}>
          Try the sample run
        </button>
      </p>
      {/* Opened by the card; hidden from the tab order and assistive tech (the card is the control). */}
      <input
        ref={inputRef}
        className={styles.input}
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden="true"
        disabled={busy}
        onChange={handleChange}
      />
    </div>
  );
}
