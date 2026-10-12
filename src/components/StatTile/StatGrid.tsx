import { useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import styles from './StatTile.module.css';

export interface StatGridProps {
  /** `StatTile`s. */
  children: ReactNode;
  className?: string;
}

/** Overflow tolerated before the values step down, px (sub-pixel text widths, rounding). */
export const FIT_TOLERANCE_PX = 1;

/**
 * The value scale (≤ 1, three decimals) that fits a value `width` px wide, measured while drawn at
 * `scale`, into `available` px. 1 when it fits (within {@link FIT_TOLERANCE_PX}) or cannot be
 * measured.
 */
export function fitScale(available: number, width: number, scale = 1): number {
  if (!(available > 0) || !(width > 0) || !(scale > 0)) return 1;
  const natural = width / scale;
  if (natural <= available + FIT_TOLERANCE_PX) return 1;
  return Math.floor((available / natural) * 1000) / 1000;
}

/** Whether this environment lays text out: ResizeObserver, frames and Range rects (jsdom has none). */
function canMeasureText(): boolean {
  return (
    typeof ResizeObserver !== 'undefined' &&
    typeof requestAnimationFrame === 'function' &&
    typeof document.createRange === 'function' &&
    typeof (document.createRange() as Partial<Range>).getBoundingClientRect === 'function'
  );
}

/** The fit (≤ 1) that lets every value in `grid` fit its column, drawn now at `current`. */
function measureFit(grid: HTMLElement, current: number): number {
  let fit = 1;
  for (const value of Array.from(grid.querySelectorAll('dd'))) {
    const range = document.createRange();
    range.selectNodeContents(value);
    const width = range.getBoundingClientRect().width;
    fit = Math.min(fit, fitScale(value.getBoundingClientRect().width, width, current));
  }
  return fit;
}

/**
 * Steps every value down together when one would overflow its column (`--fit`, read by the CSS):
 * a CCC-scale "+10,070 m" or "26:45:12" in a 300px aside's 106px column, which never wraps. At
 * normal values nothing changes. Re-measured when the grid's size changes (its width, or only its
 * height under a text-only zoom), a value changes or a font loads. Writing `--fit` changes the
 * grid's height, so the observers never write it themselves: they queue one measure for the next
 * animation frame (coalesced), and a measure that finds the fit unchanged writes nothing, so the
 * resize caused by its own write ends there. A write inside a ResizeObserver callback would
 * re-trigger it in the same frame ("ResizeObserver loop completed with undelivered
 * notifications"). Where text cannot be measured (jsdom: no Range rects) it does nothing, and a
 * measure that throws leaves the values as they are: it never throws in the layout effect.
 */
function useFitValues(ref: RefObject<HTMLDListElement | null>): void {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || !canMeasureText()) return;
    const measure = () => {
      const current = parseFloat(grid.style.getPropertyValue('--fit')) || 1;
      let fit: number;
      try {
        fit = measureFit(grid, current);
      } catch {
        return;
      }
      if (Math.abs(fit - current) < 0.002) return;
      if (fit < 1) grid.style.setProperty('--fit', String(fit));
      else grid.style.removeProperty('--fit');
    };
    // First fit before the first paint (no observer is delivering yet).
    measure();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(grid);
    const mutation = new MutationObserver(schedule);
    mutation.observe(grid, { subtree: true, childList: true, characterData: true });
    const fonts = 'fonts' in document ? document.fonts : null;
    fonts?.addEventListener('loadingdone', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [ref]);
}

/**
 * The aside's 2-column stat grid: a `<dl>` whose items are `StatTile`s. Values never wrap; when
 * one is too wide for its column, all of them shrink by the same factor (`useFitValues`).
 */
export function StatGrid({ children, className }: StatGridProps) {
  const ref = useRef<HTMLDListElement>(null);
  useFitValues(ref);
  return (
    <dl ref={ref} className={[styles.grid, className].filter(Boolean).join(' ')}>
      {children}
    </dl>
  );
}
