import { useCallback, useSyncExternalStore } from 'react';

/** Below this width the page is a phone layout (PageShell's 16px gutters, profile 100px tall). */
export const PHONE_QUERY = '(max-width: 599.98px)';

function mediaQueryList(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;
}

/**
 * Whether a media query matches now, re-rendering when it changes. False where `matchMedia` does
 * not exist (jsdom, server).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQueryList(query);
      if (!list) return () => undefined;
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => mediaQueryList(query)?.matches ?? false,
    () => false,
  );
}
