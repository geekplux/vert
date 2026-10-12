/**
 * Terrarium elevation tiles (AWS Terrain Tiles): each pixel stores elevation in metres as
 * `r * 256 + g + b / 256 - 32768`, giving a 1/256 m step over −32,768 to +32,768 m.
 */

/** Offset that lets Terrarium store below-sea-level elevations in unsigned bytes. */
const TERRARIUM_OFFSET_M = 32768;

/** Elevation in metres of one Terrarium pixel. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET_M;
}

/**
 * Decode an RGBA Terrarium image (e.g. `ImageData.data`) into elevations in metres, row-major,
 * one value per pixel. Alpha is ignored.
 *
 * @throws RangeError when `rgba` is not exactly `width * height * 4` bytes.
 */
export function decodeTerrariumImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const pixels = width * height;
  const validSize =
    Number.isInteger(width) && Number.isInteger(height) && width >= 0 && height >= 0;
  if (!validSize || rgba.length !== pixels * 4) {
    throw new RangeError(
      `Expected ${String(width)}×${String(height)}×4 = ${String(pixels * 4)} bytes, got ${String(rgba.length)}`,
    );
  }
  const out = new Float32Array(pixels);
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    // The length check above keeps every index in range; `?? 0` only satisfies the type checker.
    out[i] = decodeTerrarium(rgba[p] ?? 0, rgba[p + 1] ?? 0, rgba[p + 2] ?? 0);
  }
  return out;
}

/**
 * Bilinear sample of a row-major grid at fractional pixel coordinates (`fx`, `fy`), where integer
 * coordinates are sample centres: (0, 0) is the first value and (width − 1, height − 1) the last.
 * Coordinates outside the grid are clamped to its edge.
 *
 * @throws RangeError when the grid is empty or smaller than `width * height`.
 */
export function sampleBilinear(
  grid: ArrayLike<number>,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  if (width < 1 || height < 1 || grid.length < width * height) {
    throw new RangeError('sampleBilinear needs a non-empty grid of at least width × height values');
  }
  const x = Math.min(width - 1, Math.max(0, fx));
  const y = Math.min(height - 1, Math.max(0, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  // All four indices are inside the grid after clamping; `?? NaN` only satisfies the type checker.
  const at = (col: number, row: number) => grid[row * width + col] ?? NaN;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}
