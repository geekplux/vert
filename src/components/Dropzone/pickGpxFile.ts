/**
 * The rules for which file the Dropzone takes: from its file input, from drops on it, and from
 * drops elsewhere on the page that the page hands it (`DropzoneHandle.takeFiles`). One place, so
 * every way in accepts and rejects the same files with the same words.
 */

const MB = 1024 * 1024;

/** File extensions taken by default, as in `<input accept>`. */
export const DEFAULT_ACCEPT = '.gpx';

/** Largest file taken by default: 20 MB. */
export const DEFAULT_MAX_BYTES = 20 * MB;

/** What `pickGpxFile` decided: the file to read, a message for the user, or nothing to do. */
export type PickResult = { file: File } | { error: string } | null;

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
export function acceptedExtensions(accept: string): string[] {
  return accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith('.') && entry.length > 1)
    .map((entry) => entry.slice(1));
}

/**
 * Picks the first file with an accepted extension and checks its size. Returns that file, an error
 * message naming what was wrong (the first file's extension, or the size and the limit), or `null`
 * when there were no files at all.
 */
export function pickGpxFile(
  files: readonly File[],
  accept: string = DEFAULT_ACCEPT,
  maxBytes: number = DEFAULT_MAX_BYTES,
): PickResult {
  const first = files[0];
  if (!first) return null;

  const extensions = acceptedExtensions(accept);
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
