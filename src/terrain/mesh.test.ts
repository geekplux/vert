import { Color, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { lonLatToWorld, worldToLonLat } from '../lib/geo';
import type { Heightfield } from './heightfield';
import {
  DEFAULT_WALL_SHADE,
  STYLE_A_PALETTE,
  baseLevel,
  createTerrainMesh,
  disposeTerrainMesh,
  edgeLevel,
  edgeLevels,
  edgePoints,
  heightfieldToLocal,
  modelBounds,
  radialHull,
  readPalette,
  rowStepFor,
  setExaggeration,
  setPalette,
  surfaceSamples,
  updateDepthRange,
  visibleEdgeLevel,
} from './mesh';

/**
 * A 4 × 3 grid, 100 m between columns and 50 m between rows: 300 m east–west, 100 m north–south.
 * Elevation = 1000 + 10·column + 100·row (row 0 is north).
 */
function tinyHeightfield(): Heightfield {
  const width = 4;
  const height = 3;
  const elevations = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) elevations[j * width + i] = 1000 + 10 * i + 100 * j;
  }
  // Bounds whose Web Mercator box the grid spans exactly.
  const nw = lonLatToWorld(10, 46.01);
  const se = { x: nw.x + 0.00001, y: nw.y + 0.00001 };
  const north = worldToLonLat(nw.x, nw.y);
  const south = worldToLonLat(se.x, se.y);
  return {
    bounds: { west: north.lon, north: north.lat, east: south.lon, south: south.lat },
    zoom: 14,
    width,
    height,
    elevations,
    min: 1000,
    max: 1230,
    metresPerSample: { x: 100, y: 50 },
    failedTiles: [],
  };
}

const lonLatOfNode = (hf: Heightfield, i: number, j: number) => {
  const nw = lonLatToWorld(hf.bounds.west, hf.bounds.north);
  const se = lonLatToWorld(hf.bounds.east, hf.bounds.south);
  return worldToLonLat(
    nw.x + ((se.x - nw.x) * i) / (hf.width - 1),
    nw.y + ((se.y - nw.y) * j) / (hf.height - 1),
  );
};

describe('createTerrainMesh', () => {
  it('has width × height surface vertices in the local frame, 1 unit across, true aspect', () => {
    const hf = tinyHeightfield();
    const mesh = createTerrainMesh(hf, { skirt: false });
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBe(12);
    expect(mesh.geometry.getIndex()?.count).toBe(3 * 2 * 3 * 2); // 3 × 2 quads, 2 triangles each

    const vertex = (i: number, j: number) => new Vector3().fromBufferAttribute(position, j * 4 + i);
    // North-west corner: x west (−), z north (−), lowest point at y = 0.
    expect(vertex(0, 0).x).toBeCloseTo(-0.5);
    expect(vertex(0, 0).z).toBeCloseTo(-1 / 6);
    expect(vertex(0, 0).y).toBeCloseTo(0);
    // South-east corner: 300 m east, 100 m south; 1230 m = 230 m above the minimum.
    expect(vertex(3, 2).x).toBeCloseTo(0.5);
    expect(vertex(3, 2).z).toBeCloseTo(1 / 6);
    expect(vertex(3, 2).y).toBeCloseTo(230 / 300);
    // Width : depth = 300 m : 100 m.
    expect((vertex(3, 0).x - vertex(0, 0).x) / (vertex(0, 2).z - vertex(0, 0).z)).toBeCloseTo(3);
    disposeTerrainMesh(mesh);
  });

  it('adds a skirt: every edge vertex at the top and at the base, and walls of two triangles', () => {
    const hf = tinyHeightfield();
    const mesh = createTerrainMesh(hf);
    const surface = 12;
    const edge = 2 * (4 + 3);
    expect(mesh.geometry.getAttribute('position').count).toBe(surface + edge * 2);
    const bases = mesh.geometry.getAttribute('aBase');
    let bottom = 0;
    for (let k = 0; k < bases.count; k++) bottom += bases.getX(k);
    expect(bottom).toBe(edge);
    const wallTriangles = 2 * (2 * 3 + 2 * 2);
    expect(mesh.geometry.getIndex()?.count).toBe((12 + wallTriangles) * 3);
    disposeTerrainMesh(mesh);
  });

  it('stores grid rows for the ridge lines and counts them from the front (south) edge', () => {
    const hf = tinyHeightfield();
    const mesh = createTerrainMesh(hf, { skirt: false });
    const rows = mesh.geometry.getAttribute('aRow');
    expect(rows.getX(0)).toBe(0);
    expect(rows.getX(11)).toBe(2);
    expect(mesh.material.uniforms.uFrontRow.value).toBe(2);
    disposeTerrainMesh(mesh);
  });

  it('applies the exaggeration as a uniform, without touching the geometry', () => {
    const hf = tinyHeightfield();
    const mesh = createTerrainMesh(hf, { exaggeration: 1.6 });
    expect(mesh.material.uniforms.uExaggeration.value).toBe(1.6);
    expect(mesh.material.vertexShader).toContain('uExaggeration');
    const before = Float32Array.from(mesh.geometry.getAttribute('position').array);
    setExaggeration(mesh, 2.5);
    expect(mesh.material.uniforms.uExaggeration.value).toBe(2.5);
    expect(Float32Array.from(mesh.geometry.getAttribute('position').array)).toEqual(before);
    disposeTerrainMesh(mesh);
  });

  it('rejects a grid smaller than 2 × 2', () => {
    const hf = { ...tinyHeightfield(), width: 1, height: 1, elevations: new Float32Array(1) };
    expect(() => createTerrainMesh(hf)).toThrow(RangeError);
  });
});

