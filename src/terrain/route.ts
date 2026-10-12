/**
 * The route on the terrain (DECISIONS.md "Terrain look", style A): a 4 px `--route` line over a
 * 9 px white halo, draped on the surface.
 *
 * Geometry: the track is resampled evenly by distance (about every {@link ROUTE_STEP_M} m, at most
 * {@link MAX_ROUTE_POINTS} points) and each sample takes the terrain's own height
 * (`elevationAt`, not the GPX elevation, which is offset from the DEM by GPS and barometer error)
 * plus a small lift. Positions are stored at exaggeration 1; the vertex shader multiplies y by the
 * shared `uExaggeration`, so the slider never rebuilds the line.
 *
 * Three `Line2` objects share one `LineGeometry`: the halo (9 px) and the core (4 px) where the
 * route is in sight, and a thinner line (2 px, no halo; the route colour a shade darker, at 85%)
 * where the terrain hides it, so a route that runs behind a ridge still reads as one line and the
 * hidden stretches differ by width and the missing halo, not by colour. It keeps ≥ 3:1 against the
 * terrain fill (WCAG 1.4.11), so a colour-weak viewer still sees it. Widths are CSS pixels whatever the zoom
 * (`worldUnits: false`) times the layer's line scale ({@link RouteLayer.setLineScale}: 1 in the
 * View, output px per logical px in a poster figure).
 *
 * Visibility: a ridge in front of the route hides it, as it should in a 3D view, but the decision
 * is made once per route point, not per fragment. A screen-space ribbon has the depth of its centre
 * line, so a plain depth test lets the terrain bite into the halo wherever a slope is seen side-on
 * (the terrain under the ribbon's edge is nearer than its centre) and leaves thin slivers just
 * behind crests. Instead the stage renders the terrain's depth into a texture first, and
 * {@link RouteLayer.updateVisibility} decides, on the GPU, which points it hides (visibility.ts:
 * terrain more than {@link ROUTE_OCCLUSION_TOLERANCE_PX} pixels' worth of depth in front of the
 * point, then tiny gaps filled and tiny pieces dropped along the route). The route draws with no
 * depth test: a segment between two shown points draws whole, one between two hidden points not
 * at all, and a mixed one up to its middle from the shown end (the core stops 2.5 px short of the
 * halo, so the halo closes around it). Caps take their point's verdict. The core draws after the
 * halo (render order); both read the same verdicts, so the core never shows without its halo. The
 * hidden line takes the opposite verdicts (whole between two hidden points, from the hidden end to
 * the middle of a mixed segment), so the two styles meet end to end and, since the clean-up keeps
 * every hidden and every shown run whole, neither leaves slivers. It is drawn before the halo,
 * blended, and each pixel once (one constant fragment depth nearer than the terrain, depth test
 * `less`), so its round joints never darken where they overlap.
 */
