import { useEffect, useState } from 'react';
import { canvasMeasure } from './titleFit';
import type { MeasureEm } from './titleFit';

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
