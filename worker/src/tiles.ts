/** Tile path parsing and addressing for the proxy. Pure, so it tests without the Workers runtime. */

/**
 * Lowest zoom the proxy serves. The client picks 12–14 for ordinary routes and drops lower for very
 * long ones (about 8 for 100+ km); 6 leaves headroom without opening the whole pyramid.
 */
export const MIN_ZOOM = 6;

/** Terrarium tiles exist up to zoom 15. */
export const MAX_ZOOM = 15;

const TILE_PATH = /^\/tiles\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.png$/;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Parses a tile path, or returns null when it is not one or the tile is outside the served range. */
export function parseTilePath(pathname: string): Tile | null {
  const match = TILE_PATH.exec(pathname);
  if (!match) return null;
  const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
  const size = 2 ** z;
  if (z < MIN_ZOOM || z > MAX_ZOOM || x >= size || y >= size) return null;
  return { z, x, y };
}

/** `z/x/y` with no padding: the only part of a tile request that reaches storage or upstream. */
function tilePath({ z, x, y }: Tile): string {
  return `${String(z)}/${String(x)}/${String(y)}`;
}

/** R2 object key of a tile. */
export function r2Key(tile: Tile): string {
  return `terrarium/${tilePath(tile)}.png`;
}

/** The public AWS Terrain Tiles bucket, Terrarium encoding. */
export const UPSTREAM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';

/** Upstream URL of a tile, built from z/x/y alone. */
export function upstreamUrl(tile: Tile): string {
  return `${UPSTREAM_BASE}${tilePath(tile)}.png`;
}
