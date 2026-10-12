/**
 * Marks a PNG with its print resolution (a `pHYs` chunk), so a print shop or image viewer reads an
 * 18×24 poster as 18 × 24 in at 300 dpi rather than 75 × 100 in at 72. Browsers' encoders write no
 * `pHYs`; the chunk goes straight after `IHDR`, which is always the first 33 bytes.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as PNG uses it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The PNG signature plus the IHDR chunk. */
const HEADER_LENGTH = 8 + 4 + 4 + 13 + 4;

/** A `pHYs` chunk for `dpi` (pixels per metre, unit 1). */
export function physChunk(dpi: number): Uint8Array<ArrayBuffer> {
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

/** `png` with a `pHYs` chunk for `dpi` (unchanged if it is not a PNG). */
export async function withPngDensity(png: Blob, dpi: number): Promise<Blob> {
  const head = new Uint8Array(await png.slice(0, HEADER_LENGTH).arrayBuffer());
  const isPng =
    head.length === HEADER_LENGTH &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    String.fromCharCode(...head.subarray(12, 16)) === 'IHDR';
  if (!isPng) return png;
  return new Blob([png.slice(0, HEADER_LENGTH), physChunk(dpi), png.slice(HEADER_LENGTH)], {
    type: 'image/png',
  });
}
