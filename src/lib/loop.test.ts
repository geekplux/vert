import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M } from './geo';
import { LOOP_DISTANCE_M, isLoop } from './loop';

/** A track from (lat, 10) out and back to `gap` metres north of its start. */
function outAndBack(lat: number, gap: number) {
  const back = lat + ((gap / EARTH_RADIUS_M) * 180) / Math.PI;
  return { lat: [lat, lat + 0.01, back], lon: [10, 10.01, 10] };
}

describe('isLoop', () => {
  it('calls a track ending within 50 m of its start a loop, by great-circle distance', () => {
    expect(LOOP_DISTANCE_M).toBe(50);
    for (const lat of [0, 46, 60.45, -58.55]) {
      expect(isLoop(outAndBack(lat, 49.9))).toBe(true);
      expect(isLoop(outAndBack(lat, 50.1))).toBe(false);
    }
  });

  it('calls a track of one point, or none, a loop', () => {
    expect(isLoop({ lat: [46], lon: [10] })).toBe(true);
    expect(isLoop({ lat: [], lon: [] })).toBe(true);
  });
});
