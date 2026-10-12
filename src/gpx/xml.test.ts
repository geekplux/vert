// @vitest-environment node
// The tokenizer runs in a Web Worker, so it is tested without jsdom: any DOM use would fail here.
/// <reference types="node" />
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { decodeEntities, XmlSyntaxError, XmlTokenizer } from './xml';

/** Every token of `text` as `open:name`, `close:name` or `text:content` (whitespace-only dropped). */
function tokens(text: string): string[] {
  const xml = new XmlTokenizer(text);
  const out: string[] = [];
  for (let kind = xml.next(); kind !== 'end'; kind = xml.next()) {
    if (kind === 'text') {
      const content = xml.text();
      if (content.trim() !== '') out.push(`text:${content}`);
    } else {
      out.push(`${kind}:${xml.name}`);
    }
  }
  return out;
}

/** Tokenizes `text` to the end and returns the XmlSyntaxError it throws (failing if none). */
function syntaxError(text: string, readAttributes = false): XmlSyntaxError {
  const xml = new XmlTokenizer(text);
  try {
    for (let kind = xml.next(); kind !== 'end'; kind = xml.next()) {
      if (readAttributes && kind === 'open') xml.attr('x');
    }
  } catch (error) {
    expect(error).toBeInstanceOf(XmlSyntaxError);
    return error as XmlSyntaxError;
  }
  throw new Error('Expected an XmlSyntaxError');
}

