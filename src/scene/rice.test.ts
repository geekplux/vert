// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
import { describe, expect, it } from 'vitest';
import { SceneError } from './error';
import {
  BLOCK_LENGTH,
  BitReader,
  BitWriter,
  ESCAPE_RUN,
  MAX_RESIDUAL,
  MAX_UNSIGNED,
  readStream,
  unzigzag,
  writeStream,
  zigzag,
} from './rice';
import { randomStream } from './testing';

function roundTrip(values: number[]): { decoded: Int32Array; bytes: Uint8Array } {
  const writer = new BitWriter();
  writeStream(writer, values);
  const bytes = writer.finish();
  const reader = new BitReader(bytes, 0, bytes.length);
  const decoded = readStream(reader, values.length);
  expect(reader.position).toBe(bytes.length);
  return { decoded, bytes };
}

describe('zigzag', () => {
  it('interleaves signs and inverts', () => {
    expect([0, -1, 1, -2, 2].map(zigzag)).toEqual([0, 1, 2, 3, 4]);
    for (const v of [0, 1, -1, 1234, -98765, MAX_RESIDUAL, -MAX_RESIDUAL]) {
      expect(unzigzag(zigzag(v))).toBe(v);
    }
  });
});

describe('Rice streams', () => {
  it('round-trips small, large, escaped and extreme residuals', () => {
    const random = randomStream(7);
    const values: number[] = [];
    for (let i = 0; i < 1000; i++) values.push(Math.round((random() - 0.5) * 40) + 0);
    values.push(0, MAX_RESIDUAL, -MAX_RESIDUAL, 1_000_000, -1);
    for (let i = 0; i < 100; i++) values.push(Math.round((random() - 0.5) * 2 ** 20) + 0);
    expect(Array.from(roundTrip(values).decoded)).toEqual(values);
  });

  it('round-trips the empty stream and one value', () => {
    expect(roundTrip([]).bytes.length).toBe(0);
    expect(Array.from(roundTrip([-5]).decoded)).toEqual([-5]);
  });

  it('uses about one bit per value on constant data, and an escape on an outlier', () => {
    const zeros = new Array<number>(BLOCK_LENGTH * 8).fill(0);
    // k = 0: one bit per zero plus a 5-bit parameter per block.
    expect(roundTrip(zeros).bytes.length).toBe(Math.ceil((zeros.length + 8 * 5) / 8));
    const withOutlier = [...zeros.slice(0, BLOCK_LENGTH - 1), 2 ** 28];
    expect(Array.from(roundTrip(withOutlier).decoded)).toEqual(withOutlier);
  });

  it('rejects residuals it cannot carry', () => {
    expect(() => {
      writeStream(new BitWriter(), [MAX_RESIDUAL + 1]);
    }).toThrow(RangeError);
    expect(() => {
      writeStream(new BitWriter(), [0.5]);
    }).toThrow(RangeError);
  });

  it('fails with a SceneError on truncation, bad parameters and non-zero padding', () => {
    const { bytes } = roundTrip([1, 2, 3, 400, -5]);
    for (let end = 0; end < bytes.length; end++) {
      expect(() => readStream(new BitReader(bytes, 0, end), 5)).toThrow(SceneError);
    }
    // k = 31 (over MAX_K).
    expect(() => readStream(new BitReader(Uint8Array.of(0xf8, 0, 0, 0), 0, 4), 1)).toThrow(
      /Rice parameter/,
    );
    // k = 0, value 0 (bit 0), then a padding bit set.
    expect(() => readStream(new BitReader(Uint8Array.of(0b0000_0010), 0, 1), 1)).toThrow(/padding/);
  });

  it('accepts an escape up to the largest zigzag value and refuses one above it (range)', () => {
    const escape = (u: number) => {
      const writer = new BitWriter();
      writer.write(0, 5); // k = 0
      writer.ones(ESCAPE_RUN);
      writer.write(u, 32);
      const bytes = writer.finish();
      return () => readStream(new BitReader(bytes, 0, bytes.length), 1);
    };
    expect(MAX_UNSIGNED).toBe(zigzag(MAX_RESIDUAL));
    expect(Array.from(escape(MAX_UNSIGNED)())).toEqual([MAX_RESIDUAL]);
    let error: unknown;
    try {
      escape(MAX_UNSIGNED + 1)();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SceneError);
    expect((error as SceneError).reason).toBe('range');
  });

  it('stops a unary run at the escape length (an all-ones stream cannot loop)', () => {
    const ones = new Uint8Array(64).fill(0xff);
    // k = 31 is refused first; with k = 0 the run stops at ESCAPE_RUN and the escape is too big.
    const k0 = new Uint8Array(64).fill(0xff);
    k0[0] = 0b0000_0111;
    expect(() => readStream(new BitReader(ones, 0, ones.length), 10)).toThrow(SceneError);
    expect(() => readStream(new BitReader(k0, 0, k0.length), 10)).toThrow(SceneError);
    expect(ESCAPE_RUN).toBeLessThan(32);
  });
});
