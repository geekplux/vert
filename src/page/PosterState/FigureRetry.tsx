import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components';
import { FIGURE_ERROR_TEXT, FIGURE_LOADING_TEXT } from './LivePoster';
import type { PosterFigureStatus } from './LivePoster';
import styles from './PosterState.module.css';

/** Read out (politely) when the preview's terrain is drawn after it had failed. */
export const FIGURE_RECOVERED_TEXT = 'Terrain loaded.';

/**
 * The Try again row under the preview, px: the 44px row and the 12px stage gap above it (the
 * preview gives this up while the row shows, at desktop widths).
 */
export const RETRY_ROW_PX = 56;

/** The least width beside the poster the row may take instead of going under it, px. */
export const RETRY_SIDE_MIN_PX = 180;

/** The row beside the poster's bottom edge: its right edge from the stage's, and its width, px. */
export interface RetrySide {
  readonly right: number;
  readonly width: number;
}

export interface FigureRetry {
  /** For `LivePoster`'s `figureAttempt`. */
  readonly attempt: number;
  /** For `LivePoster`'s `onFigureStatus`. */
  readonly onFigureStatus: (status: PosterFigureStatus) => void;
  /** Try again: asks again through the figure's loader. */
  readonly retry: () => void;
  /** Download: asks again when the figure failed. */
  readonly retryQuietly: () => void;
  /**
   * What the row under the preview shows: nothing, the failure and Try again, or "Drawing the
   * terrain…" while a failed figure is asked for again (by Try again, Download or a relayout).
   */
  readonly row: 'failed' | 'retrying' | null;
  readonly announcement: string;
}

interface Reported {
  readonly key: string;
  readonly status: PosterFigureStatus;
}

const isRetryableError = (status: PosterFigureStatus | undefined) =>
  status?.status === 'error' && !status.tooLarge;

/**
 * Try again for the preview's figure when its terrain failed (not when the area is too large to
 * fetch, which fails the same way every time). Asking again goes through the figure's own loader
 * (`figureAttempt`), or, for style A drawn from the View's grid (`fromViewTerrain`), through
 * `retryTerrain`; without that callback such a figure offers no Try again.
 *
 * Once a figure (per `figureKey`, the style) has failed, the row stays until it is drawn: "The
 * terrain couldn’t be drawn." and Try again while it is failed, "Drawing the terrain…" (as the
 * poster's own note says) while it is asked for again. When it is drawn the row goes and a polite
 * "Terrain loaded." is read out; a Try again that fails again reads out the failure.
 */
export function useFigureRetry(
  figureKey: string,
  fromViewTerrain: boolean,
  retryTerrain: (() => void) | undefined,
): FigureRetry {
  // The last state other than `loading`, and the last state of all, per figure.
  const [settled, setSettled] = useState<Reported | null>(null);
  const [current, setCurrent] = useState<Reported | null>(null);
  const settledRef = useRef<Reported | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A Try again press, until the figure settles.
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  const keyRef = useRef(figureKey);
  const [announcement, setAnnouncement] = useState('');
  const failed = settled?.key === figureKey && isRetryableError(settled.status);
  const retryable = failed && (!fromViewTerrain || retryTerrain !== undefined);
  const loading = current?.key === figureKey && current.status.status === 'loading';

  useLayoutEffect(() => {
    keyRef.current = figureKey;
  });

  const ask = () => {
    if (fromViewTerrain) retryTerrain?.();
    else setAttempt((n) => n + 1);
  };

  const onFigureStatus = useCallback((next: PosterFigureStatus) => {
    const key = keyRef.current;
    setCurrent({ key, status: next });
    if (next.status === 'loading') return;
    const before = settledRef.current;
    settledRef.current = { key, status: next };
    setSettled(settledRef.current);
    const wasPressed = pressedRef.current;
    pressedRef.current = false;
    setPressed(false);
    if (next.status === 'ready' && before?.key === key && isRetryableError(before.status)) {
      setAnnouncement(FIGURE_RECOVERED_TEXT);
    } else if (wasPressed && next.status === 'error') {
      setAnnouncement(FIGURE_ERROR_TEXT);
    }
  }, []);

  return {
    attempt,
    onFigureStatus,
    retry: () => {
      if (!retryable || pressedRef.current) return;
      pressedRef.current = true;
      setPressed(true);
      setAnnouncement('');
      ask();
    },
    retryQuietly: () => {
      if (retryable && !pressedRef.current) ask();
    },
    row: retryable ? (pressed || loading ? 'retrying' : 'failed') : null,
    announcement,
  };
}

/**
 * The row under the preview (`useFigureRetry`) and a polite live region. It sits outside the
 * poster, which is one image (`role="img"`, its drawing hidden) and is exported as drawn.
 *
 * Focus never drops to the page: while it is in the row (or was, and went with what was removed),
 * a press moves it to the note, a failure back to Try again, and when the row goes (the terrain
 * is drawn, after Try again, a Download or a relayout) `focusAfter` takes it (Download PNG).
 */
export function FigureRetryRow({
  retry,
  focusAfter,
  side = null,
}: {
  retry: FigureRetry;
  /** Moves focus on once the row has gone (Download PNG, or the export's progress). */
  focusAfter: () => void;
  /** Beside the poster instead of under it (`retryPlacement`), so the preview keeps its size. */
  side?: RetrySide | null;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Whether focus last went into the row (a removed element takes focus with it silently).
  const inRow = useRef(false);
  const { row } = retry;

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      inRow.current =
        event.target instanceof Node && (rowRef.current?.contains(event.target) ?? false);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  useLayoutEffect(() => {
    if (!inRow.current) return;
    const focused = document.activeElement;
    const lost = focused === null || focused === document.body || !focused.isConnected;
    if (row === 'failed') {
      if (lost || focused === noteRef.current) buttonRef.current?.focus();
    } else if (row === 'retrying') {
      if (lost) noteRef.current?.focus();
    } else if (lost) {
      inRow.current = false;
      focusAfter();
    }
  }, [row, focusAfter]);

  return (
    <>
      {row && (
        <div
          ref={rowRef}
          className={[styles.figureRetry, side ? styles.figureRetrySide : '']
            .filter(Boolean)
            .join(' ')}
          style={side ? { right: side.right, width: side.width } : undefined}
          data-figure-retry={row}
        >
          <p ref={noteRef} tabIndex={-1} className={styles.figureRetryNote}>
            {row === 'failed' ? FIGURE_ERROR_TEXT : FIGURE_LOADING_TEXT}
          </p>
          {row === 'failed' && (
            <Button ref={buttonRef} variant="quiet" onClick={retry.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {/* Polite, without the status role: the aside's export status keeps that one. */}
      <p aria-live="polite" className={styles.status}>
        {retry.announcement}
      </p>
    </>
  );
}
