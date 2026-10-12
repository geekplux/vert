import { inflateSync } from 'node:zlib';

/**
 * Just enough PNG, JPEG and PDF reading for the export tests: chunk lists, 8-bit RGB(A) pixels
 * (every filter), JPEG frame size and the PDF's page objects. No dependency.
 */

export interface PngChunk {
  readonly type: string;
  readonly data: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunks(png: Buffer): PngChunk[] {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG');
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

export interface PngInfo {
  readonly width: number;
  readonly height: number;
  /** pHYs in pixels per metre (x, y) and its unit (1 = metre), or null. */
  readonly phys: { x: number; y: number; unit: number } | null;
}

export function pngInfo(png: Buffer): PngInfo {
  const chunks = pngChunks(png);
  const header = chunks[0];
  if (header?.type !== 'IHDR') throw new Error('No IHDR');
  const phys = chunks.find((chunk) => chunk.type === 'pHYs');
  return {
    width: header.data.readUInt32BE(0),
    height: header.data.readUInt32BE(4),
    phys: phys
      ? { x: phys.data.readUInt32BE(0), y: phys.data.readUInt32BE(4), unit: phys.data[8] ?? 0 }
      : null,
  };
}

/** Decoded pixels, RGBA, row by row. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG. */
export function decodePng(png: Buffer): Pixels {
  const chunks = pngChunks(png);
  const header = chunks[0]?.data;
  if (!header) throw new Error('No IHDR');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colour = header[9];
  const interlace = header[12];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error(`Unsupported PNG (depth ${String(depth)}, colour ${String(colour)})`);
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(
    Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)),
  );
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let i = 0; i < stride; i++) {
      const x = raw[start + 1 + i] ?? 0;
      const a = i >= channels ? (current[i - channels] ?? 0) : 0;
      const b = previous[i] ?? 0;
      const c = i >= channels ? (previous[i - channels] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + a;
          break;
        case 2:
          value = x + b;
          break;
        case 3:
          value = x + ((a + b) >> 1);
          break;
        case 4:
          value = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`Bad filter ${String(filter)}`);
      }
      current[i] = value & 0xff;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      const s = px * channels;
      out[o] = current[s] ?? 0;
      out[o + 1] = current[s + 1] ?? 0;
      out[o + 2] = current[s + 2] ?? 0;
      out[o + 3] = channels === 4 ? (current[s + 3] ?? 0) : 255;
    }
    [previous, current] = [current, previous];
  }
  return { width, height, data: out };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How many pixels in `rect` satisfy `test(r, g, b)`. */
export function countPixels(
  pixels: Pixels,
  rect: Rect,
  test: (r: number, g: number, b: number) => boolean,
): number {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(pixels.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(pixels.height, Math.ceil(rect.y + rect.height));
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * pixels.width + x) * 4;
      if (test(pixels.data[o] ?? 0, pixels.data[o + 1] ?? 0, pixels.data[o + 2] ?? 0)) count++;
    }
  }
  return count;
}

/** Whether (r, g, b) is within `tolerance` of `hex` on every channel. */
export function near(hex: string, tolerance: number) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const [R, G, B] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return (r: number, g: number, b: number) =>
    Math.abs(r - R) <= tolerance && Math.abs(g - G) <= tolerance && Math.abs(b - B) <= tolerance;
}

/**
 * The grey levels of `rect` of `pixels`, averaged down to `width × height` cells (box filter):
 * an export crop at the preview's resolution.
 */
export function greyCells(pixels: Pixels, rect: Rect, width: number, height: number): Float64Array {
  const cells = new Float64Array(width * height);
  const counts = new Float64Array(width * height);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(pixels.width, Math.floor(rect.x + rect.width));
  const y1 = Math.min(pixels.height, Math.floor(rect.y + rect.height));
  for (let y = y0; y < y1; y++) {
    const cy = Math.min(height - 1, Math.floor(((y - y0) / (y1 - y0)) * height));
    for (let x = x0; x < x1; x++) {
      const cx = Math.min(width - 1, Math.floor(((x - x0) / (x1 - x0)) * width));
      const o = (y * pixels.width + x) * 4;
      const grey =
        0.299 * (pixels.data[o] ?? 0) +
        0.587 * (pixels.data[o + 1] ?? 0) +
        0.114 * (pixels.data[o + 2] ?? 0);
      cells[cy * width + cx] = (cells[cy * width + cx] ?? 0) + grey;
      counts[cy * width + cx] = (counts[cy * width + cx] ?? 0) + 1;
    }
  }
  for (let i = 0; i < cells.length; i++) cells[i] = (cells[i] ?? 0) / Math.max(1, counts[i] ?? 1);
  return cells;
}

/** The frame size of a baseline or progressive JPEG (its SOF marker). */
export function jpegSize(jpeg: Buffer): { width: number; height: number } {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG');
  let offset = 2;
  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) throw new Error('Bad JPEG marker');
    const marker = jpeg[offset + 1] ?? 0;
    const length = jpeg.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('No SOF in the JPEG');
}

/** The PDF's page objects, media boxes and its one image stream (a JPEG). */
export function pdfSummary(pdf: Buffer) {
  const text = pdf.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page(?!s)\b/g) ?? [];
  const mediaBox = /\/MediaBox\s*\[\s*([\d.\s]+)\]/
    .exec(text)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  const streamAt = text.indexOf('/Filter /DCTDecode');
  const start = streamAt >= 0 ? text.indexOf('stream', streamAt) : -1;
  const dataStart = start >= 0 ? start + (text[start + 6] === '\r' ? 8 : 7) : -1;
  const jpeg = dataStart >= 0 ? pdf.subarray(dataStart) : null;
  return {
    header: text.slice(0, 5),
    pageCount: pages.length,
    mediaBox: mediaBox ?? null,
    jpeg: jpeg ? jpegSize(jpeg) : null,
  };
}
