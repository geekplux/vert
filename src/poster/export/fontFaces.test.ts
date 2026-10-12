import { describe, expect, it } from 'vitest';
import {
  collectFontFaces,
  collectLocalFontFaces,
  embeddedFontFaceCss,
  fontFaceSource,
  fontMime,
  localFontFace,
  parseFamilyList,
  parseUnicodeRange,
  usedFontFaces,
  usedLocalFontFaces,
} from './fontFaces';
import type { FontFaceSource, TextRun } from './fontFaces';
import { fontRule } from './testFakes';

const LATIN = 'U+0000-00FF, U+0131, U+2000-206F';
const LATIN_EXT = 'U+0100-02BA, U+1E00-1E9F';

const BASE = 'http://localhost:61178/';

function face(descriptors: Record<string, string>): FontFaceSource {
  const source = fontFaceSource(fontRule(descriptors), BASE);
  if (!source) throw new Error('no source');
  return source;
}

const archivoLatin = face({
  'font-family': '"Archivo"',
  'font-weight': '400 800',
  'font-stretch': '62% 125%',
  src: 'url("/fonts/archivo-latin.woff2") format("woff2")',
  'unicode-range': LATIN,
});
const archivoLatinExt = face({
  'font-family': 'Archivo',
  'font-weight': '400 800',
  'font-stretch': '62% 125%',
  src: "url('/fonts/archivo-latin-ext.woff2') format('woff2')",
  'unicode-range': LATIN_EXT,
});
const plexMono400 = face({
  'font-family': '"IBM Plex Mono"',
  'font-weight': '400',
  src: 'url(/fonts/ibm-plex-mono-400-latin.woff2) format("woff2")',
  'unicode-range': LATIN,
});
const plexMono500 = face({
  'font-family': '"IBM Plex Mono"',
  'font-weight': '500',
  src: 'url(/fonts/ibm-plex-mono-500-latin.woff2) format("woff2")',
  'unicode-range': LATIN,
});
const caslonItalic = face({
  'font-family': '"Libre Caslon Text"',
  'font-style': 'italic',
  src: 'url(/fonts/libre-caslon-text-400-italic-latin.woff2) format("woff2")',
});
const caslon = face({
  'font-family': '"Libre Caslon Text"',
  src: 'url(/fonts/libre-caslon-text-400-latin.woff2) format("woff2")',
});
const ALL = [archivoLatin, archivoLatinExt, plexMono400, plexMono500, caslon, caslonItalic];

const run = (family: string, text: string, rest: Partial<TextRun> = {}): TextRun => ({
  family,
  text,
  weight: '400',
  style: 'normal',
  stretch: '100%',
  ...rest,
});

describe('parsing', () => {
  it('splits family lists and unquotes names', () => {
    expect(
      parseFamilyList(`Archivo, "Archivo Fallback Arial", 'Helvetica Neue', sans-serif`),
    ).toEqual(['Archivo', 'Archivo Fallback Arial', 'Helvetica Neue', 'sans-serif']);
  });

  it('parses unicode ranges, singles and wildcards', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+0131, u+4??')).toEqual([
      [0, 0xff],
      [0x131, 0x131],
      [0x400, 0x4ff],
    ]);
  });

  it('reads a font-face rule with an absolute URL and its descriptors', () => {
    expect(archivoLatin).toMatchObject({
      family: 'Archivo',
      style: 'normal',
      weight: [400, 800],
      stretch: [62, 125],
      url: 'http://localhost:61178/fonts/archivo-latin.woff2',
      format: 'woff2',
    });
    expect(archivoLatin.descriptors).toContain('font-stretch:62% 125%;');
    expect(archivoLatin.descriptors).not.toContain('src');
    expect(caslonItalic).toMatchObject({
      style: 'italic',
      weight: [400, 400],
      stretch: [100, 100],
    });
    expect(caslon.ranges).toEqual([[0, 0x10ffff]]);
  });

  it('skips rules with only local() sources', () => {
    const local = fontRule({
      'font-family': '"Archivo Fallback Arial"',
      src: "local('Arial'), local('ArialMT')",
    });
    expect(fontFaceSource(local, BASE)).toBeNull();
  });

  it('knows font MIME types', () => {
    expect(fontMime('woff2', '/a')).toBe('font/woff2');
    expect(fontMime('', '/a.ttf')).toBe('font/ttf');
  });
});

describe('collectFontFaces', () => {
  it('walks the sheets, @imports and grouping rules, skipping unreadable sheets', () => {
    const imported = {
      href: 'http://localhost:61178/styles/fonts.css',
      cssRules: [fontRule({ 'font-family': 'Imported', src: 'url(../fonts/i.woff2)' })],
    };
    const doc = {
      baseURI: BASE,
      styleSheets: [
        {
          href: null,
          cssRules: [
            { cssText: '@import url("fonts.css");', styleSheet: imported },
            { cssText: '.a { color: red }' },
            {
              cssText: '@media print { … }',
              cssRules: [fontRule({ 'font-family': 'Nested', src: 'url(/n.woff2)' })],
            },
          ],
        },
        {
          href: 'https://elsewhere.example/x.css',
          get cssRules(): never {
            throw new DOMException('cross-origin', 'SecurityError');
          },
        },
      ],
    } as unknown as Document;
    const faces = collectFontFaces(doc);
    expect(faces.map((f) => [f.family, f.url])).toEqual([
      ['Imported', 'http://localhost:61178/fonts/i.woff2'],
      ['Nested', 'http://localhost:61178/n.woff2'],
    ]);
  });
});