import {
  Color,
  CustomBlending,
  Group,
  LessDepth,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SRGBColorSpace,
  SrcAlphaFactor,
  Vector2,
  type Camera,
  type Texture,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { RunTrack } from '../page/types';
import type { Heightfield } from './heightfield';
import { heightfieldToLocal } from './mesh';
import {
  VISIBILITY_ROW,
  createRouteVisibility,
  type RouteVisibility,
  type VisibilityRenderer,
} from './visibility';

/** Colours of the route and its markers, CSS colour strings. */
export interface RoutePalette {
  /** Route core, scrub marker fill. */
  readonly route: string;
  /** Halo, start fill, summit edge, scrub ring. */
  readonly halo: string;
  /** Start ring, summit fill. */
  readonly ink: string;
}

/** The app's tokens for the route, and their tokens.css values. */
export const ROUTE_TOKENS = { route: '--route', halo: '--white', ink: '--ink' } as const;
export const APP_ROUTE_PALETTE: RoutePalette = {
  route: '#D9480F',
  halo: '#FFFFFF',
  ink: '#1B2A3A',
};

/** Reads a route palette from CSS custom properties; missing tokens fall back to `fallback`. */
export function readRoutePalette(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
  fallback: RoutePalette = APP_ROUTE_PALETTE,
): RoutePalette {
  const read = (name: string, otherwise: string) =>
    style.getPropertyValue(name).trim() || otherwise;
  return {
    route: read(ROUTE_TOKENS.route, fallback.route),
    halo: read(ROUTE_TOKENS.halo, fallback.halo),
    ink: read(ROUTE_TOKENS.ink, fallback.ink),
  };
}

/** Target spacing of the resampled route, metres. */
export const ROUTE_STEP_M = 10;
/** Most points in the drawn route; longer routes are resampled more coarsely. */
export const MAX_ROUTE_POINTS = 4000;
/** How far the route floats above the surface, true metres (exaggerated with the terrain). */
export const DEFAULT_LIFT_M = 2;
/** Route core and halo widths, CSS px (DESIGN-SPEC §4, style A). */
export const ROUTE_WIDTH_PX = 4;
export const HALO_WIDTH_PX = 9;
/** Where the terrain hides the route: a thinner line with no halo, CSS px. */
export const HIDDEN_ROUTE_WIDTH_PX = 2;
/**
 * The hidden line is the route colour mixed this far towards the ink, drawn at
 * {@link HIDDEN_ROUTE_OPACITY}: on the terrain fill (`#E6EAEE`) 3.5:1 in the View (`--route`) and
 * 4.0:1 on poster A (its accent), against 1.7–1.8:1 for the route colour at 40% (DECISIONS.md
 * "Terrain look").
 */
export const HIDDEN_ROUTE_INK_MIX = 0.15;
export const HIDDEN_ROUTE_OPACITY = 0.85;

/** The hidden line's colour for `palette`: the route a shade towards the ink (in sRGB), CSS hex. */
export function hiddenRouteColour(palette: Pick<RoutePalette, 'route' | 'ink'>): string {
  const route = new Color(palette.route).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  const ink = new Color(palette.ink).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  const k = HIDDEN_ROUTE_INK_MIX;
  const mix = (a: number, b: number) => a + (b - a) * k;
  const colour = new Color().setRGB(
    mix(route.r, ink.r),
    mix(route.g, ink.g),
    mix(route.b, ink.b),
    SRGBColorSpace,
  );
  return `#${colour.getHexString(SRGBColorSpace)}`;
}
/**
 * How far in front of a route point terrain must be to hide it, in pixels' worth of depth at the
 * point's distance (the line is a chord between samples and the depth texture is sampled at one
 * pixel, so it needs some slack).
 */
export const ROUTE_OCCLUSION_TOLERANCE_PX = 16;
/** Where a segment is cut, how much shorter the core is than the halo, CSS px. */
export const CORE_CUT_INSET_PX = (HALO_WIDTH_PX - ROUTE_WIDTH_PX) / 2;

/** The route's line widths and cut inset at a line scale, in the units of the lines' resolution. */
export interface RouteLineWidths {
  readonly halo: number;
  readonly core: number;
  readonly hidden: number;
  readonly coreInset: number;
}

/**
 * The widths for `scale` (1 in the View, where the resolution is the canvas in CSS px; output px
 * per logical px in a poster figure, where the resolution is the drawn canvas in output px, as
 * `Line2` sets it before each draw from the renderer's viewport at pixel ratio 1).
 */
export function routeLineWidths(scale: number): RouteLineWidths {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return {
    halo: HALO_WIDTH_PX * s,
    core: ROUTE_WIDTH_PX * s,
    hidden: HIDDEN_ROUTE_WIDTH_PX * s,
    coreInset: CORE_CUT_INSET_PX * s,
  };
}

/** The parts of a track the route needs. */
export type RouteTrack = Pick<RunTrack, 'lat' | 'lon' | 'cumulative'>;

/** A lon/lat at a distance along the track, and the index of the segment it falls in. */
export interface TrackPoint {
  readonly lon: number;
  readonly lat: number;
  /** Index `i` of the segment from point `i` to `i + 1` (the last point for d ≥ the total). */
  readonly index: number;
}

/** Total length of a track, metres (0 when it has fewer than two points). */
export function trackLength(track: RouteTrack): number {
  return track.cumulative.length > 0 ? (track.cumulative[track.cumulative.length - 1] ?? 0) : 0;
}

/**
 * The lon/lat `d` metres along the track, interpolated linearly between the recorded points
 * (binary search, so it is cheap enough for every scrub event). `d` is clamped to the track.
 */
export function pointAtDistance(track: RouteTrack, d: number): TrackPoint {
  const { cumulative, lon, lat } = track;
  const n = cumulative.length;
  if (n === 0) throw new RangeError('The track has no points');
  const last = n - 1;
  if (!(d > (cumulative[0] ?? 0))) return { lon: lon[0] ?? 0, lat: lat[0] ?? 0, index: 0 };
  if (d >= (cumulative[last] ?? 0))
    return { lon: lon[last] ?? 0, lat: lat[last] ?? 0, index: last };
  // Largest i with cumulative[i] <= d.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] ?? 0) <= d) lo = mid;
    else hi = mid;
  }
  const d0 = cumulative[lo] ?? 0;
  const d1 = cumulative[hi] ?? d0;
  const t = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
  const mix = (a: Float64Array) => (a[lo] ?? 0) + ((a[hi] ?? 0) - (a[lo] ?? 0)) * t;
  return { lon: mix(lon), lat: mix(lat), index: lo };
}

