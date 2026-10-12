import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POSTER_FACES,
  POSTER_FONTS_STYLE_ID,
  POSTER_SUBTITLE_FACES,
  loadPosterFonts,
} from './fonts';

function stubFonts() {
  const load = vi.fn<(font: string, text?: string) => Promise<FontFace[]>>(() =>
    Promise.resolve([]),
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load, check: () => true },
  });
  return load;
}

describe('loadPosterFonts', () => {
  afterEach(() => {
    document.getElementById(POSTER_FONTS_STYLE_ID)?.remove();
    Reflect.deleteProperty(document, 'fonts');
  });

  it('injects the poster font sheet once, on demand', async () => {
    expect(document.getElementById(POSTER_FONTS_STYLE_ID)).toBeNull();
    await loadPosterFonts('B');
    await loadPosterFonts('E');
    expect(document.querySelectorAll(`#${POSTER_FONTS_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(POSTER_FONTS_STYLE_ID)?.tagName).toBe('STYLE');
  });

  it('style A uses the app fonts and injects nothing', async () => {
    await loadPosterFonts('A');
    expect(document.getElementById(POSTER_FONTS_STYLE_ID)).toBeNull();
  });

  it.each(['B', 'E'] as const)(
    'awaits every face of style %s with the poster text',
    async (style) => {
      const load = stubFonts();
      await loadPosterFonts(style, 'Łódź Trail');
      expect(load.mock.calls.map(([font]) => font)).toEqual(POSTER_FACES[style]);
      for (const [, text] of load.mock.calls) expect(text).toBe('Łódź Trail');
    },
  );

  it('lists the faces DECISIONS names; Caslon italic only for a subtitle', () => {
    expect(POSTER_FACES.B).toEqual([
      '800 100px "Big Shoulders Display"',
      '400 100px "JetBrains Mono"',
    ]);
    expect(POSTER_FACES.E).toEqual([
      '400 100px "Libre Caslon Text"',
      '400 100px "Archivo Narrow"',
      '600 100px "Archivo Narrow"',
      '700 100px "Archivo Narrow"',
    ]);
    expect(POSTER_SUBTITLE_FACES.E).toEqual(['italic 400 100px "Libre Caslon Text"']);
  });

  it('loads the italic only when the poster has a subtitle', async () => {
    const load = stubFonts();
    await loadPosterFonts('E', 'Coosa');
    expect(load.mock.calls.map(([font]) => font)).not.toContain(
      'italic 400 100px "Libre Caslon Text"',
    );
    load.mockClear();
    await loadPosterFonts('E', 'Coosa', { subtitle: true });
    expect(load.mock.calls.map(([font]) => font)).toContain('italic 400 100px "Libre Caslon Text"');
  });

  it('does not reject when a face fails to load', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: () => Promise.reject(new Error('404')), check: () => false },
    });
    await expect(loadPosterFonts('E')).resolves.toBeUndefined();
  });
});
