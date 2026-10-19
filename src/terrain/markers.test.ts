import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EARTH_RADIUS_M,
  MERCATOR_RADIUS_M,
  haversine,
  lonLatToWorld,
  worldToLonLat,
} from '../lib/geo';
import { LOOP_DISTANCE_M, isLoop } from '../lib/loop';
import { gridDistance } from './grid';
import { gridTrackFromRun } from './gridTrack';
import type { Heightfield } from './heightfield';
import { gridToLocal, modelBounds } from './mesh';
import {
  MAX_TEXTURE_SCALE,
  OCCLUDED_OPACITY,
  TEXTURE_SCALE,
  createMarkerLayer,
  drawMarker,
  isOccluded,
  markerBox,
  markerExtent,
  markerTextureScale,
  routeMarkerIndices,
  type TerrainMarkerKind,
} from './markers';
import { APP_ROUTE_PALETTE, DEFAULT_LIFT_M, pointAtDistance, trackLength } from './route';
import { gridTrackOn, hills, makeGridTrack, makeTrack } from './testing';

/** A 2D context that records the calls the marker drawing makes. */
function recordingContext() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(
        `${name}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`,
      );
    };
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    beginPath: record('beginPath'),
    arc: record('arc'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    fill: vi.fn(() => {
      calls.push(`fill ${ctx.fillStyle}`);
    }),
    stroke: vi.fn(() => {
      calls.push(`stroke ${ctx.strokeStyle} ${String(ctx.lineWidth)}`);
    }),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
  };
  return ctx;
}