/** The track resampled evenly by distance. */
export interface ResampledTrack {
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  /** Distance of each sample from the start, metres. */
  readonly distance: Float64Array;
}

/**
 * Samples the track at even distances, first and last points included: spacing at most `step`
 * metres, unless that would take more than `maxPoints` points, in which case it is
 * `length / (maxPoints − 1)`. A track of zero length gives its first point twice (a line needs
 * two); an empty track gives no samples.
 */
export function resampleTrack(
  track: RouteTrack,
  { step = ROUTE_STEP_M, maxPoints = MAX_ROUTE_POINTS }: { step?: number; maxPoints?: number } = {},
): ResampledTrack {
  const n = track.cumulative.length;
  if (n === 0) {
    return { lon: new Float64Array(0), lat: new Float64Array(0), distance: new Float64Array(0) };
  }
  const total = trackLength(track);
  const count = Math.max(2, Math.min(Math.max(2, maxPoints), Math.ceil(total / step) + 1));
  const lon = new Float64Array(count);
  const lat = new Float64Array(count);
  const distance = new Float64Array(count);
  const { cumulative } = track;
  // One forward walk over the recorded points: the samples are in order.
  let i = 0;
  for (let k = 0; k < count; k++) {
    const d = (total * k) / (count - 1);
    while (i < n - 2 && (cumulative[i + 1] ?? 0) <= d) i++;
    const d0 = cumulative[i] ?? 0;
    const d1 = cumulative[Math.min(i + 1, n - 1)] ?? d0;
    const t = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
    const j = Math.min(i + 1, n - 1);
    lon[k] = (track.lon[i] ?? 0) + ((track.lon[j] ?? 0) - (track.lon[i] ?? 0)) * t;
    lat[k] = (track.lat[i] ?? 0) + ((track.lat[j] ?? 0) - (track.lat[i] ?? 0)) * t;
    distance[k] = d;
  }
  return { lon, lat, distance };
}

/**
 * Local-frame positions (x, y, z per point; y at exaggeration 1) of the resampled track draped on
 * the heightfield: y is the terrain's elevation there plus `lift` metres.
 */
export function drapeTrack(
  heightfield: Heightfield,
  samples: ResampledTrack,
  lift = DEFAULT_LIFT_M,
): Float32Array {
  const count = samples.lon.length;
  const positions = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const p = heightfieldToLocal(heightfield, samples.lon[k] ?? 0, samples.lat[k] ?? 0, 1, lift);
    positions[k * 3] = p.x;
    positions[k * 3 + 1] = p.y;
    positions[k * 3 + 2] = p.z;
  }
  return positions;
}

/** Uniforms the route's two materials share. */
interface RouteUniforms {
  uExaggeration: { value: number };
  /** Per-point verdicts (visibility.ts), or null for none. */
  uRouteVisibility: { value: Texture | null };
  /** 1 while `uRouteVisibility` holds this frame's verdicts; 0 draws the route everywhere. */
  uRouteVisibilityOn: { value: number };
  /** The drawing buffer's size, device px. */
  uRouteBuffer: { value: Vector2 };
}

const START_LINE = 'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );';
const END_LINE = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );';
const UNIFORM_LINE = 'uniform float linewidth;';
const NDC_LINE = 'vec3 ndcEnd = clipEnd.xyz / clipEnd.w;';
const FRAGMENT_UNIFORM_LINE = 'uniform float opacity;';
const FRAGMENT_MAIN_LINE = 'float alpha = opacity;';
const FRAGMENT_VOID_MAIN = 'void main() {';

/** Varyings the vertex shader hands the fragment shader. */
const ROUTE_VARYINGS = [
  "// The segment's ends, NDC (after the near-plane trim), and its two points' verdicts.",
  'varying vec3 vRouteStart;',
  'varying vec3 vRouteEnd;',
  'varying vec2 vRouteShown;',
].join('\n');

