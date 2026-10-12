/**
 * Which `@font-face` files a rendered poster actually uses, so the export embeds exactly those
 * (a poster SVG drawn as an image cannot fetch anything: every face it needs travels inside it as a
 * data URL).
 *
 * The browser does not say which face drew a text node, so this repeats its choice, simplified:
 * for each run of text, walk the computed `font-family` list; in each family with web-font faces,
 * pick the face closest in style, then stretch, then weight (CSS Fonts §5.2), and take the
 * unicode-range subsets of that face that cover characters not yet covered. Characters no web font
 * covers fall to system fonts, which an SVG image can use as they are, but only through the same
 * family list: the metric-matched fallback faces (`src: local(…)` rules with `size-adjust` in
 * fonts.css) exist only in the page's style sheets, so the export copies those rules too
 * (`usedLocalFontFaces`). Without them a Cyrillic, Greek or Vietnamese title skips to the next
 * family in the list, draws in another face at another size, and wraps unlike the preview.
 */

/** One `@font-face` rule that loads a file (rules with only `local()` sources are skipped). */
export interface FontFaceSource {
  /** Family name, unquoted. */
  readonly family: string;
  readonly style: 'normal' | 'italic' | 'oblique';
  /** Weight range, inclusive (a single weight has min = max). */
  readonly weight: readonly [number, number];
  /** Stretch range in percent, inclusive. */
  readonly stretch: readonly [number, number];
  /** Unicode ranges, inclusive code point pairs; the whole range when the rule has none. */
  readonly ranges: readonly (readonly [number, number])[];
  /** The first loadable source: absolute URL and its format hint ("woff2", or "" when none). */
  readonly url: string;
  readonly format: string;
  /** The rule's descriptors other than `src` and `font-display`, as CSS text ("font-family:…;"). */
  readonly descriptors: string;
}

/** A run of text as the poster draws it. */
export interface TextRun {
  /** Computed `font-family`. */
  readonly family: string;
  /** Computed `font-weight` ("800"). */
  readonly weight: string;
  /** Computed `font-style` ("normal", "italic", "oblique 10deg"). */
  readonly style: string;
  /** Computed `font-stretch` ("62%" or a keyword). */
  readonly stretch: string;
  /** The characters drawn (after `text-transform`). */
  readonly text: string;
}

const STRETCH_KEYWORDS: Readonly<Record<string, number>> = {
  'ultra-condensed': 50,
  'extra-condensed': 62.5,
  condensed: 75,
  'semi-condensed': 87.5,
  normal: 100,
  'semi-expanded': 112.5,
  expanded: 125,
  'extra-expanded': 150,
  'ultra-expanded': 200,
};

const WEIGHT_KEYWORDS: Readonly<Record<string, number>> = { normal: 400, bold: 700 };

const ALL_CODE_POINTS: readonly [number, number] = [0, 0x10ffff];

/** Splits a CSS `font-family` list into unquoted names. */
export function parseFamilyList(value: string): string[] {
  const names: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ',') {
      names.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  names.push(current.trim());
  return names.filter(Boolean);
}

/** Parses a `unicode-range` descriptor ("U+0000-00FF, U+0131, U+4??") into code point pairs. */
export function parseUnicodeRange(value: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const part of value.split(',')) {
    const token = part.trim().replace(/^u\+/i, '');
    if (!token) continue;
    if (token.includes('?')) {
      ranges.push([
        parseInt(token.replace(/\?/g, '0'), 16),
        parseInt(token.replace(/\?/g, 'F'), 16),
      ]);
      continue;
    }
    const [lo = '', hi] = token.split('-');
    const start = parseInt(lo, 16);
    const end = hi === undefined ? start : parseInt(hi, 16);
    if (Number.isFinite(start) && Number.isFinite(end)) ranges.push([start, end]);
  }
  return ranges;
}

function parseNumberRange(
  value: string,
  keywords: Readonly<Record<string, number>>,
  fallback: number,
): [number, number] {
  const values = value
    .trim()
    .split(/\s+/)
    .map((token) => keywords[token] ?? parseFloat(token))
    .filter((n) => Number.isFinite(n));
  const [lo = fallback, hi = lo] = values;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function parseStyle(value: string): FontFaceSource['style'] {
  const token = value.trim().split(/\s+/)[0] ?? '';
  return token === 'italic' || token === 'oblique' ? token : 'normal';
}

const MIME_BY_FORMAT: Readonly<Record<string, string>> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};

