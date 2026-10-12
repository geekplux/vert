/**
 * A small pull tokenizer for the XML that GPX files are written in.
 *
 * It exists because parsing runs in a Web Worker, where `DOMParser` is not available, and Vert
 * takes no XML dependency (docs/DECISIONS.md). It is not a general XML parser: it checks the
 * structure a GPX reader relies on (tags terminated, attributes quoted, elements properly nested)
 * and is lenient about the rest (unknown entities pass through verbatim, DTDs are skipped and never
 * expanded, names are not validated beyond their first character).
 *
 * Design:
 * - Single pass, linear time. Text, comments, CDATA and processing instructions are located with
 *   `indexOf`; only the inside of a tag is walked character by character, so quoted attribute
 *   values may contain `>`. No search is ever repeated over the same stretch: each one starts past
 *   where the last of its kind ended (or ends the parse by throwing), so each character is looked
 *   at a bounded number of times, however hostile the input. xml.test.ts holds timing
 *   regressions for inputs that once broke this.
 * - Pull, not push: the consumer calls {@link XmlTokenizer.next} and reads the current token from
 *   getters, so a recursive-descent reader can skip whole subtrees ({@link XmlTokenizer.skipElement})
 *   without decoding anything inside them.
 * - Lazy: attributes are parsed only when asked for, text is sliced and entity-decoded only when
 *   asked for. Every string comes from `slice`, never from per-character concatenation.
 * - Self-closing tags yield an `open` token followed by a synthetic `close`, so every `open` has a
 *   matching `close` and consumers need no special case.
 * - Namespace prefixes are stripped for matching: `<gpx:trkpt>` and `<trkpt>` both have the local
 *   name `trkpt`. Namespace URIs are not resolved.
 */

/** What {@link XmlTokenizer.next} found. `end` means the input is exhausted. */
export type XmlTokenKind = 'open' | 'close' | 'text' | 'end';

/** The input is not well-formed enough to read. `offset` is a UTF-16 index into the input. */
export class XmlSyntaxError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (at offset ${String(offset)})`);
    this.name = 'XmlSyntaxError';
    this.offset = offset;
  }
}

const LT = 0x3c; // <
const GT = 0x3e; // >
const SLASH = 0x2f; // /
const BANG = 0x21; // !
const QUESTION = 0x3f; // ?
const EQUALS = 0x3d; // =
const DQUOTE = 0x22; // "
const SQUOTE = 0x27; // '
const LBRACKET = 0x5b; // [
const RBRACKET = 0x5d; // ]

/** XML whitespace: space, tab, line feed, carriage return. */
function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

/** First character of a name: a letter, `_`, `:` or anything non-ASCII. */
function isNameStart(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || c === 0x3a || c >= 0x80
  );
}

/** Later characters of a name: a name-start character, a digit, `-` or `.`. */
function isNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e;
}

/** `gpx:trkpt` → `trkpt`; `trkpt` → `trkpt`. */
function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/**
 * The five predefined entities. A `switch`, not an object literal: a lookup keyed by input text
 * must not reach `Object.prototype` (`&toString;`, `&__proto__;` are unknown entities, kept as
 * written).
 */
function namedEntity(body: string): string | null {
  switch (body) {
    case 'amp':
      return '&';
    case 'lt':
      return '<';
    case 'gt':
      return '>';
    case 'quot':
      return '"';
    case 'apos':
      return "'";
    default:
      return null;
  }
}

const HEX_DIGITS = /^[0-9a-fA-F]+$/;
const DECIMAL_DIGITS = /^[0-9]+$/;

/** Longest reference we try to decode, e.g. `&#x10FFFF;`. Anything longer is left as written. */
const MAX_REFERENCE_LENGTH = 10;

/**
 * Replaces the five predefined entities and numeric character references (`&#233;`, `&#xE9;`).
 * Unknown or malformed references are kept verbatim rather than rejected: a stray `&nbsp;` in a
 * track name should not cost the user their file.
 *
 * Linear in the length of `raw`: the `;` found for one `&` is reused for every later `&` before
 * it, so no stretch of the input is searched twice (`'&'.repeat(n) + ';'` is O(n), not O(n²)).
 */
