/** Tile path parsing for the proxy. Pure, so it tests without the Workers runtime. */

/** Terrarium tiles exist for zoom 0–15. */
export const MAX_ZOOM = 15;

const TILE_PATH = /^\/tiles\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.png$/;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Parses a tile path, or returns null when it is not one or the tile does not exist. */
export function parseTilePath(pathname: string): Tile | null {
  const match = TILE_PATH.exec(pathname);
  if (!match) return null;
  const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
  const size = 2 ** z;
  if (z > MAX_ZOOM || x >= size || y >= size) return null;
  return { z, x, y };
}
