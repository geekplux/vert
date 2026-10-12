import { describe, expect, it } from 'vitest';
import { blend, contrast } from '../test/contrast';
import { NIGHT_RIDGE_PALETTE, POSTER_STYLES, SURVEY_QUAD_PALETTE } from './styles';

describe('poster palettes', () => {
  it('are the single source for styles B and E', () => {
    const b = POSTER_STYLES.find((style) => style.id === 'B');
    const e = POSTER_STYLES.find((style) => style.id === 'E');
    expect(b).toMatchObject({
      paper: NIGHT_RIDGE_PALETTE.paper,
      ink: NIGHT_RIDGE_PALETTE.ink,
      accent: NIGHT_RIDGE_PALETTE.route,
      terrain: { line: NIGHT_RIDGE_PALETTE.ridge, route: NIGHT_RIDGE_PALETTE.route },
    });
    expect(e).toMatchObject({
      paper: SURVEY_QUAD_PALETTE.paper,
      ink: SURVEY_QUAD_PALETTE.ink,
      accent: SURVEY_QUAD_PALETTE.contour,
      terrain: { line: SURVEY_QUAD_PALETTE.contour, route: SURVEY_QUAD_PALETTE.ink },
    });
    expect(NIGHT_RIDGE_PALETTE).toEqual({
      paper: '#0F2233',
      ink: '#E8F1F5',
      route: '#FFD9A0',
      glow: '#F2B66D',
      ridge: '#8EC5DA',
      body: '#B9D3DE',
    });
    expect(SURVEY_QUAD_PALETTE).toEqual({
      paper: '#F2EFE6',
      ink: '#1E1B18',
      contour: '#9A5B2E',
      map: '#F7F5EE',
      halo: '#FFFFFF',
    });
  });

  // Every text colour on its background (WCAG 2: 4.5:1 small text, 3:1 large text and lines).
  it.each([
    [
      'B title, wordmark (ink on paper)',
      NIGHT_RIDGE_PALETTE.ink,
      NIGHT_RIDGE_PALETTE.paper,
      14.13,
      4.5,
    ],
    [
      'B vert number, sunrise label (route on paper)',
      NIGHT_RIDGE_PALETTE.route,
      NIGHT_RIDGE_PALETTE.paper,
      12.09,
      4.5,
    ],
    [
      'B small text (body on paper)',
      NIGHT_RIDGE_PALETTE.body,
      NIGHT_RIDGE_PALETTE.paper,
      10.36,
      4.5,
    ],
    [
      'B ridge lines, profile line (strokes)',
      NIGHT_RIDGE_PALETTE.ridge,
      NIGHT_RIDGE_PALETTE.paper,
      8.6,
      3,
    ],
    ['E all text (ink on paper)', SURVEY_QUAD_PALETTE.ink, SURVEY_QUAD_PALETTE.paper, 14.91, 4.5],
    [
      'E route and markers (ink on map)',
      SURVEY_QUAD_PALETTE.ink,
      SURVEY_QUAD_PALETTE.map,
      15.71,
      3,
    ],
    ['E contours (lines on map)', SURVEY_QUAD_PALETTE.contour, SURVEY_QUAD_PALETTE.map, 4.92, 3],
  ] as const)('%s: %s on %s', (_, fg, bg, ratio, minimum) => {
    expect(contrast(fg, bg)).toBe(ratio);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(minimum);
  });

  it('draws the share card’s elevation strip at ≥ 3:1 (a graphic), faded muted on the card', () => {
    const share = POSTER_STYLES.find((style) => style.id === 'A')?.share;
    if (!share) throw new Error('style A has no share palette');
    const strip = blend(share.muted, share.bg, share.profileOpacity);
    expect(strip).toBe('#838E99');
    expect(contrast(strip, share.bg)).toBe(4.37);
    expect(contrast(strip, share.bg)).toBeGreaterThanOrEqual(3);
  });

  it('keeps B small text off the ridge colour, which is only a stroke', () => {
    // DESIGN-SPEC §5: #8EC5DA passes 4.5:1, but small text uses #B9D3DE regardless.
    expect(contrast(NIGHT_RIDGE_PALETTE.body, NIGHT_RIDGE_PALETTE.paper)).toBeGreaterThan(
      contrast(NIGHT_RIDGE_PALETTE.ridge, NIGHT_RIDGE_PALETTE.paper),
    );
  });
});