beforeEach(() => {
  // jsdom has no 2D canvas: hand the textures a recording context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => recordingContext() as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HILLS = hills();

/** An out-and-back or loop over the hills, with a clear high point at index 3. */
const LOOP = gridTrackOn(
  HILLS,
  [
    [34.705, -83.99],
    [34.71, -83.985],
    [34.712, -83.975],
    [34.714, -83.972],
    [34.71, -83.97],
    [34.706, -83.98],
    [34.7051, -83.9899], // ~14 m from the start
  ],
  [500, 560, 700, 910, 640, 520, 501],
);

const POINT_TO_POINT = gridTrackOn(
  HILLS,
  [
    [34.705, -83.99],
    [34.71, -83.985],
    [34.714, -83.972],
    [34.712, -83.965],
  ],
  [500, 700, 950, 800],
);

/** Point `i` of a grid track. */
function at(track: { col: Float64Array; row: Float64Array }, i: number) {
  return { col: track.col[i] ?? NaN, row: track.row[i] ?? NaN };
}

describe('routeMarkerIndices', () => {
  it(`treats a route ending within ${String(LOOP_DISTANCE_M)} m of its start as a loop`, () => {
    expect(LOOP.loop).toBe(true);
    expect(routeMarkerIndices(LOOP, HILLS)).toEqual({ start: 0, finish: null, summit: 3 });
  });

  it("reads the track's loop flag and never measures the gap itself", () => {
    const route = (points: [number, number][], loop: boolean) =>
      makeGridTrack(HILLS, points, [500, 600, 500], loop);
    // Ends on the same grid node but flagged not a loop: a ◉ finish.
    const closed: [number, number][] = [
      [10, 40],
      [60, 20],
      [10, 40],
    ];
    expect(routeMarkerIndices(route(closed, false), HILLS).finish).toBe(2);
    // Ends 1.5 km apart but flagged a loop (as a baked scene may say): one ○.
    const open: [number, number][] = [
      [10, 40],
      [60, 20],
      [60, 40],
    ];
    expect(routeMarkerIndices(route(open, true), HILLS).finish).toBeNull();
  });

  it('agrees with the legend’s loop rule at 49.9 and 50.1 m, near the edges of a tall grid at 60° N', () => {
    // A grid 2° tall (≈ 220 km) at 58.5–60.5° N, spaced as buildHeightfield spaces it: its
    // metres per sample hold at the centre latitude only, ±3% at the north and south edges.
    const bounds = { west: 10, east: 11, south: 58.5, north: 60.5 };
    const nw = lonLatToWorld(bounds.west, bounds.north);
    const se = lonLatToWorld(bounds.east, bounds.south);
    const height = 240;
    const width = Math.round(1 + ((height - 1) * (se.x - nw.x)) / (se.y - nw.y));
    const centreLat = worldToLonLat(0, (nw.y + se.y) / 2).lat;
    const perWorld = 2 * Math.PI * MERCATOR_RADIUS_M * Math.cos((centreLat * Math.PI) / 180);
    const tall: Heightfield = {
      bounds,
      zoom: 8,
      width,
      height,
      elevations: new Float32Array(width * height).fill(300),
      min: 300,
      max: 300,
      metresPerSample: {
        x: ((se.x - nw.x) / (width - 1)) * perWorld,
        y: ((se.y - nw.y) / (height - 1)) * perWorld,
      },
      failedTiles: [],
    };
    const rad = Math.PI / 180;
    let gridDisagrees = 0;
    for (const lat of [60.45, 58.55]) {
      for (const gap of [49.9, 50.1]) {
        // The finish `gap` metres east of the start, or north of it.
        const east =
          (2 * Math.asin(Math.sin(gap / (2 * EARTH_RADIUS_M)) / Math.cos(lat * rad))) / rad;
        const north = gap / EARTH_RADIUS_M / rad;
        for (const [dLat, dLon] of [
          [0, east],
          [north, 0],
        ] as const) {
          const run = makeTrack(
            [
              [lat, 10.5],
              [lat - 0.01, 10.6],
              [lat + dLat, 10.5 + dLon],
            ],
            [500, 600, 500],
          );
          expect(haversine({ lat, lon: 10.5 }, { lat: lat + dLat, lon: 10.5 + dLon })).toBeCloseTo(
            gap,
            6,
          );
          expect(isLoop(run)).toBe(gap < LOOP_DISTANCE_M);
          const track = gridTrackFromRun(tall, run);
          const layer = createMarkerLayer(tall, track);
          // The terrain draws a ◉ finish exactly when the legend and the label say "not a loop".
          expect(layer.sprite('finish') === null).toBe(isLoop(run));
          layer.dispose();
          // Measured with the grid's centre spacing, the gap can land on the other side of 50 m.
          const onGrid = gridDistance(tall, at(track, 0), at(track, 2));
          if (onGrid <= LOOP_DISTANCE_M !== isLoop(run)) gridDisagrees += 1;
        }
      }
    }
    expect(gridDisagrees).toBeGreaterThan(0);
  });

  it('marks start and finish apart otherwise, and the summit at the highest elevation', () => {
    expect(routeMarkerIndices(POINT_TO_POINT, HILLS)).toEqual({ start: 0, finish: 3, summit: 2 });
  });

  it("uses the terrain's elevations when the file has none", () => {
    const hf = hills(); // the hill peaks at 70% across, 30% down
    const track = gridTrackOn(hf, [
      [34.705, -83.99],
      [34.714, -83.972], // near the peak
      [34.705, -83.965],
    ]);
    expect(routeMarkerIndices(track, hf).summit).toBe(1);
  });

  it('marks no summit on a flat route (high point under 10 m above the lowest)', () => {
    const flat = gridTrackOn(
      HILLS,
      [
        [34.705, -83.99],
        [34.71, -83.985],
        [34.714, -83.972],
        [34.712, -83.965],
      ],
      [0.4, 1.2, 0.9, 0.5],
    );
    expect(routeMarkerIndices(flat, HILLS).summit).toBeNull();
    const nine = gridTrackOn(
      HILLS,
      [
        [34.705, -83.99],
        [34.714, -83.972],
      ],
      [500, 509.9],
    );
    expect(routeMarkerIndices(nine, HILLS).summit).toBeNull();
    const ten = gridTrackOn(
      HILLS,
      [
        [34.705, -83.99],
        [34.714, -83.972],
      ],
      [500, 510],
    );
    expect(routeMarkerIndices(ten, HILLS).summit).toBe(1);
  });
});

describe('drawMarker', () => {
  const draw = (kind: TerrainMarkerKind) => {
    const ctx = recordingContext();
    drawMarker(ctx, kind, APP_ROUTE_PALETTE, markerBox(kind));
    return ctx.calls;
  };

  it('draws a different shape for each marker, never just a different colour', () => {
    const start = draw('start');
    const finish = draw('finish');
    const summit = draw('summit');
    const scrub = draw('scrub');
    // Start: one circle, white fill, ink ring.
    expect(start.filter((c) => c.startsWith('arc'))).toHaveLength(1);
    expect(start).toContain('fill #FFFFFF');
    expect(start).toContain('stroke #1B2A3A 3');
    // Finish: the start circle plus an ink dot.
    expect(finish.filter((c) => c.startsWith('arc'))).toHaveLength(2);
    expect(finish.at(-1)).toBe('fill #1B2A3A');
    // Summit: a triangle (no arcs), ink fill with a white edge.
    expect(summit.filter((c) => c.startsWith('arc'))).toHaveLength(0);
    expect(summit.filter((c) => c.startsWith('lineTo'))).toHaveLength(2);
    expect(summit.at(-1)).toBe('fill #1B2A3A');
    expect(summit.some((c) => c.startsWith('stroke #FFFFFF'))).toBe(true);
    // Scrub: ink hairline, white ring, route fill: three discs, route last.
    expect(scrub.filter((c) => c.startsWith('arc'))).toHaveLength(3);
    expect(scrub.filter((c) => c.startsWith('fill'))).toEqual([
      'fill #1B2A3A',
      'fill #FFFFFF',
      'fill #D9480F',
    ]);
  });
});

describe('markerExtent', () => {
  it('reaches as far as each drawn shape: ○ 22 px, ▲ 28 × 24 with its edge, ● 16 px', () => {
    expect(markerExtent('start')).toEqual({ left: 11, right: 11, up: 11, down: 11 });
    expect(markerExtent('finish')).toEqual(markerExtent('start'));
    // Centroid anchored: apex 16 px above it, base 8 px below, plus the 2.5 px white edge.
    expect(markerExtent('summit')).toEqual({ left: 16.5, right: 16.5, up: 18.5, down: 10.5 });
    expect(markerExtent('scrub')).toEqual({ left: 8, right: 8, up: 8, down: 8 });
    for (const kind of ['start', 'summit', 'scrub'] as const) {
      const e = markerExtent(kind);
      expect(Math.max(e.left, e.right, e.up, e.down)).toBeLessThanOrEqual(markerBox(kind) / 2);
    }
  });
});

describe('createMarkerLayer', () => {
  it('draws no ▲ for a flat route', () => {
    const flat = gridTrackOn(
      HILLS,
      [
        [34.705, -83.99],
        [34.714, -83.972],
        [34.712, -83.965],
      ],
      [1, 2, 1],
    );
    const layer = createMarkerLayer(hills(), flat, { exaggeration: 1 });
    expect(layer.indices.summit).toBeNull();
    expect(layer.sprite('summit')).toBeNull();
    expect(layer.fixedMarkers().map((m) => m.kind)).toEqual(['start', 'finish']);
    layer.dispose();
  });

  it('places start and summit on the terrain, one circle for a loop', () => {
    const hf = hills();
    const layer = createMarkerLayer(hf, LOOP, { exaggeration: 1 });
    expect(layer.sprite('finish')).toBeNull();
    const start = layer.sprite('start');
    const summit = layer.sprite('summit');
    // The first point, and the highest (index 3: -83.972, 34.714), on the terrain.
    expect(
      start?.position.distanceTo(gridToLocal(hf, at(LOOP, 0).col, at(LOOP, 0).row, 1, 2)),
    ).toBeLessThan(1e-9);
    expect(
      summit?.position.distanceTo(
        gridToLocal(hf, at(LOOP, 3).col, at(LOOP, 3).row, 1, DEFAULT_LIFT_M),
      ),
    ).toBeLessThan(1e-9);
    layer.dispose();
  });

  it('lists the fixed markers (not the scrub) with their positions at exaggeration 1', () => {
    const hf = hills();
    const layer = createMarkerLayer(hf, POINT_TO_POINT, { exaggeration: 2 });
    layer.setScrub(300);
    const fixed = layer.fixedMarkers();
    expect(fixed.map((m) => m.kind).sort()).toEqual(['finish', 'start', 'summit']);
    const start = fixed.find((m) => m.kind === 'start');
    expect(
      start?.position.distanceTo(
        gridToLocal(hf, at(POINT_TO_POINT, 0).col, at(POINT_TO_POINT, 0).row, 1, 2),
      ),
    ).toBeLessThan(1e-9);
    // A copy: the framing may scale it.
    start?.position.setY(99);
    expect(layer.sprite('start')?.position.y).not.toBe(99);
    layer.dispose();
  });

  it('adds a distinct finish marker when the route does not return to its start', () => {
    const layer = createMarkerLayer(hills(), POINT_TO_POINT);
    expect(layer.sprite('finish')).not.toBeNull();
    expect(layer.sprite('finish')?.material.map).not.toBe(layer.sprite('start')?.material.map);
    layer.dispose();
  });

  it('draws over the terrain and route, at a fixed screen size', () => {
    const layer = createMarkerLayer(hills(), LOOP);
    const camera = new PerspectiveCamera(30, 1060 / 700, 0.01, 100);
    layer.setViewport(700, camera.fov);
    for (const kind of ['start', 'summit', 'scrub'] as const) {
      const sprite = layer.sprite(kind);
      if (!sprite) throw new Error(kind);
      expect(sprite.material.depthTest).toBe(false);
      expect(sprite.material.sizeAttenuation).toBe(false);
      expect(sprite.renderOrder).toBeGreaterThan(2); // after the route's halo and core
      // Projected size in pixels: scale · P11 · height / 2.
      const p11 = camera.projectionMatrix.elements[5];
      expect((sprite.scale.y * p11 * 700) / 2).toBeCloseTo(markerBox(kind), 6);
    }
    layer.dispose();
  });

  it('follows the exaggeration', () => {
    const hf = hills();
    const layer = createMarkerLayer(hf, LOOP, { exaggeration: 1 });
    const y1 = layer.sprite('summit')?.position.y ?? 0;
    layer.setExaggeration(2.5);
    expect(layer.sprite('summit')?.position.y).toBeCloseTo(y1 * 2.5, 12);
    layer.dispose();
  });

  it('moves the scrub marker along the route by distance, without rebuilding', () => {
    const hf = hills();
    const layer = createMarkerLayer(hf, LOOP, { exaggeration: 1.6 });
    const scrub = layer.sprite('scrub');
    expect(scrub?.visible).toBe(false);
    const material = scrub?.material;
    const total = trackLength(LOOP);
    for (const fraction of [0, 0.13, 0.5, 0.91, 1]) {
      const d = total * fraction;
      layer.setScrub(d);
      const point = pointAtDistance(LOOP, d);
      const expected = gridToLocal(hf, point.col, point.row, 1.6, DEFAULT_LIFT_M);
      expect(scrub?.visible).toBe(true);
      expect(scrub?.position.distanceTo(expected)).toBeLessThan(1e-9);
    }
    // Halfway along the first segment is halfway between its ends (on the ground plane).
    const first = LOOP.cumulative[1] ?? 0;
    layer.setScrub(first / 2);
    const a = gridToLocal(hf, at(LOOP, 0).col, at(LOOP, 0).row);
    const b = gridToLocal(hf, at(LOOP, 1).col, at(LOOP, 1).row);
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
    // Linear in grid space, as the mesh is: exactly the midpoint.
    expect(scrub?.position.x).toBeCloseTo(mid.x, 9);
    expect(scrub?.position.z).toBeCloseTo(mid.z, 9);
    expect(layer.sprite('scrub')).toBe(scrub);
    expect(scrub?.material).toBe(material);
    layer.setScrub(null);
    expect(scrub?.visible).toBe(false);
    layer.dispose();
  });

  it('repaints for a new palette', () => {
    const layer = createMarkerLayer(hills(), LOOP);
    const texture = layer.sprite('start')?.material.map;
    const version = texture?.version ?? 0;
    layer.setPalette({ route: '#FFD9A0', halo: '#0F2233', ink: '#E8F1F5' });
    expect(texture?.version).toBeGreaterThan(version);
    layer.dispose();
  });

  it('repaints its textures at a larger scale without changing the sprite sizes', () => {
    const layer = createMarkerLayer(hills(), LOOP);
    layer.setViewport(600, 30);
    const sprite = layer.sprite('summit');
    const texture = sprite?.material.map;
    const image = texture?.image as HTMLCanvasElement | undefined;
    const before = image?.width ?? 0;
    const size = sprite?.scale.x;
    const version = texture?.version ?? 0;
    const dispose = texture ? vi.spyOn(texture, 'dispose') : null;
    layer.setTextureScale(markerTextureScale(7.5));
    expect(image?.width).toBe(Math.ceil(markerBox('summit') * 8));
    expect(image?.width).toBeGreaterThan(before);
    expect(texture?.version).toBeGreaterThan(version);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(sprite?.scale.x).toBe(size);
    // Same scale again: nothing to repaint.
    layer.setTextureScale(8);
    expect(dispose).toHaveBeenCalledTimes(1);
    layer.dispose();
  });

  it('frees every material and texture', () => {
    const layer = createMarkerLayer(hills(), POINT_TO_POINT);
    const spies = (['start', 'finish', 'summit', 'scrub'] as const).flatMap((kind) => {
      const sprite = layer.sprite(kind);
      if (!sprite?.material.map) throw new Error(kind);
      return [vi.spyOn(sprite.material, 'dispose'), vi.spyOn(sprite.material.map, 'dispose')];
    });
    expect(spies).toHaveLength(8);
    layer.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(layer.group.children.length).toBeGreaterThan(0); // sprites stay; their GPU data is gone
  });
});

describe('markerTextureScale', () => {
  it('is at least 4 and at least the drawing scale, in whole steps', () => {
    expect(markerTextureScale(1)).toBe(TEXTURE_SCALE);
    expect(markerTextureScale(2)).toBe(4);
    expect(markerTextureScale(4)).toBe(4);
    expect(markerTextureScale(4.2)).toBe(5);
    expect(markerTextureScale(7.5)).toBe(8);
    expect(markerTextureScale(100)).toBe(MAX_TEXTURE_SCALE);
    expect(markerTextureScale(Number.NaN)).toBe(TEXTURE_SCALE);
  });
});

describe('isOccluded', () => {
  // The fixture's hill peaks at 70% across and 30% down (north of centre); 600 m high.
  const hf = hills();
  const { width, depth } = modelBounds(hf, 1);
  const local = (fx: number, fz: number) => new Vector3((fx - 0.5) * width, 0, (fz - 0.5) * depth);

  it('hides a point in the lee of the hill from a low camera on the other side', () => {
    const behind = local(0.7, 0.05); // north of the peak, low ground
    behind.y = gridToLocal(hf, ...gridAt(0.7, 0.05), 1, 2).y;
    const eye = new Vector3(behind.x, 0.12, 2); // far south, low
    expect(isOccluded(hf, behind, eye, 1)).toBe(true);
    // From straight above (nearly), nothing is in the way.
    expect(isOccluded(hf, behind, new Vector3(behind.x, 3, behind.z + 0.01), 1)).toBe(false);
  });

  it('never hides a point on the summit', () => {
    const summit = gridToLocal(hf, ...gridAt(0.7, 0.3), 1, 2);
    expect(isOccluded(hf, summit, new Vector3(0, 0.2, 2), 1)).toBe(false);
    expect(isOccluded(hf, summit, new Vector3(-2, 0.1, -1), 1)).toBe(false);
  });

  it('fades a hidden marker in the layer', () => {
    const track = makeGridTrack(hf, [gridAt(0.7, 0.05), gridAt(0.7, 0.3), gridAt(0.3, 0.8)]);
    const layer = createMarkerLayer(hf, track);
    const start = layer.sprite('start');
    const eye = new Vector3(start?.position.x ?? 0, 0.12, 2);
    expect(layer.updateOcclusion(eye)).toBe(true);
    expect(start?.material.opacity).toBe(OCCLUDED_OPACITY);
    expect(layer.sprite('summit')?.material.opacity).toBe(1);
    expect(layer.updateOcclusion(eye)).toBe(false); // nothing changed
    layer.updateOcclusion(new Vector3(0, 4, 0.01));
    expect(start?.material.opacity).toBe(1);
    layer.dispose();
  });

  /** Column and row at fractions across (west → east) and down (north → south) the grid. */
  function gridAt(fx: number, fz: number): [number, number] {
    return [fx * (hf.width - 1), fz * (hf.height - 1)];
  }
});
