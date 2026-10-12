/**
 * Poster mode's data-driven copy: the download file name and button labels, and the size's use.
 */
import type { PosterSize, PosterSizeId } from '../../poster/sizes';
import type { PosterStyleOption } from '../../poster/styles';

/** Longest slug the file name carries, in characters. */
const SLUG_MAX = 60;

/**
 * Latin letters that Unicode does not decompose into a base letter and an accent, so NFKD and
 * dropping marks leave them as they are: written as the ASCII letters they are usually
 * transliterated to ("Żółta Góra" → "zolta-gora", "Ålesund Øya" → "alesund-oya").
 */
const LATIN_LETTERS: Readonly<Record<string, string>> = {
  ł: 'l',
  Ł: 'L',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ß: 'ss',
  ẞ: 'SS',
  þ: 'th',
  Þ: 'TH',
  ı: 'i',
  ŋ: 'n',
  Ŋ: 'N',
  ħ: 'h',
  Ħ: 'H',
  ŧ: 't',
  Ŧ: 'T',
  ĸ: 'k',
};
const LATIN_LETTER = new RegExp(`[${Object.keys(LATIN_LETTERS).join('')}]`, 'gu');

/**
 * A file-name slug: lowercase letters and digits of any script joined by single hyphens. Accents
 * are dropped from Latin letters ("Côte d’Azur Loop" → "cote-d-azur-loop") and Latin letters
 * without a decomposition are transliterated (`LATIN_LETTERS`: "ł" → "l", "æ" → "ae", "ß" →
 * "ss"). Other scripts are kept as written, marks included ("高尾山 Trail" → "高尾山-trail",
 * "ぶどう" stays "ぶどう", "हिमालय" keeps its vowel signs), recomposed (NFC). Empty when the text
 * has no letters or digits.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, '')
    .replace(LATIN_LETTER, (letter) => LATIN_LETTERS[letter] ?? letter)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+/, '');
  return Array.from(slug).slice(0, SLUG_MAX).join('').replace(/-+$/, '');
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
 * Tiles rendered so far out of the total, as the exporting screen carries it (null: unknown), and
 * `stage: 'encode'` once the file is being written.
 */
export interface ExportProgressValue {
  readonly done: number;
  readonly total: number | null;
  readonly stage?: 'encode';
}

/** Shown until the exporter reports how many tiles it will render. */
export const PREPARING_LABEL = 'Preparing…';

/** Shown while the exporter writes the file, after the last tile. */
export const SAVING_LABEL = 'Saving the file…';

/**
 * "Rendering tile 4 of 12": the tile being rendered, which is the one after those done (the last
 * tile once all are done). "Preparing…" until the total is known, "Saving the file…" while the
 * file is written.
 */
export function exportTileLabel({ done, total, stage }: ExportProgressValue): string {
  if (total === null) return PREPARING_LABEL;
  if (stage === 'encode') return SAVING_LABEL;
  return `Rendering tile ${String(Math.min(done + 1, total))} of ${String(total)}`;
}

/**
 * The progress bar's value for assistive tech: "3 of 12 tiles rendered", "Preparing", or "All 12
 * tiles rendered, saving the file".
 */
export function exportValueText({ done, total, stage }: ExportProgressValue): string {
  if (total === null) return 'Preparing';
  if (stage === 'encode') return `All ${String(total)} tiles rendered, saving the file`;
  return `${String(done)} of ${String(total)} tiles rendered`;
}

/**
 * What the polite status region says while exporting. It changes only on start and at each
 * quarter, so a screen reader hears a few updates, not one per tile: "Exporting <file>.",
 * "Export 25% done.", "Export 50% done.", "Export 75% done." Learning the total does not change
 * it, so "Preparing…" → tile 1 is not announced. The label carries the exact tile when focused.
 *
 * At done = total it returns "Rendered 12 of 12 tiles.", also while the file is written (the
 * encode stage does not add an announcement; the label says "Saving the file…"). A small poster
 * encodes at once and EXPORT_DONE replaces it with "Saved <file>." (or EXPORT_FAILED with the
 * error) before the screen reader speaks; a print poster's encode takes long enough for it to be
 * heard, followed by the outcome.
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
