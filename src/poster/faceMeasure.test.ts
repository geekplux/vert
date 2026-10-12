import { describe, expect, it } from 'vitest';
import { NIGHT_RIDGE_TITLE_FACE, SURVEY_QUAD_TITLE_FACE, faceTableMeasure } from './faceMeasure';
import { NIGHT_RIDGE_TITLE } from './NightRidgePoster';
import { SURVEY_QUAD_TITLE } from './SurveyQuadPoster';
import { fitTitle } from './titleFit';

describe('poster title faces', () => {
  const bigShoulders = faceTableMeasure(NIGHT_RIDGE_TITLE_FACE);
  const caslon = faceTableMeasure(SURVEY_QUAD_TITLE_FACE);

  it('measure from the woff2 advance widths', () => {
    expect(bigShoulders('COOSA')).toBeCloseTo(0.455 + 0.462 + 0.462 + 0.441 + 0.443, 6);
    expect(caslon('Trail')).toBeCloseTo(0.754 + 0.415 + 0.525 + 0.3 + 0.289, 6);
    // East Asian wide characters are 1 em; unknown characters err wide.
    expect(bigShoulders('山')).toBe(1);
    expect(caslon('ß')).toBe(0.85);
  });

  it('fit the Night Ridge title uppercase in ≤ 3 lines', () => {
    const fit = fitTitle('Coosa Backcountry Trail', NIGHT_RIDGE_TITLE.print, bigShoulders);
    expect(fit).toEqual({ size: 104, lines: 3 });
    const long = 'Chattahoochee National Forest Backcountry Ridge Traverse and Return Loop';
    const longFit = fitTitle(long, NIGHT_RIDGE_TITLE.print, bigShoulders);
    expect(longFit.lines).toBeLessThanOrEqual(3);
    expect(longFit.size).toBeLessThan(104);
  });

  it('fit the Survey Quad title in its own case (not uppercased)', () => {
    const fit = fitTitle('Coosa Backcountry Trail', SURVEY_QUAD_TITLE.print, caslon);
    expect(fit).toEqual({ size: 56, lines: 2 });
    // Measured uppercase it would be wider: the option matters.
    const upper = fitTitle(
      'Coosa Backcountry Trail',
      { ...SURVEY_QUAD_TITLE.print, uppercase: true },
      caslon,
    );
    expect(upper.lines).toBeGreaterThan(fit.lines);
  });
});
