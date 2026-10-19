// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { valueAtDistance } from '../gpx/stats';
import { trimTrack } from '../gpx/trim';
import {
  MERCATOR_RADIUS_M,
  lonLatToTile,
  lonLatToWorld,
  worldToLonLat,
  type Bounds,
} from '../lib/geo';
import type { RunTrack } from '../page/types';
import type { Heightfield } from '../terrain/heightfield';
import { buildScene, type SceneRun } from './build';
import { decodeScene } from './decode';
import { encodeScene } from './encode';
import {
  ACTIVITIES_COORDINATE_PATTERN,
  sceneLayout,
  scanBytes,
  scanObject,
  scanScene,
  scanText,
  tileIndices,
  type LocationSecrets,
} from './privacy';
import { buildSidecar, sidecarJson } from './sidecar';
import { MEASURED_TERRAIN, padded, runFromGpx, syntheticHeightfield } from './testing';
import { cachedSceneHeightfield, hasCachedTiles, realRoutes, trackBounds } from './testTiles';

interface Built {
  readonly bytes: Uint8Array;
  readonly sidecar: string;
  readonly secrets: LocationSecrets;
  readonly drawn: RunTrack;
  readonly track: RunTrack;
  readonly heightfield: Heightfield;
}

function build(heightfield: Heightfield, track: RunTrack, drawn: RunTrack, run: SceneRun): Built {
  const bytes = encodeScene(buildScene(heightfield, drawn, run));
  return {
    bytes,
    sidecar: sidecarJson(buildSidecar(bytes)),
    // Every coordinate of the whole run (trimmed ends included) and every box around it.
    secrets: {
      lat: track.lat,
      lon: track.lon,
      bounds: [trackBounds(track), trackBounds(drawn), heightfield.bounds],
    },
    drawn,
    track,
    heightfield,
  };
}

/** The Coosa sample on a synthetic grid (real tiles are not available offline). */
function coosa(trim: number, shift?: { lat: number; lon: number }, base?: number): Built {
  const { run, track: original } = runFromGpx(sampleGpx);
  const track: RunTrack = shift
    ? {
        ...original,
        lat: original.lat.map((v) => v + shift.lat),
        lon: original.lon.map((v) => v + shift.lon),
      }
    : original;
  const drawn = trim > 0 ? trimTrack(track, trim) : track;
  if (!drawn) throw new Error('The sample is long enough to trim');
  const terrain = {
    ...MEASURED_TERRAIN.coosa,
    ...(base === undefined ? {} : { base, range: 120 }),
  };
  return build(syntheticHeightfield(padded(trackBounds(drawn)), terrain), track, drawn, run);
}

function clean({ bytes, sidecar, secrets }: Built) {
  return scanScene({ bytes, scene: decodeScene(bytes), sidecar }, secrets);
}

/** `bytes` with an extra section (one a version-1 decoder skips) holding `payload`. */
function withExtraSection(bytes: Uint8Array, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 8 + payload.length);
  out.set(bytes);
  out.set([0x58, 0x54, 0x52, 0x41], bytes.length); // "XTRA"
  const view = new DataView(out.buffer);
  view.setUint32(bytes.length + 4, payload.length, true);
  out.set(payload, bytes.length + 8);
  view.setUint32(8, out.length, true);
  return out;
}

