/**
 * Integer streams for the scene format (docs/SCENE.md, "Streams"): signed residuals, zigzag
 * mapped to unsigned, Rice coded in blocks of {@link BLOCK_LENGTH} with one parameter `k` per
 * block. Bits are written most significant first; a stream starts and ends on a byte boundary
 * (the last byte padded with zero bits).
 *
 * Decoding never trusts its input: every read is bounds-checked, a unary run stops at
 * {@link ESCAPE_RUN} ones, and every failure is a {@link SceneError}.
 */
import { SceneError } from './error';

/** Values per block; each block carries its own Rice parameter. */
export const BLOCK_LENGTH = 64;
/** Bits of the per-block Rice parameter. */
export const K_BITS = 5;
/** Largest Rice parameter a block may use. */
export const MAX_K = 24;
/** A unary run this long is an escape: the value follows as {@link ESCAPE_BITS} plain bits. */
export const ESCAPE_RUN = 24;
export const ESCAPE_BITS = 32;
/** Largest unsigned (zigzag) value a stream can carry. */
export const MAX_UNSIGNED = 0x7fff_fffe;
/** Largest magnitude of a signed residual: 2³⁰ − 1, whose zigzag value is {@link MAX_UNSIGNED}. */
export const MAX_RESIDUAL = 0x3fff_ffff;

/** Signed → unsigned: 0, −1, 1, −2, 2 … become 0, 1, 2, 3, 4 … */
export function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

/** Unsigned → signed, the inverse of {@link zigzag}. */
export function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/** Appends bits to a growing byte array, most significant bit first. */
export class BitWriter {
  private bytes = new Uint8Array(1024);
  private length = 0;
  /** Bits already used in the byte at `length` (0–7). */
  private bit = 0;

  private ensure(extraBytes: number): void {
    if (this.length + extraBytes < this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + extraBytes + 1));
    grown.set(this.bytes);
    this.bytes = grown;
  }

  /** Writes the low `count` bits of `value` (0 ≤ count ≤ 32, value a non-negative integer). */
  write(value: number, count: number): void {
    this.ensure(5);
    for (let i = count - 1; i >= 0; i--) {
      const b = Math.floor(value / 2 ** i) % 2;
      if (b === 1) this.bytes[this.length] = (this.bytes[this.length] ?? 0) | (0x80 >> this.bit);
      this.bit++;
      if (this.bit === 8) {
        this.bit = 0;
        this.length++;
        this.ensure(5);
      }
    }
  }

  /** `count` one bits. */
  ones(count: number): void {
    for (let i = 0; i < count; i++) this.write(1, 1);
  }

  /** Pads to the next byte boundary with zero bits. */
  align(): void {
    if (this.bit > 0) {
      this.bit = 0;
      this.length++;
    }
  }

  /** The bytes written so far (aligned first). */
  finish(): Uint8Array {
    this.align();
    return this.bytes.slice(0, this.length);
  }
}

/** Reads bits from `bytes[start, end)`, most significant bit first. */
export class BitReader {
  private readonly bytes: Uint8Array;
  private readonly end: number;
  private offset: number;
  private bit = 0;

  constructor(bytes: Uint8Array, start: number, end: number) {
    this.bytes = bytes;
    this.offset = start;
    this.end = end;
  }

  /** Byte offset of the next unread byte, once aligned. */
  get position(): number {
    return this.offset;
  }

  readBit(): number {
    if (this.offset >= this.end)
      throw new SceneError('truncated', 'A stream runs past its section');
    const value = ((this.bytes[this.offset] ?? 0) >> (7 - this.bit)) & 1;
    this.bit++;
    if (this.bit === 8) {
      this.bit = 0;
      this.offset++;
    }
    return value;
  }

  /** Reads `count` bits (≤ 32) as a non-negative integer. */
  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = value * 2 + this.readBit();
    return value;
  }

  /** Skips to the next byte boundary; the padding bits must be zero. */
  align(): void {
    while (this.bit !== 0) {
      if (this.readBit() !== 0) throw new SceneError('corrupt', 'Non-zero padding after a stream');
    }
  }
}

/** Bits that `values` (unsigned) cost at Rice parameter `k`. */
function riceCost(values: readonly number[] | Uint32Array, from: number, to: number, k: number) {
  let bits = 0;
  const scale = 2 ** k;
  for (let i = from; i < to; i++) {
    const q = Math.floor((values[i] ?? 0) / scale);
    bits += q < ESCAPE_RUN ? q + 1 + k : ESCAPE_RUN + ESCAPE_BITS;
  }
  return bits;
}

/**
 * Writes signed `residuals` as one stream: per block of {@link BLOCK_LENGTH}, the cheapest `k`
 * (lowest on a tie, so the output is deterministic), then each value. Aligns at the end.
 */
export function writeStream(writer: BitWriter, residuals: ArrayLike<number>): void {
  const n = residuals.length;
  const unsigned = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const r = residuals[i] ?? 0;
    if (!Number.isInteger(r) || Math.abs(r) > MAX_RESIDUAL) {
      throw new RangeError(
        `Residual ${String(r)} is not an integer within ±${String(MAX_RESIDUAL)}`,
      );
    }
    unsigned[i] = zigzag(r);
  }
  for (let from = 0; from < n; from += BLOCK_LENGTH) {
    const to = Math.min(n, from + BLOCK_LENGTH);
    let bestK = 0;
    let bestBits = Infinity;
    for (let k = 0; k <= MAX_K; k++) {
      const bits = riceCost(unsigned, from, to, k);
      if (bits < bestBits) {
        bestBits = bits;
        bestK = k;
      }
    }
    writer.write(bestK, K_BITS);
    const scale = 2 ** bestK;
    for (let i = from; i < to; i++) {
      const u = unsigned[i] ?? 0;
      const q = Math.floor(u / scale);
      if (q < ESCAPE_RUN) {
        writer.ones(q);
        writer.write(0, 1);
        writer.write(u % scale, bestK);
      } else {
        writer.ones(ESCAPE_RUN);
        writer.write(u, ESCAPE_BITS);
      }
    }
  }
  writer.align();
}

/** Reads `count` signed residuals written by {@link writeStream}, and the padding after them. */
export function readStream(reader: BitReader, count: number): Int32Array {
  const out = new Int32Array(count);
  for (let from = 0; from < count; from += BLOCK_LENGTH) {
    const to = Math.min(count, from + BLOCK_LENGTH);
    const k = reader.read(K_BITS);
    if (k > MAX_K)
      throw new SceneError('corrupt', `Rice parameter ${String(k)} is over ${String(MAX_K)}`);
    const scale = 2 ** k;
    for (let i = from; i < to; i++) {
      let q = 0;
      while (q < ESCAPE_RUN && reader.readBit() === 1) q++;
      const u = q < ESCAPE_RUN ? q * scale + reader.read(k) : reader.read(ESCAPE_BITS);
      if (u > MAX_UNSIGNED) throw new SceneError('range', 'A stream value is out of range');
      out[i] = unzigzag(u);
    }
  }
  reader.align();
  return out;
}
