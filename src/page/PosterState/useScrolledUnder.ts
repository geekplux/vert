import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Whether content is scrolled under Poster mode's sticky Download block, so the block can show its
 * top shadow only then.
 *
 * Give the returned ref to a 1px sentinel at the very end of the aside's content, after the block.
 * The block sticks to the aside's bottom edge exactly when the end of the content is below that
 * edge, i.e. when the sentinel is out of the aside's view. An `IntersectionObserver` with the
 * aside (the sentinel's nearest `<aside>`) as its root watches that. False when everything fits,
 * when scrolled to the end, below 900px (the aside doesn't scroll, so the sentinel is always in
 * view) and where `IntersectionObserver` doesn't exist.
 */
export function useScrolledUnder(): [RefObject<HTMLSpanElement | null>, boolean] {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [scrolledUnder, setScrolledUnder] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = sentinel?.closest('aside');
    if (!sentinel || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setScrolledUnder(!entry.isIntersecting);
      },
      { root },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [sentinelRef, scrolledUnder];
}
