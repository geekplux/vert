/**
 * The Trail Sign title fit rule: the largest font size (104 px at most, in 2 px steps) at which the
 * uppercase title wraps into at most three lines across the 624 px text column. If even the
 * minimum (48 px) needs more than three lines, it stays at 48 px and wraps to as many lines as it
 * needs (four for any realistic route name); it never overflows sideways.
 *
 * Widths come from a `MeasureEm` function:
 * - In a browser, once Archivo has loaded, `useTitleMeasure` supplies `canvasMeasure`: canvas
 *   `measureText` with the real font stack, so kerning and fallback faces (CJK) are exact.
 * - Otherwise (jsdom, before the font loads) `tableMeasure`: a table of Archivo 800 advance widths
 *   at wdth 62% (measured from `public/fonts/archivo-latin.woff2` by
 *   `docs/verify/poster-a-impl/measure-title-glyphs.mjs`), with East Asian wide characters at
 *   1 em.
 * The column is narrowed by 2% to cover kerning and the 62.5% canvas width (see `canvasMeasure`).
 *
 * Wrapping follows the browser: Latin text breaks at spaces; CJK text breaks between any two wide
 * characters, except before punctuation and small kana that may not start a line (kinsoku).
 */

/** Width of a string in em at the title face, without letter-spacing. */
export type MeasureEm = (text: string) => number;

/** Advance widths in em, Archivo weight 800, wdth 62%, no letter-spacing. */
const ADVANCE_EM: Readonly<Record<string, number>> = {
  A: 0.5, B: 0.482, C: 0.505, D: 0.503, E: 0.452, F: 0.395, G: 0.532, H: 0.504, I: 0.243,
  J: 0.426, K: 0.501, L: 0.411, M: 0.677, N: 0.508, O: 0.543, P: 0.472, Q: 0.543, R: 0.498,
  S: 0.454, T: 0.458, U: 0.495, V: 0.473, W: 0.703, X: 0.487, Y: 0.48, Z: 0.463,
  '0': 0.427, '1': 0.361, '2': 0.417, '3': 0.424, '4': 0.414, '5': 0.427, '6': 0.427,
  '7': 0.371, '8': 0.415, '9': 0.427,
  ' ': 0.117, '-': 0.24, "'": 0.199, '’': 0.198, '.': 0.212, ',': 0.212, '&': 0.534,
  '(': 0.365, ')': 0.365, '[': 0.353, ']': 0.353, '/': 0.271, ':': 0.221, '!': 0.258,
  '?': 0.409, '#': 0.48, '№': 0.98, '·': 0.21, '"': 0.365, '+': 0.509,
}; // prettier-ignore

/** Width assumed for a character not in the table (wider than most capitals, so it errs safe). */
const UNKNOWN_EM = 0.55;
/** East Asian wide and fullwidth characters are square: 1 em. */
const WIDE_EM = 1;

/**
 * East Asian Wide / Fullwidth ranges: Hangul Jamo, CJK radicals and symbols, kana, CJK
 * compatibility, CJK ideographs (incl. extension A and the supplementary planes), Yi, Hangul
 * syllables, compatibility ideographs, vertical and small forms, fullwidth forms.
 */
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{20000}-\u{3FFFD}]/u;

/** Wide characters that may not start a line (closing punctuation, small kana, prolonged mark). */
const NO_LINE_START = new Set(
  '、。，．・：；？！ー」』）】〕〉》〙〗ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々〻',
);

export const isWide = (char: string): boolean => WIDE.test(char);

/** The fallback measure: the Archivo table, wide characters at 1 em. */
export const tableMeasure: MeasureEm = (text) => {
  let width = 0;
  for (const char of text) width += ADVANCE_EM[char] ?? (isWide(char) ? WIDE_EM : UNKNOWN_EM);
  return width;
};

export interface TitleFitOptions {
  /** Line length available, px. */
  width: number;
  maxSize: number;
  minSize: number;
  maxLines: number;
  /** Letter-spacing in em (the title's is −0.01em). */
  letterSpacing: number;
  /** Size step, px. */
  step: number;
  /** The title is set uppercase (CSS `text-transform`), so it is measured uppercase. Default true. */
  uppercase?: boolean;
}

