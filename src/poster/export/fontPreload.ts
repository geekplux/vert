/**
 * Loads the export's embedded font files in the page before any SVG image uses them.
 *
 * Why: an SVG drawn as an image loads its `@font-face` files lazily, when its text needs them
 * (a second unicode-range subset, such as Latin Extended for "Łódź", is only requested once that
 * text is shaped). Chrome resolves the image's `decode()` without waiting for those loads and
 * draws text in a still-loading face as nothing, so a cold export lost every Archivo text run
 * (title and stats). A `FontFace` in the page with the very same data URL puts the decoded file in
 * the memory cache that SVG images share, so their faces are ready the moment they are needed.
 * Verified in Chromium: first-image text 0 → full ink, 5/5 cold runs (docs/verify/export-engine).
 */

/** Loads every data URL as a font; resolves with a function that lets them go. */
export async function preloadFonts(urls: readonly string[]): Promise<() => void> {
  if (urls.length === 0 || typeof FontFace === 'undefined') return () => undefined;
  // Not added to document.fonts: the page never uses these names; holding the objects keeps the
  // decoded files alive for the export's duration.
  let faces: FontFace[] | null = urls.map(
    (url, i) => new FontFace(`vert-export-preload-${String(i)}`, `url("${url}")`),
  );
  // A face that fails to load is left to the fallback stack, as on screen.
  await Promise.all(faces.map((face) => face.load().catch(() => undefined)));
  return () => {
    faces = null;
  };
}
