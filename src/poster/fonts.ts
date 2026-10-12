/**
 * Poster fonts, loaded on demand (DECISIONS "Posters"): style A uses the app's Archivo and IBM Plex
 * Mono (already declared by fonts.css); B and E add faces declared in `poster-fonts.css`, which is
 * injected only when a poster in that style is shown, never at app start.
 */
import posterFontsCss from '../styles/poster-fonts.css?inline';
import type { PosterStyleId } from './styles';

/** The CSS font shorthands each style draws with; `document.fonts.load` takes these. */
export const POSTER_FACES: Readonly<Record<PosterStyleId, readonly string[]>> = {
  A: ['800 100px Archivo', '700 100px Archivo', '400 100px "IBM Plex Mono"'],
  B: ['800 100px "Big Shoulders Display"', '400 100px "JetBrains Mono"'],
  E: [
    '400 100px "Libre Caslon Text"',
    '400 100px "Archivo Narrow"',
    '600 100px "Archivo Narrow"',
    '700 100px "Archivo Narrow"',
  ],
};

/** Faces a style uses only for its subtitle (E sets it in Caslon italic). */
export const POSTER_SUBTITLE_FACES: Readonly<Record<PosterStyleId, readonly string[]>> = {
  A: [],
  B: [],
  E: ['italic 400 100px "Libre Caslon Text"'],
};

/** id of the injected `<style>` element. */
export const POSTER_FONTS_STYLE_ID = 'vert-poster-fonts';

/** Adds the poster `@font-face` sheet to the document once. */
export function injectPosterFontFaces(doc: Document = document): void {
  if (doc.getElementById(POSTER_FONTS_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = POSTER_FONTS_STYLE_ID;
  style.textContent = posterFontsCss;
  doc.head.appendChild(style);
}

/**
 * Makes sure every face `style` uses is loaded: injects the poster font sheet (B and E) and awaits
 * `document.fonts.load` for each face, with `text` deciding which unicode-range subsets are
 * fetched (pass the poster's text so a title with "ł" or "ö" gets its latin-ext file too). The
 * subtitle-only faces (E's Caslon italic) load only with `subtitle: true`, i.e. when the poster
 * has a subtitle. Call it
 * before showing a poster and again before exporting, so the export never draws a fallback face.
 * Resolves without waiting where there is no Font Loading API (jsdom). A face that fails to load
 * does not reject: the poster then renders with the fallback stack.
 */
export async function loadPosterFonts(
  style: PosterStyleId,
  text = 'Aa0',
  { subtitle = false }: { subtitle?: boolean } = {},
): Promise<void> {
  if (typeof document === 'undefined') return;
  if (style !== 'A') injectPosterFontFaces(document);
  if (!('fonts' in document)) return;
  const sample = text || 'Aa0';
  const faces = subtitle
    ? [...POSTER_FACES[style], ...POSTER_SUBTITLE_FACES[style]]
    : POSTER_FACES[style];
  await Promise.all(faces.map((face) => document.fonts.load(face, sample).catch(() => [])));
}

/** Whether `face` has loaded (false without the Font Loading API). */
export function faceReady(face: string, text = 'A'): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) return false;
  try {
    return document.fonts.check(face, text);
  } catch {
    return false;
  }
}