/** Trail Sign print layout: 720 − 2 × 48 px column, 104 px display, −0.01em, ≤ 3 lines. */
export const TRAIL_SIGN_TITLE: TitleFitOptions = {
  width: 624,
  maxSize: 104,
  minSize: 48,
  maxLines: 3,
  letterSpacing: -0.01,
  step: 2,
};

/** Share card without a headline stat: the title takes the big number's slot, 936 px column. */
export const SHARE_TITLE: TitleFitOptions = {
  width: 936,
  maxSize: 160,
  minSize: 64,
  maxLines: 3,
  letterSpacing: 0,
  step: 2,
};

/** True when the title has East Asian wide characters (it is then set with line-height 1). */
export const hasWide = (text: string): boolean => Array.from(text).some(isWide);

/**
 * Combining marks drawn above a letter (acute, grave, circumflex, tilde, ring, dot, caron, …), as
 * opposed to those below it (cedilla, ogonek, dot below), which hang into the line's own descent.
 */
const MARK_ABOVE =
  /[\u0300-\u0315\u031A\u033D-\u0344\u0346\u034A-\u034C\u0350-\u0352\u0357\u035B\u0363-\u036F]/u;

/**
 * True when the title, uppercased as CSS sets it, has an accented capital (Ż, Ó, É, Å, Ñ): its mark
 * stacks on the cap height and reaches up into the line above.
 */
export const hasStackedDiacritics = (text: string): boolean =>
  MARK_ABOVE.test(text.toUpperCase().normalize('NFD'));

/**
 * Top of the tallest accented capital above the baseline, em: Archivo 800 at wdth 62%, canvas
 * `actualBoundingBoxAscent` of "ŻÓÉÅ" (0.937; capitals are 0.688), measured by
 * `docs/verify/polish-3/title.mjs`.
 */
export const STACKED_ACCENT_ASCENT_EM = 0.937;

/**
 * Clear space kept between one line's glyphs and the next line's, logical px, on the 720 px print
 * poster: 4.2 px in the 18 × 24 preview (600 px wide), 3.9 px in A3's (566 px), so at least 3
 * whole pixel rows stay clear even with antialiased edges; 37 px in the 5400 px print.
 */
export const STACKED_LINE_GAP_PX = 5;
/**
 * The same on the 1080 px share card, whose preview is smaller (600 px for 4:5, 450 px for 9:16):
 * 4.2 px at 9:16's preview scale, 5.6 px at 4:5's.
 */
export const SHARE_STACKED_LINE_GAP_PX = 10;

/**
 * Top of a capital without an accent above the baseline, em, round ones' overshoot included (O,
 * C, Ç reach 0.700; flat ones 0.688). Same measurement as {@link STACKED_ACCENT_ASCENT_EM}.
 */
export const CAP_HEIGHT_EM = 0.7;
/** How far round capitals (O, G, C, S) overshoot below the baseline, em. */
export const CAP_OVERSHOOT_EM = 0.012;

/** Combining marks drawn below a letter (cedilla, ogonek, dot below, …). */
const MARK_BELOW =
  /[\u0316-\u0319\u031C-\u0333\u0339-\u033C\u0345\u0347-\u0349\u034D\u034E\u0353-\u0356\u0359\u035A]/u;

/** True when the title, uppercased, has a letter with a mark below it (Ç, Ę, Ą, Ş). */
export const hasMarksBelow = (text: string): boolean =>
  MARK_BELOW.test(text.toUpperCase().normalize('NFD'));

/** How far a line's ink reaches above and below its baseline, em. */
export interface InkExtent {
  readonly ascent: number;
  readonly descent: number;
}

/** The ink extent of a line of title text (already uppercased), at the title face. */
export type MeasureInk = (upper: string) => InkExtent;

/**
 * The fallback ink measure, where there is no canvas `TextMetrics` (jsdom, before the face has
 * loaded): Archivo's measured extremes. Below: Ç and Ę hang 0.205 em, Q and J 0.131, round
 * capitals overshoot {@link CAP_OVERSHOOT_EM}. Above: an accented capital
 * {@link STACKED_ACCENT_ASCENT_EM}, else {@link CAP_HEIGHT_EM}. Doubled Vietnamese marks (Ề, Ỗ)
 * rise higher; the canvas measure ({@link canvasInk}) sees them.
 */
