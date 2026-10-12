/**
 * Poster mode's data-driven copy: the download file name and button labels, and the size's use.
 */
import type { PosterSize, PosterSizeId } from '../../poster/sizes';
import type { PosterStyleId, PosterStyleOption } from '../../poster/styles';

/** Longest slug the file name carries, in code points (cut at a grapheme boundary). */
const SLUG_MAX = 60;

/**
 * Longest file name, in UTF-8 bytes: file systems allow 255, and a download that clashes gets a
 * " (1)" added, so this leaves headroom.
 */
export const FILE_NAME_MAX_BYTES = 200;

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
 * Format characters: ZWJ and ZWNJ (Chrome writes them as "_" in a downloaded file's name, so the
 * name shown would not match the file), tags, bidi controls, soft hyphen, BOM…
 */
const FORMAT = /\p{Cf}/gu;
/**
 * Default-ignorable code points that are not format characters: variation selectors, the Hangul
 * fillers (U+115F, U+1160, U+3164, U+FFA0; the last two become U+1160 under NFKD), the combining
 * grapheme joiner U+034F and Khmer U+17B4/U+17B5. They draw nothing, so "ㅤㅤ" would otherwise name
 * a file "vert-ᅠᅠ-…".
 */
const IGNORABLE = /[\p{Default_Ignorable_Code_Point}\p{Variation_Selector}]/gu;
/** A run of marks that does not follow a letter or a mark: after a digit, a symbol, or nothing. */
const STRAY_MARKS = /(?<![\p{L}\p{M}])\p{M}+/gu;
/** Everything that becomes a hyphen: anything but letters, marks and digits. */
const SEPARATOR = /[^\p{L}\p{M}\p{N}]+/gu;
const MARK = /^\p{M}/u;

const utf8 = new TextEncoder();
const byteLength = (text: string) => utf8.encode(text).length;

/**
 * `text` split into graphemes (user-perceived characters): `Intl.Segmenter` where available, else
 * code points with any mark kept with the one before it.
 */
export function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
  }
  const parts: string[] = [];
  for (const point of text) {
    const last = parts.at(-1);
    if (last !== undefined && MARK.test(point)) parts[parts.length - 1] = last + point;
    else parts.push(point);
  }
  return parts;
}

/**
 * The longest run of whole graphemes from the start of `slug` within `maxPoints` code points and
 * `maxBytes` UTF-8 bytes, without a hyphen at its end. A first grapheme longer than that
 * on its own (a letter under dozens of marks) is cut by code points, so a letter is kept.
 */
function capSlug(slug: string, maxPoints: number, maxBytes: number): string {
  let kept = '';
  let points = 0;
  let bytes = 0;
  for (const grapheme of graphemes(slug)) {
    const graphemePoints = Array.from(grapheme).length;
    const graphemeBytes = byteLength(grapheme);
    if (points + graphemePoints > maxPoints || bytes + graphemeBytes > maxBytes) {
      if (kept === '') {
        for (const point of grapheme) {
          if (points + 1 > maxPoints || bytes + byteLength(point) > maxBytes) break;
          kept += point;
          points += 1;
          bytes += byteLength(point);
        }
      }
      break;
    }
    kept += grapheme;
    points += graphemePoints;
    bytes += graphemeBytes;
  }
  return kept.replace(/-+$/, '');
}

/**
 * A file-name slug: lowercase letters and digits of any script joined by single hyphens. Accents
 * are dropped from Latin letters ("Côte d’Azur Loop" → "cote-d-azur-loop") and Latin letters
 * without a decomposition are transliterated (`LATIN_LETTERS`: "ł" → "l", "æ" → "ae", "ß" →
 * "ss"). Other scripts are kept as written, marks included ("高尾山 Trail" → "高尾山-trail",
 * "ぶどう" stays "ぶどう", "हिमालय" keeps its vowel signs), recomposed (NFC).
 *
 * Invisible leftovers are dropped: marks that do not follow a letter (an acute accent after a
 * digit, an emoji's VS16), default-ignorable code points (variation selectors, Hangul fillers,
 * CGJ…) and format characters, ZWJ and ZWNJ included even between letters, since Chrome would save them as "_" (Persian "می‌خواهم" becomes "میخواهم"; a
 * Devanagari conjunct keeps its virama and stays whole). The slug stops at 60 code points and
 * `maxBytes` UTF-8 bytes, at a grapheme boundary, so a conjunct is never split. Empty when the
 * text has no letters or digits.
 */
export function slugify(text: string, maxBytes = Infinity): string {
  const slug = text
    .normalize('NFKD')
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, '')
    .replace(LATIN_LETTER, (letter) => LATIN_LETTERS[letter] ?? letter)
    .normalize('NFC')
    .toLowerCase()
    .replace(IGNORABLE, '')
    .replace(FORMAT, '')
    .replace(STRAY_MARKS, '')
    // Stripping can leave a decomposed sequence (a CGJ removed between Hangul jamo): recompose.
    .normalize('NFC')
    .replace(SEPARATOR, '-')
    .replace(/^-+/, '');
  return capSlug(slug, SLUG_MAX, maxBytes);
}

/** Each style's name in a file name, so A, B and E downloads of one run never clash. */
export const STYLE_FILE_SLUGS: Readonly<Record<PosterStyleId, string>> = {
  A: 'trail-sign',
  B: 'night-ridge',
  E: 'survey-quad',
};

/**
 * The download's file name: "vert-coosa-backcountry-trail-trail-sign-18x24.png" from the poster's
 * title, style and size ("vert-trail-sign-18x24.png" when the title has no letters or digits), at
 * most {@link FILE_NAME_MAX_BYTES} UTF-8 bytes (the title is cut, never the style or size).
 */
export function posterFileName(
  title: string,
  styleId: PosterStyleId,
  sizeId: PosterSizeId,
  extension: 'png' | 'pdf',
) {
  const suffix = `-${STYLE_FILE_SLUGS[styleId]}-${sizeId}.${extension}`;
  const slug = slugify(title, FILE_NAME_MAX_BYTES - byteLength(`vert-${suffix}`));
  return ['vert', slug].filter(Boolean).join('-') + suffix;
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
 * How long an export runs before the status region announces its progress milestones. Most exports
 * finish sooner, and a screen reader then hears only the start and the outcome.
 */
export const ANNOUNCE_MILESTONES_AFTER_MS = 2000;

/**
 * What the polite status region says while exporting: "Exporting <file>." from the start, and once
 * the export has run {@link ANNOUNCE_MILESTONES_AFTER_MS} (`milestones`), the quarter it has
 * reached: "Export 25% done.", "Export 50% done.", "Export 75% done.", then "Rendered 12 of 12
 * tiles." It does not change per tile, when the total is learned ("Preparing…" → tile 1), or when
 * the file is being written (the label says "Saving the file…"); the label carries the exact tile
 * when focused. The outcome ("Saved <file>." or the error) replaces it when the export ends.
 */
export function exportAnnouncement(
  { done, total }: ExportProgressValue,
  fileName: string,
  milestones: boolean,
): string {
  if (total === null || !milestones) return `Exporting ${fileName}.`;
  const quarter = Math.min(4, Math.floor((4 * done) / total));
  if (quarter === 0) return `Exporting ${fileName}.`;
  if (quarter === 4) {
    return `Rendered ${String(total)} of ${String(total)} ${total === 1 ? 'tile' : 'tiles'}.`;
  }
  return `Export ${String(quarter * 25)}% done.`;
}
