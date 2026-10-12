/**
 * Title measuring for styles B and E, the counterpart of `useTitleMeasure` (style A): canvas
 * `measureText` with the real face once `loadPosterFonts` has resolved, and before that (and in
 * jsdom) a table of advance widths measured from the woff2 files in /public/fonts
 * (`docs/verify/styles-be-impl/measure-glyphs.py`). East Asian wide characters count 1 em.
 */
import { useEffect, useState } from 'react';
import { loadPosterFonts } from './fonts';
import type { PosterStyleId } from './styles';
import { isWide } from './titleFit';
import type { MeasureEm } from './titleFit';

/** Big Shoulders Display, wght 800, advance widths in em. */
const BIG_SHOULDERS_800: Readonly<Record<string, number>> = {
  A: 0.443, B: 0.441, C: 0.455, D: 0.461, E: 0.382, F: 0.378, G: 0.457, H: 0.455, I: 0.215,
  J: 0.421, K: 0.459, L: 0.374, M: 0.691, N: 0.508, O: 0.462, P: 0.436, Q: 0.462, R: 0.445,
  S: 0.441, T: 0.385, U: 0.453, V: 0.457, W: 0.733, X: 0.435, Y: 0.43, Z: 0.388,
  '0': 0.473, '1': 0.256, '2': 0.457, '3': 0.47, '4': 0.479, '5': 0.48, '6': 0.466,
  '7': 0.447, '8': 0.467, '9': 0.466,
  ' ': 0.217, '-': 0.413, "'": 0.191, '’': 0.239, '.': 0.238, ',': 0.239, '&': 0.582,
  '(': 0.277, ')': 0.277, '[': 0.329, ']': 0.329, '/': 0.389, ':': 0.238, '!': 0.238,
  '?': 0.441, '#': 0.692, '·': 0.179, '"': 0.369, '+': 0.512,
}; // prettier-ignore

/** Libre Caslon Text, 400 roman, advance widths in em (mixed case: the E title is not uppercase). */
const CASLON_400: Readonly<Record<string, number>> = {
  A: 0.744, B: 0.699, C: 0.774, D: 0.81, E: 0.692, F: 0.65, G: 0.808, H: 0.857, I: 0.374,
  J: 0.362, K: 0.783, L: 0.656, M: 1.012, N: 0.828, O: 0.836, P: 0.663, Q: 0.836, R: 0.733,
  S: 0.599, T: 0.754, U: 0.774, V: 0.721, W: 1.09, X: 0.787, Y: 0.709, Z: 0.676,
  a: 0.525, b: 0.602, c: 0.535, d: 0.607, e: 0.56, f: 0.351, g: 0.514, h: 0.619, i: 0.3,
  j: 0.28, k: 0.591, l: 0.289, m: 0.907, n: 0.611, o: 0.616, p: 0.615, q: 0.602, r: 0.415,
  s: 0.435, t: 0.35, u: 0.598, v: 0.566, w: 0.849, x: 0.579, y: 0.572, z: 0.513,
  '0': 0.64, '1': 0.42, '2': 0.579, '3': 0.554, '4': 0.582, '5': 0.547, '6': 0.59,
  '7': 0.493, '8': 0.595, '9': 0.591,
  ' ': 0.272, '-': 0.465, "'": 0.218, '’': 0.242, '.': 0.262, ',': 0.263, '&': 0.812,
  '(': 0.305, ')': 0.305, '[': 0.324, ']': 0.324, '/': 0.363, ':': 0.284, '!': 0.301,
  '?': 0.411, '#': 0.674, '·': 0.282, '"': 0.37, '+': 0.502,
}; // prettier-ignore

export interface TitleFace {
  /** The style whose fonts carry the face. */
  readonly style: PosterStyleId;
  /** CSS font shorthand at 100px, for canvas `measureText`. */
  readonly font: string;
  readonly table: Readonly<Record<string, number>>;
  /** Width for a character not in the table (wider than most letters, so it errs safe). */
  readonly unknown: number;
}

export const NIGHT_RIDGE_TITLE_FACE: TitleFace = {
  style: 'B',
  font: "800 100px 'Big Shoulders Display', 'Arial Narrow', sans-serif",
  table: BIG_SHOULDERS_800,
  unknown: 0.5,
};

export const SURVEY_QUAD_TITLE_FACE: TitleFace = {
  style: 'E',
  font: "400 100px 'Libre Caslon Text', Georgia, serif",
  table: CASLON_400,
  unknown: 0.85,
};

const tableMeasures = new WeakMap<TitleFace, MeasureEm>();

/** The table measure of a face. */
export function faceTableMeasure(face: TitleFace): MeasureEm {
  let measure = tableMeasures.get(face);
  if (!measure) {
    measure = (text) => {
      let width = 0;
      for (const char of text) width += face.table[char] ?? (isWide(char) ? 1 : face.unknown);
      return width;
    };
    tableMeasures.set(face, measure);
  }
  return measure;
}

const canvasMeasures = new Map<string, MeasureEm | null>();

/** Canvas `measureText` at the face's font, cached; null without a 2D canvas (jsdom). */
export function faceCanvasMeasure(face: TitleFace): MeasureEm | null {
  const cached = canvasMeasures.get(face.font);
  if (cached !== undefined) return cached;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  if (!context) {
    canvasMeasures.set(face.font, null);
    return null;
  }
  const ctx = context;
  const cache = new Map<string, number>();
  const measure: MeasureEm = (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      ctx.font = face.font;
      width = ctx.measureText(text).width / 100;
      cache.set(text, width);
    }
    return width;
  };
  canvasMeasures.set(face.font, measure);
  return measure;
}

/**
 * The title measure for `face`: the table until `loadPosterFonts(face.style)` resolves, then the
 * canvas measure on the real face (the table again where there is no canvas).
 */
export function useFaceMeasure(face: TitleFace): MeasureEm {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    loadPosterFonts(face.style)
      .then(() => {
        if (live && typeof document !== 'undefined' && 'fonts' in document) setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [face.style]);
  return (loaded ? faceCanvasMeasure(face) : null) ?? faceTableMeasure(face);
}
