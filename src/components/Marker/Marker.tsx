export type MarkerKind = 'start' | 'finish' | 'summit' | 'scrub';

/**
 * Colour overrides for posters whose palette differs from the app's (e.g. Night Ridge).
 * Defaults are the app tokens, so the app tracks tokens.css.
 * - `ink`: start and finish stroke, finish dot, summit fill (default `--ink`)
 * - `paper`: start and finish fill, scrub ring (default `--white`)
 * - `accent`: scrub fill (default `--route`)
 * - `ring`: scrub ring only (default `paper`). On a dark palette `paper` is the background, so the
 *   ring vanishes into it; pass the palette's ink (Night Ridge: `ring={ink}`) so the scrub keeps
 *   its ring, the cue that tells it apart from a plain dot without colour.
 * - `gap`: a band of this colour between the scrub's fill and its ring (default: none). Use it when
 *   the ring and the fill are close in lightness (Night Ridge's ink ring on its pale route fill is
 *   1.16:1): with `gap={paper}` the ring meets the dark band on both sides, so it reads at full
 *   contrast against the fill inside and the background outside.
 */
export interface MarkerColors {
  ink?: string;
  paper?: string;
  accent?: string;
  ring?: string;
  gap?: string;
}

export interface MarkerShapeProps extends MarkerColors {
  kind: MarkerKind;
  /** Centre of the shape in the parent SVG's user units. */
  x?: number;
  y?: number;
  /** Edge of the shape's 18×18 box in user units. Default 18. */
  size?: number;
}

/** The geometry lives in an 18×18 box (canvas frame 00, "MARKERS · never color alone"). */
const BOX = 18;
/**
 * The finish's centre dot: the terrain's 7 px dot in its 22 px ring (src/terrain/markers.ts,
 * `FINISH_DOT_PX` / `START_DIAMETER_PX`), at this ring's 14.5-unit outer diameter.
 */
const FINISH_DOT_R = 2.3;
/**
 * With a `gap`: the ring (centre radius and width; outer edge 6.25, as without) and the dot. The dot
 * stays large and the gap thin, so the scrub still reads as a solid dot with a ring, unlike the
 * finish (a small dot in a wide hollow ring).
 */
const GAP_RING_R = 5.25;
const GAP_RING_W = 2;
const GAP_DOT_R = 3.5;

/**
 * Just the marker's `<g>`, for drawing inside an existing `<svg>` (elevation profile, posters).
 * The shape's box is centred on (x, y) and scaled to `size`. Shapes differ, never only colour:
 * start is a hollow circle, finish the same circle with a solid ink dot in the middle (◉, for a
 * run that does not end where it started), summit a solid triangle, scrub a small solid dot with a
 * ring.
 */
export function MarkerShape({
  kind,
  x = 0,
  y = 0,
  size = BOX,
  ink = 'var(--ink)',
  paper = 'var(--white)',
  accent = 'var(--route)',
  ring = paper,
  gap,
}: MarkerShapeProps) {
  const scale = size / BOX;
  const half = size / 2;
  return (
    <g transform={`translate(${String(x - half)} ${String(y - half)}) scale(${String(scale)})`}>
      {(kind === 'start' || kind === 'finish') && (
        <circle cx={9} cy={9} r={6} strokeWidth={2.5} style={{ fill: paper, stroke: ink }} />
      )}
      {kind === 'finish' && <circle cx={9} cy={9} r={FINISH_DOT_R} style={{ fill: ink }} />}
      {kind === 'summit' && <path d="M9 2 L16 15 L2 15 Z" style={{ fill: ink }} />}
      {kind === 'scrub' && !gap && (
        <circle cx={9} cy={9} r={5} strokeWidth={2.5} style={{ fill: accent, stroke: ring }} />
      )}
      {kind === 'scrub' && gap && (
        <>
          <circle
            cx={9}
            cy={9}
            r={GAP_RING_R}
            strokeWidth={GAP_RING_W}
            style={{ fill: gap, stroke: ring }}
          />
          <circle cx={9} cy={9} r={GAP_DOT_R} style={{ fill: accent }} data-part="dot" />
        </>
      )}
    </g>
  );
}

export interface MarkerProps extends MarkerColors {
  kind: MarkerKind;
  /** Accessible name. Without it the marker is decorative and hidden from assistive tech. */
  label?: string;
  /** Rendered width and height in px. Default 18. */
  size?: number;
  className?: string;
}

/** A start, finish, summit or scrub marker as a standalone inline `<svg>`. */
export function Marker({ kind, label, size = BOX, className, ...colors }: MarkerProps) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true, focusable: false } as const);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
      className={className}
      {...a11y}
    >
      <MarkerShape kind={kind} x={BOX / 2} y={BOX / 2} {...colors} />
    </svg>
  );
}
