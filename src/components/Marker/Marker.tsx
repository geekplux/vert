export type MarkerKind = 'start' | 'summit' | 'scrub';

/**
 * Colour overrides for posters whose palette differs from the app's (e.g. Night Ridge).
 * Defaults are the app tokens, so the app tracks tokens.css.
 * - `ink`: start stroke, summit fill (default `--ink`)
 * - `paper`: start fill, scrub ring (default `--white`)
 * - `accent`: scrub fill (default `--route`)
 */
export interface MarkerColors {
  ink?: string;
  paper?: string;
  accent?: string;
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
 * Just the marker's `<g>`, for drawing inside an existing `<svg>` (elevation profile, posters).
 * The shape's box is centred on (x, y) and scaled to `size`. Shapes differ, never only colour:
 * start is a hollow circle, summit a solid triangle, scrub a small solid dot with a ring.
 */
export function MarkerShape({
  kind,
  x = 0,
  y = 0,
  size = BOX,
  ink = 'var(--ink)',
  paper = 'var(--white)',
  accent = 'var(--route)',
}: MarkerShapeProps) {
  const scale = size / BOX;
  const half = size / 2;
  return (
    <g transform={`translate(${String(x - half)} ${String(y - half)}) scale(${String(scale)})`}>
      {kind === 'start' && (
        <circle cx={9} cy={9} r={6} strokeWidth={2.5} style={{ fill: paper, stroke: ink }} />
      )}
      {kind === 'summit' && <path d="M9 2 L16 15 L2 15 Z" style={{ fill: ink }} />}
      {kind === 'scrub' && (
        <circle cx={9} cy={9} r={5} strokeWidth={2.5} style={{ fill: accent, stroke: paper }} />
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

/** A start, summit or scrub marker as a standalone inline `<svg>`. */
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
