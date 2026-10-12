import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import type { Run } from '../page/types';
import type { Heightfield } from '../terrain/heightfield';
import { trimTrack } from '../gpx/trim';
import {
  figureFrameBounds,
  formatLatLon,
  nightRidgeFigureData,
  padBounds,
  quadBounds,
  NORTH_FILL_MAX,
  ridgeBounds,
  surveyQuadFigureData,
  trackBounds,
} from './figures';

const METRES_PER_DEGREE = 111_320;

/** A cone over the sample run's bounds (plus 15%), 1,200 m at the centre. */
function sampleField(runBounds: Run['bounds'] = SAMPLE_RUN.bounds): Heightfield {
  const { west, south, east, north } = runBounds;
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

  it('folds a longitude past ±180 back into the right hemisphere', () => {
    // Either side of the antimeridian, in the unwrapped form a crossing run's bounds use.
    expect(formatLatLon(-16.86, 179.97).lon).toBe('179°58′ E');
    expect(formatLatLon(-16.86, 180.02).lon).toBe('179°59′ W');
    expect(formatLatLon(-16.86, -180.02).lon).toBe('179°59′ E');
    expect(formatLatLon(-16.86, 540 - 0.5).lon).toBe('179°30′ E');
    expect(formatLatLon(-16.86, 180).lon).toBe('180°00′ W');
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

  it('ridge bounds widen east and west, and deepen only to the north, behind the route', () => {
    const margin = quadBounds(route, 0, 0.12);
    // A tall stage gets ground behind the route (north), never in front of it (south), at most
    // NORTH_FILL_MAX × the route's north–south extent.
    const tall = ridgeBounds(route, { width: 400, height: 1200 });
    expect(tall.south).toBeCloseTo(margin.south, 9);
    expect(tall.west).toBeCloseTo(margin.west, 9);
    expect(tall.east).toBeCloseTo(margin.east, 9);
    expect(tall.north).toBeGreaterThan(margin.north);
    expect(tall.north - margin.north).toBeLessThanOrEqual(
      NORTH_FILL_MAX * (route.north - route.south) + 1e-12,
    );
    // A stage the margin already fills gets none.
    const short = ridgeBounds(route, { width: 624, height: 300 });
    expect(short.north).toBeCloseTo(margin.north, 9);
    // A wide one adds ground at the sides only.
    const wide = ridgeBounds(route, { width: 900, height: 100 });
    expect(wide.north).toBeCloseTo(margin.north, 9);
    expect(wide.south).toBeCloseTo(margin.south, 9);
    expect(wide.west).toBeLessThan(margin.west);
  });
});

describe('nightRidgeFigureData', () => {
  it('finds the sunrise during the sample run and its start time', () => {
    // The sample starts 11:10 UTC (07:10 EDT); sunrise at Vogel SP is about 07:32 EDT.
    const data = nightRidgeFigureData(SAMPLE_RUN, null, null, { timeZone: 'America/New_York' });
    expect(data.ridges).toBeNull();
    expect(data.startClock).toBe('07:10');
    expect(data.sunrise?.clock).toMatch(/^07:3[0-4]$/);
    // ~22 min into an even 3:04:58 over 21.48 km: about km 2.6.
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

describe('figureFrameBounds', () => {
  it('frames the drawn route when the ends are hidden, the run otherwise', () => {
    const drawn = trimTrack(SAMPLE_RUN.track, 500);
    if (!drawn) throw new Error('nothing drawn');
    const own = trackBounds(drawn);
    expect(figureFrameBounds(SAMPLE_RUN.bounds, drawn, 500)).toEqual(own);
    expect(figureFrameBounds(SAMPLE_RUN.bounds, SAMPLE_RUN.track, 0)).toBe(SAMPLE_RUN.bounds);
    // Nothing left to draw: nothing to give away either.
    expect(figureFrameBounds(SAMPLE_RUN.bounds, null, 500)).toBe(SAMPLE_RUN.bounds);
    // Inside the run's bounds, and smaller on some side.
    if (!own) throw new Error('no bounds');
    expect(own.west).toBeGreaterThanOrEqual(SAMPLE_RUN.bounds.west);
    expect(own.east).toBeLessThanOrEqual(SAMPLE_RUN.bounds.east);
    expect(own.south).toBeGreaterThanOrEqual(SAMPLE_RUN.bounds.south);
    expect(own.north).toBeLessThanOrEqual(SAMPLE_RUN.bounds.north);
  });

  it('measures a track and pads bounds by a share of each side', () => {
    expect(
      trackBounds({ lat: Float64Array.from([1, 3, 2]), lon: Float64Array.from([10, 12, 8]) }),
    ).toEqual({ west: 8, east: 12, south: 1, north: 3 });
    expect(trackBounds({ lat: new Float64Array(0), lon: new Float64Array(0) })).toBeNull();
    expect(padBounds({ west: 0, east: 10, south: 0, north: 20 })).toEqual({
      west: -1.5,
      east: 11.5,
      south: -3,
      north: 23,
    });
  });
});

describe('surveyQuadFigureData', () => {
  it('centres the map and the coordinates on the frame it is given', () => {
    const { west, south, east, north } = SAMPLE_RUN.bounds;
    const frame = { west, south, east: (west + east) / 2, north: (south + north) / 2 };
    const box = { width: 600, height: 500 };
    const data = surveyQuadFigureData(SAMPLE_RUN, sampleField(), box, { frame });
    const whole = surveyQuadFigureData(SAMPLE_RUN, sampleField(), box);
    expect(data.coordinates).toEqual(
      formatLatLon((south + frame.north) / 2, (west + frame.east) / 2),
    );
    // The same route, moved: centred on the south-west quarter instead of the whole run.
    expect(data.map?.route).not.toBe(whole.map?.route);
  });

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

  it('maps a run across the antimeridian at its true size, with its real coordinates', () => {
    // The sample loop moved so its centre sits on 180°, its longitudes unwrapped past it.
    const { west, east } = SAMPLE_RUN.bounds;
    const shift = 180 - (west + east) / 2;
    const bounds = { ...SAMPLE_RUN.bounds, west: west + shift, east: east + shift };
    const track = { ...SAMPLE_RUN.track, lon: SAMPLE_RUN.track.lon.map((lon) => lon + shift) };
    const run = { ...SAMPLE_RUN, bounds, track };
    const box = { width: 600, height: 500 };
    const crossing = surveyQuadFigureData(run, sampleField(bounds), box);
    const home = surveyQuadFigureData(SAMPLE_RUN, sampleField(), box);
    expect(crossing.coordinates).toEqual({ lat: '34°46′ N', lon: '180°00′ W' });
    // The same scale bar and the same drawing as the run where it really is.
    expect(crossing.map?.scaleBar).toEqual(home.map?.scaleBar);
    expect(crossing.map?.pxPerMetre).toBeCloseTo(home.map?.pxPerMetre ?? NaN, 6);
    expect(crossing.map?.route.length).toBeGreaterThan(100);
    for (const [, x, y] of crossing.map?.route.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g) ?? []) {
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
