import { DepthTexture, PerspectiveCamera, Vector2, WebGLRenderTarget } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it, vi } from 'vitest';
import { haversine } from '../lib/geo';
import { elevationAt } from './heightfield';
import { heightfieldToLocal, modelBounds } from './mesh';
import {
  CORE_CUT_INSET_PX,
  CORE_RENDER_ORDER,
  DEFAULT_LIFT_M,
  HALO_RENDER_ORDER,
  HALO_WIDTH_PX,
  MAX_ROUTE_POINTS,
  ROUTE_STEP_M,
  ROUTE_WIDTH_PX,
  createRouteLayer,
  drapeTrack,
  patchRouteFragmentShader,
  patchRouteShader,
  pointAtDistance,
  readRoutePalette,
  resampleTrack,
  trackLength,
  type RouteTrack,
} from './route';
import { hills, makeTrack } from './testing';

/** A straight track across the heightfield, west to east, in `n` points. */
function straight(n = 50): RouteTrack {
  const points: [number, number][] = Array.from({ length: n }, (_, k) => [
    34.71,
    -83.995 + (0.03 * k) / (n - 1),
  ]);
  return makeTrack(points);
}

describe('pointAtDistance', () => {
  const track = makeTrack([
    [34.71, -83.99],
    [34.71, -83.98],
    [34.715, -83.98],
  ]);
  const first = track.cumulative[1] ?? 0;
  const total = trackLength(track);

  it('interpolates between recorded points and reports the segment', () => {
    const half = pointAtDistance(track, first / 2);
    expect(half.lon).toBeCloseTo(-83.985, 9);
    expect(half.lat).toBeCloseTo(34.71, 9);
    expect(half.index).toBe(0);
    const later = pointAtDistance(track, first + (total - first) / 4);
    expect(later.lon).toBeCloseTo(-83.98, 9);
    expect(later.lat).toBeCloseTo(34.71125, 6);
    expect(later.index).toBe(1);
  });

  it('clamps to the ends', () => {
    expect(pointAtDistance(track, -100)).toEqual({ lon: -83.99, lat: 34.71, index: 0 });
    expect(pointAtDistance(track, total + 100)).toEqual({ lon: -83.98, lat: 34.715, index: 2 });
    expect(pointAtDistance(track, Number.NaN).index).toBe(0);
  });
});

describe('resampleTrack', () => {
  it(`samples evenly, at most ${String(ROUTE_STEP_M)} m apart, ends included`, () => {
    const track = straight(7);
    const total = trackLength(track);
    const samples = resampleTrack(track);
    const n = samples.lon.length;
    expect(n).toBe(Math.ceil(total / ROUTE_STEP_M) + 1);
    expect(samples.lon[0]).toBeCloseTo(track.lon[0] ?? 0, 12);
    expect(samples.lon[n - 1]).toBeCloseTo(track.lon[6] ?? 0, 12);
    expect(samples.distance[n - 1]).toBeCloseTo(total, 6);
    for (let k = 1; k < n; k++) {
      const gap = haversine(
        { lat: samples.lat[k - 1] ?? 0, lon: samples.lon[k - 1] ?? 0 },
        { lat: samples.lat[k] ?? 0, lon: samples.lon[k] ?? 0 },
      );
      expect(gap).toBeLessThanOrEqual(ROUTE_STEP_M + 1e-6);
      expect(gap).toBeGreaterThan(ROUTE_STEP_M * 0.9);
    }
  });

  it(`caps a long route at ${String(MAX_ROUTE_POINTS)} points`, () => {
    // ~110 km of latitude.
    const points: [number, number][] = Array.from({ length: 2000 }, (_, k) => [k * 0.0005, 10]);
    const track = makeTrack(points);
    expect(trackLength(track)).toBeGreaterThan(100_000);
    const samples = resampleTrack(track);
    expect(samples.lon.length).toBe(MAX_ROUTE_POINTS);
    expect(samples.lat.at(-1)).toBeCloseTo(points.at(-1)?.[0] ?? 0, 9);
    expect(resampleTrack(track, { maxPoints: 100 }).lat.length).toBe(100);
  });

  it('follows corners and skips repeated points', () => {
    const track = makeTrack([
      [34.71, -83.99],
      [34.71, -83.99],
      [34.71, -83.98],
      [34.72, -83.98],
    ]);
    const samples = resampleTrack(track);
    const corner = track.cumulative[2] ?? 0;
    samples.distance.forEach((d, k) => {
      const expected = pointAtDistance(track, d);
      expect(samples.lon[k]).toBeCloseTo(expected.lon, 9);
      expect(samples.lat[k]).toBeCloseTo(expected.lat, 9);
    });
    expect(samples.distance.some((d) => d > corner)).toBe(true);
  });

  it('gives two points for a zero-length track and none for an empty one', () => {
    const still = makeTrack([[34.71, -83.99]]);
    expect(resampleTrack(still).lon.length).toBe(2);
    expect(resampleTrack(makeTrack([])).lon.length).toBe(0);
  });
});

