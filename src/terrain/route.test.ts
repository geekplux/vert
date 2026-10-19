import {
  CustomBlending,
  DepthTexture,
  LessDepth,
  OneFactor,
  PerspectiveCamera,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it, vi } from 'vitest';
import { TRAIL_SIGN_ROUTE_PALETTE } from '../poster/terrainFigure';
import { blend, contrast } from '../test/contrast';
import { gridDistance, gridElevation } from './grid';
import { gridToLocal, modelBounds } from './mesh';
import {
  APP_ROUTE_PALETTE,
  CORE_CUT_INSET_PX,
  CORE_RENDER_ORDER,
  DEFAULT_LIFT_M,
  HALO_RENDER_ORDER,
  HALO_WIDTH_PX,
  HIDDEN_RENDER_ORDER,
  HIDDEN_ROUTE_OPACITY,
  HIDDEN_ROUTE_WIDTH_PX,
  MAX_ROUTE_POINTS,
  ROUTE_STEP_M,
  ROUTE_WIDTH_PX,
  createRouteLayer,
  drapeTrack,
  hiddenRouteColour,
  patchRouteFragmentShader,
  patchRouteShader,
  pointAtDistance,
  readRoutePalette,
  resampleTrack,
  routeLineWidths,
  trackLength,
  type RoutePalette,
  type RouteTrack,
} from './route';
import { gridTrackOn, hills, makeGridTrack } from './testing';

/** A straight track across the heightfield, west to east, in `n` points, on its grid. */
function straight(n = 50): RouteTrack {
  const points: [number, number][] = Array.from({ length: n }, (_, k) => [
    34.71,
    -83.995 + (0.03 * k) / (n - 1),
  ]);
  return gridTrackOn(hills(), points);
}

describe('pointAtDistance', () => {
  const hf = hills();
  // Columns 10 → 30 along row 20, then down to row 40.
  const track = makeGridTrack(hf, [
    [10, 20],
    [30, 20],
    [30, 40],
  ]);
  const first = track.cumulative[1] ?? 0;
  const total = trackLength(track);

  it('interpolates between recorded points and reports the segment', () => {
    const half = pointAtDistance(track, first / 2);
    expect(half.col).toBeCloseTo(20, 9);
    expect(half.row).toBeCloseTo(20, 9);
    expect(half.index).toBe(0);
    const later = pointAtDistance(track, first + (total - first) / 4);
    expect(later.col).toBeCloseTo(30, 9);
    expect(later.row).toBeCloseTo(25, 9);
    expect(later.index).toBe(1);
  });

  it('clamps to the ends', () => {
    expect(pointAtDistance(track, -100)).toEqual({ col: 10, row: 20, index: 0 });
    expect(pointAtDistance(track, total + 100)).toEqual({ col: 30, row: 40, index: 2 });
    expect(pointAtDistance(track, Number.NaN).index).toBe(0);
  });
});

