/**
 * A minimal single-page PDF writer: one page at the poster's physical size, filled by one image.
 *
 * The image is a JPEG (`DCTDecode`, quality 1.0), embedded byte for byte as the browser encoded
 * it. Why JPEG and not the lossless pixels: a PNG cannot go into a PDF as it is (PDF's Flate image
 * needs the raw scanlines without alpha, i.e. decoding and re-compressing 39 Mpx in JavaScript, or
 * a compression dependency), while every browser encodes JPEG natively. Quality 1.0 because
 * Chromium's canvas encoder writes full-resolution chroma (4:4:4) only at 1.0 (0.8–0.99 are 4:2:0,
 * measured), which keeps the thin orange route and accent text from bleeding; the 18×24 JPEG is
 * then 3.5 MB instead of 1.7 MB. Encoders that always subsample (the canvas API cannot ask) still
 * give, at 300 dpi, artefacts far below what print resolves. The PNG export stays the lossless
 * master.
 *
 * Objects: 1 catalog, 2 pages, 3 page, 4 image, 5 content stream, 6 info (Title, Producer
 * "Vert", CreationDate). The xref table records each object's exact byte offset.
 */
import type { PosterSize } from '../sizes';

/** PDF points per inch. */
const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/** Physical page sizes, inches, of the print sizes (others fall back to 300 dpi). */
const PHYSICAL_INCHES: Readonly<Record<string, readonly [number, number]>> = {
  '18x24': [18, 24],
  a3: [297 / MM_PER_INCH, 420 / MM_PER_INCH],
};

/** The print resolution the pixel sizes are made for. */
export const PRINT_DPI = 300;

/** The page size, points, for a poster size: 18×24 in = 1296 × 1728; A3 = 841.89 × 1190.55. */
export function pdfPageSize(size: Pick<PosterSize, 'id' | 'width' | 'height'>): {
  width: number;
  height: number;
} {
  const inches = PHYSICAL_INCHES[size.id] ?? [size.width / PRINT_DPI, size.height / PRINT_DPI];
  return { width: inches[0] * PT_PER_INCH, height: inches[1] * PT_PER_INCH };
}

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  /** 1 grey, 3 YCbCr/RGB, 4 CMYK. */
  readonly components: number;
}

/** Reads a JPEG's size and component count from its start-of-frame marker. */
export function jpegInfo(bytes: Uint8Array): JpegInfo {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
        components: bytes[offset + 9] ?? 0,
      };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG has no frame header');
}

/** A PDF text string: UTF-16BE with a byte-order mark, hex encoded (safe for any title). */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i += 1) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

/** A PDF date, "D:20261012153000Z" (UTC). */
export function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** A number for a PDF: at most 2 decimals, no exponent, no trailing zeros. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export interface SinglePagePdf {
  /** The JPEG file's bytes. */
  readonly jpeg: Uint8Array;
  /** Page size, points. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly title: string;
  readonly creationDate?: Date;
}

const COLOR_SPACES: Readonly<Record<number, string>> = {
  1: '/DeviceGray',
  3: '/DeviceRGB',
  4: '/DeviceCMYK',
};

/** The PDF file's bytes. */
export function singleImagePdfBytes({
  jpeg,
  pageWidth,
  pageHeight,
  title,
  creationDate = new Date(),
}: SinglePagePdf): Uint8Array<ArrayBuffer> {
  const info = jpegInfo(jpeg);
  const colorSpace = COLOR_SPACES[info.components];
  if (!colorSpace) throw new Error(`Unsupported JPEG with ${String(info.components)} components`);
  // Adobe CMYK JPEGs store inverted values; Vert's come from the browser (RGB), so no /Decode.
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const text = (value: string) => {
    push(encoder.encode(value));
  };
  const object = (id: number, body: string) => {
    offsets[id] = length;
    text(`${String(id)} 0 obj\n${body}\nendobj\n`);
  };

  // Header; the comment's high bytes mark the file as binary for transfer tools.
  text('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const w = num(pageWidth);
  const h = num(pageHeight);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>',
  );

  offsets[4] = length;
  text(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${String(info.width)} ` +
      `/Height ${String(info.height)} /ColorSpace ${colorSpace} /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${String(jpeg.length)} >>\nstream\n`,
  );
  push(jpeg);
  text('\nendstream\nendobj\n');

  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`);
  object(
    6,
    `<< /Title ${pdfTextString(title)} /Producer (Vert) /CreationDate (${pdfDate(creationDate)}) >>`,
  );

  const xref = length;
  const count = offsets.length; // objects 0..6
  let table = `xref\n0 ${String(count)}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    table += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  text(table);
  text(
    `trailer\n<< /Size ${String(count)} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The PDF as a Blob (`application/pdf`). */
export function writeSingleImagePdf(page: SinglePagePdf): Blob {
  return new Blob([singleImagePdfBytes(page)], { type: 'application/pdf' });
}