/**
 * Patches LineMaterial's vertex shader: y scaled by `uExaggeration`, and the segment's centre line
 * (its ends in NDC) and its points' verdicts (instance i is the segment from point i to i + 1)
 * passed on to the fragment shader.
 */
export function patchRouteShader(source: string): string {
  if (
    !source.includes(START_LINE) ||
    !source.includes(END_LINE) ||
    !source.includes(UNIFORM_LINE) ||
    !source.includes(NDC_LINE)
  ) {
    throw new Error('LineMaterial shader changed: the route patch no longer applies');
  }
  return source
    .replace(
      UNIFORM_LINE,
      [
        UNIFORM_LINE,
        'uniform float uExaggeration;',
        'uniform highp sampler2D uRouteVisibility;',
        'uniform float uRouteVisibilityOn;',
        ROUTE_VARYINGS,
      ].join('\n'),
    )
    .replace(
      START_LINE,
      [
        'vec3 routeStart = instanceStart;',
        'routeStart.y *= uExaggeration;',
        'vec4 start = modelViewMatrix * vec4( routeStart, 1.0 );',
      ].join('\n'),
    )
    .replace(
      END_LINE,
      [
        'vec3 routeEnd = instanceEnd;',
        'routeEnd.y *= uExaggeration;',
        'vec4 end = modelViewMatrix * vec4( routeEnd, 1.0 );',
      ].join('\n'),
    )
    .replace(
      NDC_LINE,
      [
        NDC_LINE,
        'vRouteStart = ndcStart;',
        'vRouteEnd = ndcEnd;',
        'vRouteShown = vec2( 1.0 );',
        'if ( uRouteVisibilityOn > 0.5 ) {',
        `  ivec2 routeFrom = ivec2( gl_InstanceID % ${String(VISIBILITY_ROW)}, gl_InstanceID / ${String(VISIBILITY_ROW)} );`,
        `  ivec2 routeTo = ivec2( ( gl_InstanceID + 1 ) % ${String(VISIBILITY_ROW)}, ( gl_InstanceID + 1 ) / ${String(VISIBILITY_ROW)} );`,
        '  vRouteShown = vec2( texelFetch( uRouteVisibility, routeFrom, 0 ).r, texelFetch( uRouteVisibility, routeTo, 0 ).r );',
        '}',
      ].join('\n'),
    );
}

/**
 * Patches LineMaterial's fragment shader. A segment whose points are both shown draws whole, one
 * whose points are both hidden not at all. In a mixed one, every fragment finds the point of the
 * centre line it belongs to (its projection onto the segment, clamped to the ends, so the round
 * caps count as the end) and draws if that lies within half the segment of the shown end, less
 * `uRouteCutInset` CSS px (the core's, so the halo's flat end closes around it; caps at the shown
 * end always draw). All fragments of a cross-section reach the same verdict, in every line. The
 * hidden line (`uRouteHidden` 1) swaps shown and hidden, so it draws exactly the rest; with
 * `ROUTE_FLAT_DEPTH` defined it writes one constant depth (nearer than any terrain) from the
 * fragment shader, exactly the same value everywhere, so with depth test `less` each pixel draws
 * once. (A depth set per vertex picks up rounding in the perspective divide, and joints draw twice.)
 */
export function patchRouteFragmentShader(source: string): string {
  if (
    !source.includes(FRAGMENT_UNIFORM_LINE) ||
    !source.includes(FRAGMENT_MAIN_LINE) ||
    !source.includes(FRAGMENT_VOID_MAIN)
  ) {
    throw new Error('LineMaterial shader changed: the route patch no longer applies');
  }
  return source
    .replace(
      FRAGMENT_UNIFORM_LINE,
      [
        FRAGMENT_UNIFORM_LINE,
        'uniform vec2 resolution;',
        'uniform vec2 uRouteBuffer;',
        'uniform float uRouteCutInset;',
        'uniform float uRouteHidden;',
        ROUTE_VARYINGS,
      ].join('\n'),
    )
    .replace(
      FRAGMENT_MAIN_LINE,
      [
        '// The hidden line (uRouteHidden = 1) draws what the halo and core do not.',
        'vec2 routeShown = uRouteHidden > 0.5 ? vec2( 1.0 ) - vRouteShown : vRouteShown;',
        'if ( routeShown.x < 0.5 || routeShown.y < 0.5 ) {',
        '  if ( routeShown.x < 0.5 && routeShown.y < 0.5 ) discard;',
        '  vec2 routeA = ( vRouteStart.xy * 0.5 + 0.5 ) * uRouteBuffer;',
        '  vec2 routeAB = ( vRouteEnd.xy * 0.5 + 0.5 ) * uRouteBuffer - routeA;',
        '  float routeLength = length( routeAB );',
        '  float routeT = routeLength > 1e-3 ? clamp( dot( gl_FragCoord.xy - routeA, routeAB ) / ( routeLength * routeLength ), 0.0, 1.0 ) : 0.0;',
        '  // CSS px: from the shown end, and the half segment less the inset.',
        '  float routeScale = resolution.y / uRouteBuffer.y;',
        '  float routeFromShown = ( routeShown.x > 0.5 ? routeT : 1.0 - routeT ) * routeLength * routeScale;',
        '  float routeReach = max( 0.0, 0.5 * routeLength * routeScale - uRouteCutInset );',
        '  if ( routeFromShown > routeReach ) discard;',
        '}',
        '#ifdef ROUTE_FLAT_DEPTH',
        '  gl_FragDepth = 0.25;',
        '#endif',
        FRAGMENT_MAIN_LINE,
      ].join('\n'),
    );
}

