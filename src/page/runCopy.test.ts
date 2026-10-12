import { describe, expect, it } from 'vitest';
import { runDateLine, runPaceAt } from './runCopy';
import { SAMPLE_RUN } from './sample';

describe('runDateLine', () => {
  it('formats the local date, or gives an empty string without a time', () => {
    expect(runDateLine(SAMPLE_RUN)).toBe('SAT · 2026-10-03');
    expect(runDateLine({ startTime: Number.NaN, lonForOffset: 7 })).toBe('');
  });
});

describe('runPaceAt', () => {
  it('reads pace from the track, and nothing for a timeless run', () => {
    // The placeholder track runs at an even 11,093 s over 21,480 m: 516.4 s/km.
    expect(runPaceAt(SAMPLE_RUN, 10_000)).toBeCloseTo(11_098 / 21.48, 0);
    expect(runPaceAt({ ...SAMPLE_RUN, hasTime: false }, 10_000)).toBeNull();
  });

  it('gives nothing where no time passes', () => {
    const frozen = { ...SAMPLE_RUN.track, time: SAMPLE_RUN.track.lat.map(() => 0) };
    expect(runPaceAt({ hasTime: true, track: frozen }, 10_000)).toBeNull();
  });
});
