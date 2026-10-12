/**
 * Poster mode's data-driven copy: the download file name and button labels, and the size's use.
 */
import type { PosterSize, PosterSizeId } from '../../poster/sizes';
import type { PosterStyleOption } from '../../poster/styles';

/** Longest slug the file name carries, in characters. */
const SLUG_MAX = 60;

/**
 * A file-name slug: lowercase letters and digits of any script joined by single hyphens, accents
 * dropped ("Côte d’Azur Loop" → "cote-d-azur-loop"); empty when the text has neither.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
}

/**
 * The download's file name: "vert-coosa-backcountry-trail-18x24.png" from the poster's title and
 * size ("vert-18x24.png" when the title has no letters or digits).
 */
export function posterFileName(title: string, sizeId: PosterSizeId, extension: 'png' | 'pdf') {
  return ['vert', slugify(title), sizeId].filter(Boolean).join('-') + `.${extension}`;
}

/** "Download PNG · 5400 × 7200". */
export function pngButtonLabel(size: Pick<PosterSize, 'width' | 'height'>): string {
  return `Download PNG · ${String(size.width)} × ${String(size.height)}`;
}

/** Print sizes also offer a PDF; social and story sizes are PNG only. */
export function offersPdf(size: Pick<PosterSize, 'use'>): boolean {
  return size.use === 'print';
}

/** "Night Ridge" from "B Night Ridge": the style's name without its letter. */
export function styleTitle(style: Pick<PosterStyleOption, 'id' | 'name'>): string {
  return style.name.startsWith(`${style.id} `) ? style.name.slice(style.id.length + 1) : style.name;
}

/** Tiles rendered so far out of the total, as the exporting screen carries it (null: unknown). */
export interface ExportProgressValue {
  readonly done: number;
  readonly total: number | null;
}

/** Shown until the exporter reports how many tiles it will render. */
export const PREPARING_LABEL = 'Preparing…';

/**
 * "Rendering tile 4 of 12": the tile being rendered, which is the one after those done (the last
 * tile once all are done). "Preparing…" until the total is known.
 */
export function exportTileLabel({ done, total }: ExportProgressValue): string {
  if (total === null) return PREPARING_LABEL;
  return `Rendering tile ${String(Math.min(done + 1, total))} of ${String(total)}`;
}

/** The progress bar's value for assistive tech: "3 of 12 tiles rendered", or "Preparing". */
export function exportValueText({ done, total }: ExportProgressValue): string {
  if (total === null) return 'Preparing';
  return `${String(done)} of ${String(total)} tiles rendered`;
}

/**
 * What the polite status region says while exporting. It changes only on start and at each
 * quarter, so a screen reader hears a few updates, not one per tile: "Exporting <file>.",
 * "Export 25% done.", "Export 50% done.", "Export 75% done." Learning the total does not change
 * it, so "Preparing…" → tile 1 is not announced. The label carries the exact tile when focused.
 *
 * At done = total it returns "Rendered 12 of 12 tiles.", but in the app that is normally not
 * heard: an exporter resolves right after its last tile, EXPORT_DONE replaces the text with
 * "Saved <file>." (or EXPORT_FAILED with the error) before the screen reader speaks, and only the
 * outcome is announced. It is heard only if an exporter pauses after the last tile (e.g. while
 * encoding the file).
 */
export function exportAnnouncement({ done, total }: ExportProgressValue, fileName: string): string {
  if (total === null) return `Exporting ${fileName}.`;
  const quarter = Math.min(4, Math.floor((4 * done) / total));
  if (quarter === 0) return `Exporting ${fileName}.`;
  if (quarter === 4) {
    return `Rendered ${String(total)} of ${String(total)} ${total === 1 ? 'tile' : 'tiles'}.`;
  }
  return `Export ${String(quarter * 25)}% done.`;
}