describe('drapeTrack', () => {
  it('puts every sample on the terrain (its elevation, not the GPX one) plus the lift', () => {
    const hf = hills();
    const samples = resampleTrack(straight());
    const positions = drapeTrack(hf, samples, 2);
    const { scale } = modelBounds(hf);
    for (let k = 0; k < samples.lon.length; k += 17) {
      const lon = samples.lon[k] ?? 0;
      const lat = samples.lat[k] ?? 0;
      const expectedY = (elevationAt(hf, lon, lat) + 2 - hf.min) * scale;
      expect(positions[k * 3 + 1]).toBeCloseTo(expectedY, 6);
      const local = heightfieldToLocal(hf, lon, lat);
      expect(positions[k * 3]).toBeCloseTo(local.x, 6);
      expect(positions[k * 3 + 2]).toBeCloseTo(local.z, 6);
    }
  });
});

describe('patchRouteShader', () => {
  it("patches three's LineMaterial: exaggeration on y, the centre line handed on", () => {
    const patched = patchRouteShader(new LineMaterial().vertexShader);
    expect(patched).toContain('uniform float uExaggeration;');
    expect(patched).toContain('routeStart.y *= uExaggeration;');
    expect(patched).toContain('routeEnd.y *= uExaggeration;');
    expect(patched).toContain('vRouteStart = ndcStart;');
    expect(patched).toContain('vRouteEnd = ndcEnd;');
    expect(patched).not.toContain('vec4( instanceStart, 1.0 )');
    // Segment i reads the verdicts of points i and i + 1.
    expect(patched).toContain('uniform highp sampler2D uRouteVisibility;');
    expect(patched).toContain('ivec2( gl_InstanceID % 1024, gl_InstanceID / 1024 )');
    expect(patched).toContain('( gl_InstanceID + 1 ) % 1024');
  });

  it("draws a segment from its points' verdicts, cut halfway between a shown and a hidden one", () => {
    const patched = patchRouteFragmentShader(new LineMaterial().fragmentShader);
    expect(patched).toContain('if ( vRouteShown.x < 0.5 && vRouteShown.y < 0.5 ) discard;');
    // The fragment is projected onto the segment; the cut is measured from the shown end there.
    expect(patched).toContain('dot( gl_FragCoord.xy - routeA, routeAB )');
    expect(patched).toContain(
      'float routeReach = max( 0.0, 0.5 * routeLength * routeScale - uRouteCutInset );',
    );
    expect(patched).toContain('if ( routeFromShown > routeReach ) discard;');
    expect(patched.indexOf('routeFromShown > routeReach')).toBeLessThan(
      patched.indexOf('float alpha = opacity;'),
    );
    expect(patched).not.toContain('uTerrainDepth');
  });

  it('fails loudly when the source no longer matches', () => {
    expect(() => patchRouteShader('void main() {}')).toThrow(/route patch/);
    expect(() => patchRouteFragmentShader('void main() {}')).toThrow(/route patch/);
  });
});

