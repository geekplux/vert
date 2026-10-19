// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { handleMessage } from '../../src/gpx/handler';
import { DEFAULT_MAX_POINTS } from '../../src/gpx/parse';
import { BakeError } from './errors';
import { parsePointsJson, readInput, runFromPoints } from './input';
import { gpxOf, pointsJsonOf, syntheticRoute } from './testing';

const dir = mkdtempSync(join(tmpdir(), 'vert-bake-input-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

/** Distinctive coordinates, to check no error message ever repeats them. */
const LAT = 46.583917;
const LON = 7.912846;
const point = (extra: Record<string, unknown> = {}) => ({ lat: LAT, lon: LON, ...extra });
const json = (points: unknown) => JSON.stringify({ points });

function errorOf(text: string): string {
  try {
    parsePointsJson(text);
  } catch (error) {
    expect(error).toBeInstanceOf(BakeError);
    const message = (error as Error).message;
    expect(message).not.toContain('46.58');
    expect(message).not.toContain('7.91');
    expect(message).not.toMatch(/\d{2}\.\d{3,}/);
    return message;
  }
  throw new Error('Expected the points file to be refused');
}

describe('parsePointsJson', () => {
  it('reads lat, lon, ele and ISO or epoch-millisecond times', () => {
    const parsed = parsePointsJson(
      json([
        point({ ele: 1200.5, t: '2026-06-01T06:30:00Z' }),
        point({ ele: null, t: Date.UTC(2026, 5, 1, 6, 30, 4) }),
        point({ t: '2026-06-01T08:30:08+02:00' }),
        point(),
      ]),
    );
    expect(parsed.points).toEqual([
      { lat: LAT, lon: LON, ele: 1200.5, time: Date.UTC(2026, 5, 1, 6, 30, 0) },
      { lat: LAT, lon: LON, ele: null, time: Date.UTC(2026, 5, 1, 6, 30, 4) },
      { lat: LAT, lon: LON, ele: null, time: Date.UTC(2026, 5, 1, 6, 30, 8) },
      { lat: LAT, lon: LON, ele: null, time: null },
    ]);
    expect(parsed).toMatchObject({ name: null, time: null, segments: 1, source: 'trk' });
  });

  const cases: [string, string, RegExp][] = [
    ['not JSON', '{"points": [', /not valid JSON/],
    ['not an object', '[1, 2]', /JSON object/],
    ['an unknown top-level key', JSON.stringify({ points: [], name: 'x' }), /unknown key "name"/],
    ['points not an array', JSON.stringify({ points: {} }), /must be an array/],
    ['fewer than 2 points', json([point()]), /at least 2 points/],
    ['a point that is not an object', json([point(), 5]), /points\[1\] must be an object/],
    [
      'an unknown point key',
      json([point(), point({ lng: LON })]),
      /points\[1\].*unknown key "lng"/,
    ],
    ['a typo for ele', json([point({ elevation: 3 }), point()]), /unknown key "elevation"/],
    ['a missing lat', json([point(), { lon: LON }]), /points\[1\]\.lat must be a finite number/],
    ['lat as a string', json([point(), point({ lat: String(LAT) })]), /\.lat must be a finite/],
    ['lat out of range', json([point(), point({ lat: 91.5 })]), /points\[1\]\.lat is outside/],
    ['lon out of range', json([point({ lon: -180.25 }), point()]), /points\[0\]\.lon is outside/],
    ['ele as a string', json([point({ ele: '12' }), point()]), /\.ele must be a finite number/],
    ['t in seconds', json([point({ t: 1_780_000_000 }), point()]), /epoch milliseconds/],
    ['t without a zone', json([point({ t: '2026-06-01T06:30:00' }), point()]), /with a zone/],
    ['t not a date', json([point({ t: 'yesterday' }), point()]), /ISO 8601/],
    ['t as a boolean', json([point({ t: true }), point()]), /ISO 8601 string or epoch/],
    [
      'times going backwards',
      json([point({ t: '2026-06-01T06:30:10Z' }), point({ t: '2026-06-01T06:30:00Z' })]),
      /points\[1\]\.t is earlier/,
    ],
  ];
  for (const [name, text, expected] of cases) {
    it(`refuses ${name}, without echoing a value`, () => {
      expect(errorOf(text)).toMatch(expected);
    });
  }

  it('refuses more points than the app draws', () => {
    const text = `{"points":[${Array.from({ length: DEFAULT_MAX_POINTS + 1 }, () => '{"lat":1,"lon":1}').join(',')}]}`;
    expect(errorOf(text)).toMatch(/the most Vert draws is 500000/);
  });

  it('a key in an error is shown without its digits', () => {
    expect(errorOf(json([point({ '46.583917': 1 }), point()]))).toMatch(/unknown key "\?+"/);
  });
});

describe('a points file and a GPX of the same points give the same run', () => {
  const route = syntheticRoute();
  const fromGpx = handleMessage({
    id: 1,
    kind: 'text',
    text: gpxOf(route),
    fileName: 'a.gpx',
  }).response;
  if (!fromGpx.ok) throw new Error(fromGpx.message);

  for (const time of ['iso', 'ms'] as const) {
    it(`with ${time} times`, () => {
      const { run, points } = runFromPoints(parsePointsJson(pointsJsonOf(route, { time })));
      // Only the name differs: the GPX has one, a points file never does.
      expect(run.name).not.toBe(fromGpx.run.name);
      expect({ ...run, name: '' }).toEqual({ ...fromGpx.run, name: '' });
      expect(points).toEqual(fromGpx.points);
    });
  }
});

describe('readInput', () => {
  const route = syntheticRoute();

  it('reads a GPX through the parse worker’s handler', () => {
    const input = readInput(file('Morning Run.gpx', gpxOf(route)));
    expect(input.kind).toBe('gpx');
    expect(input.fileName).toBe('Morning Run.gpx');
    expect(input.run.distance).toBeGreaterThan(3000);
    expect(input.run.hasElevation).toBe(true);
  });

  it('reads a points file', () => {
    const input = readInput(file('points.json', pointsJsonOf(route)));
    expect(input.kind).toBe('json');
    expect(input.points.lat).toHaveLength(route.length);
  });

  it("passes on the parser's message for a broken GPX", () => {
    expect(() => readInput(file('broken.gpx', '<gpx><trk><trkseg>'))).toThrow(BakeError);
    expect(() => readInput(file('empty.gpx', '<gpx version="1.1"></gpx>'))).toThrow(
      /no track points/,
    );
  });

  it('refuses other extensions and missing files', () => {
    expect(() => readInput(file('run.fit', 'x'))).toThrow(/\.gpx file or a \.json/);
    expect(() => readInput(join(dir, 'missing.gpx'))).toThrow(/cannot be read/);
  });
});
