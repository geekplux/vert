import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heightfieldToLocal, modelBounds } from './mesh';
import {
  LOOP_DISTANCE_M,
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
import { hills, makeTrack } from './testing';

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

/** An out-and-back or loop over the hills, with a clear high point at index 3. */
const LOOP = makeTrack(
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

const POINT_TO_POINT = makeTrack(
  [
    [34.705, -83.99],
    [34.71, -83.985],
    [34.714, -83.972],
    [34.712, -83.965],
  ],
  [500, 700, 950, 800],
);

describe('routeMarkerIndices', () => {
  it(`treats a route ending within ${String(LOOP_DISTANCE_M)} m of its start as a loop`, () => {
    expect(routeMarkerIndices(LOOP)).toEqual({ start: 0, finish: null, summit: 3 });
  });

  it('marks start and finish apart otherwise, and the summit at the highest elevation', () => {
    expect(routeMarkerIndices(POINT_TO_POINT)).toEqual({ start: 0, finish: 3, summit: 2 });
  });

  it("uses the terrain's elevations when the file has none", () => {
    const hf = hills(); // the hill peaks at 70% across, 30% down
    const track = makeTrack([
      [34.705, -83.99],
      [34.714, -83.972], // near the peak
      [34.705, -83.965],
    ]);
    expect(routeMarkerIndices(track, hf).summit).toBe(1);
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
  it('places start and summit on the terrain, one circle for a loop', () => {
    const hf = hills();
    const layer = createMarkerLayer(hf, LOOP, { exaggeration: 1 });
    expect(layer.sprite('finish')).toBeNull();
    const start = layer.sprite('start');
    const summit = layer.sprite('summit');
    expect(start?.position.distanceTo(heightfieldToLocal(hf, -83.99, 34.705, 1, 2))).toBeLessThan(
      1e-9,
    );
    expect(
      summit?.position.distanceTo(heightfieldToLocal(hf, -83.972, 34.714, 1, DEFAULT_LIFT_M)),
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
    expect(start?.position.distanceTo(heightfieldToLocal(hf, -83.99, 34.705, 1, 2))).toBeLessThan(
      1e-9,
    );
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
      const expected = heightfieldToLocal(hf, point.lon, point.lat, 1.6, DEFAULT_LIFT_M);
      expect(scrub?.visible).toBe(true);
      expect(scrub?.position.distanceTo(expected)).toBeLessThan(1e-9);
    }
    // Halfway along the first segment is halfway between its ends (on the ground plane).
    const first = LOOP.cumulative[1] ?? 0;
    layer.setScrub(first / 2);
    const a = heightfieldToLocal(hf, -83.99, 34.705);
    const b = heightfieldToLocal(hf, -83.985, 34.71);
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
    // (Linear in lon/lat, so a hair off the Mercator midpoint: millimetres.)
    expect(scrub?.position.x).toBeCloseTo(mid.x, 5);
    expect(scrub?.position.z).toBeCloseTo(mid.z, 5);
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
    behind.y = heightfieldToLocal(hf, ...lonLatAt(0.7, 0.05), 1, 2).y;
    const eye = new Vector3(behind.x, 0.12, 2); // far south, low
    expect(isOccluded(hf, behind, eye, 1)).toBe(true);
    // From straight above (nearly), nothing is in the way.
    expect(isOccluded(hf, behind, new Vector3(behind.x, 3, behind.z + 0.01), 1)).toBe(false);
  });

  it('never hides a point on the summit', () => {
    const summit = heightfieldToLocal(hf, ...lonLatAt(0.7, 0.3), 1, 2);
    expect(isOccluded(hf, summit, new Vector3(0, 0.2, 2), 1)).toBe(false);
    expect(isOccluded(hf, summit, new Vector3(-2, 0.1, -1), 1)).toBe(false);
  });

  it('fades a hidden marker in the layer', () => {
    const track = makeTrack([
      [lonLatAt(0.7, 0.05)[1], lonLatAt(0.7, 0.05)[0]],
      [lonLatAt(0.7, 0.3)[1], lonLatAt(0.7, 0.3)[0]],
      [lonLatAt(0.3, 0.8)[1], lonLatAt(0.3, 0.8)[0]],
    ]);
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

  /** Lon/lat at fractions across (west → east) and down (north → south) the fixture's bounds. */
  function lonLatAt(fx: number, fz: number): [number, number] {
    const { west, east, north, south } = hf.bounds;
    return [west + (east - west) * fx, north + (south - north) * fz];
  }
});
