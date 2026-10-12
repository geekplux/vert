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

/** A 256 × 256 RGB Terrarium PNG for tile z/x/y. */
export function terrariumTile(z: number, x: number, y: number): Buffer {
  const world = SIZE * 2 ** z;
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
  for (let py = 0; py < SIZE; py++) {
    const row = py * (1 + SIZE * 3);
    raw[row] = 0; // filter: none
    for (let px = 0; px < SIZE; px++) {
      const metres = elevation((x * SIZE + px + 0.5) / world, (y * SIZE + py + 0.5) / world);
      const value = metres + 32_768;
      const offset = row + 1 + px * 3;
      raw[offset] = Math.floor(value / 256);
      raw[offset + 1] = Math.floor(value) % 256;
      raw[offset + 2] = Math.floor((value % 1) * 256);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
