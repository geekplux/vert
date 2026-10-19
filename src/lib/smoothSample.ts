/**
 * Resampling a raster with a smooth low-pass kernel instead of bilinear interpolation, for grids
 * that must not reveal the pitch of the raster they came from (Vert scenes, docs/SCENE.md, "No
 * latitude from the grid").
 *
 * Bilinear interpolation is a piecewise-linear surface with a kink along every source pixel line:
 * the second differences of a grid sampled from it peak periodically at the source pitch, and that
 * period (in grid samples) with the tile zoom gives the latitude. Here each output sample is a
 * normalised weighted sum of the source pixels around it, with a separable Gaussian of standard
 * deviation σ (source pixels), tapered smoothly to zero at {@link KERNEL_RADIUS_SIGMAS} σ. The
 * kernel and its first two derivatives are continuous everywhere, so nothing happens at a pixel
 * line. What remains is that the output's statistics vary with the position inside a source pixel:
 * for independent pixel values the variance of the output (and of its differences) ripples once per
 * pixel by a fraction of order exp(−π²σ²). At σ = 1 pixel that is about 5·10⁻⁵ and, averaged over
 * the hundreds of rows of a grid, still visible in a spectrum (measured: about 15× the mean power
 * on pixel-noise tiles); at σ = 1.5 pixels it is about 2·10⁻¹⁰ and nothing shows. Vert scenes use at
 * least 1.5 real pixels, set from the zoom and the spacing only (heightfield.ts, docs/SCENE.md).
 */

/** Kernel support, in standard deviations, beyond which a weight is exactly 0. */
export const KERNEL_RADIUS_SIGMAS = 4;

/** One output coordinate's source taps: first source index and normalised weights. */
interface Taps {
  readonly first: Int32Array;
  readonly count: Int32Array;
  readonly offset: Int32Array;
  readonly weights: Float64Array;
}

/**
 * Taps for output positions `positions` (source pixel coordinates, integer = pixel centre) over a
 * source axis of `size` pixels. Pixels off the raster get no weight; the rest are renormalised.
 */
function taps(positions: ArrayLike<number>, size: number, sigma: number): Taps {
  const radius = KERNEL_RADIUS_SIGMAS * sigma;
  const n = positions.length;
  const first = new Int32Array(n);
  const count = new Int32Array(n);
  const offset = new Int32Array(n);
  const all: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = positions[k] ?? 0;
    const lo = Math.max(0, Math.ceil(p - radius));
    const hi = Math.min(size - 1, Math.floor(p + radius));
    first[k] = lo;
    offset[k] = all.length;
    let sum = 0;
    const start = all.length;
    for (let s = lo; s <= hi; s++) {
      const d = (s - p) / sigma;
      const u = (s - p) / radius;
      // Gaussian times (1 − u²)³: smooth (C²) at the edge of the support too.
      const w = Math.exp(-0.5 * d * d) * (1 - u * u) ** 3;
      all.push(w);
      sum += w;
    }
    // Every output position lies on the raster, so at least one pixel has weight.
    for (let t = start; t < all.length; t++) all[t] = (all[t] ?? 0) / (sum || 1);
    count[k] = all.length - start;
  }
  return { first, count, offset, weights: Float64Array.from(all) };
}

/**
 * `source` (row-major, `width × height`) resampled at the outer product of column positions `xs`
 * and row positions `ys` (source pixel coordinates; integer values are pixel centres), with a
 * Gaussian of `sigmaX` × `sigmaY` source pixels. Row-major result, `xs.length × ys.length`.
 */
export function smoothSample(
  source: Float32Array,
  width: number,
  height: number,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  sigmaX: number,
  sigmaY: number,
): Float32Array {
  if (!(sigmaX > 0) || !(sigmaY > 0)) throw new RangeError('Kernel widths must be positive');
  const cols = taps(xs, width, sigmaX);
  const rows = taps(ys, height, sigmaY);
  const outW = xs.length;
  const outH = ys.length;
  // Source rows any output row reads.
  let rowLo = height;
  let rowHi = -1;
  for (let j = 0; j < outH; j++) {
    rowLo = Math.min(rowLo, rows.first[j] ?? 0);
    rowHi = Math.max(rowHi, (rows.first[j] ?? 0) + (rows.count[j] ?? 0) - 1);
  }
  // Pass 1, along x: every needed source row at every output column.
  const span = Math.max(0, rowHi - rowLo + 1);
  const across = new Float64Array(span * outW);
  for (let r = 0; r < span; r++) {
    const base = (rowLo + r) * width;
    for (let i = 0; i < outW; i++) {
      const c0 = cols.first[i] ?? 0;
      const o = cols.offset[i] ?? 0;
      const m = cols.count[i] ?? 0;
      let sum = 0;
      for (let t = 0; t < m; t++) sum += (cols.weights[o + t] ?? 0) * (source[base + c0 + t] ?? 0);
      across[r * outW + i] = sum;
    }
  }
  // Pass 2, along y.
  const out = new Float32Array(outW * outH);
  for (let j = 0; j < outH; j++) {
    const r0 = (rows.first[j] ?? 0) - rowLo;
    const o = rows.offset[j] ?? 0;
    const m = rows.count[j] ?? 0;
    for (let i = 0; i < outW; i++) {
      let sum = 0;
      for (let t = 0; t < m; t++)
        sum += (rows.weights[o + t] ?? 0) * (across[(r0 + t) * outW + i] ?? 0);
      out[j * outW + i] = sum;
    }
  }
  return out;
}

/**
 * The kernel's root-mean-square width as a fraction of σ: the taper narrows the Gaussian a little
 * (about 0.86σ at 4σ support). A spectrum's roll-off near zero frequency measures this width, so
 * it is what an estimate of the kernel from the grid finds.
 */
export function kernelWidthFactor(): number {
  const radius = KERNEL_RADIUS_SIGMAS;
  let weight = 0;
  let moment = 0;
  for (let d = -radius; d <= radius; d += 1e-3) {
    const u = d / radius;
    const w = Math.exp(-0.5 * d * d) * (1 - u * u) ** 3;
    weight += w;
    moment += w * d * d;
  }
  return Math.sqrt(moment / weight);
}
