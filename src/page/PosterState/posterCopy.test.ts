import { describe, expect, it } from 'vitest';
import { POSTER_SIZES } from '../../poster/sizes';
import { POSTER_STYLES } from '../../poster/styles';
import { offersPdf, pngButtonLabel, posterFileName, slugify, styleTitle } from './posterCopy';

describe('posterCopy', () => {
  it.each([
    ['Coosa Backcountry Trail', 'coosa-backcountry-trail'],
    ['  Côte d’Azur — Loop #2 ', 'cote-d-azur-loop-2'],
    ['高尾山 Trail', '高尾山-trail'],
    ['!!!', ''],
    ['', ''],
  ])('slugifies %j as %j', (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });

  it('caps the slug at 60 characters without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(59)} bcd`);
    expect(slug).toBe('a'.repeat(59));
  });

  it('names the file after the title and the size', () => {
    expect(posterFileName('Coosa Backcountry Trail', '18x24', 'png')).toBe(
      'vert-coosa-backcountry-trail-18x24.png',
    );
    expect(posterFileName('Coosa Backcountry Trail', '9x16', 'png')).toBe(
      'vert-coosa-backcountry-trail-9x16.png',
    );
    expect(posterFileName('A3 Loop', 'a3', 'pdf')).toBe('vert-a3-loop-a3.pdf');
    expect(posterFileName('—', '4x5', 'png')).toBe('vert-4x5.png');
  });

  it('labels the PNG button with the pixel size and offers PDF for print only', () => {
    expect(POSTER_SIZES.map((size) => [pngButtonLabel(size), offersPdf(size)])).toEqual([
      ['Download PNG · 5400 × 7200', true],
      ['Download PNG · 3508 × 4961', true],
      ['Download PNG · 1080 × 1350', false],
      ['Download PNG · 1080 × 1920', false],
    ]);
  });

  it('names a style without its letter', () => {
    expect(POSTER_STYLES.map(styleTitle)).toEqual(['Trail Sign', 'Night Ridge', 'Survey Quad']);
  });
});
