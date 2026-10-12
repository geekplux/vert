import { describe, expect, it } from 'vitest';
import { posterSizeById } from '../sizes';
import {
  jpegInfo,
  pdfDate,
  pdfPageSize,
  pdfTextString,
  singleImagePdfBytes,
  writeSingleImagePdf,
} from './pdf';
import { fakeJpeg } from './testFakes';

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

/** Parses the writer's output enough to check it: objects, xref, trailer. */
function parse(bytes: Uint8Array) {
  const text = latin1(bytes);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  const xref = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
  const count = Number(xref?.[1]);
  const tableStart = startxref + (xref?.[0].length ?? 0);
  const entries = Array.from({ length: count }, (_, i) =>
    text.slice(tableStart + i * 20, tableStart + (i + 1) * 20),
  );
  const trailer = text.slice(tableStart + count * 20);
  return { text, startxref, count, entries, trailer };
}

describe('pdfPageSize', () => {
  it('uses the physical size of the print sizes', () => {
    expect(pdfPageSize(posterSizeById('18x24'))).toEqual({ width: 1296, height: 1728 });
    const a3 = pdfPageSize(posterSizeById('a3'));
    expect(a3.width).toBeCloseTo(841.89, 2);
    expect(a3.height).toBeCloseTo(1190.55, 2);
  });

  it('falls back to 300 dpi for other sizes', () => {
    expect(pdfPageSize(posterSizeById('4x5'))).toEqual({ width: 259.2, height: 324 });
  });
});

describe('jpegInfo', () => {
  it('reads the size and components from the frame header', () => {
    expect(jpegInfo(fakeJpeg(5400, 7200))).toEqual({ width: 5400, height: 7200, components: 3 });
    expect(jpegInfo(fakeJpeg(3508, 4961, 1))).toEqual({ width: 3508, height: 4961, components: 1 });
  });

  it('rejects what is not a JPEG', () => {
    expect(() => jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow('Not a JPEG');
    expect(() => jpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow('no frame header');
  });
});

describe('pdf strings', () => {
  it('encodes text as UTF-16BE hex with a byte-order mark', () => {
    expect(pdfTextString('Vé')).toBe('<FEFF005600E9>');
    expect(pdfTextString('高尾')).toBe('<FEFF9AD85C3E>');
  });

  it('formats dates in UTC', () => {
    expect(pdfDate(new Date(Date.UTC(2026, 9, 12, 3, 4, 5)))).toBe('D:20261012030405Z');
  });
});

describe('singleImagePdfBytes', () => {
  const jpeg = fakeJpeg(5400, 7200);
  const bytes = singleImagePdfBytes({
    jpeg,
    pageWidth: 1296,
    pageHeight: 1728,
    title: 'Coosa Backcountry Trail',
    creationDate: new Date(Date.UTC(2026, 9, 12)),
  });
  const { text, startxref, count, entries, trailer } = parse(bytes);

  it('starts with the header and a binary comment', () => {
    expect(text.startsWith('%PDF-1.4\n%')).toBe(true);
    expect(Array.from(bytes.slice(10, 14)).every((b) => b >= 128)).toBe(true);
  });

  it('has an xref table whose offsets point at each object', () => {
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    expect(count).toBe(7);
    expect(entries[0]).toBe('0000000000 65535 f \n');
    entries.slice(1).forEach((entry, i) => {
      expect(entry).toMatch(/^\d{10} 00000 n \n$/);
      expect(text.startsWith(`${String(i + 1)} 0 obj\n`, Number(entry.slice(0, 10)))).toBe(true);
    });
  });

  it('has a trailer naming the catalog and the info dictionary', () => {
    expect(trailer).toBe(
      `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${String(startxref)}\n%%EOF\n`,
    );
  });

  it('sizes the page and the image', () => {
    expect(text).toContain('/MediaBox [0 0 1296 1728]');
    expect(text).toContain(
      '/Width 5400 /Height 7200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
    );
    expect(text).toContain('q 1296 0 0 1728 0 0 cm /Im0 Do Q');
  });

  it('embeds the JPEG byte for byte with its exact length', () => {
    const length = Number(/\/DCTDecode \/Length (\d+)/.exec(text)?.[1]);
    expect(length).toBe(jpeg.length);
    const start = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length;
    expect(Array.from(bytes.slice(start, start + length))).toEqual(Array.from(jpeg));
    expect(text.startsWith('\nendstream', start + length)).toBe(true);
  });

  it('gives the content stream its exact length', () => {
    const match = /5 0 obj\n<< \/Length (\d+) >>\nstream\n([^\n]*)\nendstream/.exec(text);
    expect(Number(match?.[1])).toBe(match?.[2]?.length);
  });

  it('records the title, the producer and the date', () => {
    expect(text).toContain(`/Title ${pdfTextString('Coosa Backcountry Trail')}`);
    expect(text).toContain('/Producer (Vert)');
    expect(text).toContain('/CreationDate (D:20261012000000Z)');
  });

  it('writes A3 with fractional points', () => {
    const a3 = latin1(
      singleImagePdfBytes({
        jpeg: fakeJpeg(3508, 4961),
        ...{ pageWidth: 841.8897637795275, pageHeight: 1190.5511811023623 },
        title: 'A3',
      }),
    );
    expect(a3).toContain('/MediaBox [0 0 841.89 1190.55]');
  });

  it('maps grey and CMYK JPEGs to their colour spaces', () => {
    const grey = latin1(
      singleImagePdfBytes({ jpeg: fakeJpeg(10, 10, 1), pageWidth: 1, pageHeight: 1, title: '' }),
    );
    expect(grey).toContain('/ColorSpace /DeviceGray');
    expect(() =>
      singleImagePdfBytes({ jpeg: fakeJpeg(10, 10, 2), pageWidth: 1, pageHeight: 1, title: '' }),
    ).toThrow('Unsupported');
  });

  it('wraps it in an application/pdf Blob', () => {
    const blob = writeSingleImagePdf({ jpeg, pageWidth: 1296, pageHeight: 1728, title: 't' });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(jpeg.length);
  });
});
