/**
 * Turns a rendered poster (the component mounted at its logical size, unscaled) into a standalone
 * SVG: `<foreignObject>` holding a copy of the poster's DOM. An SVG drawn as an image cannot load
 * anything and sees none of the page's style sheets, so the copy carries everything itself:
 *
 * - Styles: every element's computed style is inlined (the properties that differ from what the
 *   element would get anyway: inherited ones that differ from the parent, others that differ from
 *   the element's default in a blank document). Computed values are absolute (px, rgb), so the
 *   copy lays out exactly like the original at the same size, whatever the cascade was.
 *   `::before` / `::after` boxes with content become rules in the SVG's `<style>`.
 * - Fonts: the `@font-face` files the text actually uses (`usedFontFaces`), as base64 data URLs,
 *   and the `local()` fallback rules that text outside those files reaches (`usedLocalFontFaces`),
 *   so a Cyrillic or Greek title draws in the same metric-adjusted system face as in the preview.
 * - Images: `<img>`, SVG `<image>` and CSS `url()`s as data URLs; `<canvas>` becomes an `<img>`
 *   of its pixels.
 * - Inline SVG figures are kept as they are (attributes untouched; their CSS is inlined).
 */
import {
  collectFontFaces,
  collectLocalFontFaces,
  embeddedFontFaceCss,
  fontMime,
  usedFontFaces,
  usedLocalFontFaces,
} from './fontFaces';
import type { FontFaceSource, LocalFontFace, TextRun } from './fontFaces';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** A rectangle in logical px, relative to the poster's top-left corner. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SerializedPoster {
  /** Logical size, px. */
  readonly width: number;
  readonly height: number;
  /** The poster's DOM as XHTML, every style inlined. */
  readonly xhtml: string;
  /** `@font-face` rules with data URLs, plus pseudo-element rules. */
  readonly css: string;
  /** The faces embedded (for diagnostics and tests). */
  readonly faces: readonly FontFaceSource[];
  /** The `local()` fallback rules copied (for diagnostics and tests). */
  readonly localFaces: readonly LocalFontFace[];
  /**
   * The faces' files as data URLs (same order as `faces`), exactly as the CSS embeds them, so the
   * page can load them first (`preloadFonts`).
   */
  readonly fontUrls: readonly string[];
  /** The resources inlined as data URLs (absolute URLs). */
  readonly images: readonly string[];
  /** The `[data-slot="figure"]` box, if the poster has one. */
  readonly figureBox: Box | null;
}

export interface SerializeOptions {
  /** Fetches a same-origin resource (font, image). Default: `fetch` with the HTTP cache. */
  readonly load?: (url: string) => Promise<Blob>;
  /** Hide the figure slot's content: a raster figure layer is composited over it. */
  readonly hideFigure?: boolean;
  readonly signal?: AbortSignal;
  /** The `@font-face` rules to choose from (default: the document's, `collectFontFaces`). */
  readonly fontFaces?: readonly FontFaceSource[];
  /** The `local()`-only rules to choose from (default: the document's, `collectLocalFontFaces`). */
  readonly localFontFaces?: readonly LocalFontFace[];
  /**
   * Copy `::before` / `::after` boxes (default true). Off where `getComputedStyle` cannot read
   * pseudo-elements (jsdom).
   */
  readonly pseudoElements?: boolean;
}

/**
 * Properties that inherit (CSS and SVG). For these, a value equal to the parent's is left to
 * inheritance. The list need not be complete: a property missing here is still written whenever it
 * differs from the default or from the parent, which is always correct, just longer.
 */
