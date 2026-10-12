import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fontFaceSource, localFontFace } from './fontFaces';
import type { FontFaceSource } from './fontFaces';
import { posterSvg, serializePoster } from './serialize';
import { fontRule } from './testFakes';

// jsdom computes styles from the cascade (enough to see what is inlined), but its CSSOM drops
// `src` / `unicode-range` from @font-face, so the faces are passed in as `fontFaces`. It inherits
// only a few properties (`color`, not `font-family`), so the CSS states the title's family.

const BASE = document.baseURI;

function faceOf(family: string, file: string, extra: Record<string, string> = {}): FontFaceSource {
  const face = fontFaceSource(
    fontRule({
      'font-family': `"${family}"`,
      src: `url("/fonts/${file}") format("woff2")`,
      'unicode-range': 'U+0000-00FF',
      ...extra,
    }),
    BASE,
  );
  if (!face) throw new Error('no face');
  return face;
}

const FACES = [
  faceOf('Archivo', 'archivo-latin.woff2', { 'font-weight': '400 800' }),
  faceOf('Archivo', 'archivo-latin-ext.woff2', {
    'font-weight': '400 800',
    'unicode-range': 'U+0100-02BA',
  }),
  faceOf('IBM Plex Mono', 'ibm-plex-mono-400-latin.woff2'),
  faceOf('Big Shoulders Display', 'big-shoulders-display-latin.woff2'),
];

const CSS = `
  .poster { position: relative; width: 720px; height: 960px; color: rgb(27, 42, 58); font-family: Archivo, sans-serif; }
  .title { font-family: Archivo, sans-serif; font-weight: 800; text-transform: uppercase; }
  .mono { font-family: "IBM Plex Mono", monospace; }
  .gone { display: none; }
`;

const MARKUP = `
  <div class="title">Coosa <span>trail</span></div>
  <div class="mono">SAT · 2026</div>
  <div data-slot="figure"><img src="/fig.svg" alt="" loading="lazy" srcset="/fig@2x.svg 2x"></div>
  <svg viewBox="0 0 10 10"><image href="/pic.png" width="10" height="10"></image><path d="M0 0L10 10"></path></svg>
  <div class="gone">Hidden <b>text</b></div>
  <script>window.bad = true;</script>
`;

let style: HTMLStyleElement;
let root: HTMLElement;

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.className = 'poster';
  root.setAttribute('role', 'img');
  root.innerHTML = MARKUP;
  document.body.appendChild(root);
});

afterEach(() => {
  style.remove();
  root.remove();
});

function loader() {
  return vi.fn((url: string) => Promise.resolve(new Blob([`bytes of ${url}`])));
}

const parseXhtml = (xhtml: string) =>
  new DOMParser().parseFromString(xhtml, 'application/xhtml+xml').documentElement;

