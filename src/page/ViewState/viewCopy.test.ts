import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../sample';
import {
  defaultScrub,
  elevationAt,
  elevationRangeText,
  gradeAt,
  readoutParts,
  terrainLabel,
} from './viewCopy';

const ramp = [
  { d: 0, ele: 100 },
  { d: 100, ele: 110 },
  { d: 200, ele: 110 },
  { d: 300, ele: 80 },
];

describe('viewCopy', () => {
  it('interpolates elevation between points and clamps at the ends', () => {
    expect(elevationAt(ramp, 50)).toBe(105);
    expect(elevationAt(ramp, 250)).toBe(95);
    expect(elevationAt(ramp, -10)).toBe(100);
    expect(elevationAt(ramp, 999)).toBe(80);
    expect(elevationAt([], 10)).toBeNaN();
  });

  it('measures grade over ±50 m, clipped to the route', () => {
    expect(gradeAt(ramp, 50)).toBeCloseTo(0.1);
    expect(gradeAt(ramp, 150)).toBeCloseTo(0);
    expect(gradeAt(ramp, 250)).toBeCloseTo(-0.3);
    // At the start the window is 0–50 m.
    expect(gradeAt(ramp, 0)).toBeCloseTo(0.1);
    expect(gradeAt([], 0)).toBeNaN();
    expect(gradeAt([{ d: 0, ele: 1 }], 0)).toBeNaN();
  });

  it('starts the scrub at the steepest climb’s midpoint, or 57% along', () => {
    expect(defaultScrub(SAMPLE_RUN)).toBe(12_200);
    expect(defaultScrub({ ...SAMPLE_RUN, climbs: [] })).toBeCloseTo(0.57 * 21_480);
  });

  it('formats the range, the readout (with pace once known) and the terrain label', () => {
    expect(elevationRangeText(SAMPLE_RUN, 'metric')).toBe('616–1,267 m');
    expect(elevationRangeText(SAMPLE_RUN, 'imperial')).toBe('2,021–4,157 ft');
    expect(readoutParts(ramp, 250, 'metric')).toEqual(['km 0.3', '95 m', 'grade −30%']);
    expect(readoutParts(ramp, 250, 'metric', () => null)).toHaveLength(3);
    expect(readoutParts(ramp, 250, 'metric', () => 408)).toEqual([
      'km 0.3',
      '95 m',
      'grade −30%',
      '6:48 /km',
    ]);
    expect(terrainLabel(SAMPLE_RUN, 'metric')).toBe(
      '3D terrain of Coosa Backcountry Trail: 21.5 km loop, start and finish marked with a circle, summit 1,267 m marked with a triangle',
    );
  });
});