/** Ways a careless writer could leak the place, each written into an extra section. */
function leaks({ track, drawn, heightfield, bytes }: Built): Record<string, Uint8Array> {
  const scene = decodeScene(bytes);
  const mid = Math.floor(track.lat.length / 2);
  const lat = track.lat[mid] ?? NaN;
  const lon = track.lon[mid] ?? NaN;
  // A drawn route point, interpolated (not equal to any recorded point).
  const d = scene.route.distance[5] ?? 0;
  const iLat = valueAtDistance(drawn.lat, drawn.cumulative, d);
  const iLon = valueAtDistance(drawn.lon, drawn.cumulative, d);
  const b: Bounds = heightfield.bounds;
  const nw = lonLatToWorld(b.west, b.north);
  const se = lonLatToWorld(b.east, b.south);
  const mercatorCentre = worldToLonLat(0, (nw.y + se.y) / 2).lat;
  const tile = lonLatToTile(lon, lat, 14);
  const world = lonLatToWorld(iLon, iLat);
  const make = (size: number, write: (view: DataView) => void) => {
    const out = new Uint8Array(size);
    write(new DataView(out.buffer));
    return out;
  };
  return {
    'float64 track latitude': make(8, (v) => {
      v.setFloat64(0, lat, true);
    }),
    'float64 latitude + 1e-7': make(8, (v) => {
      v.setFloat64(0, lat + 1e-7, true);
    }),
    'float32 track latitude alone': make(4, (v) => {
      v.setFloat32(0, lat, true);
    }),
    'float32 interpolated lat/lon': make(8, (v) => {
      v.setFloat32(0, iLat, true);
      v.setFloat32(4, iLon, true);
    }),
    'float64 interpolated lon/lat': make(16, (v) => {
      v.setFloat64(0, iLon, true);
      v.setFloat64(8, iLat, true);
    }),
    'float64 Mercator centre latitude': make(8, (v) => {
      v.setFloat64(0, mercatorCentre, true);
    }),
    'float32 Mercator centre latitude': make(4, (v) => {
      v.setFloat32(0, mercatorCentre, true);
    }),
    'float32 north bound': make(4, (v) => {
      v.setFloat32(0, b.north, true);
    }),
    'int32 latitude × 1e7': make(4, (v) => {
      v.setInt32(0, Math.round(lat * 1e7), true);
    }),
    'int32 lon/lat × 1e5': make(8, (v) => {
      v.setInt32(0, Math.round(iLon * 1e5), true);
      v.setInt32(4, Math.round(iLat * 1e5), true);
    }),
    'int32 latitude in semicircles': make(4, (v) => {
      v.setInt32(0, Math.round((lat * 2 ** 31) / 180), true);
    }),
    'u16 tile pair at z14': make(4, (v) => {
      v.setUint16(0, Math.floor(tile.x), true);
      v.setUint16(2, Math.floor(tile.y), true);
    }),
    'u16 tile x at z14 alone': make(2, (v) => {
      v.setUint16(0, Math.floor(tile.x), true);
    }),
    'float64 Web Mercator world (x, y)': make(16, (v) => {
      v.setFloat64(0, world.x, true);
      v.setFloat64(8, world.y, true);
    }),
    'float32 EPSG:3857 metres (x, y)': make(8, (v) => {
      v.setFloat32(0, (world.x - 0.5) * 2 * Math.PI * MERCATOR_RADIUS_M, true);
      v.setFloat32(4, (0.5 - world.y) * 2 * Math.PI * MERCATOR_RADIUS_M, true);
    }),
    'float64 fractional z14 tile (x, y)': make(16, (v) => {
      v.setFloat64(0, world.x * 2 ** 14, true);
      v.setFloat64(8, world.y * 2 ** 14, true);
    }),
    'float32 fractional z8 tile (y, x)': make(8, (v) => {
      v.setFloat32(0, world.y * 2 ** 8, true);
      v.setFloat32(4, world.x * 2 ** 8, true);
    }),
    'decimal text "lat,lon"': new TextEncoder().encode(
      `{"p":"${iLat.toFixed(5)},${iLon.toFixed(5)}"}`,
    ),
  };
}

function expectEveryLeakFound(built: Built) {
  const missed = Object.entries(leaks(built))
    .filter(
      ([, payload]) =>
        scanBytes(withExtraSection(built.bytes, payload), built.secrets).length === 0,
    )
    .map(([name]) => name);
  expect(missed).toEqual([]);
}