describe('palette and uniforms', () => {
  it('takes its colours from the palette, not the shader source', () => {
    const hf = tinyHeightfield();
    const mesh = createTerrainMesh(hf, { palette: { surface: '#0F2233', ink: '#E8F1F5' } });
    const { uSurface, uInk } = mesh.material.uniforms;
    expect(uSurface.value.equals(new Color('#0F2233'))).toBe(true);
    expect(uInk.value.equals(new Color('#E8F1F5'))).toBe(true);
    expect(mesh.material.uniforms.uWallShade.value).toBe(DEFAULT_WALL_SHADE);
    setPalette(mesh, { ...STYLE_A_PALETTE, wallShade: 0.2 });
    expect(mesh.material.uniforms.uWallShade.value).toBe(0.2);
    expect(uSurface.value.equals(new Color('#E6EAEE'))).toBe(true);
    expect(uInk.value.equals(new Color('#1B2A3A'))).toBe(true);
    expect(mesh.material.fragmentShader).not.toMatch(/#[0-9a-f]{6}|0x[0-9a-f]{6}/i);
    disposeTerrainMesh(mesh);
  });

  it('reads the style A tokens from CSS, falling back to the spec values', () => {
    const css = new Map([
      ['--surface', ' #e6eaee '],
      ['--ink', ''],
    ]);
    const palette = readPalette({ getPropertyValue: (name) => css.get(name) ?? '' });
    expect(palette).toEqual({
      surface: '#e6eaee',
      ink: STYLE_A_PALETTE.ink,
      wallShade: DEFAULT_WALL_SHADE,
    });
  });

  it('chooses the row step for about 48 ridge lines across the longer side', () => {
    const hf = tinyHeightfield();
    expect(rowStepFor(hf)).toBe(1);
    expect(rowStepFor({ ...hf, width: 481, height: 300 })).toBe(10);
    expect(rowStepFor({ ...hf, width: 200, height: 512 }, 40)).toBe(13);
  });

  it('sets the depth range from the camera to the model’s bounding sphere', () => {
    const hf = tinyHeightfield();
    const mesh = createTerrainMesh(hf);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 5);
    updateDepthRange(mesh, camera, new Vector3(0, 0, 0), 1);
    expect(mesh.material.uniforms.uDepthRange.value.toArray()).toEqual([4, 6]);
    disposeTerrainMesh(mesh);
  });
});

describe('heightfieldToLocal', () => {
  it('maps the corners and centre of the grid onto the mesh', () => {
    const hf = tinyHeightfield();
    const nw = lonLatOfNode(hf, 0, 0);
    const se = lonLatOfNode(hf, 3, 2);
    const a = heightfieldToLocal(hf, nw.lon, nw.lat);
    expect(a.x).toBeCloseTo(-0.5);
    expect(a.z).toBeCloseTo(-1 / 6);
    expect(a.y).toBeCloseTo(0, 4);
    const b = heightfieldToLocal(hf, se.lon, se.lat, 2);
    expect(b.x).toBeCloseTo(0.5);
    expect(b.z).toBeCloseTo(1 / 6);
    expect(b.y).toBeCloseTo((230 / 300) * 2, 4);
    // Grid centre (column 1.5, row 1): elevation 1000 + 15 + 100 = 1115.
    const c = lonLatOfNode(hf, 1.5, 1);
    const centre = heightfieldToLocal(hf, c.lon, c.lat);
    expect(centre.x).toBeCloseTo(0);
    expect(centre.z).toBeCloseTo(0);
    expect(centre.y).toBeCloseTo(115 / 300, 4);
  });

  it('lifts by true metres, scaled with the exaggeration', () => {
    const hf = tinyHeightfield();
    const nw = lonLatOfNode(hf, 0, 0);
    expect(heightfieldToLocal(hf, nw.lon, nw.lat, 1.5, 2).y).toBeCloseTo((2 / 300) * 1.5, 4);
  });
});

