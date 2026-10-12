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
    paper: '#0F2233',
    ink: '#E8F1F5',
    accent: '#FFD9A0',
    terrain: { kind: 'peaks', line: '#8EC5DA', route: '#FFD9A0' },
  },
  {
    id: 'E',
    name: 'E Survey Quad',
    paper: '#F2EFE6',
    ink: '#1E1B18',
    accent: '#9A5B2E',
    terrain: { kind: 'contours', line: '#9A5B2E', route: '#1E1B18' },
  },
];