describe('resampleTrack', () => {
  it(`samples evenly, at most ${String(ROUTE_STEP_M)} m apart, ends included`, () => {
    const hf = hills();
    const track = makeGridTrack(
      hf,
      Array.from({ length: 7 }, (_, k): [number, number] => [10 + 15 * k, 40 + 2 * k]),
    );
    const total = trackLength(track);
    const samples = resampleTrack(track);
    const n = samples.col.length;
    expect(n).toBe(Math.ceil(total / ROUTE_STEP_M) + 1);
    expect(samples.col[0]).toBeCloseTo(track.col[0] ?? 0, 12);
    expect(samples.col[n - 1]).toBeCloseTo(track.col[6] ?? 0, 12);
    expect(samples.row[n - 1]).toBeCloseTo(track.row[6] ?? 0, 12);
    expect(samples.distance[n - 1]).toBeCloseTo(total, 6);
    for (let k = 1; k < n; k++) {
      const gap = gridDistance(
        hf,
        { col: samples.col[k - 1] ?? 0, row: samples.row[k - 1] ?? 0 },
        { col: samples.col[k] ?? 0, row: samples.row[k] ?? 0 },
      );
      expect(gap).toBeLessThanOrEqual(ROUTE_STEP_M + 1e-6);
      expect(gap).toBeGreaterThan(ROUTE_STEP_M * 0.9);
    }
  });

  it(`caps a long route at ${String(MAX_ROUTE_POINTS)} points`, () => {
    // ~112 km: 2,000 steps of 2 rows (56 m) each.
    const points: [number, number][] = Array.from({ length: 2000 }, (_, k) => [10, k * 2]);
    const track = makeGridTrack(hills(), points);
    expect(trackLength(track)).toBeGreaterThan(100_000);
    const samples = resampleTrack(track);
    expect(samples.col.length).toBe(MAX_ROUTE_POINTS);
    expect(samples.row.at(-1)).toBeCloseTo(points.at(-1)?.[1] ?? 0, 9);
    expect(resampleTrack(track, { maxPoints: 100 }).row.length).toBe(100);
  });

  it('follows corners and skips repeated points', () => {
    const track = makeGridTrack(hills(), [
      [10, 20],
      [10, 20],
      [20, 20],
      [20, 30],
    ]);
    const samples = resampleTrack(track);
    const corner = track.cumulative[2] ?? 0;
    samples.distance.forEach((d, k) => {
      const expected = pointAtDistance(track, d);
      expect(samples.col[k]).toBeCloseTo(expected.col, 9);
      expect(samples.row[k]).toBeCloseTo(expected.row, 9);
    });
    expect(samples.distance.some((d) => d > corner)).toBe(true);
  });

  it('samples a trimmed track (distances from the real start) from its first point, not 0', () => {
    // The drawn stretch of a run whose first 200 m are hidden: cumulative starts at 200.
    const hf = hills();
    const whole = makeGridTrack(
      hf,
      Array.from({ length: 7 }, (_, k): [number, number] => [10 + 15 * k, 40 + 2 * k]),
    );
    const trim = 200;
    const trimmed = { ...whole, cumulative: whole.cumulative.map((d) => d + trim) };
    const length = trackLength(whole);
    const samples = resampleTrack(trimmed);
    const reference = resampleTrack(whole);
    const n = samples.col.length;
    // As many samples as the stretch's own length needs, the first at its first point.
    expect(n).toBe(Math.ceil(length / ROUTE_STEP_M) + 1);
    expect(n).toBe(reference.col.length);
    expect(samples.distance[0]).toBe(trim);
    expect(samples.distance[n - 1]).toBeCloseTo(trim + length, 6);
    // The same positions as the untrimmed track, each sample distinct (no repeats of the first).
    for (let k = 0; k < n; k++) {
      expect(samples.col[k]).toBeCloseTo(reference.col[k] ?? 0, 9);
      expect(samples.row[k]).toBeCloseTo(reference.row[k] ?? 0, 9);
      expect(samples.distance[k]).toBeCloseTo((reference.distance[k] ?? 0) + trim, 6);
    }
    for (let k = 1; k < n; k++) {
      const gap = gridDistance(
        hf,
        { col: samples.col[k - 1] ?? 0, row: samples.row[k - 1] ?? 0 },
        { col: samples.col[k] ?? 0, row: samples.row[k] ?? 0 },
      );
      expect(gap).toBeGreaterThan(ROUTE_STEP_M * 0.9);
    }
  });

  it('gives two points for a zero-length track and none for an empty one', () => {
    const still = makeGridTrack(hills(), [[10, 20]]);
    expect(resampleTrack(still).col.length).toBe(2);
    expect(resampleTrack(makeGridTrack(hills(), [])).col.length).toBe(0);
  });
});

