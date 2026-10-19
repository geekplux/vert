import { describe, expect, it } from 'vitest';
import { gridDistance, gridElevation, groundExtent, type TerrainGrid } from './grid';

/** 3 × 2 samples, 30 m apart east–west and 20 m north–south; elevation 100 + 10·column + 50·row. */
const GRID: TerrainGrid = {
  zoom: 13,
  width: 3,
  height: 2,
  elevations: Float32Array.from([100, 110, 120, 150, 160, 170]),
  min: 100,
  max: 170,
  metresPerSample: { x: 30, y: 20 },
};

describe('grid space', () => {
  it('samples elevations bilinearly, taking the edge value outside the grid', () => {
    expect(gridElevation(GRID, 0, 0)).toBe(100);
    expect(gridElevation(GRID, 2, 1)).toBe(170);
    expect(gridElevation(GRID, 0.5, 0.5)).toBeCloseTo(130, 9);
    expect(gridElevation(GRID, -4, 0)).toBe(100);
    expect(gridElevation(GRID, 9, 3)).toBe(170);
  });

  it('measures ground distances with the grid’s spacing', () => {
    expect(gridDistance(GRID, { col: 0, row: 0 }, { col: 2, row: 0 })).toBe(60);
    expect(gridDistance(GRID, { col: 0, row: 0 }, { col: 0, row: 1 })).toBe(20);
    expect(gridDistance(GRID, { col: 0, row: 0 }, { col: 1, row: 2 })).toBe(50);
  });

  it('gives the longer side in metres', () => {
    expect(groundExtent(GRID)).toBe(60);
    expect(groundExtent({ ...GRID, height: 5 })).toBe(80);
  });
});
