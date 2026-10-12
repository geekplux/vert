import { describe, expect, it } from 'vitest';
import { SUMMIT_MIN_RISE_M, hasSummit } from './summit';

describe('hasSummit', () => {
  it('needs the high point at least 10 m above the low point', () => {
    expect(SUMMIT_MIN_RISE_M).toBe(10);
    expect(hasSummit(1_267, 616)).toBe(true);
    expect(hasSummit(510, 500)).toBe(true);
    expect(hasSummit(509.9, 500)).toBe(false);
    expect(hasSummit(1, 0.2)).toBe(false); // a flat city loop: "Summit 1 m" is no summit
  });

  it('has none while the elevation is unknown', () => {
    expect(hasSummit(NaN, NaN)).toBe(false);
    expect(hasSummit(800, NaN)).toBe(false);
  });
});