describe('createRouteLayer', () => {
  it('draws a 9 px halo under a 4 px core, in screen pixels, hidden per point', () => {
    const layer = createRouteLayer(hills(), straight(), { exaggeration: 1.6 });
    const { halo, core } = layer;
    expect(halo.material.linewidth).toBe(HALO_WIDTH_PX);
    expect(core.material.linewidth).toBe(ROUTE_WIDTH_PX);
    expect(HALO_WIDTH_PX).toBe(9);
    expect(ROUTE_WIDTH_PX).toBe(4);
    expect(halo.material.worldUnits).toBe(false);
    expect(core.material.worldUnits).toBe(false);
    // No per-fragment depth test: the whole width shows or hides (see route.ts).
    expect(halo.material.depthTest).toBe(false);
    expect(core.material.depthTest).toBe(false);
    expect(halo.material.depthWrite).toBe(false);
    expect(core.material.depthWrite).toBe(false);
    // The core stops short of the halo where a segment is cut, so the halo closes around it.
    expect(halo.material.uniforms.uRouteCutInset?.value).toBe(0);
    expect(core.material.uniforms.uRouteCutInset?.value).toBe(CORE_CUT_INSET_PX);
    expect(CORE_CUT_INSET_PX).toBe(2.5);
    expect(core.material.uniforms.uRouteVisibilityOn?.value).toBe(0);
    const targets: unknown[] = [];
    const renderer = {
      setRenderTarget: vi.fn((target: unknown) => targets.push(target)),
      render: vi.fn(),
    };
    const camera = new PerspectiveCamera();
    layer.updateVisibility({
      renderer,
      depth: new DepthTexture(4, 4),
      camera,
      bufferWidth: 8,
      bufferHeight: 4,
      pixelRatio: 2,
    });
    // One depth test and four cleanup passes, into the per-point targets, then back to the screen.
    expect(renderer.render).toHaveBeenCalledTimes(5);
    expect(targets).toHaveLength(6);
    expect(targets.at(-1)).toBeNull();
    for (const target of targets.slice(0, 5)) expect(target).toBeInstanceOf(WebGLRenderTarget);
    const result = targets[0] as WebGLRenderTarget;
    expect(targets[4]).toBe(result);
    for (const line of [halo, core]) {
      expect(line.material.uniforms.uRouteVisibility?.value).toBe(result.texture);
      expect(line.material.uniforms.uRouteVisibilityOn?.value).toBe(1);
      expect((line.material.uniforms.uRouteBuffer?.value as Vector2).toArray()).toEqual([8, 4]);
    }
    layer.updateVisibility(null);
    expect(halo.material.uniforms.uRouteVisibilityOn?.value).toBe(0);
    expect(halo.renderOrder).toBe(HALO_RENDER_ORDER);
    expect(core.renderOrder).toBe(CORE_RENDER_ORDER);
    expect(core.renderOrder).toBeGreaterThan(halo.renderOrder);
    expect(halo.geometry).toBe(core.geometry);
    expect(`#${halo.material.color.getHexString()}`).toBe('#ffffff');
    expect(`#${core.material.color.getHexString()}`).toBe('#d9480f');
    expect(layer.group.children).toEqual([halo, core]);
    layer.dispose();
  });

  it('stores positions at exaggeration 1 and scales them with the shared uniform', () => {
    const hf = hills();
    const layer = createRouteLayer(hf, straight(), { exaggeration: 1.6 });
    const n = layer.samples.lon.length;
    expect(layer.core.geometry.instanceCount).toBe(n - 1);
    expect(layer.halo.material.uniforms.uExaggeration?.value).toBe(1.6);
    layer.setExaggeration(2.5);
    expect(layer.halo.material.uniforms.uExaggeration?.value).toBe(2.5);
    expect(layer.core.material.uniforms.uExaggeration?.value).toBe(2.5);
    // The positions themselves are untouched (no rebuild), at the default 2 m lift.
    const k = Math.floor(n / 2);
    const expected = heightfieldToLocal(
      hf,
      layer.samples.lon[k] ?? 0,
      layer.samples.lat[k] ?? 0,
      1,
      DEFAULT_LIFT_M,
    );
    expect(layer.positions[k * 3 + 1]).toBeCloseTo(expected.y, 6);
    layer.dispose();
  });

  it('respects the point cap', () => {
    const layer = createRouteLayer(hills(), straight(), { maxPoints: 64 });
    expect(layer.core.geometry.instanceCount).toBe(63);
    layer.dispose();
  });

  it('swaps colours for a poster palette and takes the viewport size', () => {
    const layer = createRouteLayer(hills(), straight());
    layer.setPalette({ route: '#FFD9A0', halo: '#0F2233', ink: '#E8F1F5' });
    expect(layer.core.material.color.getHexString()).toBe('ffd9a0');
    expect(layer.halo.material.color.getHexString()).toBe('0f2233');
    layer.setResolution(1060, 700);
    expect(layer.core.material.resolution.toArray()).toEqual([1060, 700]);
    layer.dispose();
  });

  it('frees its geometry and both materials', () => {
    const layer = createRouteLayer(hills(), straight());
    const geometry = vi.spyOn(layer.core.geometry, 'dispose');
    const halo = vi.spyOn(layer.halo.material, 'dispose');
    const core = vi.spyOn(layer.core.material, 'dispose');
    layer.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(halo).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
  });
});

describe('readRoutePalette', () => {
  it('reads --route, --white and --ink, with fallbacks', () => {
    const values: Record<string, string> = { '--route': ' #d9480f ', '--ink': '#1b2a3a' };
    const palette = readRoutePalette({ getPropertyValue: (name) => values[name] ?? '' });
    expect(palette).toEqual({ route: '#d9480f', halo: '#FFFFFF', ink: '#1b2a3a' });
  });
});
