// @vitest-environment node
// Scenes are built in Node (`pnpm bake`) and decoded anywhere; no DOM is needed or allowed.
import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { trimTrack } from '../gpx/trim';
import { boundsOf } from '../lib/geo';
import { buildScene } from './build';
import { encodeScene } from './encode';
import { SceneError } from './error';
import { ACTIVITIES_COORDINATE_PATTERN } from './privacy';
import { buildSidecar, fnv1a32, sidecarJson } from './sidecar';
import { MEASURED_TERRAIN, padded, runFromGpx, syntheticHeightfield } from './testing';

const { run, track } = runFromGpx(sampleGpx);
const drawn = trimTrack(track, 200);
if (!drawn) throw new Error('The sample is long enough to trim');
const bounds = boundsOf(Array.from(drawn.lat, (lat, k) => ({ lat, lon: drawn.lon[k] ?? 0 })));
const bytes = encodeScene(
  buildScene(syntheticHeightfield(padded(bounds), MEASURED_TERRAIN.coosa), drawn, run),
);

describe('buildSidecar', () => {
  it('describes the file: format, version, length, hash and the summary in whole metres', () => {
    const sidecar = buildSidecar(bytes);
    expect(Object.keys(sidecar)).toEqual(['format', 'version', 'bytes', 'hash', 'summary']);
    expect(sidecar).toMatchObject({ format: 'vert-scene', version: 1, bytes: bytes.length });
    expect(sidecar.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(sidecar.summary.distance).toBe(Math.round(run.distance));
    expect(sidecar.summary.climb).toBe(Math.round(run.vert));
    expect(sidecar.summary.trim).toEqual({ start: 200, end: 200 });
    const numbers = JSON.stringify(sidecar.summary).match(/-?\d+(\.\d+)?/g) ?? [];
    for (const n of numbers) expect(Number.isInteger(Number(n))).toBe(true);
    const json = sidecarJson(sidecar);
    expect(json.endsWith('}\n')).toBe(true);
    expect(ACTIVITIES_COORDINATE_PATTERN.test(json)).toBe(false);
    expect(JSON.parse(json)).toEqual(sidecar);
  });

  it('changes its hash with the file and refuses bytes that are not a scene', () => {
    const other = bytes.slice();
    other[other.length - 1] = (other[other.length - 1] ?? 0) ^ 1;
    expect(fnv1a32(other)).not.toBe(fnv1a32(bytes));
    expect(fnv1a32(new Uint8Array(0))).toBe('811c9dc5');
    expect(fnv1a32(new TextEncoder().encode('a'))).toBe('e40c292c');
    expect(() => buildSidecar(Uint8Array.of(1, 2, 3))).toThrow(SceneError);
  });
});
