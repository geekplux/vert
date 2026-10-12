import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';

/** The View's h1 size (canvas Main frame), px. */
export const TITLE_PX = 44;
/** The smallest the h1 steps down to for a long word before the word may break, px. */
export const TITLE_MIN_PX = 32;
const STEP_PX = 2;

export interface TitleFit {
  /** Font size, px. */
  readonly size: number;
  /** A word is wider than the column even at TITLE_MIN_PX: let it hyphenate or break. */
  readonly breakWords: boolean;
}

export const NO_FIT: TitleFit = { size: TITLE_PX, breakWords: false };

/**
 * The title's size: 44 px, stepped down 2 px at a time while a word is wider than the column
 * (`overflowsAt(size)`), to no less than TITLE_MIN_PX; `breakWords` when it still is there. A
 * title whose words all fit keeps 44 px and breaks only at spaces, as the canvas draws it.
 */
export function fitTitle(overflowsAt: (size: number) => boolean): TitleFit {
  let size = TITLE_PX;
  while (size > TITLE_MIN_PX && overflowsAt(size)) size -= STEP_PX;
  return { size, breakWords: overflowsAt(size) };
}

/**
 * Fits the View's h1 to its column (`fitTitle`), measured in the browser: with words kept whole,
 * a word wider than the column makes the heading's scroll width exceed its client width. Refits
 * when the column's width changes and when the web fonts finish loading. Returns a ref for the
 * heading (merged with `outerRef`) and the fit to render.
 */
export function useTitleFit(
  text: string,
  outerRef?: Ref<HTMLHeadingElement>,
): [(node: HTMLHeadingElement | null) => void, TitleFit] {
  const node = useRef<HTMLHeadingElement | null>(null);
  const [fit, setFit] = useState<TitleFit>(NO_FIT);

  const ref = useCallback(
    (element: HTMLHeadingElement | null) => {
      node.current = element;
      if (typeof outerRef === 'function') outerRef(element);
      else if (outerRef) outerRef.current = element;
    },
    [outerRef],
  );

  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const measure = () => {
      const { fontSize, overflowWrap, hyphens } = element.style;
      element.style.overflowWrap = 'normal';
      element.style.hyphens = 'manual';
      const next = fitTitle((size) => {
        element.style.fontSize = `${String(size)}px`;
        return element.scrollWidth > element.clientWidth + 0.5;
      });
      element.style.fontSize = fontSize;
      element.style.overflowWrap = overflowWrap;
      element.style.hyphens = hyphens;
      setFit((current) =>
        current.size === next.size && current.breakWords === next.breakWords ? current : next,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            measure();
          });
    observer?.observe(element.parentElement ?? element);
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    let live = true;
    void fonts?.ready.then(() => {
      if (live) measure();
    });
    fonts?.addEventListener('loadingdone', measure);
    return () => {
      live = false;
      observer?.disconnect();
      fonts?.removeEventListener('loadingdone', measure);
    };
  }, [text]);

  return [ref, fit];
}
