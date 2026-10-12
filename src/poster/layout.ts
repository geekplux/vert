/**
 * Logical poster sizes. A poster is laid out with CSS at a logical width (all its lengths are the
 * canvas frame's px at that width) and scaled: by `transform: scale()` in the preview, and by
 * `size.width / logicalWidth` in the export.
 *
 * - Print sizes (18×24, A3) use the Trail Sign frame, drawn at 720 px wide.
 * - Social sizes (4:5, 9:16) use the share-card frame, drawn at 1080 px wide (DECISIONS).
 */
import type { PosterSize } from './sizes';

export type PosterLayoutKind = 'print' | 'social';

export interface PosterLayout {
  kind: PosterLayoutKind;
  /** Logical width, px. */
  width: number;
  /** Logical height, px: `width` at the size's aspect ratio (may be fractional, e.g. A3 1018.25). */
  height: number;
  /** Export scale: target pixels per logical px. */
  scale: number;
}

export const PRINT_LOGICAL_WIDTH = 720;
export const SOCIAL_LOGICAL_WIDTH = 1080;

export function posterLayout(size: Pick<PosterSize, 'use' | 'width' | 'height'>): PosterLayout {
  const kind: PosterLayoutKind = size.use === 'print' ? 'print' : 'social';
  const width = kind === 'print' ? PRINT_LOGICAL_WIDTH : SOCIAL_LOGICAL_WIDTH;
  return { kind, width, height: (width * size.height) / size.width, scale: size.width / width };
}

/** Page margin of each layout at its logical width, px (canvas frames). */
export const LAYOUT_PADDING = { print: 48, social: 72 } as const;
/** The share card's elevation strip on the tall story size (9:16), logical px. */
export const SHARE_PROFILE_HEIGHT = 96;
/** Space between the share card's figure and its elevation strip, logical px. */
export const SHARE_PROFILE_GAP = 24;

/**
 * How the terrain figure box is sized (logical px), so the figure never leaves a blank band:
 *
 * - Print (18×24, A3): the box fills all the height the text leaves (`grow`), but never drops
 *   below 75% of the figure's natural height at full width (`minHeight`).
 * - Social (4:5): the figure's natural aspect at full width, never taller than wide
 *   (`maxHeight`), as in the share-card frame.
 * - Story (9:16, `tall`): the box grows up to square (`maxHeight`); the share card adds a 96 px
 *   elevation strip under it (`profile`) and spreads what is left evenly between its blocks.
 */
export interface FigureBoxRule {
  grow: boolean;
  minHeight: number | null;
  maxHeight: number | null;
  /** The share card shows its elevation strip (9:16 only; print always has one). */
  profile: boolean;
  /** A social layout taller than the 4:5 frame: its blocks spread evenly. */
  tall: boolean;
}

export function figureBoxRule(layout: PosterLayout, figureAspect: number): FigureBoxRule {
  const contentWidth = layout.width - 2 * LAYOUT_PADDING[layout.kind];
  if (layout.kind === 'print') {
    return {
      grow: true,
      minHeight: (contentWidth / figureAspect) * 0.75,
      maxHeight: null,
      profile: false,
      tall: false,
    };
  }
  const tall = layout.height > (layout.width * 1350) / 1080 + 1;
  return { grow: tall, minHeight: null, maxHeight: contentWidth, profile: tall, tall };
}