export const tableInk: MeasureInk = (upper) => {
  const nfd = upper.normalize('NFD');
  const descent = MARK_BELOW.test(nfd) ? 0.205 : /[QJ]/.test(upper) ? 0.131 : CAP_OVERSHOOT_EM;
  const ascent = MARK_ABOVE.test(nfd) ? STACKED_ACCENT_ASCENT_EM : CAP_HEIGHT_EM;
  return { ascent, descent };
};

/**
 * The line-height (× size, rounded up to 0.01) at which every pair of neighbouring `lines` keeps
 * `gap` px between the lowest ink of the upper line and the highest ink of the lower one, as
 * `ink` measures them. 0 for a single line: it has nothing to touch.
 */
export function neededLineHeight(
  lines: readonly string[],
  size: number,
  gap: number,
  ink: MeasureInk = tableInk,
): number {
  if (lines.length < 2) return 0;
  let most = 0;
  for (let k = 1; k < lines.length; k++) {
    const reach =
      ink((lines[k - 1] ?? '').toUpperCase()).descent + ink((lines[k] ?? '').toUpperCase()).ascent;
    most = Math.max(most, reach + gap / size);
  }
  return Math.ceil(most * 100 - 1e-9) / 100;
}

/**
 * The display title's line-height when the CSS one (`base`, 0.88) would not do: 1 for East Asian
 * wide text, and, for a title with diacritics (an accent above a capital, or a cedilla or ogonek
 * below one), enough that, wherever two of its words could sit on neighbouring lines, the deeper
 * glyph above stays `gap` px clear of the taller one below (round capitals' overshoot included).
 * Pass `lines` (the title as broken at `size`) to count only the neighbours that really meet.
 * Undefined when the stylesheet's value already does, so other titles keep it exactly.
 */
export function titleLineHeight(
  title: string,
  size: number,
  {
    base = 0.88,
    gap = STACKED_LINE_GAP_PX,
    lines,
    ink = tableInk,
  }: { base?: number; gap?: number; lines?: readonly string[]; ink?: MeasureInk } = {},
): number | undefined {
  const wide = hasWide(title) ? 1 : undefined;
  if ((!hasStackedDiacritics(title) && !hasMarksBelow(title)) || !(size > 0)) return wide;
  // Without the breaks, the worst case: the whole title above itself.
  const needed = neededLineHeight(lines ?? [title, title], size, gap, ink);
  const floor = Math.max(base, wide ?? 0);
  return needed > floor ? needed : wide;
}

/** How a display title is set: size, lines, and (for diacritics) line-height and box height. */
export interface TitleSetting extends TitleFit {
  /** Inline line-height; undefined keeps the stylesheet's 0.88. */
  lineHeight?: number;
  /**
   * The title box's height, px, when the text is set looser than 0.88: the height the plain fit
   * takes (lines × size × 0.88, or × 1 for wide text), so the layout around it never moves.
   */
  boxHeight?: number;
}

/** The smallest size a title with diacritics shrinks to so its looser lines fit the box, px. */
const MIN_DIACRITIC_SIZE = 16;

/**
 * {@link fitTitle}, then room for diacritics: the box keeps the plain fit's height (lines × size ×
 * the stylesheet's line-height). Only when the title's lines, as broken at that size, put an
 * accent under another line (or a cedilla over one) closer than `gap` does it set them looser
 * ({@link titleLineHeight}), at the largest size (in `step`s) whose lines fit that height. So the
 * figure, stats and footer sit exactly where they would for the same title without its accents,
 * and a one-line title is never touched. Line extents come from `ink`: the real glyphs' ink with
 * the loaded face in a browser ({@link canvasInk}), the table elsewhere.
 */