const INHERITED = new Set([
  'border-collapse',
  'border-spacing',
  'caption-side',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-rendering',
  'color-scheme',
  'cursor',
  'direction',
  'empty-cells',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'font-palette',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-synthesis-small-caps',
  'font-synthesis-style',
  'font-synthesis-weight',
  'font-variant-alternates',
  'font-variant-caps',
  'font-variant-east-asian',
  'font-variant-emoji',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-variant-position',
  'font-variation-settings',
  'font-weight',
  'hyphens',
  'image-rendering',
  'letter-spacing',
  'line-break',
  'line-height',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'marker-end',
  'marker-mid',
  'marker-start',
  'orphans',
  'overflow-wrap',
  'paint-order',
  'pointer-events',
  'quotes',
  'ruby-position',
  'shape-rendering',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-anchor',
  'text-indent',
  'text-orientation',
  'text-rendering',
  'text-shadow',
  'text-transform',
  'text-wrap-mode',
  'text-wrap-style',
  'visibility',
  'white-space-collapse',
  'widows',
  'word-break',
  'word-spacing',
  'word-wrap',
  'writing-mode',
  '-webkit-font-smoothing',
  '-webkit-locale',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
  '-webkit-text-stroke-width',
]);

/** SVG geometry properties: the elements' attributes already carry them (`d` can be huge). */
const SVG_GEOMETRY = new Set(['d', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height']);

/** Elements that draw nothing in an exported image. */
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta']);

type StyleSnapshot = ReadonlyMap<string, string>;

function snapshot(style: CSSStyleDeclaration): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (name && !name.startsWith('--')) values.set(name, style.getPropertyValue(name));
  }
  return values;
}

/**
 * Default computed styles per element type, read in a blank standards-mode document (an
 * invisible iframe), so page-wide rules such as `* { box-sizing: border-box }` are not mistaken
 * for defaults.
 */
class StyleDefaults {
  private readonly frame: HTMLIFrameElement;
  private readonly cache = new Map<string, StyleSnapshot>();

  constructor(doc: Document) {
    this.frame = doc.createElement('iframe');
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.tabIndex = -1;
    this.frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:100px;height:100px;border:0;visibility:hidden';
    doc.body.appendChild(this.frame);
    const blank = this.frame.contentDocument;
    if (!blank) throw new Error('No blank document for style defaults');
    // A fresh about:blank is in quirks mode; writing a doctype is the synchronous way to get a
    // standards-mode document, like the poster's.
    blank.open();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    blank.write('<!DOCTYPE html><html><head></head><body></body></html>');
    blank.close();
  }

  private get doc(): Document {
    const doc = this.frame.contentDocument;
    if (!doc) throw new Error('The style defaults document went away');
    return doc;
  }

  /** The computed style of a fresh `element`-like element (same namespace and tag). */
  of(element: Element, pseudo?: string): StyleSnapshot {
    const key = `${element.namespaceURI ?? ''}|${element.localName}|${pseudo ?? ''}`;
    let values = this.cache.get(key);
    if (!values) {
      const doc = this.doc;
      const probe = doc.createElementNS(element.namespaceURI, element.localName);
      let holder: Element = probe;
      if (element.namespaceURI === SVG_NS && element.localName !== 'svg') {
        holder = doc.createElementNS(SVG_NS, 'svg');
        holder.appendChild(probe);
      }
      doc.body.appendChild(holder);
      const view = doc.defaultView;
      values = view ? snapshot(view.getComputedStyle(probe, pseudo)) : new Map<string, string>();
      holder.remove();
      this.cache.set(key, values);
    }
    return values;
  }

  dispose(): void {
    this.frame.remove();
  }
}

/** The CSS for the properties of `values` that the copy must state explicitly. */
function styleText(
  values: StyleSnapshot,
  parent: StyleSnapshot | null,
  defaults: StyleSnapshot,
  skip: ReadonlySet<string> | null,
): string {
  let css = '';
  for (const [name, value] of values) {
    if (skip?.has(name)) continue;
    const parentValue = parent?.get(name);
    const write = INHERITED.has(name)
      ? parent === null || value !== parentValue
      : value !== defaults.get(name) || (parent !== null && value !== parentValue);
    if (write) css += `${name}:${value};`;
  }
  return css;
}

function textAfterTransform(text: string, transform: string): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize') return text + text.toUpperCase();
  return text;
}

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

