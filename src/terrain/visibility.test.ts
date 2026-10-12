import {
  DataTexture,
  DepthTexture,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  ShaderMaterial,
  WebGLRenderTarget,
  type Scene,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CLEANUP_PASSES,
  CLEANUP_SHADER,
  DEPTH_TEST_SHADER,
  ROUTE_MIN_GAP_PX,
  ROUTE_MIN_RUN_PX,
  VISIBILITY_ROW,
  createRouteVisibility,
} from './visibility';

/** A fake renderer that records each pass: its target and the material's uniforms then. */
function recorder() {
  const passes: { target: unknown; shader: string; uniforms: Record<string, unknown> }[] = [];
  let target: unknown = null;
  const renderer = {
    setRenderTarget: vi.fn((value: unknown) => {
      target = value;
    }),
    render: vi.fn((scene: Scene) => {
      const quad = scene.children[0];
      if (!(quad instanceof Mesh) || !(quad.material instanceof ShaderMaterial)) {
        throw new Error('no pass quad');
      }
      const uniforms: Record<string, unknown> = {};
      for (const [name, uniform] of Object.entries(quad.material.uniforms)) {
        uniforms[name] = uniform.value;
      }
      passes.push({ target, shader: quad.material.fragmentShader, uniforms });
    }),
  };
  return { renderer, passes, target: () => target };
}

describe('createRouteVisibility', () => {
  it(`lays the points out ${String(VISIBILITY_ROW)} to a row`, () => {
    const count = VISIBILITY_ROW + 5;
    const positions = new Float32Array(count * 3).map((_, i) => i);
    const visibility = createRouteVisibility(positions);
    const { renderer, passes } = recorder();
    visibility.update({
      renderer,
      depth: new DepthTexture(4, 4),
      camera: new PerspectiveCamera(),
      model: new Matrix4(),
      exaggeration: 1.6,
      bufferWidth: 200,
      bufferHeight: 100,
      pixelRatio: 2,
      tolerancePx: 16,
    });
    const points = passes[0]?.uniforms.uPositions;
    if (!(points instanceof DataTexture)) throw new Error('no point texture');
    expect([points.image.width, points.image.height]).toEqual([VISIBILITY_ROW, 2]);
    const data = points.image.data as Float32Array;
    // Point VISIBILITY_ROW + 1 starts the second row: texel (1, 1).
    const k = VISIBILITY_ROW + 1;
    expect(Array.from(data.slice(k * 4, k * 4 + 4))).toEqual([k * 3, k * 3 + 1, k * 3 + 2, 1]);
    expect(passes[0]?.uniforms.uCount).toBe(count);
    expect((visibility.texture.image as { height: number }).height).toBe(2);
    visibility.dispose();
  });

  it('tests every point against the depth, then fills short gaps and drops short runs', () => {
    const visibility = createRouteVisibility(new Float32Array(30));
    const { renderer, passes, target } = recorder();
    const camera = new PerspectiveCamera(30, 2, 0.1, 10);
    camera.position.set(0, 1, 3);
    camera.updateMatrixWorld();
    const depth = new DepthTexture(200, 100);
    visibility.update({
      renderer,
      depth,
      camera,
      model: new Matrix4(),
      exaggeration: 2,
      bufferWidth: 200,
      bufferHeight: 100,
      pixelRatio: 2,
      tolerancePx: 16,
    });
    expect(passes).toHaveLength(1 + CLEANUP_PASSES.length);
    const [test, ...cleanup] = passes;
    expect(test?.shader).toBe(DEPTH_TEST_SHADER);
    expect(test?.uniforms.uDepth).toBe(depth);
    expect(test?.uniforms.uExaggeration).toBe(2);
    // Screen distances in CSS px.
    expect((test?.uniforms.uViewport as { toArray(): number[] }).toArray()).toEqual([100, 50]);
    // 16 px of depth at distance d: 2 · 16 · d / (P11 · 50 CSS px), as a fraction of d.
    const p11 = camera.projectionMatrix.elements[5];
    expect(test?.uniforms.uTolerance).toBeCloseTo((2 * 16) / (p11 * 50), 9);
    expect(
      (test?.uniforms.uViewProjection as Matrix4).equals(
        camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse),
      ),
    ).toBe(true);
    // Closing (grow, shrink by half the gap), then opening (shrink, grow by half the run).
    expect(cleanup.map((pass) => [pass.uniforms.uRadius, pass.uniforms.uGrow])).toEqual([
      [ROUTE_MIN_GAP_PX / 2, 1],
      [ROUTE_MIN_GAP_PX / 2, 0],
      [ROUTE_MIN_RUN_PX / 2, 0],
      [ROUTE_MIN_RUN_PX / 2, 1],
    ]);
    for (const pass of cleanup) expect(pass.shader).toBe(CLEANUP_SHADER);
    // Each pass reads the previous one's output; the last lands in the result texture.
    expect(test?.target).toBeInstanceOf(WebGLRenderTarget);
    const targets = passes.map((pass) => pass.target as WebGLRenderTarget);
    for (const [i, pass] of cleanup.entries()) {
      expect(pass.uniforms.uSource).toBe(targets[i]?.texture);
      expect(pass.target).not.toBe(targets[i]);
    }
    expect(targets.at(-1)?.texture).toBe(visibility.texture);
    expect(target()).toBeNull();
    visibility.dispose();
  });

  it('frees its textures, targets and materials', () => {
    const visibility = createRouteVisibility(new Float32Array(30));
    const { renderer, passes } = recorder();
    visibility.update({
      renderer,
      depth: new DepthTexture(4, 4),
      camera: new PerspectiveCamera(),
      model: new Matrix4(),
      exaggeration: 1,
      bufferWidth: 4,
      bufferHeight: 4,
      pixelRatio: 1,
      tolerancePx: 16,
    });
    const points = passes[0]?.uniforms.uPositions as DataTexture;
    const spies = [
      vi.spyOn(points, 'dispose'),
      ...new Set(passes.map((pass) => pass.target as WebGLRenderTarget)),
    ].map((item) => (item instanceof WebGLRenderTarget ? vi.spyOn(item, 'dispose') : item));
    visibility.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
