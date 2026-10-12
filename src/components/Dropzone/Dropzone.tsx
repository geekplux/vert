import { useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import styles from './Dropzone.module.css';

/** The drawn state of the zone, for previews and tests (see `state`). */
export type DropzoneVisualState = 'rest' | 'dragover';

export interface DropzoneProps {
  /** Called with a file that passed the extension and size checks. The page reads it. */
  onFile: (file: File) => void;
  /** Called when "try a sample run" is pressed. */
  onSample: () => void;
  /** File extensions to take, comma-separated, as in `<input accept>`. Default ".gpx". */
  accept?: string;
  /** Largest file accepted, in bytes. Default 20 MB. */
  maxBytes?: number;
  /** An error from outside (e.g. the page could not parse the file). Shown like a local error. */
  error?: string;
  /** The page is reading a file: the title says so, controls are disabled, drops are ignored. */
  busy?: boolean;
  /** Name shown while busy ("Reading <fileName>…"). Defaults to the last file accepted here. */
  fileName?: string;
  /** Forces the drawn state. For stories and visual tests only; the app never sets it. */
  state?: DropzoneVisualState;
  className?: string;
}

const MB = 1024 * 1024;
const DEFAULT_MAX_BYTES = 20 * MB;

/** "24.3", "20": megabytes rounded up to one decimal, so 20 MB + 1 byte reads 20.1, not 20. */
function formatMegabytes(bytes: number): string {
  const rounded = Math.ceil((bytes / MB) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** ".gpx, .GPX" → ["gpx"]. MIME entries are ignored: GPX often arrives with an empty or odd type. */
function acceptedExtensions(accept: string): string[] {
  return accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith('.') && entry.length > 1)
    .map((entry) => entry.slice(1));
}

/** Picks the first accepted file and checks it. Returns the file or an error message. */
function validate(
  files: readonly File[],
  extensions: readonly string[],
  maxBytes: number,
): { file: File } | { error: string } | null {
  const first = files[0];
  if (!first) return null;

  const file = files.find((candidate) => extensions.includes(extensionOf(candidate.name)));
  if (!file) {
    const wanted = extensions.map((extension) => `.${extension}`).join(' or ');
    const extension = extensionOf(first.name);
    const what = extension ? `That's a .${extension} file.` : 'That file has no extension.';
    return { error: `${what} Vert reads ${wanted} files in v1.` };
  }
  if (file.size > maxBytes) {
    return {
      error: `That file is ${formatMegabytes(file.size)} MB. The limit is ${formatMegabytes(maxBytes)} MB.`,
    };
  }
  return { file };
}

function isFileDrag(event: DragEvent): boolean {
  const types = event.dataTransfer.types as readonly string[] | undefined;
  return !types || Array.from(types).includes('Files');
}

/**
 * Upload target for one GPX file. Drops work anywhere on the zone; the controls are the two
 * buttons ("choose a file" opens a hidden file input). Nothing is read or sent from here: a valid
 * file goes to `onFile` and the page parses it.
 */
export function Dropzone({
  onFile,
  onSample,
  accept = '.gpx',
  maxBytes = DEFAULT_MAX_BYTES,
  error,
  busy = false,
  fileName,
  state,
  className,
}: DropzoneProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child crossed; count them so the state doesn't flicker.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<{ message: string; id: number } | null>(null);
  const [source, setSource] = useState<{ kind: 'file'; name: string } | { kind: 'sample' } | null>(
    null,
  );

  const extensions = acceptedExtensions(accept);
  const dragOver = !busy && (state === 'dragover' || (state === undefined && dragging));
  const message = busy ? undefined : (localError?.message ?? error);
  const visual = dragOver ? 'dragover' : message ? 'error' : 'rest';

  const busyName = fileName ?? (source?.kind === 'file' ? source.name : undefined);
  const title = busy
    ? busyName
      ? `Reading ${busyName}…`
      : source?.kind === 'sample'
        ? 'Reading the sample run…'
        : 'Reading…'
    : dragOver
      ? 'Release to open the file'
      : 'Drop a .gpx file here';

  function take(files: readonly File[]) {
    const result = validate(files, extensions, maxBytes);
    if (!result) return;
    if ('error' in result) {
      // A new id remounts the alert, so the same error is announced again on a second try.
      setLocalError((previous) => ({ message: result.error, id: (previous?.id ?? 0) + 1 }));
      return;
    }
    setLocalError(null);
    setSource({ kind: 'file', name: result.file.name });
    onFile(result.file);
  }

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
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    take(Array.from(event.dataTransfer.files));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // Reset so choosing the same file again still fires a change.
    input.value = '';
    take(files);
  }

  function handleSample() {
    setLocalError(null);
    setSource({ kind: 'sample' });
    onSample();
  }

  return (
    // Only drag-and-drop listeners here, no click or key handlers: dropping is a pointer shortcut,
    // and "choose a file" is its keyboard and assistive-tech equivalent (DECISIONS.md: not a
    // clickable div).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={[styles.zone, className].filter(Boolean).join(' ')}
      role="group"
      aria-labelledby={titleId}
      data-state={visual}
      aria-busy={busy || undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <svg
        className={styles.icon}
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M12 16V4M6 10l6-6 6 6" />
        <path d="M4 20h16" />
      </svg>
      <div id={titleId} className={styles.title}>
        {title}
      </div>
      <div className={styles.line}>
        or{' '}
        <button
          type="button"
          className={styles.link}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          choose a file
        </button>{' '}
        · or{' '}
        <button type="button" className={styles.link} disabled={busy} onClick={handleSample}>
          try a sample run
        </button>
      </div>
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
      {/* Opened by "choose a file"; hidden from the tab order and assistive tech (the button is the control). */}
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
