import { useEffect, useState } from 'react';
import { canvasInk, canvasMeasure } from './titleFit';
import type { MeasureEm, MeasureInk } from './titleFit';

/** The face the title is set in; `check`/`load` with Latin text so only that subset is needed. */
const TITLE_FACE = '800 100px Archivo';

function archivoLoaded(): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) return false;
  try {
    return document.fonts.check(TITLE_FACE, 'A');
  } catch {
    return false;
  }
}

/**
 * The title measure: canvas `measureText` once the Archivo face has loaded (immediately if it
 * already has), else `undefined` so `fitTitle` uses its table. jsdom has no `document.fonts`, so
 * tests always get the table.
 */
export function useTitleMeasure(): MeasureEm | undefined {
  const [ready, setReady] = useState(archivoLoaded);

  useEffect(() => {
    if (ready || typeof document === 'undefined' || !('fonts' in document)) return;
    let live = true;
    document.fonts
      .load(TITLE_FACE, 'A')
      .then(() => {
        if (live && archivoLoaded()) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ready]);

  return ready ? (canvasMeasure() ?? undefined) : undefined;
}

function faceReady(text: string): boolean {
  if (typeof document === 'undefined' || !('fonts' in document)) return false;
  try {
    return document.fonts.check(TITLE_FACE, text);
  } catch {
    return false;
  }
}

/** What a display title is fitted with: widths and the lines' ink extents. */
export interface TitleFonts {
  measure: MeasureEm | undefined;
  ink: MeasureInk | undefined;
}

/**
 * {@link useTitleMeasure} for `text` itself: loads the title face for every character the title
 * has (a Latin title needs only the Latin subset, as before; Ż or Ę load the Latin Extended one),
 * then gives canvas widths and canvas ink extents (`canvasInk`) once they are in. Until then, and
 * in jsdom, both are `undefined`, so the fit uses its tables. Poster A uses it, in the preview and
 * in the export's off-screen mount alike, so both set the title from the same measurements.
 */
export function useTitleFonts(text: string): TitleFonts {
  const sample = text.trim() || 'A';
  const [, setLoaded] = useState(0);
  const ready = faceReady(sample);

  useEffect(() => {
    if (ready || typeof document === 'undefined' || !('fonts' in document)) return;
    let live = true;
    document.fonts
      .load(TITLE_FACE, sample)
      .then(() => {
        if (live) setLoaded((count) => count + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ready, sample]);

  if (!ready) return { measure: undefined, ink: undefined };
  return { measure: canvasMeasure() ?? undefined, ink: canvasInk() ?? undefined };
}
