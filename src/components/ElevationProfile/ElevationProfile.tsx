import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import styles from './ElevationProfile.module.css';
import {
  VIEW_H,
  VIEW_W,
  buildTicks,
  defaultValueText,
  describeClimbs,
  elevationAt,
  plotProfile,
  profilePaths,
  type Climb,
  type ProfilePoint,
  type Units,
} from './profileGeometry';

export type { Climb, ProfilePoint, Units } from './profileGeometry';

export interface ElevationProfileProps {
  /**
   * Resampled profile, sorted by distance: `d` cumulative metres (from `origin`), `ele` metres.
   */
  points: readonly ProfilePoint[];
  /**
   * Distance of the profile's first point, metres: 0 for a whole run; past 0 for a stretch whose
   * distances count from an earlier start (a baked scene's drawn route, trimmed by 200 m, starts at
   * 200). Points, climbs, `scrub`, `onScrub`, the slider's values and the ticks all use the same
   * metres; the plot spans `origin` to the last point. Default 0.
   */
  origin?: number;
  /** Scrub position, metres along the route. */
  scrub: number;
  /** Called with the new scrub distance (metres, clamped to the route) on drag and keys. */
  onScrub: (d: number) => void;
  /** Climbs to shade and number, metres. The `steepest` one gets the stronger shade. */
  climbs?: readonly Climb[];
  /** Ticks in km or mi; also the default value text. Default metric. */
  units?: Units;
  /** Plot height in px. Default 140 (View at 1440); the page uses 100 at 390 wide. */
  height?: number;
  /** Accessible name of the slider. Default "Elevation profile". */
  label?: string;
  /** Slider value text. Default "km 12.2, 640 m". */
  valueText?: (d: number, ele: number) => string;
  className?: string;
}

const NO_CLIMBS: readonly Climb[] = [];

/** Dot diameter (canvas: 14px with a 3px white border). */
const DOT = 14;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const percent = (viewX: number) => `${String((viewX / VIEW_W) * 100)}%`;

/**
 * The scrubbable elevation chart under the terrain (DESIGN-SPEC §2, DECISIONS.md). The plot is one
 * ARIA slider: arrow keys ±1% (Shift ±10%), PageUp/PageDown ±10%, Home/End, and pointer drag.
 * Climbs are shaded and numbered, and listed in the slider's description, so colour is never the
 * only cue.
 */
