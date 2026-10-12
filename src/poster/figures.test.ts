import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import type { Run } from '../page/types';
import type { Heightfield } from '../terrain/heightfield';
import {
  formatLatLon,
  nightRidgeFigureData,
  quadBounds,
  ridgeBounds,
  surveyQuadFigureData,
} from './figures';

const METRES_PER_DEGREE = 111_320;

/** A cone over the sample run's bounds (plus 15%), 1,200 m at the centre. */
function sampleField(): Heightfield {
  const { west, south, east, north } = SAMPLE_RUN.bounds;
  const padX = (east - west) * 0.15;
  const padY = (north - south) * 0.15;
  const bounds = { west: west - padX, east: east + padX, south: south - padY, north: north + padY };
  const w = 120;
  const h = 150;
  const elevations = new Float32Array(w * h);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = 1200 - 6 * Math.hypot(x - w / 2, y - h / 2);
      elevations[y * w + x] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const lat = ((north + south) / 2) * (Math.PI / 180);
  return {
    bounds,
    zoom: 13,
    width: w,
    height: h,
    elevations,
    min,
    max,
    metresPerSample: {
      x: ((bounds.east - bounds.west) * Math.cos(lat) * METRES_PER_DEGREE) / (w - 1),
      y: ((bounds.north - bounds.south) * METRES_PER_DEGREE) / (h - 1),
    },
    failedTiles: [],
  };
}

describe('formatLatLon', () => {
  it('writes degrees and minutes with the hemisphere', () => {
    expect(formatLatLon(34.7704, -83.9423)).toEqual({ lat: '34°46′ N', lon: '83°57′ W' });
    expect(formatLatLon(-33.8688, 151.2093)).toEqual({ lat: '33°52′ S', lon: '151°13′ E' });
    // Rounding to the minute carries into the degree.
    expect(formatLatLon(45.9999, 6.99999)).toEqual({ lat: '46°00′ N', lon: '7°00′ E' });
  });
});

describe('quadBounds and ridgeBounds', () => {
  const route = SAMPLE_RUN.bounds;
  /** Ground width / height of bounds, metres. */
  const aspectOf = (b: typeof route) => {
    const lat = ((b.north + b.south) / 2) * (Math.PI / 180);
    return ((b.east - b.west) * Math.cos(lat)) / (b.north - b.south);
  };

  it('widens the route bounds to the box aspect and keeps the route inside', () => {
    for (const aspect of [0.6, 1, 1.4, 2.5]) {
      const b = quadBounds(route, aspect);
      expect(aspectOf(b)).toBeCloseTo(aspect, 2);
      expect(b.west).toBeLessThan(route.west);
      expect(b.east).toBeGreaterThan(route.east);
      expect(b.south).toBeLessThan(route.south);
      expect(b.north).toBeGreaterThan(route.north);
    }
  });

  it('ridge bounds follow the free area under the text, between 0.6:1 and 3:1', () => {
    expect(aspectOf(ridgeBounds(route, { width: 624, height: 300 }))).toBeCloseTo(1.248, 2);
    const keepOut = [{ x: 0, y: 0, width: 300, height: 400 }];
    expect(aspectOf(ridgeBounds(route, { width: 624, height: 700, keepOut }))).toBeCloseTo(
      1.248,
      2,
    );
    expect(aspectOf(ridgeBounds(route, { width: 900, height: 100 }))).toBeCloseTo(3, 2);
  });
});

describe('nightRidgeFigureData', () => {
  it('finds the sunrise during the sample run and its start time', () => {
    // The sample starts 11:10 UTC (07:10 EDT); sunrise at Vogel SP is about 07:32 EDT.
    const data = nightRidgeFigureData(SAMPLE_RUN, null, null, { timeZone: 'America/New_York' });
    expect(data.ridges).toBeNull();
    expect(data.startClock).toBe('07:10');
    expect(data.sunrise?.clock).toMatch(/^07:3[0-4]$/);
    // ~22 min into an even 3:04:53 over 21.48 km: about km 2.6.
    expect(data.sunrise?.distance).toBeGreaterThan(2000);
    expect(data.sunrise?.distance).toBeLessThan(3200);
  });

  it('has no sunrise or start time without timestamps', () => {
    const untimed: Run = {
      ...SAMPLE_RUN,
      hasTime: false,
      track: { ...SAMPLE_RUN.track, time: null },
    };
    const data = nightRidgeFigureData(untimed, null, null);
    expect(data.sunrise).toBeNull();
    expect(data.startClock).toBeNull();
  });

  it('lays the ridges out in the reported box, clear of the text', () => {
    const keepOut = [{ x: 0, y: 0, width: 400, height: 200 }];
    const data = nightRidgeFigureData(
      SAMPLE_RUN,
      sampleField(),
      { width: 624, height: 600, keepOut },
      { rows: 40 },
    );
    expect(data.ridges?.rows).toHaveLength(40);
    expect(data.ridges?.width).toBe(624);
    expect(data.ridges?.route).toMatch(/^M/);
    expect(data.ridges?.start).not.toBeNull();
  });
});

describe('surveyQuadFigureData', () => {
  it('has the coordinates of the run centre even before the terrain loads', () => {
    const data = surveyQuadFigureData(SAMPLE_RUN, null, null);
    expect(data.map).toBeNull();
    expect(data.coordinates).toEqual({ lat: '34°46′ N', lon: '83°57′ W' });
  });

  it('draws contours, the route, the markers and the scale bar for the box', () => {
    const data = surveyQuadFigureData(SAMPLE_RUN, sampleField(), { width: 600, height: 500 });
    const map = data.map;
    expect(map?.width).toBe(600);
    expect(map?.height).toBe(500);
    expect(map?.interval).toBe(20);
    expect(map?.contours.index).toMatch(/^M/);
    expect(map?.contours.intermediate).toMatch(/^M/);
    expect(map?.route).toMatch(/^M/);
    // The sample is a loop: one ○ for start and finish.
    expect(map?.markers.map((marker) => marker.kind)).toEqual(['start']);
    expect(map?.scaleBar.segments).toBe(4);
    expect(map?.scaleBar.lengthPx).toBeLessThanOrEqual(200);
    expect(map?.scaleBar.labels.at(-1)).toMatch(/ (k?m)$/);
    // Every route point lies inside the box.
    for (const [, x, y] of map?.route.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g) ?? []) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(600);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(500);
    }
  });

  it('marks start and finish apart on a point-to-point run, in miles for imperial', () => {
    const n = 50;
    const { west, south, east, north } = SAMPLE_RUN.bounds;
    const track = {
      ...SAMPLE_RUN.track,
      lat: Float64Array.from({ length: n }, (_, i) => south + ((north - south) * i) / (n - 1)),
      lon: Float64Array.from({ length: n }, (_, i) => west + ((east - west) * i) / (n - 1)),
    };
    const data = surveyQuadFigureData(
      { ...SAMPLE_RUN, track },
      sampleField(),
      { width: 1080 - 168, height: 600 },
      { units: 'imperial', layout: 'social' },
    );
    expect(data.map?.markers.map((marker) => marker.kind)).toEqual(['start', 'finish']);
    expect(data.map?.scaleBar.lengthPx).toBeLessThanOrEqual(300);
    expect(data.map?.scaleBar.text).toMatch(/ (mi|ft)$/);
    // Contours every 50 ft (or a coarser step in feet), never a metric interval.
    const feet = (data.map?.interval ?? NaN) / 0.3048;
    expect([50, 100, 200, 500, 1000, 2000, 5000]).toContain(Math.round(feet));
    expect(feet).toBeCloseTo(Math.round(feet), 6);
  });
});