export function fitTitleSetting(
  title: string,
  options: TitleFitOptions = TRAIL_SIGN_TITLE,
  measure: MeasureEm = tableMeasure,
  gap: number = STACKED_LINE_GAP_PX,
  ink: MeasureInk = tableInk,
): TitleSetting {
  const fit = fitTitle(title, options, measure);
  const wide = hasWide(title);
  const base = wide ? 1 : 0.88;
  const plain = wide ? { ...fit, lineHeight: 1 } : fit;
  const { width, letterSpacing, step, uppercase = true } = options;
  const usable = width * 0.98;
  const linesAt = (size: number) =>
    breakLines(title, usable / size, letterSpacing, measure, uppercase);
  const lineHeightAt = (size: number, lines: readonly string[]) =>
    titleLineHeight(title, size, { base, gap, lines, ink });
  if ((lineHeightAt(fit.size, linesAt(fit.size)) ?? base) <= base) return plain;
  const boxHeight = fit.lines * fit.size * base;
  let size = fit.size;
  for (; size > MIN_DIACRITIC_SIZE; size -= step) {
    const lines = linesAt(size);
    const lineHeight = lineHeightAt(size, lines) ?? base;
    if (lines.length * size * lineHeight <= boxHeight + 1e-6) {
      return { size, lines: lines.length, lineHeight, boxHeight };
    }
  }
  size = MIN_DIACRITIC_SIZE;
  const lines = linesAt(size);
  return { size, lines: lines.length, lineHeight: lineHeightAt(size, lines) ?? base, boxHeight };
}

/**
 * Width of `text` in em at the title face (uppercased, as CSS shows it, unless `uppercase` is
 * false), with letter-spacing.
 */
export function titleWidthEm(
  text: string,
  letterSpacing = 0,
  measure: MeasureEm = tableMeasure,
  uppercase = true,
): number {
  const upper = uppercase ? text.toUpperCase() : text;
  return measure(upper) + letterSpacing * Array.from(upper).length;
}

interface Token {
  text: string;
  /** A space separates it from the previous token. */
  space: boolean;
}

/** Break opportunities: words between spaces, and every wide character on its own. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let word = '';
  let space = false;
  const flush = () => {
    if (!word) return;
    tokens.push({ text: word, space });
    word = '';
    space = false;
  };
  for (const char of text.trim()) {
    if (/\s/.test(char)) {
      flush();
      space = tokens.length > 0;
    } else if (isWide(char)) {
      const last = tokens.at(-1);
      if (NO_LINE_START.has(char) && !word && !space && last) {
        last.text += char;
      } else {
        flush();
        tokens.push({ text: char, space });
        space = false;
      }
    } else {
      word += char;
    }
  }
  flush();
  return tokens;
}

/**
 * Greedy line breaking, as the browser does it: how many lines `text` takes in `widthEm`. A word
 * wider than the line counts as many lines as it needs (CSS breaks it with
 * `overflow-wrap: anywhere`).
 */
export function countLines(
  text: string,
  widthEm: number,
  letterSpacing = 0,
  measure: MeasureEm = tableMeasure,
  uppercase = true,
): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const space = titleWidthEm(' ', letterSpacing, measure, uppercase);
  let lines = 0;
  let current = 0;
  const startLine = (w: number) => {
    lines += Math.max(1, Math.ceil(w / widthEm));
    current = w > widthEm ? w - (Math.ceil(w / widthEm) - 1) * widthEm : w;
  };
  for (const token of tokens) {
    const w = titleWidthEm(token.text, letterSpacing, measure, uppercase);
    const gap = token.space ? space : 0;
    if (lines === 0) startLine(w);
    else if (current + gap + w <= widthEm) current += gap + w;
    else startLine(w);
  }
  return lines;
}

/**
 * The lines {@link countLines} counts, as text (joined by single spaces). A word wider than the
 * line fills as many lines as it needs; each of them is given the whole word (its diacritics could
 * be on any of them).
 */
export function breakLines(
  text: string,
  widthEm: number,
  letterSpacing = 0,
  measure: MeasureEm = tableMeasure,
  uppercase = true,
): string[] {
  const tokens = tokenize(text);
  const space = titleWidthEm(' ', letterSpacing, measure, uppercase);
  const lines: string[] = [];
  let current = 0;
  const startLine = (word: string, w: number) => {
    const count = Math.max(1, Math.ceil(w / widthEm));
    for (let k = 0; k < count; k++) lines.push(word);
    current = w > widthEm ? w - (count - 1) * widthEm : w;
  };
  for (const token of tokens) {
    const w = titleWidthEm(token.text, letterSpacing, measure, uppercase);
    const gap = token.space ? space : 0;
    if (lines.length === 0) startLine(token.text, w);
    else if (current + gap + w <= widthEm) {
      current += gap + w;
      const last = lines.length - 1;
      lines[last] = `${lines[last] ?? ''}${token.space ? ' ' : ''}${token.text}`;
    } else startLine(token.text, w);
  }
  return lines;
}

