/**
 * The attack a scene grid must withstand (docs/SCENE.md, "No latitude from the grid"): recovering
 * the tiles' native pixel pitch from the elevations alone. A grid sampled from tiles by
 * interpolation that has a kink at every source pixel line (bilinear) has second differences that
 * peak once per native pixel; a periodogram of the mean |second difference| per column (or row)
 * then peaks at that pitch, folded into 0–0.5 cycles per sample. With the zoom and the spacing the
 * pitch gives cos(latitude). The bake runs {@link pitchSignature} on every scene it writes, and
 * the privacy tests run it on synthetic and real terrain.
 */
import { kernelWidthFactor } from '../lib/smoothSample';
import { SMOOTH_SIGMA_EQUATOR_PX, SMOOTH_SIGMA_PER_SPACING } from '../terrain/heightfield';
import type { SceneGrid } from './types';

/** Native tile pixel size at zoom 0 on the equator, metres (2π · 6,378,137 / 256). */
export const PIXEL_M_Z0 = (2 * Math.PI * 6378137) / 256;

/**
 * A pitch counts as detected when the power at its alias is at least this many times the
 * spectrum's mean power **and** at least the strongest power within {@link NEIGHBOURHOOD} of it
 * (the alias stands out locally). The bilinear grids measured gave 15–106× at the alias, the
 * strongest peak of its neighbourhood; in a clean spectrum chance peaks reach 10–20× at low
 * frequencies (the relief's own spectrum), so a low alias must beat those to count.
 */
export const ALIAS_POWER_LIMIT = 6;

/** Half-width of the neighbourhood an alias must stand out in, cycles per sample. */
export const NEIGHBOURHOOD = 0.05;

/** Frequencies within this of the predicted alias count as "at" it (≈ one resolution bin). */
export const ALIAS_TOLERANCE = 0.003;

/** Mean |second difference| of the elevations across each column (`x`) or row (`y`). */
export function secondDifferenceProfile(grid: SceneGrid, axis: 'x' | 'y'): Float64Array {
  const { width: w, height: h, elevations: e } = grid;
  const n = axis === 'x' ? w : h;
  const other = axis === 'x' ? h : w;
  const at = (k: number, j: number) => (axis === 'x' ? e[j * w + k] : e[k * w + j]) ?? 0;
  const profile = new Float64Array(n);
  for (let k = 1; k < n - 1; k++) {
    let sum = 0;
    for (let j = 0; j < other; j++) sum += Math.abs(at(k - 1, j) - 2 * at(k, j) + at(k + 1, j));
    profile[k] = sum / other;
  }
  return profile;
}

/** Periodogram of a profile's interior (mean removed), 0.02–0.5 cycles per sample. */
export function periodogram(profile: Float64Array): { f: Float64Array; power: Float64Array } {
  const values = Array.from(profile.subarray(1, profile.length - 1));
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const v = values.map((x) => x - mean);
  const count = Math.floor((0.5 - 0.02) / 0.0002) + 1;
  const f = new Float64Array(count);
  const power = new Float64Array(count);
  for (let m = 0; m < count; m++) {
    const freq = 0.02 + m * 0.0002;
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      re += (v[k] ?? 0) * Math.cos(2 * Math.PI * freq * k);
      im += (v[k] ?? 0) * Math.sin(2 * Math.PI * freq * k);
    }
    f[m] = freq;
    power[m] = (re * re + im * im) / n;
  }
  return { f, power };
}

