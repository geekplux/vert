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

/**
 * PHASE 2 PLACEHOLDER: the tile count an export starts with. Phase 3 (export, task 6) computes it
 * from the size's tiling and drives the progress for real.
 */
export const PLACEHOLDER_EXPORT_TILES = 12;