/** The MIME type for a font source's format hint (or its file extension). */
export function fontMime(format: string, url: string): string {
  const known = MIME_BY_FORMAT[format];
  if (known) return known;
  const ext = /\.(\w+)(?:[?#].*)?$/.exec(url)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_FORMAT[{ ttf: 'truetype', otf: 'opentype' }[ext] ?? ext] ?? 'font/woff2';
}

const URL_SOURCE = /url\(\s*(['"]?)(.*?)\1\s*\)\s*(?:format\(\s*(['"]?)([\w-]+)\3\s*\))?/g;

/** Reads one `@font-face` rule; null when it has no loadable source. */
export function fontFaceSource(rule: CSSRule, baseUrl: string): FontFaceSource | null {
  const declaration = (rule as CSSRule & { style?: CSSStyleDeclaration }).style;
  if (!declaration) return null;
  const read = (name: string) => declaration.getPropertyValue(name).trim();
  const family = parseFamilyList(read('font-family'))[0];
  if (!family) return null;
  const src = read('src');
  let url = '';
  let format = '';
  for (const match of src.matchAll(URL_SOURCE)) {
    const raw = match[2] ?? '';
    if (!raw) continue;
    try {
      url = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
    format = (match[4] ?? '').toLowerCase();
    break;
  }
  if (!url) return null;
  const descriptors: string[] = [];
  for (let i = 0; i < declaration.length; i += 1) {
    const name = declaration.item(i);
    if (!name || name === 'src' || name === 'font-display') continue;
    descriptors.push(`${name}:${declaration.getPropertyValue(name)};`);
  }
  const range = read('unicode-range');
  return {
    family,
    style: parseStyle(read('font-style') || 'normal'),
    weight: parseNumberRange(read('font-weight') || 'normal', WEIGHT_KEYWORDS, 400),
    stretch: parseNumberRange(read('font-stretch') || 'normal', STRETCH_KEYWORDS, 100),
    ranges: range ? parseUnicodeRange(range) : [ALL_CODE_POINTS],
    url,
    format,
    descriptors: descriptors.join(''),
  };
}

function rulesOf(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    // A cross-origin sheet: its rules cannot be read (Vert has none; fonts are self-hosted).
    return [];
  }
}

/** Calls `visit` with every `@font-face` rule in the document's style sheets and its base URL. */
function eachFontFaceRule(doc: Document, visit: (rule: CSSRule, baseUrl: string) => void): void {
  const walk = (rules: readonly CSSRule[], baseUrl: string) => {
    for (const rule of rules) {
      if (rule.cssText.startsWith('@font-face')) {
        visit(rule, baseUrl);
        continue;
      }
      const imported = (rule as CSSRule & { styleSheet?: CSSStyleSheet | null }).styleSheet;
      if (imported) {
        walk(rulesOf(imported), imported.href ?? baseUrl);
        continue;
      }
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) walk(Array.from(nested), baseUrl);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    walk(rulesOf(sheet), sheet.href ?? doc.baseURI);
  }
}

/** Every loadable `@font-face` rule in the document's style sheets, `@import`s included. */
export function collectFontFaces(doc: Document = document): FontFaceSource[] {
  const faces: FontFaceSource[] = [];
  eachFontFaceRule(doc, (rule, baseUrl) => {
    const face = fontFaceSource(rule, baseUrl);
    if (face) faces.push(face);
  });
  return faces;
}

/**
 * An `@font-face` rule whose sources are all `local()`: a system font under another name, usually
 * with metric overrides (fonts.css's "Archivo Fallback Helvetica Neue"). Nothing to embed, so the
 * rule travels as it is.
 */
export interface LocalFontFace {
  /** Family name, unquoted. */
  readonly family: string;
  /** The whole rule without `font-display` (`@font-face{…}`). */
  readonly css: string;
}

const LOCAL_SOURCE = /\blocal\(/i;
const URL_PRESENT = /\burl\(/i;

/** Reads one `@font-face` rule as a {@link LocalFontFace}; null unless its sources are `local()`. */
export function localFontFace(rule: CSSRule): LocalFontFace | null {
  const declaration = (rule as CSSRule & { style?: CSSStyleDeclaration }).style;
  if (!declaration) return null;
  const family = parseFamilyList(declaration.getPropertyValue('font-family'))[0];
  const src = declaration.getPropertyValue('src');
  if (!family || !LOCAL_SOURCE.test(src) || URL_PRESENT.test(src)) return null;
  let css = '';
  for (let i = 0; i < declaration.length; i += 1) {
    const name = declaration.item(i);
    if (!name || name === 'font-display') continue;
    css += `${name}:${declaration.getPropertyValue(name)};`;
  }
  return { family, css: `@font-face{${css}}` };
}

/** Every `local()`-only `@font-face` rule in the document's style sheets. */
export function collectLocalFontFaces(doc: Document = document): LocalFontFace[] {
  const faces: LocalFontFace[] = [];
  eachFontFaceRule(doc, (rule) => {
    const face = localFontFace(rule);
    if (face) faces.push(face);
  });
  return faces;
}

const STYLE_ORDER: Readonly<Record<FontFaceSource['style'], readonly FontFaceSource['style'][]>> = {
  normal: ['normal', 'oblique', 'italic'],
  italic: ['italic', 'oblique', 'normal'],
  oblique: ['oblique', 'italic', 'normal'],
};

const distance = (value: number, [lo, hi]: readonly [number, number]) =>
  value < lo ? lo - value : value > hi ? value - hi : 0;

const faceKey = (face: FontFaceSource) =>
  `${face.style}|${String(face.weight)}|${String(face.stretch)}`;

/** The faces of `family` closest to the wanted style, stretch and weight (all their subsets). */
function closestFace(
  candidates: readonly FontFaceSource[],
  style: FontFaceSource['style'],
  weight: number,
  stretch: number,
): FontFaceSource[] {
  const order = STYLE_ORDER[style];
  let best: FontFaceSource | null = null;
  let bestScore: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const face of candidates) {
    const score: [number, number, number] = [
      order.indexOf(face.style),
      distance(stretch, face.stretch),
      distance(weight, face.weight),
    ];
    if (
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] &&
        (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))
    ) {
      best = face;
      bestScore = score;
    }
  }
  if (!best) return [];
  const key = faceKey(best);
  return candidates.filter((face) => faceKey(face) === key);
}

const covers = (face: FontFaceSource, codePoint: number) =>
  face.ranges.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);

function groupByFamily<T extends { readonly family: string }>(faces: readonly T[]) {
  const byFamily = new Map<string, T[]>();
  for (const face of faces) {
    const key = face.family.toLowerCase();
    byFamily.set(key, [...(byFamily.get(key) ?? []), face]);
  }
  return byFamily;
}

/** The faces (unicode-range subsets included) that `runs` draw with, in `faces` order. */
export function usedFontFaces(
  runs: readonly TextRun[],
  faces: readonly FontFaceSource[],
): FontFaceSource[] {
  const { used } = resolveRuns(runs, faces, []);
  return faces.filter((face) => used.has(face));
}

/**
 * The `local()`-only faces `runs` may draw with, in `localFaces` order: a family counts when the
 * walk down a run's family list reaches it with characters no earlier web font covers (and so
 * does every later one, as the system font may lack some of them).
 */
export function usedLocalFontFaces(
  runs: readonly TextRun[],
  faces: readonly FontFaceSource[],
  localFaces: readonly LocalFontFace[],
): LocalFontFace[] {
  const { usedLocal } = resolveRuns(runs, faces, localFaces);
  return localFaces.filter((face) => usedLocal.has(face));
}

/** Walks each run's family list as the browser does (see the file header). */
function resolveRuns(
  runs: readonly TextRun[],
  faces: readonly FontFaceSource[],
  localFaces: readonly LocalFontFace[],
): { used: Set<FontFaceSource>; usedLocal: Set<LocalFontFace> } {
  const used = new Set<FontFaceSource>();
  const usedLocal = new Set<LocalFontFace>();
  const byFamily = groupByFamily(faces);
  const localByFamily = groupByFamily(localFaces);
  for (const run of runs) {
    const remaining = new Set<number>();
    for (const char of run.text) {
      const codePoint = char.codePointAt(0);
      if (codePoint !== undefined && !/\s/.test(char)) remaining.add(codePoint);
    }
    if (remaining.size === 0) continue;
    const style = parseStyle(run.style);
    const weight = parseNumberRange(run.weight, WEIGHT_KEYWORDS, 400)[0];
    const stretch = parseNumberRange(run.stretch, STRETCH_KEYWORDS, 100)[0];
    for (const family of parseFamilyList(run.family)) {
      const key = family.toLowerCase();
      for (const face of closestFace(byFamily.get(key) ?? [], style, weight, stretch)) {
        let hit = false;
        for (const codePoint of remaining) {
          if (covers(face, codePoint)) {
            remaining.delete(codePoint);
            hit = true;
          }
        }
        if (hit) used.add(face);
      }
      if (remaining.size === 0) break;
      for (const face of localByFamily.get(key) ?? []) usedLocal.add(face);
    }
  }
  return { used, usedLocal };
}

/** The `@font-face` rule for `face` with its file inlined as `dataUrl`. */
export function embeddedFontFaceCss(face: FontFaceSource, dataUrl: string): string {
  const format = face.format ? ` format("${face.format}")` : '';
  return `@font-face{${face.descriptors}src:url("${dataUrl}")${format};}`;
}