function createRouteMaterial(
  color: string,
  linewidth: number,
  cutInset: number,
  uniforms: RouteUniforms,
  hidden = false,
) {
  const material = new LineMaterial({
    color,
    linewidth,
    worldUnits: false,
    // Visibility comes from the per-point verdicts (see above).
    depthTest: false,
    depthWrite: false,
  });
  if (hidden) {
    // Faded and blended, but drawn in the opaque pass by render order (before the halo, which
    // covers it where a hidden stretch passes under a shown one). The alpha channel adds up to
    // the terrain's 1, so the canvas stays opaque there.
    material.opacity = HIDDEN_ROUTE_OPACITY;
    material.blending = CustomBlending;
    material.blendSrc = SrcAlphaFactor;
    material.blendDst = OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = OneFactor;
    material.blendDstAlpha = OneMinusSrcAlphaFactor;
    // Each pixel once (see patchRouteFragmentShader): overlapping joints do not darken.
    material.depthTest = true;
    material.depthWrite = true;
    material.depthFunc = LessDepth;
    material.defines = { ...material.defines, ROUTE_FLAT_DEPTH: '' };
  }
  material.vertexShader = patchRouteShader(material.vertexShader);
  material.fragmentShader = patchRouteFragmentShader(material.fragmentShader);
  material.uniforms.uExaggeration = uniforms.uExaggeration;
  material.uniforms.uRouteVisibility = uniforms.uRouteVisibility;
  material.uniforms.uRouteVisibilityOn = uniforms.uRouteVisibilityOn;
  material.uniforms.uRouteBuffer = uniforms.uRouteBuffer;
  material.uniforms.uRouteCutInset = { value: cutInset };
  material.uniforms.uRouteHidden = { value: hidden ? 1 : 0 };
  return material;
}

export interface RouteLayerOptions {
  palette?: RoutePalette;
  exaggeration?: number;
  /** Metres above the surface. Default {@link DEFAULT_LIFT_M}. */
  lift?: number;
  step?: number;
  maxPoints?: number;
}

/** What {@link RouteLayer.updateVisibility} needs from the stage. */
export interface RouteVisibilityInput {
  readonly renderer: VisibilityRenderer;
  readonly depth: Texture;
  readonly camera: Camera;
  /** Drawing buffer size, device px. */
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  /** Device px per CSS px. */
  readonly pixelRatio: number;
}

export interface RouteLayer {
  /** Add to the scene; holds the halo and the core. */
  readonly group: Group;
  readonly halo: Line2;
  readonly core: Line2;
  /** The hidden line where the terrain hides the route. */
  readonly hidden: Line2;
  /** The draped samples (positions at exaggeration 1). */
  readonly samples: ResampledTrack;
  readonly positions: Float32Array;
  setExaggeration(exaggeration: number): void;
  setPalette(palette: RoutePalette): void;
  /**
   * Viewport size in the units line widths are in: CSS px in the View, output px in a figure
   * (`Line2` also takes it from the renderer's viewport before each draw).
   */
  setResolution(width: number, height: number): void;
  /** Multiplies every line width and the core's cut inset ({@link routeLineWidths}). */
  setLineScale(scale: number): void;
  /**
   * Decides which points the terrain hides for this frame (GPU passes, visibility.ts), from its
   * depth (a depth texture the size of the drawing buffer, rendered with the same camera just
   * before the route); null draws the route everywhere.
   */
  updateVisibility(frame: RouteVisibilityInput | null): void;
  dispose(): void;
}

