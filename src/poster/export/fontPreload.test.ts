import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadFonts } from './fontPreload';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preloadFonts', () => {
  it('loads every data URL as a font face, tolerating failures', async () => {
    const made: { family: string; source: string }[] = [];
    vi.stubGlobal(
      'FontFace',
      class {
        family: string;
        source: string;
        constructor(family: string, source: string) {
          this.family = family;
          this.source = source;
          made.push({ family, source });
        }
        load() {
          return this.source.includes('BAD')
            ? Promise.reject(new Error('bad font'))
            : Promise.resolve(this);
        }
      },
    );
    const release = await preloadFonts([
      'data:font/woff2;base64,AAAA',
      'data:font/woff2;base64,BAD',
    ]);
    expect(made).toEqual([
      { family: 'vert-export-preload-0', source: 'url("data:font/woff2;base64,AAAA")' },
      { family: 'vert-export-preload-1', source: 'url("data:font/woff2;base64,BAD")' },
    ]);
    expect(release).toBeTypeOf('function');
    release();
  });

  it('does nothing without fonts or without the Font Loading API', async () => {
    const release = await preloadFonts(['data:font/woff2;base64,AAAA']);
    expect(release).toBeTypeOf('function');
    expect(await preloadFonts([])).toBeTypeOf('function');
  });
});
