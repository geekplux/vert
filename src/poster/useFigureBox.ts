import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { FigureBoxSize } from './TrailSignPoster';

/**
 * Reports an element's layout size in logical px (ResizeObserver `contentRect`, unaffected by the
 * preview's `transform: scale()`) to `onFigureBox` when it is first laid out and whenever it
 * changes. Returns the ref to attach. No-op without `onFigureBox` or ResizeObserver (jsdom).
 */
export function useFigureBox<T extends HTMLElement>(
  onFigureBox: ((size: FigureBoxSize) => void) | undefined,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const callback = useRef(onFigureBox);
  useLayoutEffect(() => {
    callback.current = onFigureBox;
  });
  const observe = onFigureBox !== undefined;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!observe || !element || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      const key = `${String(rect.width)}×${String(rect.height)}`;
      if (key === last) return;
      last = key;
      callback.current?.({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [observe]);

  return ref;
}
