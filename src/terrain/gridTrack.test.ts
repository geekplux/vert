import { describe, expect, it } from 'vitest';
import { isLoop } from '../lib/loop';
import { gridTrackFromRun } from './gridTrack';
import { elevationAt, gridPosition } from './heightfield';
import { gridElevation } from './grid';
import { hills, makeTrack } from './testing';

describe('gridTrackFromRun', () => {
  const hf = hills();
  const run = makeTrack(
    [
      [34.705, -83.99],
      [34.72, -84], // the north-west corner
      [34.7, -83.96], // the south-east corner
      [34.73, -84.01], // outside, north-west of the grid
    ],
    [500, 610, 420, 700],
  );

  it('puts every point where gridPosition does, exactly', () => {
    const track = gridTrackFromRun(hf, run);
    expect(track.col).toHaveLength(4);
    run.lat.forEach((lat, i) => {
      const p = gridPosition(hf, run.lon[i] ?? NaN, lat);
      expect(track.col[i]).toBe(p.x);
      expect(track.row[i]).toBe(p.y);
      // So the terrain under the route is the same elevation, bit for bit.
      expect(gridElevation(hf, track.col[i] ?? NaN, track.row[i] ?? NaN)).toBe(
        elevationAt(hf, run.lon[i] ?? NaN, lat),
      );
    });
    expect(track.col[1]).toBeCloseTo(0, 9);
    expect(track.row[1]).toBeCloseTo(0, 9);
    expect(track.col[2]).toBeCloseTo(hf.width - 1, 9);
    expect(track.row[2]).toBeCloseTo(hf.height - 1, 9);
    expect(track.col[3]).toBeLessThan(0);
    expect(track.row[3]).toBeLessThan(0);
  });

  it('passes the distances and elevations through, not copies, and carries no lat/lon', () => {
    const track = gridTrackFromRun(hf, run);
    expect(track.cumulative).toBe(run.cumulative);
    expect(track.ele).toBe(run.ele);
    expect(Object.keys(track).sort()).toEqual(['col', 'cumulative', 'ele', 'loop', 'row']);
    expect(gridTrackFromRun(hf, makeTrack([[34.71, -83.98]])).ele).toBeNull();
  });

  it('decides the loop once, with the legend’s rule (isLoop, great-circle distance)', () => {
    expect(isLoop(run)).toBe(false);
    expect(gridTrackFromRun(hf, run).loop).toBe(false);
    // Back to within ~14 m of the start.
    const loop = makeTrack([
      [34.705, -83.99],
      [34.714, -83.972],
      [34.7051, -83.9899],
    ]);
    expect(isLoop(loop)).toBe(true);
    expect(gridTrackFromRun(hf, loop).loop).toBe(true);
    expect(gridTrackFromRun(hf, makeTrack([[34.71, -83.98]])).loop).toBe(true);
  });

  it('gives an empty track for an empty run', () => {
    const track = gridTrackFromRun(hf, makeTrack([]));
    expect(track.col).toHaveLength(0);
    expect(track.row).toHaveLength(0);
  });

  it('works across the antimeridian, where the bounds run past 180°', () => {
    const dateline = { ...hf, bounds: { west: 179.98, south: -16.9, east: 180.02, north: -16.88 } };
    const track = gridTrackFromRun(dateline, makeTrack([[-16.89, 180.01]]));
    expect(track.col[0]).toBeCloseTo(0.75 * (hf.width - 1), 6);
  });
});
