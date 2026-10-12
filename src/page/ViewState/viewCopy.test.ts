import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../sample';
import {
  defaultScrub,
  elevationAt,
  elevationRangeText,
  elevationSourceText,
  gradeAt,
  isLoop,
  LOOP_DISTANCE_M,
  readoutParts,
  summitText,
  terrainLabel,
} from './viewCopy';
import { LOOP_DISTANCE_M as MARKERS_LOOP_DISTANCE_M } from '../../terrain/markers';
import { makeTrack } from '../../terrain/testing';

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

  it('calls a track a loop when it ends within 50 m of its start, like the terrain markers', () => {
    expect(LOOP_DISTANCE_M).toBe(MARKERS_LOOP_DISTANCE_M);
    // 0.0004° of latitude ≈ 44 m; 0.0005° ≈ 56 m.
    expect(
      isLoop(
        makeTrack([
          [46, 10],
          [46.01, 10],
          [46.0004, 10],
        ]),
      ),
    ).toBe(true);
    expect(
      isLoop(
        makeTrack([
          [46, 10],
          [46.01, 10],
          [46.0005, 10],
        ]),
      ),
    ).toBe(false);
    expect(isLoop(makeTrack([[46, 10]]))).toBe(true);
    expect(isLoop(SAMPLE_RUN.track)).toBe(true);
  });

  it('names a point-to-point run "from start to finish" with its dotted-circle finish', () => {
    const track = makeTrack([
      [34.7, -84],
      [34.75, -83.95],
    ]);
    expect(terrainLabel({ ...SAMPLE_RUN, track }, 'imperial')).toBe(
      '3D terrain of Coosa Backcountry Trail: 13.3 mi from start to finish, start marked with a circle, finish with a dotted circle, summit 4,157 ft marked with a triangle',
    );
  });
});

describe('summit and elevation source', () => {
  const flat = { ...SAMPLE_RUN, highPoint: 1.2, lowPoint: 0.4 };
  const unknown = {
    ...SAMPLE_RUN,
    hasElevation: false,
    elevationSource: null,
    highPoint: NaN,
    lowPoint: NaN,
  };

  it('names a summit only when it stands 10 m or more above the low point', () => {
    expect(summitText(SAMPLE_RUN, 'metric')).toBe('Summit 1,267 m');
    expect(summitText(flat, 'metric')).toBeNull();
    expect(summitText(unknown, 'metric')).toBeNull();
    expect(summitText({ ...SAMPLE_RUN, highPoint: 626, lowPoint: 616 }, 'metric')).toBe(
      'Summit 626 m',
    );
  });

  it('leaves the summit out of the terrain label when there is none', () => {
    expect(terrainLabel(flat, 'metric')).toBe(
      '3D terrain of Coosa Backcountry Trail: 21.5 km loop, start and finish marked with a circle',
    );
    expect(terrainLabel(unknown, 'metric')).not.toContain('summit');
  });

  it('says where the elevations come from, in plain words', () => {
    const none = { track: { partialEle: null } };
    const gaps = { track: { partialEle: Float64Array.from([600, NaN, NaN]) } };
    expect(elevationSourceText(SAMPLE_RUN, 'ready')).toBeNull();
    expect(elevationSourceText({ ...none, elevationSource: 'terrain' }, 'ready')).toBe(
      'Elevation from terrain data. This file has no usable elevation.',
    );
    expect(elevationSourceText({ ...gaps, elevationSource: 'mixed' }, 'ready')).toBe(
      'Elevation partly from terrain data, where this file has gaps.',
    );
    expect(elevationSourceText({ ...none, elevationSource: null }, 'loading')).toBe(
      'This file has no usable elevation. Reading it from the terrain…',
    );
    expect(elevationSourceText({ ...none, elevationSource: null }, 'error')).toBe(
      "This file has no usable elevation, and the terrain couldn't load.",
    );
    expect(elevationSourceText({ ...gaps, elevationSource: null }, 'loading')).toBe(
      "This file's elevation has gaps. Filling them from the terrain…",
    );
    expect(elevationSourceText({ ...gaps, elevationSource: null }, 'error')).toBe(
      "This file's elevation has gaps, and the terrain couldn't load to fill them.",
    );
  });
});