/** Milliseconds `run` takes. */
function time(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe('XmlTokenizer: tokens', () => {
  it('yields open, text and close tokens, with a synthetic close for self-closing tags', () => {
    expect(tokens('<a><b>hi</b><c/><d /></a>')).toEqual([
      'open:a',
      'open:b',
      'text:hi',
      'close:b',
      'open:c',
      'close:c',
      'open:d',
      'close:d',
      'close:a',
    ]);
  });

  it('strips namespace prefixes from element and attribute names', () => {
    const xml = new XmlTokenizer('<gpx:trkpt gpx:lat="1" lon="2"></gpx:trkpt>');
    expect(xml.next()).toBe('open');
    expect(xml.name).toBe('trkpt');
    expect(xml.attr('lat')).toBe('1');
    expect(xml.attr('lon')).toBe('2');
    expect(xml.attr('ele')).toBeNull();
    expect(xml.next()).toBe('close');
    expect(xml.name).toBe('trkpt');
  });

  it('reads single- and double-quoted attributes that contain > and the other quote', () => {
    const xml = new XmlTokenizer(`<a x = 'say "hi" > bye' y="it's &amp; &#x41;" />`);
    expect(xml.next()).toBe('open');
    expect(xml.attr('x')).toBe('say "hi" > bye');
    expect(xml.attr('y')).toBe("it's & A");
  });

  it('decodes entities in text but keeps CDATA verbatim', () => {
    expect(tokens('<a>x &lt; y</a>')).toEqual(['open:a', 'text:x < y', 'close:a']);
    expect(tokens('<a><![CDATA[x &lt; <b> ]] y]]></a>')).toEqual([
      'open:a',
      'text:x &lt; <b> ]] y',
      'close:a',
    ]);
  });

  it('skips the XML declaration, processing instructions, comments and a byte-order mark', () => {
    const text = '﻿<?xml version="1.0"?><!-- <x> --><a><?pi a > b?>t<!-- c -- ? --></a>';
    expect(tokens(text)).toEqual(['open:a', 'text:t', 'close:a']);
  });

  it('skips a DOCTYPE with an external ID and an internal subset', () => {
    const text = `<!DOCTYPE gpx PUBLIC "-//x//y>" 'z.dtd' [
  <!ENTITY a "]>">
  <!ENTITY b ']]> " >'>
  <!-- don't ] end > here -->
  <?pi ] > ?>
  <!ELEMENT gpx ANY>
]><gpx/>`;
    expect(tokens(text)).toEqual(['open:gpx', 'close:gpx']);
    expect(tokens('<!DOCTYPE html><html></html>')).toEqual(['open:html', 'close:html']);
  });

  it('readText concatenates text and CDATA, skipping child elements', () => {
    const xml = new XmlTokenizer('<n>a<![CDATA[<b>]]><skip><x>no</x></skip>&amp;c</n><after/>');
    xml.next();
    expect(xml.readText()).toBe('a<b>&c');
    expect(xml.next()).toBe('open');
    expect(xml.name).toBe('after');
  });

  it('skipElement consumes a whole subtree', () => {
    const xml = new XmlTokenizer('<r><ext><a><b/></a>text</ext><next/></r>');
    xml.next();
    xml.next();
    xml.skipElement();
    expect(xml.next()).toBe('open');
    expect(xml.name).toBe('next');
  });

  it('reports the current token kind, which is close once an element is consumed', () => {
    const xml = new XmlTokenizer('<a><b>x</b><c/></a>');
    expect(xml.current).toBe('end');
    xml.next();
    xml.next();
    expect(xml.current).toBe('open');
    xml.readText();
    expect(xml.current).toBe('close');
    xml.next();
    expect(xml.current).toBe('open');
    xml.skipElement();
    expect(xml.current).toBe('close');
  });

  it('refuses readText and skipElement off an open token', () => {
    const xml = new XmlTokenizer('<a/>');
    expect(() => xml.readText()).toThrow('must be called on an open token');
    expect(() => {
      xml.skipElement();
    }).toThrow('must be called on an open token');
  });
});

describe('XmlTokenizer: errors', () => {
  it.each<[string, string, RegExp]>([
    ['an unterminated tag', '<a x="1"', /Unterminated tag <a>/],
    ['an unterminated attribute value', '<a x="1>', /Unterminated attribute/],
    ['an unterminated comment', '<a><!-- </a>', /Unterminated comment/],
    ['an unterminated CDATA section', '<a><![CDATA[ </a>', /Unterminated CDATA/],
    ['an unterminated processing instruction', '<?xml ', /Unterminated processing/],
    ['an unterminated DOCTYPE', '<!DOCTYPE gpx [ <!ENTITY a "x"> ', /Unterminated DOCTYPE/],
    ['an unterminated quote in a DOCTYPE', '<!DOCTYPE gpx [ <!ENTITY a "]><a/>', /DOCTYPE/],
    ['a mismatched closing tag', '<a><b></a>', /Expected <\/b>/],
    ['a stray closing tag', '<a></a></b>', /nothing open/],
    ['input ending inside an element', '<a><b></b>', /Input ended inside <a>/],
    ['a tag with no name', '<a>< b></a>', /Expected a tag name/],
    ['an unknown declaration', '<!ELEMENT a ANY>', /Unknown markup declaration/],
  ])('throws on %s', (_, text, message) => {
    expect(syntaxError(text).message).toMatch(message);
  });

  it('checks attribute syntax when attributes are read', () => {
    expect(syntaxError('<a x=1/>', true).message).toMatch(/not quoted/);
    expect(syntaxError('<a x/>', true).message).toMatch(/has no value/);
    expect(tokens('<a x=1/>')).toEqual(['open:a', 'close:a']); // not read, not checked
  });

  it('reports the offset of the problem', () => {
    expect(syntaxError('<a></b>').offset).toBe(3);
  });
});

describe('decodeEntities', () => {
  it('decodes the predefined entities and numeric references', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    expect(decodeEntities('Caf&#233; &#xE9;t&#Xe9; &#x1F3D4;')).toBe('Café été 🏔');
    expect(decodeEntities('no references')).toBe('no references');
  });

  it('keeps unknown, malformed and out-of-range references verbatim', () => {
    for (const raw of [
      '&nbsp;',
      '&bogus',
      '&;',
      '&#;',
      '&#x;',
      '&#12a;',
      '&#0;',
      '&#xD800;',
      '&#x110000;',
      '&#x0000000041;', // longer than any reference we decode
      'a & b; c',
    ]) {
      expect(decodeEntities(raw)).toBe(raw);
    }
  });

  it('keeps Object.prototype names verbatim: they are unknown entities, not lookups', () => {
    for (const raw of [
      '&toString;',
      '&valueOf;',
      '&__proto__;',
      '&constructor;',
      '&hasOwnProperty;',
      '&isPrototypeOf;',
    ]) {
      expect(decodeEntities(raw)).toBe(raw);
      expect(decodeEntities(`a ${raw} &amp; b`)).toBe(`a ${raw} & b`);
    }
  });

  it('keeps Object.prototype names verbatim in text and attribute values', () => {
    const xml = new XmlTokenizer('<a b="&toString;" c="&__proto__;">&valueOf;&constructor;</a>');
    expect(xml.next()).toBe('open');
    expect(xml.attr('b')).toBe('&toString;');
    expect(xml.attr('c')).toBe('&__proto__;');
    expect(xml.next()).toBe('text');
    expect(xml.text()).toBe('&valueOf;&constructor;');
  });

  it('reads attributes named after Object.prototype members like any other', () => {
    const xml = new XmlTokenizer('<a constructor="1" __proto__="x" toString="y" lat="2"/>');
    expect(xml.next()).toBe('open');
    expect(xml.attr('constructor')).toBe('1');
    expect(xml.attr('__proto__')).toBe('x');
    expect(xml.attr('toString')).toBe('y');
    expect(xml.attr('lat')).toBe('2');
    expect(xml.attr('valueOf')).toBeNull();
    expect(xml.attr('hasOwnProperty')).toBeNull();
  });

  it('decodes a reference that follows a stray &', () => {
    expect(decodeEntities('&&amp;')).toBe('&&');
    expect(decodeEntities('&x&#65;&&&lt;')).toBe('&xA&&<');
    expect(decodeEntities('&waytoolongtobeareference&amp;')).toBe('&waytoolongtobeareference&');
  });
});