describe('usedFontFaces', () => {
  it('picks only the faces and subsets the text needs', () => {
    const used = usedFontFaces(
      [
        run('Archivo, sans-serif', 'COOSA', { weight: '800', stretch: '62%' }),
        run('"IBM Plex Mono", monospace', 'SAT · 2026'),
      ],
      ALL,
    );
    expect(used).toEqual([archivoLatin, plexMono400]);
  });

  it('adds the latin-ext subset for characters only it covers', () => {
    expect(usedFontFaces([run('Archivo', 'ŁÓDŹ')], ALL)).toEqual([archivoLatin, archivoLatinExt]);
    expect(usedFontFaces([run('Archivo', 'Łł')], ALL)).toEqual([archivoLatinExt]);
  });

  it('matches style, then weight (nearest)', () => {
    expect(usedFontFaces([run('"Libre Caslon Text"', 'Vogel', { style: 'italic' })], ALL)).toEqual([
      caslonItalic,
    ]);
    expect(usedFontFaces([run('"IBM Plex Mono"', 'KM', { weight: '600' })], ALL)).toEqual([
      plexMono500,
    ]);
    // No italic Plex Mono: the browser slants the upright face, so that is the one embedded.
    expect(usedFontFaces([run('"IBM Plex Mono"', 'KM', { style: 'italic' })], ALL)).toEqual([
      plexMono400,
    ]);
  });

  it('falls through the stack for families without web fonts and ignores whitespace', () => {
    expect(usedFontFaces([run('"Helvetica Neue", Archivo', 'A')], ALL)).toEqual([archivoLatin]);
    expect(usedFontFaces([run('Archivo', '   \n ')], ALL)).toEqual([]);
    // Characters no web font covers are left to system fonts.
    expect(usedFontFaces([run('Archivo, sans-serif', '高尾山')], ALL)).toEqual([]);
  });

  it('writes the embedded rule with the data URL', () => {
    expect(embeddedFontFaceCss(plexMono400, 'data:font/woff2;base64,AAAA')).toBe(
      '@font-face{font-family:"IBM Plex Mono";font-weight:400;unicode-range:' +
        `${LATIN};src:url("data:font/woff2;base64,AAAA") format("woff2");}`,
    );
  });
});

describe('local() fallback faces', () => {
  const helvetica = localFontFace(
    fontRule({
      'font-family': '"Archivo Fallback Helvetica Neue"',
      'font-weight': '600 800',
      src: 'local("Helvetica Neue Bold"), local("HelveticaNeue-Bold")',
      'size-adjust': '101.19%',
      'font-display': 'swap',
    }),
  );
  const arial = localFontFace(
    fontRule({
      'font-family': '"Archivo Fallback Arial"',
      src: 'local("Arial")',
      'size-adjust': '102.5%',
    }),
  );
  const menlo = localFontFace(
    fontRule({ 'font-family': '"IBM Plex Mono Fallback Menlo"', src: 'local("Menlo Regular")' }),
  );
  const LOCAL = [helvetica, arial, menlo].filter((face) => face !== null);
  const DISPLAY =
    'Archivo, "Archivo Fallback Helvetica Neue", "Archivo Fallback Arial", sans-serif';

  it('reads local()-only rules whole, without font-display', () => {
    expect(helvetica).toEqual({
      family: 'Archivo Fallback Helvetica Neue',
      css:
        '@font-face{font-family:"Archivo Fallback Helvetica Neue";font-weight:600 800;' +
        'src:local("Helvetica Neue Bold"), local("HelveticaNeue-Bold");size-adjust:101.19%;}',
    });
    expect(
      localFontFace(fontRule({ 'font-family': 'X', src: 'local(X), url(/x.woff2)' })),
    ).toBeNull();
    expect(localFontFace(fontRule({ 'font-family': 'X', src: 'url(/x.woff2)' }))).toBeNull();
  });

  it('collects them from the sheets', () => {
    const doc = {
      baseURI: BASE,
      styleSheets: [
        {
          href: null,
          cssRules: [
            fontRule({ 'font-family': 'Web', src: 'url(/w.woff2)' }),
            fontRule({ 'font-family': 'Local', src: 'local(Arial)' }),
          ],
        },
      ],
    } as unknown as Document;
    expect(collectLocalFontFaces(doc).map((face) => face.family)).toEqual(['Local']);
  });

  it('copies the fallbacks a run reaches with characters no web font covers', () => {
    // Cyrillic: Archivo's subsets cover none of it; the walk reaches both Archivo fallbacks.
    expect(usedLocalFontFaces([run(DISPLAY, 'ЭЛЬБРУС')], ALL, LOCAL)).toEqual([helvetica, arial]);
    // Vietnamese mixes covered and uncovered letters.
    expect(usedLocalFontFaces([run(DISPLAY, 'Đường Mòn')], ALL, LOCAL)).toEqual([helvetica, arial]);
    // Mono text in Greek reaches only the mono fallback.
    const mono = '"IBM Plex Mono", "IBM Plex Mono Fallback Menlo", monospace';
    expect(usedLocalFontFaces([run(mono, 'ΟΛΥΜΠΟΣ')], ALL, LOCAL)).toEqual([menlo]);
  });

  it('copies none when the web fonts cover the text', () => {
    expect(usedLocalFontFaces([run(DISPLAY, 'COOSA Łódź')], ALL, LOCAL)).toEqual([]);
    expect(usedLocalFontFaces([run(DISPLAY, '  ')], ALL, LOCAL)).toEqual([]);
  });
});
