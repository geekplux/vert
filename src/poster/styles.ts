/**
 * The three v1 poster styles (DESIGN-SPEC §4): the one list the style picker, the page state and
 * the poster renderer read. Poster palettes are not app tokens, so their hexes live here and
 * nowhere else.
 */

export type PosterStyleId = 'A' | 'B' | 'E';

/**
 * How the swatch hints at the style's terrain, so the styles differ by shape as well as colour:
 * `rows` = stacked ridge lines across the grid (A), `peaks` = jagged ridge silhouettes (B),
 * `contours` = concentric contour rings with a dashed route (E).
 */
export interface PosterStyleTerrain {
  kind: 'rows' | 'peaks' | 'contours';
  /** Ridge or contour line colour. */
  line: string;
  /** Route stroke colour. */
  route: string;
}

/**
 * The dark palette of a style's share-card layout (the social sizes 4:5 and 9:16). Contrast on
 * `bg` (WCAG 2): text 13.47:1, accent 6.26:1 (used at 220px), muted 9.46:1 (22px footer).
 */
export interface PosterSharePalette {
  bg: string;
  text: string;
  /** The big vert number. */
  accent: string;
  /** Footer text. */
  muted: string;
  /** The figure box behind the terrain. */
  figure: string;
}

/**
 * Style B, Night Ridge (canvas frame "Style B · Night Ridge"). Contrast on `paper` (WCAG 2, see
 * styles.test.ts): ink 14.13:1, route 12.09:1, body 10.36:1. `ridge` (8.60:1) is used for
 * strokes only: DESIGN-SPEC §5 keeps small text on `body`.
 */
export const NIGHT_RIDGE_PALETTE = {
  paper: '#0F2233',
  /** Title and wordmark. */
  ink: '#E8F1F5',
  /** Route core, start ring, the vert number, the sunrise line and label. */
  route: '#FFD9A0',
  /** The route's glow halo, drawn at 35% opacity. */
  glow: '#F2B66D',
  /** Ridge lines and the elevation profile line: strokes only. */
  ridge: '#8EC5DA',
  /** Every line of small text (JetBrains Mono). */
  body: '#B9D3DE',
} as const;

/**
 * Style E, Survey Quad (canvas frame "Style E · Survey Quad"). Contrast (styles.test.ts): ink on paper 14.91:1,
 * on the map 15.71:1; contours (`contour` on `map`, lines only) 4.92:1.
 */
export const SURVEY_QUAD_PALETTE = {
  paper: '#F2EFE6',
  /** Text, the map frame, the route and the markers' rings. */
  ink: '#1E1B18',
  /** Contour lines. */
  contour: '#9A5B2E',
  /** Inside the map frame. */
  map: '#F7F5EE',
  /** The route's halo and the markers' fill. */
  halo: '#FFFFFF',
} as const;

export interface PosterStyleOption<Id extends string = PosterStyleId> {
  id: Id;
  /** Visible name; also the radio's accessible name. */
  name: string;
  paper: string;
  ink: string;
  accent: string;
  terrain: PosterStyleTerrain;
  /** Style A only: the share-card palette (canvas frame "Style A · share card 4:5"). */
  share?: PosterSharePalette;
}

/** The poster styles, in display order. */
export const POSTER_STYLES: readonly PosterStyleOption[] = [
  {
    id: 'A',
    name: 'A Trail Sign',
    paper: '#E6EAEE',
    ink: '#1B2A3A',
    accent: '#C2410C',
    terrain: { kind: 'rows', line: '#1B2A3A', route: '#C2410C' },
    share: {
      bg: '#1B2A3A',
      text: '#F4F6F8',
      accent: '#FF8A50',
      muted: '#C9D1D9',
      figure: '#E6EAEE',
    },
  },
  {
    id: 'B',
    name: 'B Night Ridge',
    paper: NIGHT_RIDGE_PALETTE.paper,
    ink: NIGHT_RIDGE_PALETTE.ink,
    accent: NIGHT_RIDGE_PALETTE.route,
    terrain: { kind: 'peaks', line: NIGHT_RIDGE_PALETTE.ridge, route: NIGHT_RIDGE_PALETTE.route },
  },
  {
    id: 'E',
    name: 'E Survey Quad',
    paper: SURVEY_QUAD_PALETTE.paper,
    ink: SURVEY_QUAD_PALETTE.ink,
    accent: SURVEY_QUAD_PALETTE.contour,
    terrain: {
      kind: 'contours',
      line: SURVEY_QUAD_PALETTE.contour,
      route: SURVEY_QUAD_PALETTE.ink,
    },
  },
];