export function ElevationProfile({
  points: givenPoints,
  origin = 0,
  scrub: givenScrub,
  onScrub,
  climbs: givenClimbs = NO_CLIMBS,
  units = 'metric',
  height = 140,
  label = 'Elevation profile',
  valueText,
  className,
}: ElevationProfileProps) {
  const descriptionId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; left: number; width: number } | null>(null);
  const [widthPx, setWidthPx] = useState<number | undefined>(undefined);

  // The plot works from 0: points and climbs shifted by `origin` (none for a whole run).
  const points = useMemo(
    () => (origin === 0 ? givenPoints : givenPoints.map((p) => ({ d: p.d - origin, ele: p.ele }))),
    [givenPoints, origin],
  );
  const climbs = useMemo(
    () =>
      origin === 0
        ? givenClimbs
        : givenClimbs.map((c) => ({ ...c, start: c.start - origin, end: c.end - origin })),
    [givenClimbs, origin],
  );
  const scrub = givenScrub - origin;

  // Paths depend on the points only: scrubbing never rebuilds them. The line is drawn from the
  // plotted (minimum-span, smoothed) points; the value text keeps the real elevations.
  const plot = useMemo(() => plotProfile(points), [points]);
  const { scale } = plot;
  const paths = useMemo(() => profilePaths(plot.points, scale), [plot, scale]);
  const { total } = scale;

  const bands = useMemo(
    () =>
      total > 0
        ? climbs.map((climb, index) => {
            const x0 = scale.x(Math.min(climb.start, climb.end));
            const x1 = scale.x(Math.max(climb.start, climb.end));
            return { key: index, x0, x1, steepest: climb.steepest === true };
          })
        : [],
    [climbs, scale, total],
  );

  // Bands and profile as one memoised element, so React skips them entirely on scrub.
  const layers = useMemo(
    () => (
      <>
        {bands.map((band) => (
          <rect
            key={band.key}
            className={band.steepest ? styles.bandSteepest : styles.band}
            x={band.x0}
            y={0}
            width={band.x1 - band.x0}
            height={VIEW_H}
          />
        ))}
        {paths.area && <path className={styles.area} d={paths.area} />}
        {paths.line && <path className={styles.line} d={paths.line} />}
      </>
    ),
    [bands, paths],
  );

  const ticks = useMemo(
    () => buildTicks(total, units, { widthPx, origin }),
    [total, units, widthPx, origin],
  );
  // In the route's own metres, as the readouts.
  const description = useMemo(() => describeClimbs(givenClimbs, units), [givenClimbs, units]);

  // Measure the plot so tick labels near the end never overlap at narrow widths.
  useLayoutEffect(() => {
    const element = plotRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidthPx(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const value = total > 0 ? clamp(scrub, 0, total) : 0;
  const ele = elevationAt(points, value);
  const text = valueText
    ? valueText(value + origin, ele)
    : defaultValueText(value + origin, ele, units);
  const scrubX = scale.x(value);
  // The dot sits on the line as drawn.
  const drawnEle = elevationAt(plot.points, value);
  const dotTop = Number.isFinite(drawnEle) ? (scale.y(drawnEle) / VIEW_H) * height : height / 2;

  const commit = (d: number) => {
    if (total <= 0) return;
    const next = clamp(d, 0, total);
    if (next !== value) onScrub(next + origin);
  };

  const commitFromPointer = (clientX: number) => {
    const current = drag.current;
    if (!current || current.width <= 0) return;
    commit(((clientX - current.left) / current.width) * total);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const element = event.currentTarget;
    // Read layout once per drag; pointermove only does arithmetic.
    const rect = element.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, left: rect.left, width: rect.width };
    if ('setPointerCapture' in element) {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone (or the environment lacks capture); dragging still works
        // while the pointer stays over the plot.
      }
    }
    commitFromPointer(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    commitFromPointer(event.clientX);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const small = total * 0.01;
    const large = total * 0.1;
    const step = event.shiftKey ? large : small;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - step;
        break;
      case 'PageUp':
        next = value + large;
        break;
      case 'PageDown':
        next = value - large;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = total;
        break;
      default:
        return;
    }
    event.preventDefault();
    commit(next);
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div
        ref={plotRef}
        className={styles.plot}
        style={{ height }}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={Math.round(origin)}
        aria-valuemax={Math.round(origin + total)}
        aria-valuenow={Math.round(origin + value)}
        aria-valuetext={text}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <svg
          className={styles.svg}
          viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {layers}
          {total > 0 && (
            <line className={styles.scrubLine} x1={scrubX} y1={0} x2={scrubX} y2={VIEW_H} />
          )}
        </svg>
        {bands.map((band, index) => (
          <span
            key={band.key}
            className={band.steepest ? styles.climbLabelSteepest : styles.climbLabel}
            style={{ left: percent(band.x0) }}
            aria-hidden="true"
          >
            {index + 1}
          </span>
        ))}
        {total > 0 && (
          <span
            className={styles.dot}
            style={{ left: percent(scrubX), top: dotTop - DOT / 2 }}
            aria-hidden="true"
          />
        )}
      </div>
      {ticks.length > 0 && (
        <div className={styles.ticks} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={`${tick.label}@${String(tick.at)}`}
              className={styles[tick.align]}
              style={tick.align === 'center' ? { left: `${String(tick.at * 100)}%` } : undefined}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
      <p id={descriptionId} hidden>
        {description}
      </p>
    </div>
  );
}
