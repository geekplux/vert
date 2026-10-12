/**
 * Which route vertices the terrain hides, decided once per frame on the GPU (route.ts draws the
 * line from the result).
 *
 * Deciding per fragment lets neighbouring pixels, and the halo and the core at the same spot,
 * disagree where the line grazes a crest; the result is stray dots and ragged stubs. Instead every
 * resampled route point gets one verdict, in a few draws into a tiny render target (one texel per
 * point, {@link VISIBILITY_ROW} to a row):
 *
 * 1. Each point is projected and compared with the terrain's depth texture at its pixel: hidden
 *    when the terrain is more than the tolerance (pixels' worth of depth at the point's distance)
 *    in front of it.
 * 2. The verdicts are cleaned up along the route, by screen distance: hidden gaps shorter than
 *    {@link ROUTE_MIN_GAP_PX} are filled (a closing: grow the shown runs by half that, then shrink
 *    them back) and shown runs shorter than {@link ROUTE_MIN_RUN_PX} are dropped (an opening:
 *    shrink by half, grow back). Each step is one pass that walks along the route from every point
 *    up to the radius, so nothing reads back to the CPU and the frame never waits on the GPU.
 *
 * The halo and the core read the same texture, so they always agree.
 */
import {
  DataTexture,
  FloatType,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** Texels per row of the per-point textures (rows are added for longer routes). */
export const VISIBILITY_ROW = 1024;
/** Shown runs of the route shorter than this, CSS px along the line, are hidden. */
export const ROUTE_MIN_RUN_PX = 4;
/** Hidden gaps in the route shorter than this, CSS px along the line, are drawn. */
export const ROUTE_MIN_GAP_PX = 3;
/** Most points a cleanup pass walks on each side (enough for 3 px at 0.05 px spacing). */
const MAX_REACH = 64;

/** The renderer calls the passes use. */
export type VisibilityRenderer = Pick<WebGLRenderer, 'render' | 'setRenderTarget'>;

/** Everything one frame's visibility depends on. */
export interface VisibilityFrame {
  readonly renderer: VisibilityRenderer;
  /** The terrain's depth, the size of the drawing buffer, rendered with `camera`. */
  readonly depth: Texture;
  readonly camera: Camera;
  /** The route's world matrix. */
  readonly model: Matrix4;
  readonly exaggeration: number;
  /** Drawing buffer size, device px. */
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  /** Device px per CSS px. */
  readonly pixelRatio: number;
  /** Pixels' worth of depth (CSS px) terrain must be in front of a point to hide it. */
  readonly tolerancePx: number;
}

export interface RouteVisibility {
  /** One texel per point (point i at (i mod row, i div row)): red 1 shown, 0 hidden. */
  readonly texture: Texture;
  update(frame: VisibilityFrame): void;
  dispose(): void;
}

const ROW = String(VISIBILITY_ROW);

const COMMON = /* glsl */ `
uniform highp sampler2D uPositions;
uniform mat4 uViewProjection;
uniform float uExaggeration;
uniform vec2 uViewport;
uniform int uCount;

ivec2 routeCell( int i ) { return ivec2( i % ${ROW}, i / ${ROW} ); }
int routeIndex() { ivec2 p = ivec2( gl_FragCoord.xy ); return p.y * ${ROW} + p.x; }
vec4 routeClip( int i ) {
  vec3 p = texelFetch( uPositions, routeCell( i ), 0 ).xyz;
  p.y *= uExaggeration;
  return uViewProjection * vec4( p, 1.0 );
}
// CSS px.
vec2 routeScreen( int i ) {
  vec4 c = routeClip( i );
  return ( c.xy / max( c.w, 1e-6 ) * 0.5 + 0.5 ) * uViewport;
}
`;

const VERTEX = /* glsl */ `
void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

/**
 * Step 1: one point against the terrain's depth. Depths compare as view distances: with
 * a = P[2][2], b = P[3][2], an NDC depth z lies b / (z + a) in front of the camera.
 */
export const DEPTH_TEST_SHADER = /* glsl */ `
${COMMON}
uniform highp sampler2D uDepth;
uniform vec2 uBuffer;
uniform vec2 uProjection;
uniform float uTolerance;

void main() {
  int i = routeIndex();
  float shown = 1.0;
  vec4 c = routeClip( min( i, uCount - 1 ) );
  if ( i < uCount && c.w > 0.0 ) {
    vec3 ndc = c.xyz / c.w;
    ivec2 texel = ivec2( clamp( ( ndc.xy * 0.5 + 0.5 ) * uBuffer, vec2( 0.0 ), uBuffer - 1.0 ) );
    float terrainZ = texelFetch( uDepth, texel, 0 ).r * 2.0 - 1.0;
    float pointDistance = uProjection.y / ( ndc.z + uProjection.x );
    float terrainDistance = uProjection.y / ( terrainZ + uProjection.x );
    shown = terrainDistance < pointDistance * ( 1.0 - uTolerance ) ? 0.0 : 1.0;
  }
  gl_FragColor = vec4( shown, 0.0, 0.0, 1.0 );
}
`;

/**
 * Step 2: grow (`uGrow` 1: shown if any point within `uRadius` CSS px along the route is) or shrink
 * (hidden if any is) the shown runs. The route's ends stop the walk.
 */
export const CLEANUP_SHADER = /* glsl */ `
${COMMON}
uniform highp sampler2D uSource;
uniform float uRadius;
uniform float uGrow;

float routeShown( int i ) { return texelFetch( uSource, routeCell( i ), 0 ).r; }

void main() {
  int i = routeIndex();
  if ( i >= uCount ) {
    gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
    return;
  }
  float shown = routeShown( i );
  vec2 here = routeScreen( i );
  for ( int side = -1; side <= 1; side += 2 ) {
    vec2 previous = here;
    float reach = 0.0;
    for ( int k = 1; k <= ${String(MAX_REACH)}; k ++ ) {
      int j = i + side * k;
      if ( j < 0 || j >= uCount ) break;
      vec2 next = routeScreen( j );
      reach += distance( previous, next );
      if ( reach > uRadius ) break;
      previous = next;
      float other = routeShown( j );
      shown = uGrow > 0.5 ? max( shown, other ) : min( shown, other );
    }
  }
  gl_FragColor = vec4( shown, 0.0, 0.0, 1.0 );
}
`;

/** The cleanup passes in order: [radius CSS px, grow]. */
export const CLEANUP_PASSES: readonly (readonly [number, boolean])[] = [
  [ROUTE_MIN_GAP_PX / 2, true],
  [ROUTE_MIN_GAP_PX / 2, false],
  [ROUTE_MIN_RUN_PX / 2, false],
  [ROUTE_MIN_RUN_PX / 2, true],
];

function pointTarget(rows: number) {
  return new WebGLRenderTarget(VISIBILITY_ROW, rows, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

/** The GPU passes for a route with these local positions (x, y, z per point, y at exaggeration 1). */
export function createRouteVisibility(positions: Float32Array): RouteVisibility {
  const count = Math.floor(positions.length / 3);
  const rows = Math.max(1, Math.ceil(count / VISIBILITY_ROW));
  const data = new Float32Array(VISIBILITY_ROW * rows * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = positions[i * 3] ?? 0;
    data[i * 4 + 1] = positions[i * 3 + 1] ?? 0;
    data[i * 4 + 2] = positions[i * 3 + 2] ?? 0;
    data[i * 4 + 3] = 1;
  }
  const pointTexture = new DataTexture(data, VISIBILITY_ROW, rows, RGBAFormat, FloatType);
  pointTexture.minFilter = NearestFilter;
  pointTexture.magFilter = NearestFilter;
  pointTexture.generateMipmaps = false;
  pointTexture.needsUpdate = true;

  const common = {
    uPositions: { value: pointTexture },
    uViewProjection: { value: new Matrix4() },
    uExaggeration: { value: 1 },
    uViewport: { value: new Vector2(1, 1) },
    uCount: { value: count },
  };
  const depthUniforms = {
    ...common,
    uDepth: { value: null as Texture | null },
    uBuffer: { value: new Vector2(1, 1) },
    uProjection: { value: new Vector2() },
    uTolerance: { value: 0 },
  };
  const cleanupUniforms = {
    ...common,
    uSource: { value: null as Texture | null },
    uRadius: { value: 0 },
    uGrow: { value: 0 },
  };
  const depthTest = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: DEPTH_TEST_SHADER,
    uniforms: depthUniforms,
    depthTest: false,
    depthWrite: false,
  });
  const cleanup = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: CLEANUP_SHADER,
    uniforms: cleanupUniforms,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), depthTest);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera();
  // Ping-pong: the result always ends in `result` (an even number of cleanup passes).
  const result = pointTarget(rows);
  const scratch = pointTarget(rows);

  return {
    texture: result.texture,
    update(frame) {
      const { renderer } = frame;
      const viewProjection = common.uViewProjection.value;
      viewProjection
        .multiplyMatrices(frame.camera.projectionMatrix, frame.camera.matrixWorldInverse)
        .multiply(frame.model);
      common.uExaggeration.value = frame.exaggeration;
      common.uViewport.value.set(
        frame.bufferWidth / frame.pixelRatio,
        frame.bufferHeight / frame.pixelRatio,
      );
      const p = frame.camera.projectionMatrix.elements;
      const u = depthUniforms;
      u.uDepth.value = frame.depth;
      u.uBuffer.value.set(frame.bufferWidth, frame.bufferHeight);
      u.uProjection.value.set(p[10], p[14]);
      // One pixel at view distance d spans 2d / (P11 · height) world units.
      u.uTolerance.value = (frame.tolerancePx * 2 * frame.pixelRatio) / (p[5] * frame.bufferHeight);
      quad.material = depthTest;
      renderer.setRenderTarget(result);
      renderer.render(scene, camera);
      quad.material = cleanup;
      let source = result;
      for (const [radius, grow] of CLEANUP_PASSES) {
        const target = source === result ? scratch : result;
        cleanupUniforms.uSource.value = source.texture;
        cleanupUniforms.uRadius.value = radius;
        cleanupUniforms.uGrow.value = grow ? 1 : 0;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        source = target;
      }
      renderer.setRenderTarget(null);
    },
    dispose() {
      pointTexture.dispose();
      depthTest.dispose();
      cleanup.dispose();
      quad.geometry.dispose();
      result.dispose();
      scratch.dispose();
    },
  };
}
