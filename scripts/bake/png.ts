/**
 * A PNG decoder for Terrarium tiles, in Node with `node:zlib` (the bake has no canvas): 8-bit
 * truecolour (RGB or RGBA) or palette images, not interlaced, every chunk's CRC checked. What the
 * app gets from `createImageBitmap` + `getImageData` for the same file: the stored RGB bytes, no
 * colour management, alpha ignored, then the app's own `decodeTerrariumImage`.
 */
import { crc32, inflateSync } from 'node:zlib';
import { decodeTerrariumImage } from '../../src/lib/terrarium';
import { TILE_SIZE } from '../../src/terrain/tiles';

/** The eight bytes every PNG starts with. */
export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** A file that is not a PNG this decoder reads. */
export class PngError extends Error {
  override name = 'PngError';
}

/** Whether `bytes` starts with the PNG signature. */
export function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** A decoded PNG as RGBA bytes, row-major from the top-left pixel. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/**
 * Decodes a PNG to RGBA.
 *
 * @throws PngError when the bytes are not a PNG, a chunk is damaged, or the image uses a format
 *   Terrarium tiles do not (bit depth other than 8, greyscale, interlacing).
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (!hasPngSignature(bytes)) throw new PngError('Not a PNG (no PNG signature)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colourType = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  let ended = false;
  const data: Uint8Array[] = [];
  for (let offset = PNG_SIGNATURE.length; offset < bytes.length && !ended;) {
    if (offset + 12 > bytes.length) throw new PngError('PNG cut off inside a chunk header');
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new PngError('PNG cut off inside a chunk');
    const typeAndBody = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(typeAndBody) !== view.getUint32(offset + 8 + length)) {
      throw new PngError('PNG chunk fails its CRC');
    }
    const type = String.fromCharCode(...typeAndBody.subarray(0, 4));
    const body = typeAndBody.subarray(4);
    if (type === 'IHDR') {
      if (length !== 13) throw new PngError('PNG header has the wrong length');
      const header = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      const depth = body[8];
      colourType = body[9] ?? -1;
      if (depth !== 8) throw new PngError(`PNG bit depth ${String(depth)} (tiles have 8)`);
      if (colourType !== 2 && colourType !== 3 && colourType !== 6) {
        throw new PngError(`PNG colour type ${String(colourType)} (tiles are RGB)`);
      }
      if (body[10] !== 0 || body[11] !== 0) throw new PngError('Unknown PNG compression');
      if (body[12] !== 0) throw new PngError('Interlaced PNG (tiles are not interlaced)');
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      ended = true;
    } else if ((typeAndBody[0] ?? 0) & 0x20) {
      // Ancillary chunk (gAMA, sRGB, iCCP…): ignored, as the app decodes with no colour management.
    } else {
      throw new PngError(`Unknown critical PNG chunk ${type}`);
    }
    offset = end;
  }
  if (colourType < 0) throw new PngError('PNG has no header');
  if (!ended) throw new PngError('PNG has no end chunk');
  if (width === 0 || height === 0) throw new PngError('PNG has no pixels');
  if (colourType === 3 && !palette) throw new PngError('Palette PNG without a palette');

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(data));
  } catch (error) {
    throw new PngError('PNG image data does not inflate', { cause: error });
  }
  const channels = colourType === 2 ? 3 : colourType === 6 ? 4 : 1;
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new PngError('PNG image data has the wrong size');

  const pixels = unfilter(raw, width, height, channels);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 1) {
      const index = pixels[i] ?? 0;
      if (palette && index * 3 + 2 >= palette.length) {
        throw new PngError('PNG palette index out of range');
      }
      rgba[i * 4] = palette?.[index * 3] ?? 0;
      rgba[i * 4 + 1] = palette?.[index * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = palette?.[index * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = transparency?.[index] ?? 255;
    } else {
      rgba[i * 4] = pixels[i * channels] ?? 0;
      rgba[i * 4 + 1] = pixels[i * channels + 1] ?? 0;
      rgba[i * 4 + 2] = pixels[i * channels + 2] ?? 0;
      rgba[i * 4 + 3] = channels === 4 ? (pixels[i * channels + 3] ?? 255) : 255;
    }
  }
  return { width, height, rgba };
}

/** Undoes PNG's per-row filters (none, sub, up, average, Paeth). */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)] ?? 0;
    if (filter > 4) throw new PngError(`Unknown PNG filter ${String(filter)}`);
    const src = row * (stride + 1) + 1;
    const dst = row * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (out[dst + i - channels] ?? 0) : 0;
      const b = row > 0 ? (out[dst - stride + i] ?? 0) : 0;
      const c = i >= channels && row > 0 ? (out[dst - stride + i - channels] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + i] = ((raw[src + i] ?? 0) + predictor) & 0xff;
    }
  }
  return out;
}

/**
 * Elevations (metres) of a Terrarium tile PNG, TILE_SIZE² values from the north-west pixel.
 *
 * @throws PngError when the bytes are not a readable PNG of TILE_SIZE × TILE_SIZE pixels.
 */
export function decodeTerrariumPngBytes(bytes: Uint8Array): Float32Array {
  const { width, height, rgba } = decodePng(bytes);
  if (width !== TILE_SIZE || height !== TILE_SIZE) {
    throw new PngError(
      `Tile is ${String(width)}×${String(height)} pixels, not ${String(TILE_SIZE)}²`,
    );
  }
  return decodeTerrariumImage(rgba, width, height);
}
