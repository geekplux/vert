// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hills, sceneOn } from '../terrain/testing';
import { decodeScene } from './decode';
import { metresAtTime, sceneTimeRange, timeAtMetres } from './time';
import type { Scene } from './types';

/** The committed Coosa scene: the sample run (synthetic times), 200 m trimmed off each end. */
const coosa = decodeScene(
  new Uint8Array(readFileSync(new URL('./fixtures/coosa-backcountry.scene', import.meta.url))),
);

const base = sceneOn(hills(), [
  [5, 10],
  [60, 40],
]);

/** A scene whose route has these distances and times (nothing else of it is read). */
function routeScene(distance: readonly number[], time: readonly number[] | null): Scene {
  return {
    ...base,
    route: {
      ...base.route,
      distance: Float64Array.from(distance),
      time: time ? Float64Array.from(time) : null,
    },
  };
}

describe('the Coosa fixture’s times', () => {
  const { distance, time } = coosa.route;
  const n = distance.length;

  it('has times, and its drawn stretch starts and ends inside the run', () => {
    expect(time).not.toBeNull();
    const range = sceneTimeRange(coosa);
    expect(range).not.toBeNull();
    expect(range?.start).toBe(time?.[0]);
    expect(range?.end).toBe(time?.[n - 1]);
    // 200 m in: the trimmed start took some time to run.
    expect(range?.start).toBeGreaterThan(0);
    expect((range?.end ?? 0) - (range?.start ?? 0)).toBeGreaterThan(3600);
  });

  it('maps every point’s time to its distance and back', () => {
    for (let k = 0; k < n; k += 97) {
      const t = time?.[k] ?? Number.NaN;
      const d = distance[k] ?? Number.NaN;
      // At a repeated time (none in this fixture), the first point's distance.
      expect(metresAtTime(coosa, t)).toBe(d);
      expect(timeAtMetres(coosa, d)).toBe(t);
    }
  });

  it('round-trips times between points: timeAtMetres(metresAtTime(t)) ≈ t', () => {
    const range = sceneTimeRange(coosa);
    if (!range) throw new Error('no times');
    for (let k = 1; k < 400; k++) {
      const t = range.start + ((range.end - range.start) * k) / 400 + 0.37;
      const d = metresAtTime(coosa, t);
      expect(d).not.toBeNull();
      expect(timeAtMetres(coosa, d ?? Number.NaN)).toBeCloseTo(t, 6);
    }
  });

  it('is null in the trimmed ends and past the run, and the ends of the range map to the ends', () => {
    const range = sceneTimeRange(coosa);
    if (!range) throw new Error('no times');
    expect(metresAtTime(coosa, 0)).toBeNull();
    expect(metresAtTime(coosa, range.start - 0.1)).toBeNull();
    expect(metresAtTime(coosa, range.end + 0.1)).toBeNull();
    expect(metresAtTime(coosa, range.start)).toBe(distance[0]);
    expect(metresAtTime(coosa, range.end)).toBe(distance[n - 1]);
    expect(timeAtMetres(coosa, 0)).toBeNull();
    expect(timeAtMetres(coosa, 199.9)).toBeNull();
    expect(timeAtMetres(coosa, (distance[n - 1] ?? 0) + 0.1)).toBeNull();
    expect(timeAtMetres(coosa, coosa.summary.distance)).toBeNull();
  });

  it('is monotonic: later times are never nearer the start', () => {
    const range = sceneTimeRange(coosa);
    if (!range) throw new Error('no times');
    let last = -Infinity;
    for (let t = range.start; t <= range.end; t += 13.7) {
      const d = metresAtTime(coosa, t) ?? Number.NaN;
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe('metresAtTime, timeAtMetres and sceneTimeRange on hand-made routes', () => {
  it('give null for a scene without times', () => {
    const scene = routeScene([200, 210, 220], null);
    expect(metresAtTime(scene, 10)).toBeNull();
    expect(timeAtMetres(scene, 210)).toBeNull();
    expect(sceneTimeRange(scene)).toBeNull();
  });

  it('give null for an empty route', () => {
    const scene = routeScene([], []);
    expect(metresAtTime(scene, 0)).toBeNull();
    expect(timeAtMetres(scene, 0)).toBeNull();
    expect(sceneTimeRange(scene)).toBeNull();
  });

  it('interpolate linearly between points', () => {
    const scene = routeScene([200, 210, 220, 230], [60, 64, 70, 80]);
    expect(metresAtTime(scene, 62)).toBe(205);
    expect(metresAtTime(scene, 67)).toBe(215);
    expect(metresAtTime(scene, 75)).toBe(225);
    expect(timeAtMetres(scene, 205)).toBe(62);
    expect(timeAtMetres(scene, 215)).toBe(67);
    expect(timeAtMetres(scene, 230)).toBe(80);
    expect(sceneTimeRange(scene)).toEqual({ start: 60, end: 80 });
  });

  it('cover only a trimmed route: null before its first time and after its last', () => {
    // 200 m trimmed at the start (60 s in) and the run went on after 80 s.
    const scene = routeScene([200, 210, 220, 230], [60, 64, 70, 80]);
    expect(metresAtTime(scene, 0)).toBeNull();
    expect(metresAtTime(scene, 59.999)).toBeNull();
    expect(metresAtTime(scene, 60)).toBe(200);
    expect(metresAtTime(scene, 80)).toBe(230);
    expect(metresAtTime(scene, 80.001)).toBeNull();
    expect(timeAtMetres(scene, 199.999)).toBeNull();
    expect(timeAtMetres(scene, 230.001)).toBeNull();
  });

  it('stay at the distance through a stop, whose first time timeAtMetres gives', () => {
    // Stood at 210 m from 64 s to 124 s.
    const scene = routeScene([200, 210, 210, 210, 220], [60, 64, 90, 124, 130]);
    for (const t of [64, 70, 90, 100, 123.9, 124]) expect(metresAtTime(scene, t)).toBe(210);
    expect(metresAtTime(scene, 127)).toBe(215);
    expect(timeAtMetres(scene, 210)).toBe(64);
    expect(timeAtMetres(scene, 215)).toBe(127);
    // A route that stands still at its start: the first time there.
    expect(timeAtMetres(routeScene([200, 200, 210], [0, 30, 40]), 200)).toBe(0);
  });

  it('give the first distance where the time repeats (a jump in the recording)', () => {
    const scene = routeScene([200, 210, 220, 230], [60, 64, 64, 70]);
    expect(metresAtTime(scene, 64)).toBe(210);
    expect(metresAtTime(scene, 67)).toBe(225);
    expect(timeAtMetres(scene, 215)).toBe(64);
  });

  it('give the one point of a single-point route, and null anywhere else', () => {
    const scene = routeScene([200], [60]);
    expect(metresAtTime(scene, 60)).toBe(200);
    expect(metresAtTime(scene, 60.5)).toBeNull();
    expect(timeAtMetres(scene, 200)).toBe(60);
    expect(timeAtMetres(scene, 201)).toBeNull();
    expect(sceneTimeRange(scene)).toEqual({ start: 60, end: 60 });
  });

  it('give null for non-finite input', () => {
    const scene = routeScene([200, 210, 220], [60, 64, 70]);
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(metresAtTime(scene, bad)).toBeNull();
      expect(timeAtMetres(scene, bad)).toBeNull();
    }
  });

  it('give null for a route whose times or distances go backwards or are not finite', () => {
    for (const scene of [
      routeScene([200, 210, 220], [60, 50, 70]),
      routeScene([200, 190, 220], [60, 64, 70]),
      routeScene([200, 210, 220], [60, Number.NaN, 70]),
      routeScene([200, Infinity, 220], [60, 64, 70]),
    ]) {
      expect(metresAtTime(scene, 65)).toBeNull();
      expect(timeAtMetres(scene, 215)).toBeNull();
      expect(sceneTimeRange(scene)).toBeNull();
    }
  });

  it('use the points both arrays have when their lengths differ', () => {
    const scene = routeScene([200, 210, 220, 230], [60, 64]);
    expect(metresAtTime(scene, 62)).toBe(205);
    expect(timeAtMetres(scene, 220)).toBeNull();
    expect(sceneTimeRange(scene)).toEqual({ start: 60, end: 64 });
  });

  it('search in O(log n) once the route has been checked', () => {
    const n = 1_000_000;
    let reads = 0;
    /** The array, counting the elements read from it. */
    const counted = (values: Float64Array) =>
      new Proxy(values, {
        get(target, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
          // Only elements and `length` are read, neither of them a method.
          return Reflect.get(target, key, target) as unknown;
        },
      });
    const scene: Scene = {
      ...base,
      route: {
        ...base.route,
        distance: counted(Float64Array.from({ length: n }, (_, k) => 200 + k)),
        time: counted(Float64Array.from({ length: n }, (_, k) => 2 * k)),
      },
    };
    // The first call checks the route's order, once per route object.
    expect(metresAtTime(scene, 0)).toBe(200);
    for (let k = 0; k < 1000; k++) {
      const t = (k * 1999.5) % (2 * (n - 1));
      reads = 0;
      expect(metresAtTime(scene, t)).toBeCloseTo(200 + t / 2, 6);
      // ⌈log2 n⌉ = 20 steps of the search, and a few reads around it.
      expect(reads).toBeGreaterThan(10);
      expect(reads).toBeLessThanOrEqual(30);
      reads = 0;
      expect(timeAtMetres(scene, 200 + t / 2)).toBeCloseTo(t, 6);
      expect(reads).toBeLessThanOrEqual(30);
    }
  });
});