describe('drapeTrack', () => {
  it('puts every sample on the terrain (its elevation, not the GPX one) plus the lift', () => {
    const hf = hills();
    const samples = resampleTrack(straight());
    const positions = drapeTrack(hf, samples, 2);
    const { scale } = modelBounds(hf);
    for (let k = 0; k < samples.col.length; k += 17) {
      const col = samples.col[k] ?? 0;
      const row = samples.row[k] ?? 0;
      const expectedY = (gridElevation(hf, col, row) + 2 - hf.min) * scale;
      expect(positions[k * 3 + 1]).toBeCloseTo(expectedY, 6);
      const local = gridToLocal(hf, col, row);
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
    expect(patched).toContain(
      'vec2 routeShown = uRouteHidden > 0.5 ? vec2( 1.0 ) - vRouteShown : vRouteShown;',
    );
    expect(patched).toContain('if ( routeShown.x < 0.5 && routeShown.y < 0.5 ) discard;');
    // The fragment is projected onto the segment; the cut is measured from the shown end there.
    expect(patched).toContain('dot( gl_FragCoord.xy - routeA, routeAB )');
    expect(patched).toContain(
      'float routeReach = max( 0.0, 0.5 * routeLength * routeScale - uRouteCutInset );',
    );
    expect(patched).toContain('if ( routeFromShown > routeReach ) discard;');
    // The faded line's one constant depth, only where it is defined, after every discard.
    expect(patched).toContain('#ifdef ROUTE_FLAT_DEPTH\n  gl_FragDepth = 0.25;\n#endif');
    expect(patched.indexOf('gl_FragDepth')).toBeGreaterThan(
      patched.indexOf('routeFromShown > routeReach'),
    );
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
    expect(layer.group.children).toEqual([layer.hidden, halo, core]);
    layer.dispose();
  });

  it('draws hidden stretches as a thin line with no halo, ≥ 3:1 on the terrain, each pixel once', () => {
    const layer = createRouteLayer(hills(), straight());
    const { hidden, halo, core } = layer;
    expect(HIDDEN_ROUTE_WIDTH_PX).toBe(2);
    expect(HIDDEN_ROUTE_OPACITY).toBe(0.85);
    expect(hidden.material.linewidth).toBe(HIDDEN_ROUTE_WIDTH_PX);
    expect(hidden.material.opacity).toBe(HIDDEN_ROUTE_OPACITY);
    // Width and the missing halo set it apart, not colour: the route's colour, a shade darker.
    expect(`#${hidden.material.color.getHexString()}`).toBe('#bd4415');
    expect(hiddenRouteColour(APP_ROUTE_PALETTE)).toBe('#bd4415');
    // WCAG 1.4.11 (a graphic needs 3:1) against the terrain fill, as blended on the canvas, in the
    // View (--route) and on poster A (its accent): the route colour at 40% was 1.68:1 and 1.77:1.
    const onFill = (palette: RoutePalette) =>
      contrast(blend(hiddenRouteColour(palette), '#E6EAEE', HIDDEN_ROUTE_OPACITY), '#E6EAEE');
    expect(onFill(APP_ROUTE_PALETTE)).toBeGreaterThan(3.5);
    expect(onFill(TRAIL_SIGN_ROUTE_PALETTE)).toBeGreaterThanOrEqual(4);
    expect(contrast(blend('#D9480F', '#E6EAEE', 0.4), '#E6EAEE')).toBeLessThan(1.7);
    expect(hidden.geometry).toBe(core.geometry);
    // The opposite verdicts, drawn before the halo (which covers it where they cross).
    expect(hidden.material.uniforms.uRouteHidden?.value).toBe(1);
    expect(core.material.uniforms.uRouteHidden?.value).toBe(0);
    expect(halo.material.uniforms.uRouteHidden?.value).toBe(0);
    expect(hidden.renderOrder).toBe(HIDDEN_RENDER_ORDER);
    expect(hidden.renderOrder).toBeLessThan(halo.renderOrder);
    expect(hidden.renderOrder).toBeGreaterThan(0);
    // Blended in the opaque pass; one constant depth and `less`, so overlapping joints draw once.
    expect(hidden.material.transparent).toBe(false);
    expect(hidden.material.blending).toBe(CustomBlending);
    expect(hidden.material.blendSrcAlpha).toBe(OneFactor);
    expect(hidden.material.depthTest).toBe(true);
    expect(hidden.material.depthWrite).toBe(true);
    expect(hidden.material.depthFunc).toBe(LessDepth);
    expect(hidden.material.defines).toHaveProperty('ROUTE_FLAT_DEPTH');
    expect(core.material.defines).not.toHaveProperty('ROUTE_FLAT_DEPTH');
    // On a dark paper the ink is light, so the shade goes lighter: still apart from the paper.
    layer.setPalette({ route: '#FFD9A0', halo: '#0F2233', ink: '#E8F1F5' });
    expect(hidden.material.color.getHexString()).toBe('fcddad');
    layer.dispose();
  });

  it('scales every width and the core’s cut inset with the line scale', () => {
    expect(routeLineWidths(1)).toEqual({ halo: 9, core: 4, hidden: 2, coreInset: 2.5 });
    expect(routeLineWidths(7.5)).toEqual({ halo: 67.5, core: 30, hidden: 15, coreInset: 18.75 });
    expect(routeLineWidths(0)).toEqual(routeLineWidths(1));
    const layer = createRouteLayer(hills(), straight());
    layer.setLineScale(2);
    expect(layer.halo.material.linewidth).toBe(18);
    expect(layer.core.material.linewidth).toBe(8);
    expect(layer.hidden.material.linewidth).toBe(4);
    expect(layer.core.material.uniforms.uRouteCutInset?.value).toBe(5);
    expect(layer.halo.material.uniforms.uRouteCutInset?.value).toBe(0);
    layer.setLineScale(1);
    expect(layer.core.material.linewidth).toBe(ROUTE_WIDTH_PX);
    layer.dispose();
  });

  it('stores positions at exaggeration 1 and scales them with the shared uniform', () => {
    const hf = hills();
    const layer = createRouteLayer(hf, straight(), { exaggeration: 1.6 });
    const n = layer.samples.col.length;
    expect(layer.core.geometry.instanceCount).toBe(n - 1);
    expect(layer.halo.material.uniforms.uExaggeration?.value).toBe(1.6);
    layer.setExaggeration(2.5);
    expect(layer.halo.material.uniforms.uExaggeration?.value).toBe(2.5);
    expect(layer.core.material.uniforms.uExaggeration?.value).toBe(2.5);
    // The positions themselves are untouched (no rebuild), at the default 2 m lift.
    const k = Math.floor(n / 2);
    const expected = gridToLocal(
      hf,
      layer.samples.col[k] ?? 0,
      layer.samples.row[k] ?? 0,
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

  it('frees its geometry and its materials', () => {
    const layer = createRouteLayer(hills(), straight());
    const geometry = vi.spyOn(layer.core.geometry, 'dispose');
    const halo = vi.spyOn(layer.halo.material, 'dispose');
    const core = vi.spyOn(layer.core.material, 'dispose');
    const hidden = vi.spyOn(layer.hidden.material, 'dispose');
    layer.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(halo).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledTimes(1);
    expect(hidden).toHaveBeenCalledTimes(1);
  });
});

describe('readRoutePalette', () => {
  it('reads --route, --white and --ink, with fallbacks', () => {
    const values: Record<string, string> = { '--route': ' #d9480f ', '--ink': '#1b2a3a' };
    const palette = readRoutePalette({ getPropertyValue: (name) => values[name] ?? '' });
    expect(palette).toEqual({ route: '#d9480f', halo: '#FFFFFF', ink: '#1b2a3a' });
  });

  it('falls back to the app palette for every token a host lacks or leaves blank', () => {
    expect(readRoutePalette({ getPropertyValue: () => '' })).toEqual(APP_ROUTE_PALETTE);
    expect(readRoutePalette({ getPropertyValue: () => '  ' })).toEqual(APP_ROUTE_PALETTE);
  });
});