export function decodeEntities(raw: string): string {
  let amp = raw.indexOf('&');
  if (amp === -1) return raw;

  const parts: string[] = [];
  let copied = 0;
  let semi = -1;
  while (amp !== -1) {
    // Search again only once `amp` has passed the last `;`; each search starts beyond the last.
    if (semi < amp) {
      semi = raw.indexOf(';', amp + 1);
      if (semi === -1) break; // no `;` anywhere after this `&`, so no reference can follow
    }
    const replacement =
      semi - amp > MAX_REFERENCE_LENGTH ? null : decodeReference(raw.slice(amp + 1, semi));
    if (replacement === null) {
      // Not a reference; the next `&` may still start one (`&&amp;` keeps its `&amp;`).
      amp = raw.indexOf('&', amp + 1);
      continue;
    }
    parts.push(raw.slice(copied, amp), replacement);
    copied = semi + 1;
    amp = raw.indexOf('&', copied);
  }
  if (copied === 0) return raw;
  parts.push(raw.slice(copied));
  return parts.join('');
}

/** The text a reference body (between `&` and `;`) stands for, or `null` if it is not one. */
function decodeReference(body: string): string | null {
  if (body.charCodeAt(0) !== 0x23 /* # */) return namedEntity(body);
  const hex = body.charCodeAt(1) === 0x78 /* x */ || body.charCodeAt(1) === 0x58; /* X */
  const digits = body.slice(hex ? 2 : 1);
  if (!(hex ? HEX_DIGITS : DECIMAL_DIGITS).test(digits)) return null;
  const codePoint = parseInt(digits, hex ? 16 : 10);
  if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

interface Attribute {
  readonly name: string;
  readonly value: string;
}

/**
 * Pull tokenizer over a complete XML document held in memory.
 *
 * ```ts
 * const xml = new XmlTokenizer(text);
 * for (let kind = xml.next(); kind !== 'end'; kind = xml.next()) {
 *   if (kind === 'open' && xml.name === 'trkpt') console.log(xml.attr('lat'));
 * }
 * ```
 *
 * Errors are thrown as {@link XmlSyntaxError}: unterminated tags, comments, CDATA or attribute
 * values; mismatched or stray closing tags; and end of input with elements still open.
 * Attribute syntax is checked when attributes are first read, not when the tag is scanned.
 */
export class XmlTokenizer {
  private readonly src: string;
  private pos: number;
  /** Qualified names of the open elements, innermost last. */
  private readonly openNames: string[] = [];

  private kind: XmlTokenKind = 'end';
  private qualifiedName = '';
  private local = '';
  /** For `open`: the attribute source range inside the tag. For `text`: the text range. */
  private rangeStart = 0;
  private rangeEnd = 0;
  private isCdata = false;
  private pendingSelfClose = false;
  private attrs: Attribute[] | null = null;

  /** @param text The whole document. A leading byte-order mark is ignored. */
  constructor(text: string) {
    this.src = text;
    this.pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  }

  /** Kind of the current token: what the last call to `next()` returned. */
  get current(): XmlTokenKind {
    return this.kind;
  }

  /** Local name (prefix stripped) of the current `open` or `close` token. */
  get name(): string {
    return this.local;
  }

  /**
   * Advances to the next token and returns its kind. Comments, processing instructions (including
   * the XML declaration) and the DOCTYPE are skipped. Text may arrive as several consecutive `text`
   * tokens (CDATA sections are separate tokens), and whitespace between elements is reported too.
   */
  next(): XmlTokenKind {
    this.attrs = null;
    if (this.pendingSelfClose) {
      this.pendingSelfClose = false;
      this.openNames.pop();
      return (this.kind = 'close');
    }

    const src = this.src;
    const length = src.length;
    for (;;) {
      const start = this.pos;
      if (start >= length) {
        const unclosed = this.openNames.at(-1);
        if (unclosed !== undefined) {
          throw new XmlSyntaxError(`Input ended inside <${unclosed}>`, length);
        }
        return (this.kind = 'end');
      }

      if (src.charCodeAt(start) !== LT) {
        const lt = src.indexOf('<', start);
        const end = lt === -1 ? length : lt;
        return this.setText(start, end, false, end);
      }

      const marker = src.charCodeAt(start + 1);
      if (marker === SLASH) return this.readCloseTag(start);
      if (marker === QUESTION) {
        this.pos = this.endOf('?>', start + 2, 'processing instruction');
        continue;
      }
      if (marker === BANG) {
        if (src.startsWith('<!--', start)) {
          this.pos = this.endOf('-->', start + 4, 'comment');
          continue;
        }
        if (src.startsWith('<![CDATA[', start)) {
          const after = this.endOf(']]>', start + 9, 'CDATA section');
          return this.setText(start + 9, after - 3, true, after);
        }
        if (src.startsWith('<!DOCTYPE', start)) {
          this.pos = this.skipDoctype(start + 9);
          continue;
        }
        throw new XmlSyntaxError('Unknown markup declaration', start);
      }
      return this.readOpenTag(start);
    }
  }

  /**
   * Value of an attribute of the current `open` token, matched by local name, entity-decoded.
   * Returns `null` when the attribute is absent. Only valid until the next call to `next()`.
   */
  attr(name: string): string | null {
    if (this.kind !== 'open') return null;
    this.attrs ??= this.parseAttributes();
    for (const attribute of this.attrs) {
      if (attribute.name === name) return attribute.value;
    }
    return null;
  }

  /** Content of the current `text` token: entity-decoded, or verbatim for CDATA. */
  text(): string {
    if (this.kind !== 'text') return '';
    const raw = this.src.slice(this.rangeStart, this.rangeEnd);
    return this.isCdata ? raw : decodeEntities(raw);
  }

  /**
   * Call on an `open` token: consumes the element through its `close` and returns its text
   * content (text and CDATA, concatenated, untrimmed). Child elements are skipped.
   */
  readText(): string {
    this.expectOpen('readText');
    let content = '';
    for (;;) {
      const kind = this.next();
      if (kind === 'text') content += this.text();
      else if (kind === 'open') this.skipElement();
      else return content; // 'close'; 'end' cannot happen inside an element: next() throws first
    }
  }

  /**
   * Call on an `open` token: consumes the element and everything inside it through its `close`,
   * without decoding text or attributes. This is how unknown `<extensions>` are passed over.
   */
  skipElement(): void {
    this.expectOpen('skipElement');
    let depth = 1;
    while (depth > 0) {
      const kind = this.next();
      if (kind === 'open') depth++;
      else if (kind === 'close') depth--;
    }
  }

  /** Makes `[start, end)` the current text token and resumes scanning at `resume`. */
  private setText(start: number, end: number, cdata: boolean, resume: number): XmlTokenKind {
    this.rangeStart = start;
    this.rangeEnd = end;
    this.isCdata = cdata;
    this.pos = resume;
    return (this.kind = 'text');
  }

  /** Index just past `terminator`, searching from `from`; throws if it never appears. */
  private endOf(terminator: string, from: number, what: string): number {
    const at = this.src.indexOf(terminator, from);
    if (at === -1) throw new XmlSyntaxError(`Unterminated ${what}`, from);
    return at + terminator.length;
  }

  /**
   * Skips `<!DOCTYPE …>`, including an internal subset in brackets. Returns the index past it.
   * Quoted literals (system IDs, entity values) are stepped over whole, as are comments and
   * processing instructions inside the subset, so a `]`, `>` or quote inside them ends nothing.
   * Each construct is jumped over with one `indexOf`, so the scan stays linear.
   */
  private skipDoctype(from: number): number {
    const src = this.src;
    const length = src.length;
    let inSubset = false;
    let p = from;
    while (p < length) {
      const c = src.charCodeAt(p);
      if (c === DQUOTE || c === SQUOTE) {
        const close = src.indexOf(c === DQUOTE ? '"' : "'", p + 1);
        if (close === -1) break;
        p = close + 1;
        continue;
      }
      if (inSubset && c === LT) {
        if (src.startsWith('<!--', p)) {
          p = this.endOf('-->', p + 4, 'comment');
          continue;
        }
        if (src.charCodeAt(p + 1) === QUESTION) {
          p = this.endOf('?>', p + 2, 'processing instruction');
          continue;
        }
      }
      if (c === LBRACKET) inSubset = true;
      else if (c === RBRACKET) inSubset = false;
      else if (c === GT && !inSubset) return p + 1;
      p++;
    }
    throw new XmlSyntaxError('Unterminated DOCTYPE', from);
  }

  private readOpenTag(start: number): XmlTokenKind {
    const src = this.src;
    const length = src.length;
    const nameStart = start + 1;
    if (!isNameStart(src.charCodeAt(nameStart))) {
      throw new XmlSyntaxError('Expected a tag name after <', start);
    }
    let p = nameStart + 1;
    while (p < length && isNameChar(src.charCodeAt(p))) p++;
    const qualified = src.slice(nameStart, p);
    if (p < length) {
      const c = src.charCodeAt(p);
      if (!isSpace(c) && c !== SLASH && c !== GT) {
        throw new XmlSyntaxError(`Invalid character in tag <${qualified}>`, p);
      }
    }

    // Find the closing '>', stepping over quoted attribute values (which may contain '>').
    const attrStart = p;
    for (;;) {
      if (p >= length) throw new XmlSyntaxError(`Unterminated tag <${qualified}>`, start);
      const c = src.charCodeAt(p);
      if (c === GT) break;
      if (c === DQUOTE || c === SQUOTE) {
        const close = src.indexOf(c === DQUOTE ? '"' : "'", p + 1);
        if (close === -1) throw new XmlSyntaxError(`Unterminated attribute in <${qualified}>`, p);
        p = close + 1;
        continue;
      }
      if (c === LT) throw new XmlSyntaxError(`Unterminated tag <${qualified}>`, start);
      p++;
    }

    const selfClosing = p > attrStart && src.charCodeAt(p - 1) === SLASH;
    this.rangeStart = attrStart;
    this.rangeEnd = selfClosing ? p - 1 : p;
    this.pos = p + 1;
    this.qualifiedName = qualified;
    this.local = localName(qualified);
    this.openNames.push(qualified);
    this.pendingSelfClose = selfClosing;
    return (this.kind = 'open');
  }

  private readCloseTag(start: number): XmlTokenKind {
    const src = this.src;
    const expected = this.openNames.pop();
    if (expected === undefined) throw new XmlSyntaxError('Closing tag with nothing open', start);

    // Compare in place rather than slicing the name out: close tags are half of all tags.
    let p = start + 2;
    if (!src.startsWith(expected, p)) {
      throw new XmlSyntaxError(`Expected </${expected}>`, start);
    }
    p += expected.length;
    while (p < src.length && isSpace(src.charCodeAt(p))) p++;
    if (p >= src.length) throw new XmlSyntaxError(`Unterminated tag </${expected}>`, start);
    if (src.charCodeAt(p) !== GT) throw new XmlSyntaxError(`Expected </${expected}>`, start);

    this.pos = p + 1;
    if (this.qualifiedName !== expected) {
      this.qualifiedName = expected;
      this.local = localName(expected);
    }
    return (this.kind = 'close');
  }

  /** Parses `name="value"` pairs in the current tag's attribute range. */
  private parseAttributes(): Attribute[] {
    const src = this.src;
    const end = this.rangeEnd;
    const attributes: Attribute[] = [];
    let p = this.rangeStart;
    for (;;) {
      while (p < end && isSpace(src.charCodeAt(p))) p++;
      if (p >= end) return attributes;

      if (!isNameStart(src.charCodeAt(p))) {
        throw new XmlSyntaxError(`Invalid attribute in <${this.qualifiedName}>`, p);
      }
      const nameStart = p;
      while (p < end && isNameChar(src.charCodeAt(p))) p++;
      const name = localName(src.slice(nameStart, p));

      while (p < end && isSpace(src.charCodeAt(p))) p++;
      if (src.charCodeAt(p) !== EQUALS || p >= end) {
        throw new XmlSyntaxError(`Attribute ${name} has no value`, p);
      }
      p++;
      while (p < end && isSpace(src.charCodeAt(p))) p++;
      const quote = src.charCodeAt(p);
      if ((quote !== DQUOTE && quote !== SQUOTE) || p >= end) {
        throw new XmlSyntaxError(`Attribute ${name} is not quoted`, p);
      }
      // The tag scan already proved the closing quote exists inside this tag.
      const close = src.indexOf(quote === DQUOTE ? '"' : "'", p + 1);
      attributes.push({ name, value: decodeEntities(src.slice(p + 1, close)) });
      p = close + 1;
    }
  }

  private expectOpen(method: string): void {
    if (this.kind !== 'open') {
      throw new Error(`XmlTokenizer.${method}() must be called on an open token`);
    }
  }
}