export interface TitleFit {
  /** Font size, px. */
  size: number;
  /** Lines the title takes at that size (more than `maxLines` only at `minSize`). */
  lines: number;
}

/** The largest size step ≤ maxSize at which the title fits in maxLines; else minSize. */
export function fitTitle(
  title: string,
  options: TitleFitOptions = TRAIL_SIGN_TITLE,
  measure: MeasureEm = tableMeasure,
): TitleFit {
  const { width, maxSize, minSize, maxLines, letterSpacing, step, uppercase = true } = options;
  const usable = width * 0.98;
  const linesAt = (size: number) =>
    countLines(title, usable / size, letterSpacing, measure, uppercase);
  for (let size = maxSize; size > minSize; size -= step) {
    const lines = linesAt(size);
    if (lines <= maxLines) return { size, lines };
  }
  return { size: minSize, lines: linesAt(minSize) };
}

/** `fitTitle(...).size`. */
export function fitTitleSize(
  title: string,
  options: TitleFitOptions = TRAIL_SIGN_TITLE,
  measure: MeasureEm = tableMeasure,
): number {
  return fitTitle(title, options, measure).size;
}

const FALLBACK_STACK = "'Archivo', sans-serif";
let canvasMeasureFn: MeasureEm | null | undefined;
let canvasInkFn: MeasureInk | null | undefined;

/** A 2D context set to the title face at 100 px (as `canvasMeasure` uses it), or null. */
function titleContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  return context;
}

/**
 * Canvas `TextMetrics` ink extents of a line at the display face, weight 800 (as
 * {@link canvasMeasure} sets it), em: `actualBoundingBoxAscent` / `Descent`, so every mark the
 * line really has counts (Vietnamese Ề, Ỗ rise past the table's accent height). Measure only once
 * the face has loaded (`useTitleFonts`). Null without a 2D canvas or `TextMetrics` (jsdom).
 */
export function canvasInk(): MeasureInk | null {
  if (canvasInkFn !== undefined) return canvasInkFn;
  canvasInkFn = null;
  const ctx = titleContext();
  if (!ctx) return null;
  const stack =
    getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() ||
    FALLBACK_STACK;
  canvasInkFn = createCanvasInk(ctx, stack);
  return canvasInkFn;
}

/**
 * The ink measure over a 2D context (see {@link canvasInk}): `font` at weight 800, 100 px,
 * extra-condensed. Null when the context's `TextMetrics` has no ink bounds.
 */
export function createCanvasInk(
  ctx: Pick<CanvasRenderingContext2D, 'font' | 'fontStretch' | 'measureText'>,
  font: string,
): MeasureInk | null {
  const set = () => {
    ctx.font = `800 100px ${font}`;
    ctx.fontStretch = 'extra-condensed';
  };
  set();
  if (typeof ctx.measureText('H').actualBoundingBoxAscent !== 'number') return null;
  const cache = new Map<string, InkExtent>();
  return (upper) => {
    let extent = cache.get(upper);
    if (extent === undefined) {
      set();
      const metrics = ctx.measureText(upper);
      extent = {
        ascent: Math.max(0, metrics.actualBoundingBoxAscent) / 100,
        descent: Math.max(0, metrics.actualBoundingBoxDescent) / 100,
      };
      cache.set(upper, extent);
    }
    return extent;
  };
}

/**
 * Canvas `measureText` with the display font stack (`--font-display`) at weight 800. Canvas has
 * no percentage font-stretch, so it measures at `extra-condensed` (62.5%, at most 0.8% wider
 * than the title's 62%: errs safe). Null when there is no 2D canvas (jsdom).
 */
export function canvasMeasure(): MeasureEm | null {
  if (canvasMeasureFn !== undefined) return canvasMeasureFn;
  canvasMeasureFn = null;
  if (typeof document === 'undefined') return null;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  if (!context) return null;
  const ctx = context;
  const stack =
    getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() ||
    FALLBACK_STACK;
  const cache = new Map<string, number>();
  canvasMeasureFn = (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      ctx.font = `800 100px ${stack}`;
      ctx.fontStretch = 'extra-condensed';
      width = ctx.measureText(text).width / 100;
      cache.set(text, width);
    }
    return width;
  };
  return canvasMeasureFn;
}