describe('scene privacy (Coosa sample track, synthetic grid)', () => {
  const trimmed = coosa(200);

  it('finds nothing in a clean scene, with the default trim and with none', () => {
    expect(clean(trimmed)).toEqual([]);
    expect(clean(coosa(0))).toEqual([]);
  });

  it('finds nothing on a low-lying grid where elevations and times share the coordinates’ range', () => {
    // The track moved to 22.3° N 114.2° E, over a grid 0–120 m high: route times, elevations and
    // grid values all pass through 22.x and 114.x without being coordinates.
    const shift = { lat: 22.3 - 34.77, lon: 114.2 + 83.92 };
    expect(clean(coosa(0, shift, 0))).toEqual([]);
    expect(clean(coosa(200, shift, 0))).toEqual([]);
  });

  it('publishes a sidecar that passes Activities’ coordinate check', () => {
    expect(ACTIVITIES_COORDINATE_PATTERN.test(trimmed.sidecar)).toBe(false);
  });

  it('keeps nothing absolute: no start time, no date, no name', () => {
    const { run } = runFromGpx(sampleGpx);
    const text = JSON.stringify(decodeScene(trimmed.bytes), (_, v: unknown) =>
      ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v,
    );
    expect(text).not.toContain(run.name);
    expect(text).not.toContain(String(run.startTime));
    expect(text).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('catches every leak a writer could add', () => {
    expectEveryLeakFound(trimmed);
  });

  it('does not look for raw tile pairs inside a stream, where they occur by chance', () => {
    const { bytes, secrets } = trimmed;
    const tile = tileIndices(secrets.bounds).at(-1);
    if (!tile) throw new Error('no tiles');
    const inStream = bytes.slice();
    const at = (sceneLayout(bytes).streams[0]?.[0] ?? 0) + 50;
    new DataView(inStream.buffer).setUint16(at, tile.x, true);
    new DataView(inStream.buffer).setUint16(at + 2, tile.y, true);
    expect(scanBytes(inStream, secrets)).toEqual([]);
  });
});

describe('scene privacy on real terrain (cached tiles)', () => {
  for (const trim of [200, 0]) {
    for (const route of realRoutes(trim)) {
      const bounds = trackBounds(route.drawn);
      it.skipIf(!hasCachedTiles(bounds))(
        `${route.name}, trim ${String(trim)}: clean, and every leak is caught`,
        async () => {
          const heightfield = await cachedSceneHeightfield(bounds);
          const built = build(heightfield, route.track, route.drawn, route.run);
          expect(clean(built)).toEqual([]);
          expectEveryLeakFound(built);
        },
      );
    }
  }
});

describe('the scanner on objects', () => {
  const { secrets } = coosa(200);
  const { track } = runFromGpx(sampleGpx);
  const lat = track.lat[10] ?? NaN;
  const lon = track.lon[10] ?? NaN;

  it('finds forbidden keys, key values, pairs, timestamps and tile indices', () => {
    const tile = lonLatToTile(lon, lat, 12);
    const findings = scanObject(
      {
        bounds: {},
        name: 'x',
        nested: { values: Float32Array.of(1, lat, lon), when: Date.UTC(2026, 9, 3) },
        point: { a: lat + 1e-4, b: lon - 1e-4 },
        edge: secrets.bounds[2]?.north,
        tile: { x: Math.floor(tile.x) },
      },
      secrets,
    ).map((f) => f.what);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/forbidden key \$\.bounds/),
        expect.stringMatching(/forbidden key \$\.name/),
        expect.stringMatching(/values\[1\], \[2\] form a lat\/lon pair/),
        expect.stringMatching(/point\.a and \.b form a lat\/lon pair/),
        expect.stringMatching(/\$\.edge is a bound/),
        expect.stringMatching(/when looks like a timestamp/),
        expect.stringMatching(/tile\.x equals a tile index/),
      ]),
    );
  });

  it('does not flag a lone number that merely falls in the coordinates’ range', () => {
    // Route times of a run that starts at 0 s pass through every value from 0 to 100 s.
    const times = Float64Array.from({ length: 1000 }, (_, i) => i / 10);
    expect(scanObject({ route: { time: times }, grade: 0.348, low: lat + 0.01 }, secrets)).toEqual(
      [],
    );
  });

  it('applies Activities’ pattern to text', () => {
    expect(scanText('{"lat": 34.7637553}')).toHaveLength(1);
    expect(scanText('{"distance": 21468, "grade": 0.1428}')).toEqual([]);
  });
});
