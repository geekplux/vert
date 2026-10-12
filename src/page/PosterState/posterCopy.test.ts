import { describe, expect, it } from 'vitest';
import { POSTER_SIZES } from '../../poster/sizes';
import { POSTER_STYLES } from '../../poster/styles';
import {
  exportAnnouncement,
  exportTileLabel,
  exportValueText,
  offersPdf,
  pngButtonLabel,
  posterFileName,
  slugify,
  styleTitle,
} from './posterCopy';

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

  it('labels the tile being rendered and the tiles done, or Preparing…', () => {
    expect(exportTileLabel({ done: 0, total: null })).toBe('Preparing…');
    expect(exportTileLabel({ done: 0, total: 12 })).toBe('Rendering tile 1 of 12');
    expect(exportTileLabel({ done: 3, total: 12 })).toBe('Rendering tile 4 of 12');
    expect(exportTileLabel({ done: 12, total: 12 })).toBe('Rendering tile 12 of 12');
    expect(exportValueText({ done: 3, total: 12 })).toBe('3 of 12 tiles rendered');
    expect(exportValueText({ done: 0, total: null })).toBe('Preparing');
  });

  it('announces the export on start and at each quarter only', () => {
    const steps = [
      { done: 0, total: null },
      ...Array.from({ length: 13 }, (_, done) => ({ done, total: 12 })),
    ];
    const said = steps.map((progress) => exportAnnouncement(progress, 'v.png'));
    expect([...new Set(said)]).toEqual([
      'Exporting v.png.',
      'Export 25% done.',
      'Export 50% done.',
      'Export 75% done.',
      'Rendered 12 of 12 tiles.',
    ]);
    // Preparing… and tiles 0–2 say the same thing.
    expect(new Set(said.slice(0, 4)).size).toBe(1);
    expect(exportAnnouncement({ done: 1, total: 1 }, 'v.png')).toBe('Rendered 1 of 1 tile.');
  });
});
