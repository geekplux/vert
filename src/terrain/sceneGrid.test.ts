import { describe, expect, it } from 'vitest';
import sampleGpx from '../../public/samples/coosa-backcountry.gpx?raw';
import { trimTrack } from '../gpx/trim';
import { boundsOf } from '../lib/geo';
import { buildScene } from '../scene/build';
import { decodeScene } from '../scene/decode';
import { encodeScene } from '../scene/encode';
import { MEASURED_TERRAIN, padded, runFromGpx, syntheticHeightfield } from '../scene/testing';
import { createMarkerLayer, markerPositions, routeMarkerIndices } from './markers';
import { resampleTrack } from './route';
import { sceneToGrid } from './sceneGrid';
import { hills, sceneOn } from './testing';

const POINTS: [number, number][] = [
  [10, 20],
  [30, 25],
  [60, 40],
  [90, 50],
];

describe('sceneToGrid', () => {
  it('turns grid-local metres into grid columns and rows, and keeps distances and elevations', () => {
    const grid = hills();
    const scene = sceneOn(grid, POINTS, { start: 200 });
    const { grid: g, track } = sceneToGrid(scene);
    expect(g).toEqual({
      zoom: grid.zoom,
      width: grid.width,
      height: grid.height,
      elevations: grid.elevations,
      min: grid.min,
      max: grid.max,
      metresPerSample: grid.metresPerSample,
    });
    // The scene's own elevation array, not a copy.
    expect(g.elevations).toBe(scene.grid.elevations);
    POINTS.forEach(([c, r], k) => {
      expect(track.col[k]).toBeCloseTo(c, 4);
      expect(track.row[k]).toBeCloseTo(r, 4);
    });
    // Distances from the run's real start: the drawn route starts at the trim.
    expect(track.cumulative).toBe(scene.route.distance);
    expect(track.cumulative[0]).toBe(200);
    expect(Array.from(track.ele ?? [])).toEqual(Array.from(scene.route.elevation));
  });

  it('is a loop exactly when the scene has no finish marker', () => {
    const grid = hills();
    expect(sceneToGrid(sceneOn(grid, POINTS)).track.loop).toBe(false);
    expect(sceneToGrid(sceneOn(grid, POINTS, { finish: null })).track.loop).toBe(true);
  });

  it('passes the stored markers through as grid positions', () => {
    const grid = hills();
    const scene = sceneOn(grid, POINTS, { summit: [70, 24] });
    const { markers } = sceneToGrid(scene).track;
    expect(markers?.start.col).toBeCloseTo(10, 4);
    expect(markers?.start.row).toBeCloseTo(20, 4);
    expect(markers?.finish?.col).toBeCloseTo(90, 4);
    expect(markers?.summit?.col).toBeCloseTo(70, 4);
    expect(markers?.summit?.row).toBeCloseTo(24, 4);
    expect(sceneToGrid(sceneOn(grid, POINTS, { finish: null })).track.markers?.finish).toBeNull();
  });

  it('is memoised per scene object', () => {
    const grid = hills();
    const scene = sceneOn(grid, POINTS);
    expect(sceneToGrid(scene)).toBe(sceneToGrid(scene));
    expect(sceneToGrid(scene).track).toBe(sceneToGrid(scene).track);
    expect(sceneToGrid(sceneOn(grid, POINTS))).not.toBe(sceneToGrid(scene));
  });

  it('draws the markers at the stored positions, not where routeMarkerIndices would put them', () => {
    // The summit the bake found on the original track is off the resampled route's highest point.
    const grid = hills();
    const scene = sceneOn(grid, POINTS, { summit: [70, 24], finish: null });
    const { grid: g, track } = sceneToGrid(scene);
    const derived = routeMarkerIndices(track, g);
    expect(derived.summit).not.toBeNull();
    const layer = createMarkerLayer(g, track);
    expect(layer.indices).toBeNull();
    expect(layer.positions).toBe(track.markers);
    expect(layer.sprite('finish')).toBeNull();
    expect(layer.fixedMarkers().map((m) => m.kind)).toEqual(['start', 'summit']);
    layer.dispose();
  });

  it('places a built scene’s markers exactly where the bake stored them (Coosa, synthetic grid)', () => {
    const { run, track: whole } = runFromGpx(sampleGpx);
    const drawn = trimTrack(whole, 200);
    if (!drawn) throw new Error('Nothing left after the trim');
    const bounds = boundsOf(Array.from(drawn.lat, (lat, k) => ({ lat, lon: drawn.lon[k] ?? 0 })));
    const heightfield = syntheticHeightfield(padded(bounds), MEASURED_TERRAIN.coosa);
    const scene = decodeScene(encodeScene(buildScene(heightfield, drawn, run)));
    const { grid, track } = sceneToGrid(scene);
    const { x: mx, y: my } = scene.grid.metresPerSample;
    const { positions } = markerPositions(track, grid);
    const stored = scene.markers;
    expect(positions.start).toEqual({ col: stored.start.x / mx, row: stored.start.y / my });
    expect(positions.finish).toBeNull(); // Coosa is a loop
    expect(stored.finish).toBeNull();
    expect(positions.summit).toEqual(
      stored.summit ? { col: stored.summit.x / mx, row: stored.summit.y / my } : null,
    );
    // The route is drawn from its first point (200 m), with no repeats of it.
    const samples = resampleTrack(track);
    expect(samples.distance[0]).toBe(scene.route.distance[0]);
    expect(samples.col[1]).not.toBe(samples.col[0]);
  });
});