/** Grid samples per native tile pixel at `latitude`, for a grid spacing in metres and a zoom. */
export function nativePitch(latitude: number, spacing: number, zoom: number): number {
  return (PIXEL_M_Z0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom / spacing;
}

/** Where a pitch of `pitch` samples shows in a 0–0.5 cycles-per-sample spectrum. */
export function aliasFrequency(pitch: number): number {
  const f = 1 / pitch;
  return Math.abs(f - Math.round(f));
}

export interface AxisSignature {
  /** Predicted alias of the true native pitch, cycles per sample. */
  readonly alias: number;
  /** Strongest power within {@link ALIAS_TOLERANCE} of it, in multiples of the mean power. */
  readonly aliasPower: number;
  /** Strongest power elsewhere within {@link NEIGHBOURHOOD} of the alias, same unit. */
  readonly neighbourPower: number;
  /** The spectrum's strongest peak: frequency and multiple of the mean power. */
  readonly peak: number;
  readonly peakPower: number;
}

/**
 * The pitch signature of a grid on each axis, given the true latitude of its centre (which only
 * the bake knows); {@link isPitchHidden} judges it.
 */
export function pitchSignature(
  grid: SceneGrid,
  latitude: number,
): { x: AxisSignature; y: AxisSignature } {
  const axis = (which: 'x' | 'y'): AxisSignature => {
    const spacing = which === 'x' ? grid.metresPerSample.x : grid.metresPerSample.y;
    const alias = aliasFrequency(nativePitch(latitude, spacing, grid.zoom));
    const { f, power } = periodogram(secondDifferenceProfile(grid, which));
    let mean = 0;
    for (const p of power) mean += p;
    mean /= power.length || 1;
    let aliasPower = 0;
    let neighbourPower = 0;
    let peak = 0;
    let peakPower = -Infinity;
    for (let m = 0; m < f.length; m++) {
      const p = (power[m] ?? 0) / (mean || 1);
      const distance = Math.abs((f[m] ?? 0) - alias);
      if (distance <= ALIAS_TOLERANCE) aliasPower = Math.max(aliasPower, p);
      else if (distance <= NEIGHBOURHOOD) neighbourPower = Math.max(neighbourPower, p);
      if (p > peakPower) {
        peakPower = p;
        peak = f[m] ?? 0;
      }
    }
    return { alias, aliasPower, neighbourPower, peak, peakPower };
  };
  return { x: axis('x'), y: axis('y') };
}

/** Whether the native pitch shows on this axis (see {@link ALIAS_POWER_LIMIT}). */
export function isPitchDetected(s: AxisSignature): boolean {
  return s.aliasPower >= ALIAS_POWER_LIMIT && s.aliasPower >= s.neighbourPower;
}

/** No detectable native pitch on either axis (see {@link pitchSignature}). */
export function isPitchHidden(signature: { x: AxisSignature; y: AxisSignature }): boolean {
  return !isPitchDetected(signature.x) && !isPitchDetected(signature.y);
}

/**
 * The latitudes an attacker would try from a spectral peak at `frequency` (cycles per sample):
 * every native pitch whose alias is that frequency, within the band of latitudes where the grid's
 * zoom gets chosen (`buildHeightfield` picks the highest zoom whose native extent fits 512 pixels,
 * so cos(latitude) ≥ extent · 2^zoom / (512 · 256 px · pixel size at z0), and below twice that
 * unless the zoom is the top one, 14). Degrees.
 */
export function latitudeCandidates(grid: SceneGrid, frequency: number): number[] {
  const spacing = (grid.metresPerSample.x + grid.metresPerSample.y) / 2;
  const extent = spacing * (Math.max(grid.width, grid.height) - 1);
  const low = (extent * 2 ** grid.zoom) / (PIXEL_M_Z0 * 512);
  const high = grid.zoom >= 14 ? 1 : Math.min(1, 2 * low);
  const out: number[] = [];
  for (let n = 0; n < 40; n++) {
    for (const cyclesPerSample of [n + frequency, n - frequency]) {
      if (cyclesPerSample <= 0) continue;
      const cos = (spacing * 2 ** grid.zoom) / (PIXEL_M_Z0 * cyclesPerSample);
      if (cos >= low && cos <= high) out.push((Math.acos(cos) * 180) / Math.PI);
    }
  }
  return out;
}

/**
 * The second attack: the width of the smoothing kernel. A grid low-passed by a Gaussian of σ
 * samples has row and column power spectra that roll off as exp(−4π²σ²f²); fitting
 * log P(f) = a − β·log f − 4π²σ²·f² (a power-law relief times the kernel) over the band where the
 * power stands well above the elevation step's quantisation noise recovers σ. If σ were a fixed
 * number of real tile pixels, σ × spacing ÷ (pixel size at the equator for the zoom) would be
 * cos(latitude). The scene sampler therefore sets σ from published values only
 * ({@link publishedKernelWidth}); a fit should find that and nothing else. Returns `NaN` when too
 * little of the spectrum stands above the noise to fit.
 */
export function kernelWidth(grid: SceneGrid, axis: 'x' | 'y'): number {
  const { width: w, height: h, elevations: e } = grid;
  const n = axis === 'x' ? w : h;
  const other = axis === 'x' ? h : w;
  const half = Math.floor(n / 2);
  const power = new Float64Array(half + 1);
  const hann = Float64Array.from(
    { length: n },
    (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)),
  );
  const cos = Array.from({ length: half + 1 }, (_, f) =>
    Float64Array.from({ length: n }, (_, k) => Math.cos((2 * Math.PI * f * k) / n)),
  );
  const sin = Array.from({ length: half + 1 }, (_, f) =>
    Float64Array.from({ length: n }, (_, k) => Math.sin((2 * Math.PI * f * k) / n)),
  );
  const line = new Float64Array(n);
  let sx = 0;
  let sxx = 0;
  for (let k = 0; k < n; k++) {
    sx += k;
    sxx += k * k;
  }
  for (let j = 0; j < other; j++) {
    let sy = 0;
    let sxy = 0;
    for (let k = 0; k < n; k++) {
      const v = (axis === 'x' ? e[j * w + k] : e[k * w + j]) ?? 0;
      line[k] = v;
      sy += v;
      sxy += k * v;
    }
    // Remove the line's linear trend, then taper it (Hann) before the transform.
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    for (let k = 0; k < n; k++) line[k] = ((line[k] ?? 0) - intercept - slope * k) * (hann[k] ?? 0);
    for (let f = 1; f <= half; f++) {
      const c = cos[f] ?? line;
      const s = sin[f] ?? line;
      let re = 0;
      let im = 0;
      for (let k = 0; k < n; k++) {
        re += (line[k] ?? 0) * (c[k] ?? 0);
        im += (line[k] ?? 0) * (s[k] ?? 0);
      }
      power[f] = (power[f] ?? 0) + (re * re + im * im) / other;
    }
  }
  let hannPower = 0;
  for (const v of hann) hannPower += v * v;
  // White quantisation noise of the elevation step, through the same taper.
  const floor = ((grid.elevationStep * grid.elevationStep) / 12) * hannPower;
  // Least squares on f ≥ 4 / n while the power stays above 20 × the noise floor.
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  let used = 0;
  for (let f = 4; f <= half; f++) {
    const p = power[f] ?? 0;
    if (p < 20 * floor) break;
    const fr = f / n;
    const row = [1, Math.log(fr), fr * fr];
    const y = Math.log(p);
    for (let r = 0; r < 3; r++) {
      b[r] = (b[r] ?? 0) + (row[r] ?? 0) * y;
      const Ar = A[r] ?? [];
      for (let q = 0; q < 3; q++) Ar[q] = (Ar[q] ?? 0) + (row[r] ?? 0) * (row[q] ?? 0);
    }
    used++;
  }
  if (used < 6) return NaN;
  const at = (M: number[][], r: number, q: number) => M[r]?.[q] ?? 0;
  const det = (M: number[][]) =>
    at(M, 0, 0) * (at(M, 1, 1) * at(M, 2, 2) - at(M, 1, 2) * at(M, 2, 1)) -
    at(M, 0, 1) * (at(M, 1, 0) * at(M, 2, 2) - at(M, 1, 2) * at(M, 2, 0)) +
    at(M, 0, 2) * (at(M, 1, 0) * at(M, 2, 1) - at(M, 1, 1) * at(M, 2, 0));
  const D = det(A);
  const replaced = A.map((row, r) => row.map((v, q) => (q === 2 ? (b[r] ?? 0) : v)));
  const c = -det(replaced) / D; // the f² coefficient is −4π²σ²
  return c > 0 ? Math.sqrt(c) / (2 * Math.PI) : 0;
}

