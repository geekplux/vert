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

/** Width of `text` in em at the title face (uppercased, as CSS shows it), with letter-spacing. */
export function titleWidthEm(
  text: string,
  letterSpacing = 0,
  measure: MeasureEm = tableMeasure,
): number {
  const upper = text.toUpperCase();
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
): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const space = titleWidthEm(' ', letterSpacing, measure);
  let lines = 0;
  let current = 0;
  const startLine = (w: number) => {
    lines += Math.max(1, Math.ceil(w / widthEm));
    current = w > widthEm ? w - (Math.ceil(w / widthEm) - 1) * widthEm : w;
  };
  for (const token of tokens) {
    const w = titleWidthEm(token.text, letterSpacing, measure);
    const gap = token.space ? space : 0;
    if (lines === 0) startLine(w);
    else if (current + gap + w <= widthEm) current += gap + w;
    else startLine(w);
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
  const { width, maxSize, minSize, maxLines, letterSpacing, step } = options;
  const usable = width * 0.98;
  const linesAt = (size: number) => countLines(title, usable / size, letterSpacing, measure);
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
