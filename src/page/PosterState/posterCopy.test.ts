import { afterEach, describe, expect, it } from 'vitest';
import { POSTER_SIZES } from '../../poster/sizes';
import { POSTER_STYLES } from '../../poster/styles';
import {
  ANNOUNCE_MILESTONES_AFTER_MS,
  exportAnnouncement,
  exportTileLabel,
  exportValueText,
  FILE_NAME_MAX_BYTES,
  graphemes,
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

  it.each([
    // VS16 after the mountain and the sign; a skin tone and a ZWJ in the runner.
    ['\u26F0\uFE0F Morning run \u{1F3C3}\u{1F3FD}\u200D\u2640\uFE0F', 'morning-run'],
    ['\u0301\u0302', ''],
    ['1\u0301', '1'],
    ['Loop 2\u0301\u0302 north', 'loop-2-north'],
    ['\u{1F468}\u200D\u{1F469}\u200D\u{1F467} trip', 'trip'],
    ['Peak\u00AD\u200Bname \u2066x\u2069\uFEFF', 'peakname-x'],
    ['\u5F0F\u{E0100}\u5834', '\u5F0F\u5834'],
    ['flag \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} hill', 'flag-hill'],
    ['a \u200C b \u200D', 'a-b'],
  ])('drops invisible leftovers from %j (%j)', (text, slug) => {
    const result = slugify(text);
    expect(result).toBe(slug);
    expect(result).not.toMatch(/\p{Variation_Selector}|\p{Cf}|^\p{M}|-\p{M}|--/u);
  });

  it('drops ZWJ and ZWNJ even between letters, since Chrome would save them as "_"', () => {
    const persian = '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645';
    const joined = '\u0645\u06CC\u062E\u0648\u0627\u0647\u0645';
    expect(slugify(persian)).toBe(joined);
    expect(posterFileName(`${persian} Trail`, '4x5', 'png')).toBe(`vert-${joined}-trail-4x5.png`);
    // Devanagari KSSA keeps its virama, so the conjunct stays whole without the ZWJ.
    expect(slugify('\u0915\u094D\u200D\u0937')).toBe('\u0915\u094D\u0937');
    expect(
      slugify('\u0915\u094D\u0937\u0924\u094D\u0930\u093F\u092F \u092E\u093E\u0930\u094D\u0917'),
    ).toBe('\u0915\u094D\u0937\u0924\u094D\u0930\u093F\u092F-\u092E\u093E\u0930\u094D\u0917');
  });

  it('names a file after an emoji-laden title without invisible characters', () => {
    const title = '\u26F0\uFE0F Morning run \u{1F3C3}\u{1F3FD}\u200D\u2640\uFE0F';
    expect(posterFileName(title, '4x5', 'png')).toBe('vert-morning-run-4x5.png');
    expect(posterFileName('\u0301\u0302', '4x5', 'png')).toBe('vert-4x5.png');
    expect(posterFileName('1\u0301', '4x5', 'png')).toBe('vert-1-4x5.png');
  });

  describe('the cap', () => {
    const segmenter = Intl.Segmenter;
    const setSegmenter = (value: typeof Intl.Segmenter | undefined) => {
      Object.defineProperty(Intl, 'Segmenter', { value, configurable: true, writable: true });
    };
    afterEach(() => {
      setSegmenter(segmenter);
    });
    // Devanagari "kshatriya": the graphemes KSSA (3 code points), TRI (4) and YA (1).
    const word = '\u0915\u094D\u0937\u0924\u094D\u0930\u093F\u092F';

    it('cuts at a grapheme boundary, so no conjunct loses its virama or vowel sign', () => {
      // 57 + 3 code points fill the cap; the next conjunct would pass it and is left out whole.
      expect(slugify(`${'a'.repeat(57)}${word}`)).toBe(`${'a'.repeat(57)}\u0915\u094D\u0937`);
      // 58 + 3 would pass 60: the whole conjunct goes, not just its last consonant.
      expect(slugify(`${'a'.repeat(58)}${word}`)).toBe('a'.repeat(58));
      expect(slugify(`${'a'.repeat(59)}\u0928\u0947`)).toBe('a'.repeat(59));
    });

    it('backs off before a mark when Intl.Segmenter is missing', () => {
      setSegmenter(undefined);
      expect(graphemes('\u0928\u092E\u0938\u094D\u0924\u0947')).toEqual([
        '\u0928',
        '\u092E',
        '\u0938\u094D',
        '\u0924\u0947',
      ]);
      expect(slugify(`${'a'.repeat(59)}\u0938\u094D\u0924\u0947`)).toBe('a'.repeat(59));
      expect(slugify(`${'a'.repeat(58)}\u0924\u0947`)).toBe(`${'a'.repeat(58)}\u0924\u0947`);
      expect(Array.from(slugify('\u{20000}'.repeat(70)))).toHaveLength(60);
    });

    it('keeps a letter under more marks than the cap holds', () => {
      expect(slugify(`\u0436${'\u0301'.repeat(80)}`)).toBe(`\u0436${'\u0301'.repeat(59)}`);
    });

    it(`keeps the file name within ${String(FILE_NAME_MAX_BYTES)} UTF-8 bytes, cut by grapheme`, () => {
      const bytes = (text: string) => new TextEncoder().encode(text).length;
      // 60 four-byte ideographs would make 240 bytes of slug alone.
      const ideographs = posterFileName('\u{20000}'.repeat(70), '18x24', 'png');
      expect(ideographs).toBe(`vert-${'\u{20000}'.repeat(46)}-18x24.png`);
      expect(bytes(ideographs)).toBe(199);
      // Brahmi KA + vowel sign AA: one grapheme of 8 bytes, never split.
      const ka = '\u{11013}\u{11038}';
      const brahmi = posterFileName(ka.repeat(30), '18x24', 'png');
      expect(brahmi).toBe(`vert-${ka.repeat(23)}-18x24.png`);
      expect(bytes(brahmi)).toBeLessThanOrEqual(FILE_NAME_MAX_BYTES);
    });
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
    for (const milestones of [false, true]) {
      expect(exportAnnouncement({ done: 8, total: 8, stage: 'encode' }, 'v.png', milestones)).toBe(
        exportAnnouncement({ done: 8, total: 8 }, 'v.png', milestones),
      );
    }
  });

  const steps = [
    { done: 0, total: null },
    ...Array.from({ length: 13 }, (_, done) => ({ done, total: 12 })),
    { done: 12, total: 12, stage: 'encode' as const },
  ];

  it('announces a slow export on start and at each quarter only', () => {
    const said = steps.map((progress) => exportAnnouncement(progress, 'v.png', true));
    expect([...new Set(said)]).toEqual([
      'Exporting v.png.',
      'Export 25% done.',
      'Export 50% done.',
      'Export 75% done.',
      'Rendered 12 of 12 tiles.',
    ]);
    // Preparing… and tiles 0–2 say the same thing.
    expect(new Set(said.slice(0, 4)).size).toBe(1);
    expect(exportAnnouncement({ done: 1, total: 1 }, 'v.png', true)).toBe('Rendered 1 of 1 tile.');
  });

  it(`announces only the start until the export has run ${String(ANNOUNCE_MILESTONES_AFTER_MS)} ms`, () => {
    expect(ANNOUNCE_MILESTONES_AFTER_MS).toBe(2000);
    const said = steps.map((progress) => exportAnnouncement(progress, 'v.png', false));
    expect([...new Set(said)]).toEqual(['Exporting v.png.']);
  });
});