// Each of these took seconds to tens of seconds when the `;` search was repeated for every `&`.
// They finish in a few ms now; the bound is loose so a slow CI machine does not flake.
describe('XmlTokenizer: linear time on hostile input', () => {
  const nameOf = (raw: string): string => {
    const xml = new XmlTokenizer(`<trk><name>${raw}</name></trk>`);
    xml.next();
    xml.next();
    return xml.readText();
  };

  it("decodes '&'×1.6M + ';' quickly, in text and in an attribute", () => {
    const raw = '&'.repeat(1_600_000) + ';';
    let decoded = '';
    expect(time(() => (decoded = decodeEntities(raw)))).toBeLessThan(1000);
    expect(decoded).toBe(raw);
    expect(time(() => (decoded = nameOf(raw)))).toBeLessThan(1000);
    expect(decoded).toBe(raw);
    const xml = new XmlTokenizer(`<gpx creator="${raw}"/>`);
    xml.next();
    expect(time(() => (decoded = xml.attr('creator') ?? ''))).toBeLessThan(1000);
    expect(decoded).toBe(raw);
  });

  it("decodes '&abcdefghijk'×200k quickly, with and without semicolons", () => {
    for (const raw of ['&abcdefghijk'.repeat(200_000), '&abcdefghijk;'.repeat(200_000)]) {
      let decoded = '';
      expect(time(() => (decoded = nameOf(raw)))).toBeLessThan(1000);
      expect(decoded).toBe(raw);
    }
  });

  it('skips a huge DOCTYPE, comment and attribute quickly', () => {
    const n = 1_000_000;
    const text =
      `<!DOCTYPE g [${'<!ENTITY a "]>">'.repeat(n / 10)}]>` +
      `<!--${'<!-- '.repeat(n / 5)}-->` +
      `<g a="${'>'.repeat(n)}"/>`;
    let found: string[] = [];
    expect(time(() => (found = tokens(text)))).toBeLessThan(1000);
    expect(found).toEqual(['open:g', 'close:g']);
  });
});