/**
 * Draw order after the terrain (0): the hidden line, the halo, then the core. Markers come
 * later (see markers.ts).
 */
export const HIDDEN_RENDER_ORDER = 0.5;
export const HALO_RENDER_ORDER = 1;
export const CORE_RENDER_ORDER = 2;

/**
 * The route on `heightfield`: halo and core lines over the draped, resampled track, and the hidden
 * line where it is hidden.
 */
export function createRouteLayer(
  heightfield: Heightfield,
  track: RouteTrack,
  {
    palette = APP_ROUTE_PALETTE,
    exaggeration = 1,
    lift = DEFAULT_LIFT_M,
    step,
    maxPoints,
  }: RouteLayerOptions = {},
): RouteLayer {
  const samples = resampleTrack(track, { step, maxPoints });
  const positions = drapeTrack(heightfield, samples, lift);
  const geometry = new LineGeometry();
  if (positions.length >= 6) geometry.setPositions(positions);
  const uniforms: RouteUniforms = {
    uExaggeration: { value: exaggeration },
    uRouteVisibility: { value: null },
    uRouteVisibilityOn: { value: 0 },
    uRouteBuffer: { value: new Vector2(1, 1) },
  };
  const widths = routeLineWidths(1);
  const haloMaterial = createRouteMaterial(palette.halo, widths.halo, 0, uniforms);
  const coreMaterial = createRouteMaterial(palette.route, widths.core, widths.coreInset, uniforms);
  const hiddenMaterial = createRouteMaterial(
    hiddenRouteColour(palette),
    widths.hidden,
    0,
    uniforms,
    true,
  );
  let visibility: RouteVisibility | null = null;
  const halo = new Line2(geometry, haloMaterial);
  const core = new Line2(geometry, coreMaterial);
  const hidden = new Line2(geometry, hiddenMaterial);
  halo.name = 'route-halo';
  core.name = 'route';
  hidden.name = 'route-hidden';
  halo.renderOrder = HALO_RENDER_ORDER;
  core.renderOrder = CORE_RENDER_ORDER;
  hidden.renderOrder = HIDDEN_RENDER_ORDER;
  // The bounding volume is at exaggeration 1; the shader scales y.
  halo.frustumCulled = false;
  core.frustumCulled = false;
  hidden.frustumCulled = false;
  const group = new Group();
  group.name = 'route-layer';
  group.add(hidden, halo, core);
  // An empty geometry draws nothing.
  group.visible = positions.length >= 6;

  return {
    group,
    halo,
    core,
    hidden,
    samples,
    positions,
    setExaggeration(value) {
      uniforms.uExaggeration.value = value;
    },
    setPalette(next) {
      haloMaterial.color.set(next.halo);
      coreMaterial.color.set(next.route);
      hiddenMaterial.color.set(hiddenRouteColour(next));
    },
    setResolution(width, height) {
      haloMaterial.resolution.set(width, height);
      coreMaterial.resolution.set(width, height);
      hiddenMaterial.resolution.set(width, height);
    },
    setLineScale(scale) {
      const next = routeLineWidths(scale);
      haloMaterial.linewidth = next.halo;
      coreMaterial.linewidth = next.core;
      hiddenMaterial.linewidth = next.hidden;
      const inset = coreMaterial.uniforms.uRouteCutInset;
      if (inset) inset.value = next.coreInset;
    },
    updateVisibility(frame) {
      if (!frame || !group.visible) {
        uniforms.uRouteVisibilityOn.value = 0;
        return;
      }
      visibility ??= createRouteVisibility(positions);
      halo.updateMatrixWorld();
      visibility.update({
        ...frame,
        model: halo.matrixWorld,
        exaggeration: uniforms.uExaggeration.value,
        tolerancePx: ROUTE_OCCLUSION_TOLERANCE_PX,
      });
      uniforms.uRouteVisibility.value = visibility.texture;
      uniforms.uRouteBuffer.value.set(frame.bufferWidth, frame.bufferHeight);
      uniforms.uRouteVisibilityOn.value = 1;
    },
    dispose() {
      visibility?.dispose();
      visibility = null;
      group.removeFromParent();
      geometry.dispose();
      haloMaterial.dispose();
      coreMaterial.dispose();
      hiddenMaterial.dispose();
    },
  };
}
