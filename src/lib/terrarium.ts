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

/** Radius of the neighbourhood {@link removeSpikes} judges a pixel by: 5 × 5 pixels. */
export const SPIKE_RADIUS = 2;
/** The smallest spike {@link spikeThreshold} allows, metres. */
export const MIN_SPIKE_M = 100;
/** …and, on coarse tiles, the spike threshold in pixel widths (of 45° slope). */
export const SPIKE_PIXELS = 5;

/**
 * How far (metres) a pixel must stand from most of its neighbourhood to count as a spike in
 * {@link removeSpikes}, for tiles of `metresPerPixel`: at least {@link MIN_SPIKE_M}, and
 * {@link SPIKE_PIXELS} pixel widths on coarse tiles, where real summits stand further above their
 * neighbours (z10 in the Alps: 525 m).
 */
export function spikeThreshold(metresPerPixel: number): number {
  return Math.max(MIN_SPIKE_M, SPIKE_PIXELS * metresPerPixel);
}

/**
 * Replaces the spikes in a row-major elevation grid with the median of their neighbourhood, in
 * place, and returns how many it replaced.
 *
 * A pixel is a spike when more than half of the other pixels in its 5 × 5 neighbourhood (fewer at
 * the grid's edges) stand more than `threshold` metres above it, or more than half stand more than
 * `threshold` below it. Terrarium has such artefacts along some coastlines: one-pixel-wide lines
 * of −1,000 to −7,000 m where its sources meet (Hong Kong harbour at z14), and, in the coarser
 * zooms built from them, ringing of −500 to +6,400 m next to sea-level pixels. Ordinary terrain
 * is left alone: on a slope the neighbourhood's median is the pixel itself, and a summit's or a
 * valley floor's neighbours climb or fall towards it a slope at a time ({@link spikeThreshold}).
 * Near-vertical walls are the exception: a single rim or foot pixel can qualify and is moved (Mt
 * Thor at z11: 25 pixels, by up to 527 m; El Capitan, Half Dome, Zion: a few, 114–200 m).
 * Neighbours are read from the original values, so the result does not depend on scan order, and
 * a line or small blob of spike pixels (a minority of each neighbourhood) is replaced whole.
 *
 * Cost: one pass comparing each pixel with its right and lower neighbours; the full test runs only
 * within two pixels of a step larger than `threshold / 4` (a spike's neighbourhood holds such a
 * step on the way from it to each neighbour that clears it by `threshold`).
 */
export function removeSpikes(
  grid: Float32Array,
  width: number,
  height: number,
  threshold: number,
): number {
  if (width < 1 || height < 1 || grid.length < width * height) {
    throw new RangeError('removeSpikes needs a grid of at least width × height values');
  }
  const r = SPIKE_RADIUS;
  const step = threshold / 4;
  // Pixels within r of a steep step: the only ones that can be spikes.
  const candidate = new Uint8Array(width * height);
  let candidates = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = grid[y * width + x] ?? 0;
      const right = x + 1 < width ? (grid[y * width + x + 1] ?? v) : v;
      const below = y + 1 < height ? (grid[(y + 1) * width + x] ?? v) : v;
      if (!(Math.abs(right - v) > step || Math.abs(below - v) > step)) continue;
      // The step is between (x, y) and (x + 1, y) or (x, y + 1): mark everything within r of both.
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + 1 + r);
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + 1 + r); yy++) {
        candidate.fill(1, yy * width + x0, yy * width + x1 + 1);
      }
      candidates++;
    }
  }
  if (candidates === 0) return 0;
  const original = Float32Array.from(grid.subarray(0, width * height));
  const neighbours: number[] = [];
  let replaced = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (candidate[index] !== 1) continue;
      const v = original[index] ?? 0;
      neighbours.length = 0;
      let above = 0;
      let below = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) {
          if (xx === x && yy === y) continue;
          const n = original[yy * width + xx] ?? v;
          neighbours.push(n);
          if (n - v > threshold) above++;
          else if (v - n > threshold) below++;
        }
      }
      if (2 * above <= neighbours.length && 2 * below <= neighbours.length) continue;
      neighbours.sort((a, b) => a - b);
      const mid = neighbours.length >> 1;
      grid[index] =
        neighbours.length % 2 === 1
          ? (neighbours[mid] ?? v)
          : ((neighbours[mid - 1] ?? v) + (neighbours[mid] ?? v)) / 2;
      replaced++;
    }
  }
  return replaced;
}
