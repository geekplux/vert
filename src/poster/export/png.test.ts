import { describe, expect, it } from 'vitest';
import { crc32, physChunk, withPngDensity } from './png';

const ascii = (text: string) => new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));

describe('crc32', () => {
  it('matches PNG’s CRC (the IEND chunk’s is AE 42 60 82)', () => {
    expect(crc32(ascii('IEND'))).toBe(0xae426082);
  });
});

describe('physChunk', () => {
  it('stores 300 dpi as 11811 px per metre, unit metre, with its CRC', () => {
    const chunk = physChunk(300);
    const view = new DataView(chunk.buffer);
    expect(view.getUint32(0)).toBe(9);
    expect(String.fromCharCode(...chunk.subarray(4, 8))).toBe('pHYs');
    expect(view.getUint32(8)).toBe(11811);
    expect(view.getUint32(12)).toBe(11811);
    expect(chunk[16]).toBe(1);
    expect(view.getUint32(17)).toBe(crc32(chunk.subarray(4, 17)));
  });
});

describe('withPngDensity', () => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, ...ascii('IHDR'), ...new Array<number>(17).fill(0)];
  const rest = [0, 0, 0, 0, ...ascii('IEND'), 0xae, 0x42, 0x60, 0x82];

  it('inserts the chunk straight after IHDR', async () => {
    const png = new Blob([new Uint8Array([...signature, ...ihdr, ...rest])], { type: 'image/png' });
    const out = new Uint8Array(await (await withPngDensity(png, 300)).arrayBuffer());
    expect(out.length).toBe(png.size + 21);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    expect(String.fromCharCode(...out.subarray(58, 62))).toBe('IEND');
  });

  it('leaves anything else alone', async () => {
    const other = new Blob([ascii('not a png at all, just some bytes here')]);
    expect(await withPngDensity(other, 300)).toBe(other);
  });
});
