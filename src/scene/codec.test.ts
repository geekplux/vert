// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
import { describe, expect, it } from 'vitest';
import { decodeScene } from './decode';
import { encodeScene } from './encode';
import { SceneError } from './error';
import { HEADER_BYTES, SCENE_LIMITS, SCENE_STEPS, SECTION_HEADER_BYTES } from './format';
import { randomStream, sectionLengths } from './testing';
import type { Scene } from './types';

/**
 * A scene of arbitrary (unquantised) values within the format's ranges, so the round trip
 * exercises every rounding.
 */
function randomScene(seed: number, { time = true, finish = true, summit = true } = {}): Scene {
  const random = randomStream(seed);
  const between = (a: number, b: number) => a + (b - a) * random();
  const width = 37;
  const height = 23;
  const mps = { x: between(20, 40), y: between(20, 40) };
  const elevations = Float32Array.from({ length: width * height }, () => between(-50, 2500));
  const count = 57;
  const start = between(0, 500);
  const end = start + between(1000, 5000);
  const distance = Float64Array.from(
    { length: count },
    (_, k) => start + ((end - start) * k) / (count - 1),
  );
  const extentX = mps.x * (width - 1);
  const extentY = mps.y * (height - 1);
  const marker = (d: number) => ({
    distance: d,
    x: between(0, extentX),
    y: between(0, extentY),
    elevation: between(0, 2000),
  });
  let min = Infinity;
  let max = -Infinity;
  for (const e of elevations) {
    min = Math.min(min, e);
    max = Math.max(max, e);
  }
  const runDistance = end + between(0, 400);
  return {
    version: 1,
    grid: {
      width,
      height,
      zoom: 12,
      metresPerSample: mps,
      elevationStep: 0.137,
      elevations,
      min,
      max,
    },
    route: {
      x: Float32Array.from({ length: count }, () => between(0, extentX)),
      y: Float32Array.from({ length: count }, () => between(0, extentY)),
      distance,
      elevation: Float32Array.from({ length: count }, () => between(-20, 3000)),
      time: time ? Float64Array.from({ length: count }, (_, k) => 60 + k * between(2, 9)) : null,
    },
    markers: {
      start: marker(start),
      finish: finish ? marker(end) : null,
      summit: summit ? marker(between(start, end)) : null,
    },
    climbs: [
      { start: start + 10, end: start + 400.123, gain: 55.55, avgGrade: 0.1428, steepest: false },
      { start: start + 500, end: start + 900, gain: 120.04, avgGrade: 0.3001, steepest: true },
    ],
    summary: {
      distance: runDistance,
      climb: 1234.56,
      drawnLength: end - start,
      extent: { x: extentX, y: extentY },
      trim: { start, end: runDistance - end },
    },
  };
}

/** Every value of `actual` within `step / 2` (plus float32 slack) of `expected`. */
function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>, step: number) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i] ?? NaN;
    const e = expected[i] ?? NaN;
    expect(Math.abs(a - e)).toBeLessThanOrEqual(step / 2 + Math.abs(e) * 1e-6);
  }
}

