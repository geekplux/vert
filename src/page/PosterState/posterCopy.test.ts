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
    ['Żółta Góra', 'zolta-gora'],
    ['Ålesund Øya', 'alesund-oya'],
    ['Łódź · Đakovo · Ðorvik', 'lodz-dakovo-dorvik'],
    ['Æbeltoft Œuvre Straße', 'aebeltoft-oeuvre-strasse'],
    ['ÆØÅ STRASSE ẞ', 'aeoa-strasse-ss'],
    ['Þórsmörk Þingvellir', 'thorsmork-thingvellir'],
    ['Dağı Ilık', 'dagi-ilik'],
    ['İstanbul', 'istanbul'],
    ['Ŋa Ħal Ŧur ĸ', 'na-hal-tur-k'],
    ['Tiếng Việt', 'tieng-viet'],
    ['ﬁve ½', 'five-1-2'],
    ['!!!', ''],
    ['', ''],
  ])('slugifies %j as %j', (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });

  it.each([
    ['富士山', '富士山'],
    ['ぶどう峠 パーク', 'ぶどう峠-パーク'],
    ['서울 둘레길', '서울-둘레길'],
    ['جَبَل طارق', 'جَبَل-طارق'],
    ['हिमालय', 'हिमालय'],
    ['Москва Йошкар', 'москва-йошкар'],
    ['Ελλάδα', 'ελλάδα'],
  ])('keeps %j as written (%j), marks and all', (text, slug) => {
    expect(slugify(text)).toBe(slug);
    expect(slugify(text)).toBe(slugify(text).normalize('NFC'));
  });

  it('caps the slug at 60 characters, not code units', () => {
    expect(Array.from(slugify('𠀀'.repeat(70)))).toHaveLength(60);
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
    expect(posterFileName('Żółta Góra – Ålesund Øya', '4x5', 'png')).toBe(
      'vert-zolta-gora-alesund-oya-4x5.png',
    );
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

  it('says Saving the file… while the file is written', () => {
    expect(exportTileLabel({ done: 8, total: 8, stage: 'encode' })).toBe('Saving the file…');
    expect(exportValueText({ done: 8, total: 8, stage: 'encode' })).toBe(
      'All 8 tiles rendered, saving the file',
    );
    // The live region adds nothing for it: it already said every tile was rendered.
    expect(exportAnnouncement({ done: 8, total: 8, stage: 'encode' }, 'v.png')).toBe(
      exportAnnouncement({ done: 8, total: 8 }, 'v.png'),
    );
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
