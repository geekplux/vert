import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_M,
  MAX_MERCATOR_LAT,
  boundsOf,
  chooseZoom,
  cumulativeDistances,
  haversine,
  localMetres,
  lonLatToTile,
  lonLatToWorld,
  metresPerPixel,
  tileBounds,
  tileCount,
  tilesForBounds,
  worldToLonLat,
  type Bounds,
} from './geo';

/** One degree of arc on the mean sphere, metres. */
const ONE_DEGREE_M = (2 * Math.PI * EARTH_RADIUS_M) / 360;

/** Vogel State Park, Georgia: the sample run's start area. */
const VOGEL = { lat: 34.764, lon: -83.926 };

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversine(VOGEL, VOGEL)).toBe(0);
  });

  it('measures one degree of latitude or of longitude at the equator as 111,195.08 m', () => {
    expect(ONE_DEGREE_M).toBeCloseTo(111195.08, 2);
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(ONE_DEGREE_M, 6);
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(ONE_DEGREE_M, 6);
    expect(haversine({ lat: 60, lon: 10 }, { lat: 61, lon: 10 })).toBeCloseTo(ONE_DEGREE_M, 6);
  });

  it('shrinks east–west degrees by cos(latitude) for short hops', () => {
    const d = haversine({ lat: 60, lon: 0 }, { lat: 60, lon: 0.001 });
    expect(d).toBeCloseTo(ONE_DEGREE_M * 0.001 * 0.5, 3);
  });

  it('matches the known London–New York great-circle distance (≈ 5,574.8 km)', () => {
    const london = { lat: 51.5007, lon: -0.1246 };
    const newYork = { lat: 40.6892, lon: -74.0445 };
    expect(haversine(london, newYork) / 1000).toBeCloseTo(5574.85, 1);
  });

  it('is symmetric', () => {
    const a = { lat: -33.86, lon: 151.21 };
    const b = { lat: 35.68, lon: 139.69 };
    expect(haversine(a, b)).toBe(haversine(b, a));
  });

  it('gives half the circumference for antipodal points without NaN', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_M,
      3,
    );
    expect(haversine({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_M,
      3,
    );
  });

  it('takes the short way across the antimeridian', () => {
    expect(haversine({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(ONE_DEGREE_M, 3);
  });
});

describe('cumulativeDistances', () => {
  it('returns an empty array for no points and [0] for one point', () => {
    expect(cumulativeDistances([])).toEqual(new Float64Array(0));
    expect(cumulativeDistances([VOGEL])).toEqual(new Float64Array([0]));
  });

  it('accumulates segment lengths', () => {
    const points = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
    ];
    const d = cumulativeDistances(points);
    expect(d).toBeInstanceOf(Float64Array);
    expect(d).toHaveLength(4);
    expect(d[0]).toBe(0);
    expect(d[1]).toBeCloseTo(ONE_DEGREE_M, 6);
    expect(d[2]).toBeCloseTo(ONE_DEGREE_M, 6);
    expect(d[3]).toBeCloseTo(2 * ONE_DEGREE_M, 6);
  });

  it('never decreases', () => {
    const points = Array.from({ length: 50 }, (_, i) => ({
      lat: VOGEL.lat + Math.sin(i) * 0.01,
      lon: VOGEL.lon + Math.cos(i * 1.3) * 0.01,
    }));
    const d = cumulativeDistances(points);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] ?? 0);
  });
});