describe('modelBounds', () => {
  it('gives the extents, scale and enclosing sphere', () => {
    const bounds = modelBounds(tinyHeightfield(), 2);
    expect(bounds.scale).toBeCloseTo(1 / 300);
    expect(bounds.width).toBeCloseTo(1);
    expect(bounds.depth).toBeCloseTo(1 / 3);
    expect(bounds.height).toBeCloseTo((230 / 300) * 2);
    expect(bounds.center.y).toBeCloseTo(230 / 300);
    expect(bounds.radius).toBeCloseTo(Math.hypot(1, 1 / 3, 460 / 300) / 2);
  });
});

describe('skirt base and radial hull', () => {
  /** 5 × 5, 100 m spacing: a 300 m pit in the middle, edges between 1000 and 1040 m. */
  function pit(): Heightfield {
    const width = 5;
    const height = 5;
    const elevations = new Float32Array(width * height).map((_, k) => 1000 + (k % width) * 10);
    elevations[12] = 700;
    return {
      ...tinyHeightfield(),
      width,
      height,
      elevations,
      min: 700,
      max: 1040,
      metresPerSample: { x: 100, y: 100 },
    };
  }

  it('puts the base a fixed depth below the lowest edge point, not the grid minimum', () => {
    const hf = pit();
    const scale = 1 / 400;
    expect(edgeLevel(hf)).toBeCloseTo(300 * scale);
    expect(baseLevel(edgeLevel(hf), 2, 0.01)).toBeCloseTo(600 * scale - 0.01);
    const mesh = createTerrainMesh(hf, { baseDepth: 0.01 });
    expect(mesh.material.uniforms.uEdgeLevel.value).toBeCloseTo(300 * scale);
    expect(mesh.material.uniforms.uBaseDepth.value).toBe(0.01);
    expect(mesh.material.vertexShader).toContain('uEdgeLevel * uExaggeration - uBaseDepth');
    disposeTerrainMesh(mesh);
  });

  it('encloses every node in the revolved outline', () => {
    const hf = pit();
    const hull = radialHull(hf, 16);
    expect(hull[0]?.rho).toBe(0);
    const scale = 1 / 400;
    const heightAt = (rho: number) => {
      for (let k = 1; k < hull.length; k++) {
        const a = hull[k - 1];
        const b = hull[k];
        if (a && b && rho <= b.rho + 1e-12) {
          return a.y + ((b.y - a.y) * (rho - a.rho)) / Math.max(b.rho - a.rho, 1e-12);
        }
      }
      return -Infinity;
    };
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 5; i++) {
        const rho = Math.hypot((i / 4 - 0.5) * 400 * scale, (j / 4 - 0.5) * 400 * scale);
        const y = ((hf.elevations[j * 5 + i] ?? 0) - 700) * scale;
        expect(heightAt(rho)).toBeGreaterThanOrEqual(y - 1e-9);
      }
    }
  });
});

describe('visible edge level', () => {
  const levels = { north: 0.3, south: 0.2, east: 0, west: 0.25 };
  const DEG = Math.PI / 180;

  it('hangs the base from the edges facing the camera, not from a side or hidden edge', () => {
    // From due south only the south wall faces the camera.
    expect(visibleEdgeLevel(levels, 0)).toBeCloseTo(0.2);
    // 18° east of south: the east wall is still too oblique (its low point would make a slab).
    expect(visibleEdgeLevel(levels, 18 * DEG)).toBeCloseTo(0.2);
    // 45°: south and east both face the camera.
    expect(visibleEdgeLevel(levels, 45 * DEG)).toBeCloseTo(0);
    // From the north-west: north and west.
    expect(visibleEdgeLevel(levels, -135 * DEG)).toBeCloseTo(0.25);
  });

  it('changes smoothly as the model turns (no jump in the base)', () => {
    let previous = visibleEdgeLevel(levels, 0);
    for (let degrees = 0.5; degrees <= 360; degrees += 0.5) {
      const level = visibleEdgeLevel(levels, degrees * DEG);
      expect(Math.abs(level - previous)).toBeLessThan(0.02); // ≤ ~5% of the 0.3 range per 0.5°
      previous = level;
    }
  });

  it('measures each edge’s lowest point', () => {
    const hf = tinyHeightfield(); // 1000 + 10·column + 100·row, row 0 north; 300 m → 1 unit
    const result = edgeLevels(hf);
    expect(result.north).toBeCloseTo(0);
    expect(result.west).toBeCloseTo(0);
    expect(result.south).toBeCloseTo(200 / 300);
    expect(result.east).toBeCloseTo(30 / 300);
  });

  it('samples the edge (corners included) and a subgrid of the surface with its top', () => {
    const hf = tinyHeightfield();
    const edge = edgePoints(hf);
    expect(edge).toHaveLength(2 * (4 + 3) - 4);
    expect(edge.some((p) => Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.z - 1 / 6) < 1e-9)).toBe(true);
    const surface = surfaceSamples(hf, 48);
    expect(Math.max(...surface.map((p) => p.y))).toBeCloseTo(230 / 300);
  });
});
