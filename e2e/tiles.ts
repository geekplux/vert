import { crc32, deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

/**
 * Elevation tiles for e2e without the network: `/tiles/z/x/y.png` is answered with a synthetic
 * Terrarium PNG (rolling hills, continuous across tiles), so the live terrain renders the same on
 * every run and the tests never depend on the AWS bucket the preview server proxies to.
 */

export const TILE_PATH = /\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/;

const SIZE = 256;

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Elevation in metres at a Web Mercator position (0–1 across the world). */
function elevation(u: number, v: number): number {
  const tau = 2 * Math.PI;
  // A few hills across a 20 km route's area (≈ 1.4e-4 of the world wide).
  return 800 + 300 * Math.sin(tau * 21_000 * u) * Math.cos(tau * 17_000 * v);
}

/** RGB bytes of one pixel. */
export type Rgb = readonly [r: number, g: number, b: number];

/** Terrarium encoding: `value = metres + 32768`, then r = value / 256, g = value % 256, b = fraction. */
export function terrariumRgb(metres: number): Rgb {
  const value = metres + 32_768;
  return [Math.floor(value / 256), Math.floor(value) % 256, Math.floor((value % 1) * 256)];
}

/**
 * An 8-bit RGB PNG, `size` × `size`. With `gamma` it also carries a gAMA chunk (e.g. 1.0): a
 * browser that colour-manages the image would then change its bytes, which a Terrarium decoder
 * must not let happen.
 */
export function rgbPng(
  pixel: (px: number, py: number) => Rgb,
  { size = SIZE, gamma }: { size?: number; gamma?: number } = {},
): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let py = 0; py < size; py++) {
    const row = py * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const [r, g, b] = pixel(px, py);
      const offset = row + 1 + px * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const chunks = [chunk('IHDR', header)];
  if (gamma !== undefined) {
    const gama = Buffer.alloc(4);
    gama.writeUInt32BE(Math.round(100_000 / gamma));
    chunks.push(chunk('gAMA', gama));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunks,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 256 × 256 RGB Terrarium PNG for tile z/x/y. */
export function terrariumTile(z: number, x: number, y: number): Buffer {
  const world = SIZE * 2 ** z;
  return rgbPng((px, py) =>
    terrariumRgb(elevation((x * SIZE + px + 0.5) / world, (y * SIZE + py + 0.5) / world)),
  );
}

/** Answers every tile request on `page` with a synthetic tile. */
export async function serveSyntheticTiles(page: Page): Promise<void> {
  await page.route(TILE_PATH, async (route) => {
    const match = TILE_PATH.exec(new URL(route.request().url()).pathname);
    if (!match) {
      await route.abort();
      return;
    }
    const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
    await route.fulfill({ status: 200, contentType: 'image/png', body: terrariumTile(z, x, y) });
  });
}