function blobToDataUrl(blob: Blob, mime?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!mime) {
        resolve(result);
        return;
      }
      resolve(`data:${mime};base64,${result.slice(result.indexOf(',') + 1)}`);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read a resource'));
    };
    reader.readAsDataURL(blob);
  });
}

async function defaultLoad(url: string): Promise<Blob> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${String(response.status)})`);
  return response.blob();
}

function absoluteUrl(raw: string, base: string): string | null {
  if (!raw || raw.startsWith('data:') || raw.startsWith('#')) return null;
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

/** Serializes the poster rooted at `root` (mounted, laid out at its logical size). */
export async function serializePoster(
  root: HTMLElement,
  {
    load = defaultLoad,
    hideFigure = false,
    signal,
    fontFaces,
    localFontFaces,
    pseudoElements = true,
  }: SerializeOptions = {},
): Promise<SerializedPoster> {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const base = doc.baseURI;
  const rootRect = root.getBoundingClientRect();
  const figure = root.querySelector('[data-slot="figure"]');
  const figureRect = figure?.getBoundingClientRect();
  const figureBox: Box | null = figureRect
    ? {
        x: figureRect.left - rootRect.left,
        y: figureRect.top - rootRect.top,
        width: figureRect.width,
        height: figureRect.height,
      }
    : null;

  const defaults = new StyleDefaults(doc);
  const runs: TextRun[] = [];
  /** URL → elements/attributes waiting for its data URL. */
  const urlTargets = new Map<string, ((dataUrl: string) => void)[]>();
  const styled: [Element, string][] = [];
  const pseudoRules: string[] = [];
  let pseudoCount = 0;

  const wantUrl = (url: string, apply: (dataUrl: string) => void) => {
    urlTargets.set(url, [...(urlTargets.get(url) ?? []), apply]);
  };

  const pseudoRule = (element: Element, values: StyleSnapshot, className: () => string) => {
    if (!pseudoElements) return;
    for (const pseudo of ['::before', '::after']) {
      const style = view.getComputedStyle(element, pseudo);
      const content = style.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') continue;
      const css = styleText(snapshot(style), values, defaults.of(element, pseudo), null);
      pseudoRules.push(`.${className()}${pseudo}{${css}}`);
    }
  };

  /** Copies `element` and its subtree; `hide` marks a direct child of a hidden figure slot. */
  const copy = (element: Element, parent: StyleSnapshot | null, hide: boolean): Node | null => {
    const tag = element.localName;
    if (SKIPPED_TAGS.has(tag)) return null;
    const isSvg = element.namespaceURI === SVG_NS;
    const inSvg = isSvg && element.parentElement?.namespaceURI === SVG_NS;
    const values = snapshot(view.getComputedStyle(element));
    if (values.get('display') === 'none' && element !== root) return null;

    let clone: Element;
    if (tag === 'canvas') {
      clone = doc.createElementNS(XHTML_NS, 'img');
      try {
        clone.setAttribute('src', (element as HTMLCanvasElement).toDataURL('image/png'));
      } catch {
        // A tainted canvas cannot be read; leave the box empty.
      }
    } else {
      clone = element.cloneNode(false) as Element;
    }
    clone.removeAttribute('style');

    if (tag === 'img') {
      for (const name of ['srcset', 'sizes', 'loading', 'decoding', 'crossorigin']) {
        clone.removeAttribute(name);
      }
      const image = element as HTMLImageElement;
      const url = absoluteUrl(image.currentSrc || (image.getAttribute('src') ?? ''), base);
      if (url) {
        wantUrl(url, (dataUrl) => {
          clone.setAttribute('src', dataUrl);
        });
      }
    } else if (isSvg && tag === 'image') {
      const raw = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href') ?? '';
      const url = absoluteUrl(raw, base);
      if (url) {
        wantUrl(url, (dataUrl) => {
          clone.removeAttributeNS(XLINK_NS, 'href');
          clone.setAttribute('href', dataUrl);
        });
      }
    }

    let css = styleText(values, parent, defaults.of(element), inSvg ? SVG_GEOMETRY : null);
    // Its descendants inherit it (their own `visible` equals the live parent's, so is not written).
    if (hide) css += 'visibility:hidden;';
    styled.push([clone, css]);
    pseudoRule(element, values, () => {
      const name = `vx-pseudo-${String((pseudoCount += 1))}`;
      clone.classList.add(name);
      return name;
    });

    const hideChildren = hideFigure && element === figure;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? '';
        clone.appendChild(doc.createTextNode(text));
        if (text.trim()) {
          runs.push({
            family: values.get('font-family') ?? '',
            weight: values.get('font-weight') ?? '400',
            style: values.get('font-style') ?? 'normal',
            stretch: values.get('font-stretch') ?? '100%',
            text: textAfterTransform(text, values.get('text-transform') ?? 'none'),
          });
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const inner = copy(child as Element, values, hideChildren);
        if (inner) clone.appendChild(inner);
      }
    }
    return clone;
  };

  let rootClone: Node | null;
  try {
    rootClone = copy(root, null, false);
  } finally {
    defaults.dispose();
  }
  if (!(rootClone instanceof Element)) throw new Error('The poster has nothing to draw');
  signal?.throwIfAborted();

  // CSS url()s (backgrounds, masks) become data URLs too.
  for (const entry of styled) {
    for (const match of entry[1].matchAll(CSS_URL)) {
      const raw = match[2] ?? '';
      const url = absoluteUrl(raw, base);
      if (!url) continue;
      wantUrl(url, (dataUrl) => {
        entry[1] = entry[1].split(raw).join(dataUrl);
      });
    }
  }

  const allFaces = fontFaces ?? collectFontFaces(doc);
  const faces = usedFontFaces(runs, allFaces);
  const localFaces = usedLocalFontFaces(
    runs,
    allFaces,
    localFontFaces ?? collectLocalFontFaces(doc),
  );
  const [fontUrls, ...imageResults] = await Promise.all([
    Promise.all(
      faces.map(async (face) =>
        blobToDataUrl(await load(face.url), fontMime(face.format, face.url)),
      ),
    ),
    ...Array.from(urlTargets.keys(), async (url) => {
      const blob = await load(url);
      return [url, await blobToDataUrl(blob)] as const;
    }),
  ]);
  signal?.throwIfAborted();
  for (const [url, dataUrl] of imageResults) {
    for (const apply of urlTargets.get(url) ?? []) apply(dataUrl);
  }
  for (const [element, css] of styled) {
    if (css) element.setAttribute('style', css);
  }

  return {
    width: rootRect.width,
    height: rootRect.height,
    xhtml: new XMLSerializer().serializeToString(rootClone),
    css: [
      ...faces.map((face, i) => embeddedFontFaceCss(face, fontUrls[i] ?? '')),
      ...localFaces.map((face) => face.css),
      ...pseudoRules,
    ].join('\n'),
    faces,
    localFaces,
    fontUrls,
    images: Array.from(urlTargets.keys()),
    figureBox,
  };
}

/** The part of the poster an SVG shows, in logical px. */
export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The poster as a standalone SVG document showing `view` (default: all of it) at `outWidth ×
 * outHeight` px. Rendering the same poster with one view per tile is how print sizes are drawn
 * in pieces.
 */
export function posterSvg(
  poster: Pick<SerializedPoster, 'width' | 'height' | 'xhtml' | 'css'>,
  view: ViewBox = { x: 0, y: 0, width: poster.width, height: poster.height },
  outWidth: number = view.width,
  outHeight: number = view.height,
): string {
  const viewBox = [view.x, view.y, view.width, view.height].map(String).join(' ');
  const style = poster.css ? `<style><![CDATA[${poster.css}]]></style>` : '';
  return (
    `<svg xmlns="${SVG_NS}" width="${String(outWidth)}" height="${String(outHeight)}" ` +
    `viewBox="${viewBox}" preserveAspectRatio="none">${style}` +
    `<foreignObject x="0" y="0" width="${String(poster.width)}" height="${String(poster.height)}">` +
    `${poster.xhtml}</foreignObject></svg>`
  );
}