describe('encodeScene / decodeScene', () => {
  it('round-trips every field within its quantisation step, integers and flags exactly', () => {
    const scene = randomScene(1);
    const decoded = decodeScene(encodeScene(scene));
    const S = SCENE_STEPS;
    expect(decoded.version).toBe(1);
    const { grid } = decoded;
    expect([grid.width, grid.height, grid.zoom]).toEqual([37, 23, 12]);
    expect(grid.elevationStep).toBe(0.137);
    expectClose(
      [grid.metresPerSample.x, grid.metresPerSample.y],
      [scene.grid.metresPerSample.x, scene.grid.metresPerSample.y],
      S.metresPerSample,
    );
    expectClose(grid.elevations, scene.grid.elevations, grid.elevationStep);
    expectClose([grid.min, grid.max], [scene.grid.min, scene.grid.max], grid.elevationStep);
    const { route } = decoded;
    expectClose(route.x, scene.route.x, S.position);
    expectClose(route.y, scene.route.y, S.position);
    expectClose(route.elevation, scene.route.elevation, S.elevation);
    // Distances are evenly spaced between the two rounded ends.
    expectClose(route.distance, scene.route.distance, S.distance);
    expect(route.time).not.toBeNull();
    expectClose(route.time ?? [], scene.route.time ?? [], S.time);
    for (const kind of ['start', 'finish', 'summit'] as const) {
      const a = decoded.markers[kind];
      const e = scene.markers[kind];
      expect(a && e).toBeTruthy();
      if (!a || !e) continue;
      expectClose([a.distance], [e.distance], S.distance);
      expectClose([a.x, a.y], [e.x, e.y], S.position);
      expectClose([a.elevation], [e.elevation], S.elevation);
    }
    expect(decoded.climbs.map((c) => c.steepest)).toEqual([false, true]);
    decoded.climbs.forEach((c, i) => {
      const e = scene.climbs[i];
      if (!e) throw new Error('missing climb');
      expectClose([c.start, c.end], [e.start, e.end], S.distance);
      expectClose([c.gain], [e.gain], S.gain);
      expectClose([c.avgGrade], [e.avgGrade], S.grade);
    });
    const { summary } = decoded;
    expectClose([summary.distance], [scene.summary.distance], S.distance);
    expectClose([summary.climb], [scene.summary.climb], S.gain);
    expectClose(
      [summary.drawnLength, summary.trim.start, summary.trim.end],
      [scene.summary.drawnLength, scene.summary.trim.start, scene.summary.trim.end],
      2 * S.distance,
    );
    expectClose(
      [summary.extent.x, summary.extent.y],
      [scene.summary.extent.x, scene.summary.extent.y],
      37 * S.metresPerSample,
    );
  });

  it('re-encodes a decoded scene to the same bytes, and decodes it to the same scene', () => {
    for (const seed of [1, 2, 3]) {
      const bytes = encodeScene(randomScene(seed, { time: seed !== 2, finish: seed !== 3 }));
      const decoded = decodeScene(bytes);
      const again = encodeScene(decoded);
      expect(again).toEqual(bytes);
      expect(decodeScene(again)).toEqual(decoded);
    }
  });

  it('is deterministic', () => {
    expect(encodeScene(randomScene(4))).toEqual(encodeScene(randomScene(4)));
  });

  it('carries no time, finish or summit when the scene has none, and an unknown climb as NaN', () => {
    const scene = { ...randomScene(5, { time: false, finish: false, summit: false }) };
    const decoded = decodeScene(
      encodeScene({ ...scene, summary: { ...scene.summary, climb: NaN } }),
    );
    expect(decoded.route.time).toBeNull();
    expect(decoded.markers.finish).toBeNull();
    expect(decoded.markers.summit).toBeNull();
    expect(decoded.summary.climb).toBeNaN();
  });

  it('accepts a Uint8Array view into a larger buffer and an ArrayBuffer', () => {
    const bytes = encodeScene(randomScene(6));
    const padded = new Uint8Array(bytes.length + 10);
    padded.set(bytes, 5);
    expect(decodeScene(padded.subarray(5, 5 + bytes.length))).toEqual(decodeScene(bytes));
    expect(decodeScene(bytes.slice().buffer)).toEqual(decodeScene(bytes));
  });

  it('refuses scenes that break the format', () => {
    const scene = randomScene(7);
    const bad = (patch: Partial<Scene>) => () => encodeScene({ ...scene, ...patch });
    expect(bad({ grid: { ...scene.grid, width: 1025 } })).toThrow(RangeError);
    expect(bad({ grid: { ...scene.grid, elevationStep: 0.001 } })).toThrow(/step/);
    expect(
      bad({
        markers: {
          ...scene.markers,
          start: { ...scene.markers.start, distance: scene.markers.start.distance + 5 },
        },
      }),
    ).toThrow(/start marker/);
    expect(
      bad({
        climbs: [
          ...scene.climbs,
          { ...scene.climbs[1], start: 0, end: 1, gain: 1, avgGrade: 1, steepest: true },
        ],
      }),
    ).toThrow(RangeError);
    expect(bad({ route: { ...scene.route, x: scene.route.x.map(() => 1e7) } })).toThrow(
      /off the grid/,
    );
    const elevations = scene.grid.elevations.slice();
    elevations[5] = NaN;
    expect(bad({ grid: { ...scene.grid, elevations } })).toThrow(/not finite/);
    const distance = scene.route.distance.slice();
    distance[3] = (distance[3] ?? 0) + 1;
    expect(bad({ route: { ...scene.route, distance } })).toThrow(/evenly spaced/);
  });
});