/** Equatorial tile pixel size at `zoom`, metres: 2π · 6,378,137 / (256 · 2^zoom). */
export function equatorPixel(zoom: number): number {
  return PIXEL_M_Z0 / 2 ** zoom;
}

/**
 * The scene sampler's kernel width along an axis, in grid samples, from published values alone:
 * σ = max(1.5 equatorial pixels of the zoom, 0.5 samples) (`SMOOTH_SIGMA_EQUATOR_PX`,
 * `SMOOTH_SIGMA_PER_SPACING` in heightfield.ts), as the root-mean-square width that
 * {@link kernelWidth} estimates (σ × `kernelWidthFactor()`, the taper's narrowing).
 */
export function publishedKernelWidth(grid: SceneGrid, axis: 'x' | 'y'): number {
  return kernelSigma(grid, axis, 1) * kernelWidthFactor();
}

/**
 * The same with the pixel size at `cos` × the equatorial one: `cos` = 1 is the published rule; the
 * true cos(latitude) gives the width a kernel of 1.5 real pixels would have had (the leak).
 */
export function kernelSigma(grid: SceneGrid, axis: 'x' | 'y', cos: number): number {
  const spacing = axis === 'x' ? grid.metresPerSample.x : grid.metresPerSample.y;
  return Math.max(
    (SMOOTH_SIGMA_EQUATOR_PX * equatorPixel(grid.zoom) * cos) / spacing,
    SMOOTH_SIGMA_PER_SPACING,
  );
}