describe('serializePoster', () => {
  it('embeds exactly the faces the text uses, as data URLs', async () => {
    const load = loader();
    const poster = await serializePoster(root, { load, fontFaces: FACES, pseudoElements: false });
    expect(poster.faces.map((face) => face.url)).toEqual([
      new URL('/fonts/archivo-latin.woff2', BASE).href,
      new URL('/fonts/ibm-plex-mono-400-latin.woff2', BASE).href,
    ]);
    const rules = poster.css.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(rules).toHaveLength(2);
    // The same data URLs the CSS embeds, for the page to preload.
    expect(poster.fontUrls).toHaveLength(2);
    poster.fontUrls.forEach((url, i) => {
      expect(rules[i]).toContain(url);
    });
    expect(rules[0]).toContain('font-family:"Archivo"');
    expect(rules[0]).toMatch(
      /src:url\("data:font\/woff2;base64,[A-Za-z0-9+/=]+"\) format\("woff2"\)/,
    );
    const fontUrls = load.mock.calls.map(([url]) => url).filter((url) => url.includes('/fonts/'));
    expect(fontUrls).toHaveLength(2);
    expect(fontUrls.some((url) => url.includes('big-shoulders'))).toBe(false);
  });

  it('copies the local() fallback rules that text outside the embedded subsets reaches', async () => {
    const fallback = localFontFace(
      fontRule({
        'font-family': '"Archivo Fallback Arial"',
        src: 'local("Arial")',
        'size-adjust': '102.5%',
      }),
    );
    const unused = localFontFace(
      fontRule({ 'font-family': '"IBM Plex Mono Fallback Menlo"', src: 'local("Menlo")' }),
    );
    if (!fallback || !unused) throw new Error('no local face');
    const title = root.querySelector<HTMLElement>('.title');
    if (!title) throw new Error('no title');
    title.style.fontFamily = 'Archivo, "Archivo Fallback Arial", sans-serif';
    const options = {
      load: loader(),
      fontFaces: FACES,
      localFontFaces: [fallback, unused],
      pseudoElements: false,
    };

    // Latin only: Archivo covers it, nothing falls back.
    expect((await serializePoster(root, options)).localFaces).toEqual([]);

    title.textContent = 'Эльбрус Северный';
    const poster = await serializePoster(root, options);
    expect(poster.localFaces).toEqual([fallback]);
    expect(poster.css).toContain(
      '@font-face{font-family:"Archivo Fallback Arial";src:local("Arial");size-adjust:102.5%;}',
    );
    expect(poster.css).not.toContain('Menlo');
    // Nothing to load for a local face; the title needs no Archivo file now, the mono line does.
    expect(poster.faces.map((face) => face.family)).toEqual(['IBM Plex Mono']);
    expect(poster.fontUrls).toHaveLength(1);
  });

  it('inlines images and SVG images as data URLs', async () => {
    const poster = await serializePoster(root, {
      load: loader(),
      fontFaces: FACES,
      pseudoElements: false,
    });
    expect(poster.images).toEqual([new URL('/fig.svg', BASE).href, new URL('/pic.png', BASE).href]);
    const tree = parseXhtml(poster.xhtml);
    const img = tree.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^data:/);
    expect(img?.hasAttribute('loading')).toBe(false);
    expect(img?.hasAttribute('srcset')).toBe(false);
    expect(
      tree.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'image')[0]?.getAttribute('href'),
    ).toMatch(/^data:/);
  });

  it('inlines computed styles, leaving inherited values to inheritance', async () => {
    const poster = await serializePoster(root, {
      load: loader(),
      fontFaces: FACES,
      pseudoElements: false,
    });
    const tree = parseXhtml(poster.xhtml);
    expect(tree.getAttribute('xmlns')).toBe('http://www.w3.org/1999/xhtml');
    const rootStyle = tree.getAttribute('style') ?? '';
    expect(rootStyle).toContain('color:rgb(27, 42, 58)');
    expect(rootStyle).toContain('font-family:Archivo, sans-serif');
    expect(rootStyle).toContain('position:relative');
    const title = tree.querySelector('.title');
    expect(title?.getAttribute('style')).toContain('font-weight:800');
    expect(title?.getAttribute('style')).toContain('text-transform:uppercase');
    // Inherited and unchanged: not repeated.
    expect(title?.getAttribute('style')).not.toContain('color:');
    expect(title?.querySelector('span')?.hasAttribute('style')).toBe(false);
    expect(tree.querySelector('.mono')?.getAttribute('style')).toContain(
      'font-family:"IBM Plex Mono", monospace',
    );
    // The inline SVG keeps its geometry as attributes.
    const path = tree.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'path')[0];
    expect(path?.getAttribute('d')).toBe('M0 0L10 10');
  });

  it('drops what draws nothing: display:none subtrees and scripts', async () => {
    const poster = await serializePoster(root, {
      load: loader(),
      fontFaces: FACES,
      pseudoElements: false,
    });
    expect(poster.xhtml).not.toContain('Hidden');
    expect(poster.xhtml).not.toContain('script');
  });

  it('hides the figure slot content for a raster figure layer', async () => {
    const poster = await serializePoster(root, {
      load: loader(),
      fontFaces: FACES,
      pseudoElements: false,
      hideFigure: true,
    });
    const tree = parseXhtml(poster.xhtml);
    expect(tree.querySelector('[data-slot="figure"] > img')?.getAttribute('style')).toContain(
      'visibility:hidden',
    );
    expect(tree.querySelector('[data-slot="figure"]')?.getAttribute('style') ?? '').not.toContain(
      'visibility:hidden',
    );
    expect(poster.figureBox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('removes its style-defaults frame', async () => {
    await serializePoster(root, { load: loader(), fontFaces: FACES, pseudoElements: false });
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      serializePoster(root, {
        load: loader(),
        fontFaces: FACES,
        pseudoElements: false,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('posterSvg', () => {
  const poster = { width: 720, height: 960, xhtml: '<div xmlns="x"/>', css: '@font-face{}' };

  it('shows the whole poster by default', () => {
    expect(posterSvg(poster)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960" ' +
        'preserveAspectRatio="none"><style><![CDATA[@font-face{}]]></style>' +
        '<foreignObject x="0" y="0" width="720" height="960"><div xmlns="x"/></foreignObject></svg>',
    );
  });

  it('shows one tile at the output size', () => {
    const svg = posterSvg(poster, { x: 360, y: 480, width: 360, height: 480 }, 2700, 3600);
    expect(svg).toContain('width="2700" height="3600" viewBox="360 480 360 480"');
    expect(svg).toContain('<foreignObject x="0" y="0" width="720" height="960">');
  });
});