/** Overwrites the header's byte length (so a cut-down file reaches the section parsers). */
function withLength(bytes: Uint8Array, length: number): Uint8Array {
  const out = bytes.slice(0, length);
  if (out.length >= HEADER_BYTES) new DataView(out.buffer).setUint32(8, length, true);
  return out;
}

/** Decodes and returns the error, which must be a SceneError not from the catch-all. */
function decodeError(bytes: Uint8Array): SceneError | null {
  try {
    decodeScene(bytes);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(SceneError);
    // The catch-all turns unexpected exceptions into SceneErrors; none should get that far.
    expect((error as Error).message).not.toMatch(/^Unreadable scene/);
    return error as SceneError;
  }
}

describe('decodeScene on untrusted bytes', () => {
  const bytes = encodeScene(randomScene(8));

  it('refuses a section tag that is not printable ASCII', () => {
    const bad = bytes.slice();
    bad[HEADER_BYTES] = 0x00;
    expect(decodeError(bad)?.reason).toBe('corrupt');
    const space = bytes.slice();
    space[HEADER_BYTES + 3] = 0x20;
    expect(decodeError(space)?.reason).toBe('corrupt');
  });

  it('names the reason: magic, version, truncation, length', () => {
    expect(decodeError(new Uint8Array(0))?.reason).toBe('magic');
    expect(decodeError(Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0))?.reason).toBe(
      'magic',
    );
    const v2 = bytes.slice();
    new DataView(v2.buffer).setUint16(4, 2, true);
    expect(decodeError(v2)?.reason).toBe('version');
    expect(decodeError(bytes.slice(0, bytes.length - 1))?.reason).toBe('truncated');
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(decodeError(longer)?.reason).toBe('length');
  });

  it('skips unknown trailing sections, and refuses a repeated or missing known one', () => {
    const extra = new Uint8Array(bytes.length + SECTION_HEADER_BYTES + 3);
    extra.set(bytes);
    extra.set([0x58, 0x54, 0x52, 0x41, 3, 0, 0, 0, 1, 2, 3], bytes.length); // "XTRA", 3 bytes
    new DataView(extra.buffer).setUint32(8, extra.length, true);
    expect(decodeScene(extra)).toEqual(decodeScene(bytes));

    const summary = bytes.slice(bytes.length - SECTION_HEADER_BYTES - 8);
    const twice = new Uint8Array(bytes.length + summary.length);
    twice.set(bytes);
    twice.set(summary, bytes.length);
    new DataView(twice.buffer).setUint32(8, twice.length, true);
    expect(decodeError(twice)?.message).toMatch(/twice/);
    expect(decodeError(withLength(bytes, bytes.length - summary.length))?.message).toMatch(
      /SUMM is missing/,
    );
  });

  it('fails cleanly when cut at every length, with the header length left or patched', () => {
    for (let length = 0; length < bytes.length; length++) {
      expect(decodeError(bytes.slice(0, length))).not.toBeNull();
      expect(decodeError(withLength(bytes, length))).not.toBeNull();
    }
  });

  it('never throws anything but a SceneError on random byte flips', () => {
    const random = randomStream(9);
    let rejected = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const corrupt = bytes.slice();
      const flips = 1 + Math.floor(random() * 4);
      for (let f = 0; f < flips; f++) {
        const at = Math.floor(random() * corrupt.length);
        corrupt[at] = (corrupt[at] ?? 0) ^ (1 << Math.floor(random() * 8));
      }
      if (decodeError(corrupt)) rejected++;
    }
    // Most flips break something; a few land on values that are still valid (a grid residual).
    expect(rejected).toBeGreaterThan(1500);
  });

  it('refuses huge declared sizes without allocating them', () => {
    const lengths = sectionLengths(bytes);
    const gridAt = HEADER_BYTES + SECTION_HEADER_BYTES;
    const routeAt = gridAt + (lengths.GRID ?? 0) + SECTION_HEADER_BYTES;
    const patch = (offset: number, write: (view: DataView) => void) => {
      const out = bytes.slice();
      write(new DataView(out.buffer, offset));
      return out;
    };
    // Header and section lengths.
    expect(
      decodeError(
        patch(8, (v) => {
          v.setUint32(0, 0xffff_ffff, true);
        }),
      )?.reason,
    ).toBe('truncated');
    expect(
      decodeError(
        patch(gridAt - 4, (v) => {
          v.setUint32(0, 0xffff_ffff, true);
        }),
      )?.reason,
    ).toBe('truncated');
    // Grid sides over the cap, and at the cap with a tiny stream.
    expect(
      decodeError(
        patch(gridAt, (v) => {
          v.setUint16(0, 0xffff, true);
        }),
      )?.reason,
    ).toBe('range');
    expect(
      decodeError(
        patch(gridAt, (v) => {
          v.setUint16(0, SCENE_LIMITS.maxGridSide, true);
          v.setUint16(2, SCENE_LIMITS.maxGridSide, true);
        }),
      )?.reason,
    ).toBe('truncated');
    // Route point count over the cap, and at the cap.
    expect(
      decodeError(
        patch(routeAt, (v) => {
          v.setUint32(0, 0xffff_ffff, true);
        }),
      )?.reason,
    ).toBe('range');
    expect(
      decodeError(
        patch(routeAt, (v) => {
          v.setUint32(0, SCENE_LIMITS.maxRoutePoints, true);
        }),
      ),
    ).not.toBeNull();
    // Marker and climb counts that disagree with their section lengths.
    const markAt = routeAt + (lengths.ROUT ?? 0) + SECTION_HEADER_BYTES;
    const climbAt = markAt + (lengths.MARK ?? 0) + SECTION_HEADER_BYTES;
    expect(
      decodeError(
        patch(markAt, (v) => {
          v.setUint8(0, 2);
        }),
      )?.reason,
    ).toBe('length');
    expect(
      decodeError(
        patch(climbAt, (v) => {
          v.setUint8(0, 255);
        }),
      )?.reason,
    ).toBe('length');
  });

  it('decodes a scene at the size caps in reasonable time', () => {
    const side = SCENE_LIMITS.maxGridSide;
    const random = randomStream(10);
    const count = SCENE_LIMITS.maxRoutePoints;
    const mps = 30;
    const scene = randomScene(11);
    const big: Scene = {
      ...scene,
      grid: {
        ...scene.grid,
        width: side,
        height: side,
        metresPerSample: { x: mps, y: mps },
        elevationStep: 0.5,
        elevations: Float32Array.from(
          { length: side * side },
          (_, i) => 1000 + 300 * Math.sin(i / 5000) + 20 * random(),
        ),
      },
      route: {
        x: Float32Array.from({ length: count }, (_, k) => (k / count) * mps * (side - 1)),
        y: Float32Array.from({ length: count }, (_, k) => (k / count) * mps * (side - 1)),
        // The same drawn stretch, cut into the most points a scene may have.
        distance: Float64Array.from(
          { length: count },
          (_, k) => scene.summary.trim.start + (scene.summary.drawnLength * k) / (count - 1),
        ),
        elevation: Float32Array.from({ length: count }, () => 1000 + 50 * random()),
        time: Float64Array.from({ length: count }, (_, k) => k * 3),
      },
    };
    const bytes = encodeScene(big);
    decodeScene(bytes);
    const t0 = performance.now();
    decodeScene(bytes);
    const ms = performance.now() - t0;
    console.log(
      `decode at the caps (${String(side)}², ${String(count)} points, ${String(Math.round(bytes.length / 1000))} KB): ${ms.toFixed(1)} ms`,
    );
    expect(ms).toBeLessThan(3000);
  });
});