describe('lonLatToWorld / worldToLonLat', () => {
  it('maps the corners and centre of the Mercator square', () => {
    expect(lonLatToWorld(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    const nw = lonLatToWorld(-180, MAX_MERCATOR_LAT);
    expect(nw.x).toBe(0);
    expect(nw.y).toBeCloseTo(0, 12);
    const se = lonLatToWorld(180, -MAX_MERCATOR_LAT);
    expect(se.x).toBe(1);
    expect(se.y).toBeCloseTo(1, 12);
  });

  it('grows y southward', () => {
    expect(lonLatToWorld(0, 10).y).toBeLessThan(0.5);
    expect(lonLatToWorld(0, -10).y).toBeGreaterThan(0.5);
  });

  it('clamps latitudes beyond the Mercator limit instead of returning Infinity', () => {
    expect(lonLatToWorld(0, 90).y).toBeCloseTo(0, 12);
    expect(lonLatToWorld(0, -90).y).toBeCloseTo(1, 12);
  });

  it('round-trips', () => {
    for (const [lon, lat] of [
      [0, 0],
      [VOGEL.lon, VOGEL.lat],
      [151.21, -33.86],
      [-179.9, 80],
      [179.9, -80],
    ] as const) {
      const w = lonLatToWorld(lon, lat);
      const back = worldToLonLat(w.x, w.y);
      expect(back.lon).toBeCloseTo(lon, 10);
      expect(back.lat).toBeCloseTo(lat, 10);
    }
  });
});

describe('lonLatToTile', () => {
  it('matches the reference tile for Vogel State Park at z12 (1093, 1625)', () => {
    const t = lonLatToTile(VOGEL.lon, VOGEL.lat, 12);
    expect(t.x).toBeCloseTo(1093.1086, 4);
    expect(t.y).toBeCloseTo(1625.69, 2);
    expect(Math.floor(t.x)).toBe(1093);
    expect(Math.floor(t.y)).toBe(1625);
  });

  it('agrees with the asinh form of the Mercator y formula', () => {
    for (const z of [0, 5, 10, 15]) {
      const t = lonLatToTile(VOGEL.lon, VOGEL.lat, z);
      const y = ((1 - Math.asinh(Math.tan((VOGEL.lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
      expect(t.y).toBeCloseTo(y, 8);
    }
  });

  it('puts the whole world in tile 0/0/0', () => {
    const t = lonLatToTile(VOGEL.lon, VOGEL.lat, 0);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x).toBeLessThan(1);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeLessThan(1);
  });

  it('doubles coordinates with each zoom level', () => {
    const a = lonLatToTile(VOGEL.lon, VOGEL.lat, 9);
    const b = lonLatToTile(VOGEL.lon, VOGEL.lat, 10);
    expect(b.x).toBeCloseTo(a.x * 2, 9);
    expect(b.y).toBeCloseTo(a.y * 2, 9);
  });
});

describe('tileBounds', () => {
  it('covers the whole Mercator world at z0', () => {
    const b = tileBounds(0, 0, 0);
    expect(b.west).toBe(-180);
    expect(b.east).toBe(180);
    expect(b.north).toBeCloseTo(MAX_MERCATOR_LAT, 10);
    expect(b.south).toBeCloseTo(-MAX_MERCATOR_LAT, 10);
  });

  it('splits at the equator and prime meridian at z1', () => {
    expect(tileBounds(1, 1, 1)).toMatchObject({ west: 0, east: 180, north: 0 });
    expect(tileBounds(0, 0, 1)).toMatchObject({ west: -180, east: 0, south: 0 });
  });

  it.each([1, 6, 12, 15])('round-trips with lonLatToTile at z%i', (z) => {
    const t = lonLatToTile(VOGEL.lon, VOGEL.lat, z);
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    const b = tileBounds(x, y, z);
    expect(VOGEL.lon).toBeGreaterThanOrEqual(b.west);
    expect(VOGEL.lon).toBeLessThan(b.east);
    expect(VOGEL.lat).toBeLessThanOrEqual(b.north);
    expect(VOGEL.lat).toBeGreaterThan(b.south);
    // The tile's corners map back to its integer coordinates.
    const nw = lonLatToTile(b.west, b.north, z);
    const se = lonLatToTile(b.east, b.south, z);
    expect(nw.x).toBeCloseTo(x, 8);
    expect(nw.y).toBeCloseTo(y, 8);
    expect(se.x).toBeCloseTo(x + 1, 8);
    expect(se.y).toBeCloseTo(y + 1, 8);
  });

  it('makes neighbouring tiles share edges', () => {
    const a = tileBounds(1093, 1625, 12);
    expect(tileBounds(1094, 1625, 12).west).toBeCloseTo(a.east, 12);
    expect(tileBounds(1093, 1626, 12).north).toBeCloseTo(a.south, 12);
  });
});

describe('metresPerPixel', () => {
  it('is 156,543.03 m at the equator at z0 for 256 px tiles', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 2);
  });

  it('halves with each zoom level and with doubled tile size', () => {
    expect(metresPerPixel(0, 1)).toBeCloseTo(metresPerPixel(0, 0) / 2, 9);
    expect(metresPerPixel(0, 15)).toBeCloseTo(4.777, 3);
    expect(metresPerPixel(0, 3, 512)).toBeCloseTo(metresPerPixel(0, 4), 9);
  });

  it('scales by cos(latitude)', () => {
    expect(metresPerPixel(60, 10)).toBeCloseTo(metresPerPixel(0, 10) / 2, 9);
    expect(metresPerPixel(-60, 10)).toBeCloseTo(metresPerPixel(60, 10), 9);
    expect(metresPerPixel(VOGEL.lat, 12)).toBeCloseTo(31.397, 3);
  });
});

describe('tilesForBounds / tileCount', () => {
  const run: Bounds = { west: -83.98, south: 34.72, east: -83.88, north: 34.8 };

  it('returns a single tile for a box inside one tile', () => {
    const tiny: Bounds = { west: -83.93, south: 34.763, east: -83.925, north: 34.765 };
    expect(tilesForBounds(tiny, 12)).toEqual([{ z: 12, x: 1093, y: 1625 }]);
    expect(tileCount(tiny, 12)).toBe(1);
  });

  it('returns a single tile for a degenerate (point) box', () => {
    const point: Bounds = { west: VOGEL.lon, south: VOGEL.lat, east: VOGEL.lon, north: VOGEL.lat };
    expect(tilesForBounds(point, 12)).toEqual([{ z: 12, x: 1093, y: 1625 }]);
  });

  it('covers every tile the bbox touches, row by row from the north-west', () => {
    const tiles = tilesForBounds(run, 12);
    const nw = lonLatToTile(run.west, run.north, 12);
    const se = lonLatToTile(run.east, run.south, 12);
    const cols = Math.floor(se.x) - Math.floor(nw.x) + 1;
    const rows = Math.floor(se.y) - Math.floor(nw.y) + 1;
    expect(tiles).toHaveLength(cols * rows);
    expect(tileCount(run, 12)).toBe(cols * rows);
    expect(tiles[0]).toEqual({ z: 12, x: Math.floor(nw.x), y: Math.floor(nw.y) });
    expect(tiles.at(-1)).toEqual({ z: 12, x: Math.floor(se.x), y: Math.floor(se.y) });
    expect(tiles[1]).toEqual({ z: 12, x: Math.floor(nw.x) + 1, y: Math.floor(nw.y) });
  });

  it('does not add a tile for an edge exactly on a tile boundary', () => {
    const b = tileBounds(1093, 1625, 12);
    expect(tilesForBounds(b, 12)).toEqual([{ z: 12, x: 1093, y: 1625 }]);
    expect(tileCount(tileBounds(0, 0, 1), 1)).toBe(1);
  });

  // tileBounds → lonLatToTile drifts by ~1e-11 tile (y = 6533.000000000001), which used to pull in
  // an extra row or column. Every tile of a deterministic sweep must cover exactly itself, and a
  // block of tiles exactly that block.
  it.each([6, 10, 12, 13, 14, 15])('round-trips tileBounds to exactly one tile at z%i', (z) => {
    const centre = lonLatToTile(VOGEL.lon, VOGEL.lat, z);
    const cx = Math.floor(centre.x);
    const cy = Math.floor(centre.y);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx * 7;
        const y = cy + dy * 5;
        if (x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) continue;
        expect(tilesForBounds(tileBounds(x, y, z), z)).toEqual([{ z, x, y }]);
      }
    }
    const nw = tileBounds(cx, cy, z);
    const se = tileBounds(cx + 2, cy + 1, z);
    const block: Bounds = { west: nw.west, north: nw.north, east: se.east, south: se.south };
    expect(tileCount(block, z)).toBe(6);
    expect(tilesForBounds(block, z)[0]).toEqual({ z, x: cx, y: cy });
  });

  it('still adds the next tile for an edge just past a boundary', () => {
    const b = tileBounds(1093, 1625, 12);
    const past = { ...b, east: b.east + 1e-6, south: b.south - 1e-6 };
    expect(tileCount(past, 12)).toBe(4);
  });

  it('returns the whole world at low zoom and clamps beyond the Mercator limits', () => {
    const world: Bounds = { west: -180, south: -90, east: 180, north: 90 };
    expect(tilesForBounds(world, 0)).toEqual([{ z: 0, x: 0, y: 0 }]);
    expect(tileCount(world, 2)).toBe(16);
    const tiles = tilesForBounds(world, 2);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(4);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(4);
    }
  });

  it('roughly quadruples per zoom level', () => {
    const at13 = tileCount(run, 13);
    const at14 = tileCount(run, 14);
    expect(at14).toBeGreaterThan(at13 * 2);
    expect(at14).toBeLessThanOrEqual((Math.sqrt(at13) * 2 + 1) ** 2);
  });
});

describe('chooseZoom', () => {
  const run: Bounds = { west: -83.98, south: 34.72, east: -83.88, north: 34.8 };

  it('picks the highest zoom whose covering fits the budget', () => {
    const z = chooseZoom(run, 16);
    expect(tileCount(run, z)).toBeLessThanOrEqual(16);
    expect(tileCount(run, z + 1)).toBeGreaterThan(16);
  });

  it('never exceeds the Terrarium max zoom of 15', () => {
    const tiny: Bounds = { west: -83.926, south: 34.764, east: -83.9259, north: 34.7641 };
    expect(chooseZoom(tiny, 4)).toBe(15);
    expect(chooseZoom(run, 1_000_000)).toBe(15);
  });

  it('grows with the budget', () => {
    expect(chooseZoom(run, 64)).toBeGreaterThanOrEqual(chooseZoom(run, 16));
    expect(chooseZoom(run, 4)).toBeLessThanOrEqual(chooseZoom(run, 16));
  });

  it('falls back to 0 when nothing fits', () => {
    expect(chooseZoom(run, 0)).toBe(0);
    const world: Bounds = { west: -180, south: -85, east: 180, north: 85 };
    expect(chooseZoom(world, 1)).toBe(0);
    expect(chooseZoom(world, 4)).toBe(1);
  });
});

describe('boundsOf', () => {
  const points = [
    { lat: 34.75, lon: -83.95 },
    { lat: 34.8, lon: -83.9 },
    { lat: 34.7, lon: -83.92 },
  ];

  it('is the min/max of the points', () => {
    expect(boundsOf(points)).toEqual({ west: -83.95, south: 34.7, east: -83.9, north: 34.8 });
  });

  it('pads each side by a fraction of the span', () => {
    const b = boundsOf(points, 0.1);
    expect(b.west).toBeCloseTo(-83.955, 10);
    expect(b.east).toBeCloseTo(-83.895, 10);
    expect(b.south).toBeCloseTo(34.69, 10);
    expect(b.north).toBeCloseTo(34.81, 10);
  });

  it('gives a zero-size box for a single point, with or without padding', () => {
    const b = { west: VOGEL.lon, south: VOGEL.lat, east: VOGEL.lon, north: VOGEL.lat };
    expect(boundsOf([VOGEL])).toEqual(b);
    expect(boundsOf([VOGEL], 0.5)).toEqual(b);
  });

  it('clamps padding to valid coordinates', () => {
    const b = boundsOf(
      [
        { lat: -89, lon: -179 },
        { lat: 89, lon: 179 },
      ],
      0.5,
    );
    expect(b).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });

  it('throws for no points', () => {
    expect(() => boundsOf([])).toThrow(RangeError);
  });
});

describe('localMetres', () => {
  it('is the origin at the origin', () => {
    const p = localMetres(VOGEL, VOGEL);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it('points x east and y north', () => {
    const ne = localMetres(VOGEL, { lat: VOGEL.lat + 0.01, lon: VOGEL.lon + 0.01 });
    expect(ne.x).toBeGreaterThan(0);
    expect(ne.y).toBeGreaterThan(0);
    const sw = localMetres(VOGEL, { lat: VOGEL.lat - 0.01, lon: VOGEL.lon - 0.01 });
    expect(sw.x).toBeLessThan(0);
    expect(sw.y).toBeLessThan(0);
  });

  it('is exact north–south and matches haversine east–west along the origin parallel', () => {
    const north = { lat: VOGEL.lat + 0.1, lon: VOGEL.lon };
    expect(localMetres(VOGEL, north).y).toBeCloseTo(haversine(VOGEL, north), 6);
    const east = { lat: VOGEL.lat, lon: VOGEL.lon + 0.001 };
    expect(localMetres(VOGEL, east).x).toBeCloseTo(haversine(VOGEL, east), 3);
  });

  it.each([0, 34.764, 45, 60])(
    'stays within the documented error of haversine over a 10 km area at %f°',
    (lat) => {
      const origin = { lat, lon: 10 };
      const dLat = 10_000 / EARTH_RADIUS_M / (Math.PI / 180);
      const dLon = dLat / Math.cos((lat * Math.PI) / 180);
      for (const [sy, sx] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const point = { lat: lat + sy * dLat, lon: 10 + sx * dLon };
        const { x, y } = localMetres(origin, point);
        const planar = Math.hypot(x, y);
        const relativeError = Math.abs(planar - haversine(origin, point)) / planar;
        // |tan(lat) · Δlat| with Δlat = 10 km / R, plus a little for the diagonal.
        const bound = Math.abs(Math.tan((lat * Math.PI) / 180)) * (10_000 / EARTH_RADIUS_M);
        expect(relativeError).toBeLessThan(bound + 1e-5);
      }
    },
  );

  it('keeps the error under 0.16% for 10 km at 45°, as documented', () => {
    const origin = { lat: 45, lon: 0 };
    const point = { lat: 45 + 10_000 / ONE_DEGREE_M, lon: 0.1 };
    const { x } = localMetres(origin, point);
    const trueEast = haversine({ lat: point.lat, lon: 0 }, point);
    expect(Math.abs(x - trueEast) / trueEast).toBeLessThan(0.0016);
  });
});
