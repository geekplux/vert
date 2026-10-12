import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { posterLayout } from './layout';
import type { PosterSize } from './sizes';
import styles from './PosterPreview.module.css';

export interface PosterPreviewProps {
  /** The poster, rendered at its logical size (`posterLayout(size)`). */
  children: ReactNode;
  size: PosterSize;
  /** The box the poster is fitted into, px; it also never exceeds its container's width. */
  maxWidth?: number;
  maxHeight?: number;
  className?: string;
  /**
   * Called with the scale the poster is drawn at (screen px per logical px) when it is first laid
   * out and whenever it changes, so a raster figure can be rendered sharp at that scale.
   */
  onScale?: (scale: number) => void;
}

/**
 * Shows a poster scaled down to fit a box (600 × 800 by default, as in the Poster mode frame),
 * centred, with the canvas's soft shadow.
 *
 * The frame's size is pure CSS (a width capped by the box and the container, and the poster's
 * aspect ratio), so it never shifts the layout; a ResizeObserver only updates the scale of the
 * poster inside it.
 */
export function PosterPreview({
  children,
  size,
  maxWidth = 600,
  maxHeight = 800,
  className,
  onScale,
}: PosterPreviewProps) {
  const layout = posterLayout(size);
  const fitWidth = Math.min(maxWidth, (maxHeight * layout.width) / layout.height);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(fitWidth);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      if (width > 0) setFrameWidth(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [fitWidth]);

  const frameStyle: CSSProperties = {
    width: fitWidth,
    aspectRatio: `${String(layout.width)} / ${String(layout.height)}`,
  };
  const scale = Math.min(frameWidth, fitWidth) / layout.width;
  const onScaleRef = useRef(onScale);
  useLayoutEffect(() => {
    onScaleRef.current = onScale;
  });
  useEffect(() => {
    onScaleRef.current?.(scale);
  }, [scale]);

  return (
    <div className={[styles.preview, className ?? ''].filter(Boolean).join(' ')}>
      <div ref={frameRef} className={styles.frame} style={frameStyle}>
        <div className={styles.poster} style={{ transform: `scale(${String(scale)})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
