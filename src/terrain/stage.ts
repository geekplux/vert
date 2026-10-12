/**
 * The imperative half of TerrainView: one renderer, one camera, OrbitControls, the terrain mesh and
 * a render loop that only runs while something moves (a drag, damping, a camera tween). Idle, it
 * schedules nothing.
 *
 * Camera: spherical coordinates around a pivot on the model's vertical axis. `phi` is the polar
 * angle from straight down (0 = top-down map, π/2 = horizon), `theta` the azimuth (0 = looking
 * north from the south, positive = the camera east of south).
 *
 * Framing: the camera distance fits the model as the current azimuth sees it (an envelope of the
 * surface plus the walls' bottom) inside a small inset from the box's edges and
 * {@link OVERLAY_GAP_PX} clear of the overlays on the box (`setOverlays`: the legend chip, the icon
 * buttons), so the default view fills the box. A lens shift centres the model, and moves it off
 * centre, away from an overlay, before the camera backs off from it. At each polar angle the
 * distance stays within a band: no farther than the farthest any azimuth needs, no closer than that
 * ÷ {@link TURN_ZOOM_BAND}, so turning the model zooms in and out only a little. Distance and pivot
 * height follow the camera as the user drags, times a zoom factor the wheel, pinch and + / − keys
 * change. The page can also reserve whole bands on any side (`setInsets`); the model is fitted and
 * centred in what is left. The markers' drawn shapes and the scrub marker's room along the route
 * are fitted too (as boxes of fixed screen size), so they keep the same clearance.
 *
 * A camera tween (Flat map, Rotate view, the intro) first drops whatever OrbitControls still meant
 * to apply (damping after a drag or an arrow key, {@link stopControlsMotion}), so flat is exactly
 * north-up and a rotation exactly an eighth of a turn.
 *
 * Every render refits first ({@link TerrainStage.renderNow}): OrbitControls' own methods
 * (`rotateLeft`, `dollyIn`, pointer handlers) move the camera and call `update()` straight away,
 * which leaves it unframed until the stage follows; nothing is drawn in between.
 *
 * The route and its markers (route.ts, markers.ts) are built once both a heightfield and a track
 * are present, and follow the exaggeration, the palette and the viewport.
 */
import {
  DepthTexture,
  FloatType,
  PerspectiveCamera,
  Scene,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { RunTrack } from '../page/types';
import {
  DEFAULT_AZIMUTH,
  DEFAULT_POLAR,
  FLAT_POLAR,
  MAX_POLAR,
  MIN_POLAR,
  defaultPolarFor,
  normalizeAzimuth,
  type ViewCamera,
} from './camera';
import { groundExtent, type Heightfield } from './heightfield';
import { createMarkerLayer, markerExtent, markerTextureScale, type MarkerLayer } from './markers';
import { APP_ROUTE_PALETTE, createRouteLayer, type RouteLayer, type RoutePalette } from './route';
import {
  DEFAULT_BASE_DEPTH,
  baseLevel,
  createTerrainMesh,
  disposeTerrainMesh,
  edgeLevels,
  edgePoints,
  modelBounds,
  surfaceSamples,
  radialHull,
  setEdgeLevel,
  setExaggeration,
  surfaceEnvelope,
  updateDepthRange,
  visibleEdgeLevel,
  type EdgeLevels,
  type EdgePoint,
  type RadialPoint,
  type TerrainMesh,
  type TerrainPalette,
} from './mesh';

/**
 * The renderer methods the stage uses; tests inject a fake (jsdom has no WebGL). Without
 * `setRenderTarget` and `getDrawingBufferSize` there is no terrain depth pass and the route draws
 * everywhere.
 */
export type StageRenderer = Pick<
  WebGLRenderer,
  'setPixelRatio' | 'getPixelRatio' | 'setSize' | 'render' | 'dispose' | 'forceContextLoss'
> &
  Partial<Pick<WebGLRenderer, 'setRenderTarget' | 'getDrawingBufferSize'>>;

export type RendererFactory = (canvas: HTMLCanvasElement) => StageRenderer;

/** Whether the renderer can draw into render targets (the depth and route visibility passes). */
function hasRenderTargets(
  renderer: StageRenderer,
): renderer is StageRenderer &
  Required<Pick<WebGLRenderer, 'setRenderTarget' | 'getDrawingBufferSize'>> {
  return Boolean(renderer.setRenderTarget && renderer.getDrawingBufferSize);
}

export const createWebGLRenderer: RendererFactory = (canvas) => {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  // Transparent: the page's --surface box shows through.
  renderer.setClearColor(0x000000, 0);
  return renderer;
};

export type TerrainViewMode = 'oblique' | 'flat';

const DEG = Math.PI / 180;
export { DEFAULT_AZIMUTH, DEFAULT_POLAR, FLAT_POLAR, MAX_POLAR, MIN_POLAR };
export const INTRO_MS = 1200;
export const VIEW_CHANGE_MS = 600;
export const FOV = 30;
/**
 * Clear space between the model and each side of the box, CSS px. The overlays on the box (legend
 * chip, icon buttons) are kept clear separately ({@link TerrainStage.setOverlays}), so this is only
 * breathing room at the edges. On small boxes the inset shrinks to {@link FIT_INSET_MAX_FRACTION}
 * of the side.
 */
export const FIT_INSET_PX = 16;
const FIT_INSET_MAX_FRACTION = 0.12;
/**
 * In the View the edge clearance also scales with the box: at most this fraction of its shorter
 * side, so a phone's 358 × 269 box keeps 11 px instead of 16 and the model is drawn larger (from
 * 400 px up, the full {@link FIT_INSET_PX}). Poster figures keep {@link FIT_INSET_PX}.
 */
export const VIEW_INSET_SHORT_FRACTION = 0.04;

/** The View's edge clearance for a `width × height` box, CSS px. */
export function viewInset(width: number, height: number): number {
  return Math.min(FIT_INSET_PX, VIEW_INSET_SHORT_FRACTION * Math.max(1, Math.min(width, height)));
}
/** Zoom factor limits, relative to the fitted distance. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.2;
const KEY_STEP = 5 * DEG;
const KEY_ZOOM = 0.9;
/** Points per ring when the revolved outline is turned into points to fit. */
const RING_POINTS = 32;
/** Most route points padded for the scrub marker in the fit (the route is subsampled to this). */
const MAX_ROUTE_BOX_POINTS = 160;
/** Extra room around a marker's drawn shape for its antialiased edge, CSS px. */
const MARKER_FIT_SLACK_PX = 1;

export const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** OrbitControls' pending motion: what its next `update()` would still apply. */
interface ControlsMotion {
  _sphericalDelta?: Spherical;
  _scale?: number;
  _panOffset?: Vector3;
}

/**
 * Drops whatever OrbitControls still means to apply: damping's leftover rotation after a drag or
 * an arrow key, a pending wheel zoom. Otherwise a camera tween (Flat map, Rotate view) would end
 * with the leftover added on top (flat would not be north-up). three.js keeps these private; the
 * stage tests fail if a release renames them.
 */
export function stopControlsMotion(controls: OrbitControls): void {
  const motion = controls as unknown as ControlsMotion;
  motion._sphericalDelta?.set(0, 0, 0);
  if (typeof motion._scale === 'number') motion._scale = 1;
  motion._panOffset?.set(0, 0, 0);
}

/**
 * Room the page reserves on each side of the box for overlays that stay on top of the terrain
 * (legend chip, icon buttons), CSS px.
 */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** Clear space kept between an overlay (its inset, or its rectangle) and the model, CSS px. */
export const OVERLAY_GAP_PX = 12;
/** Extra room around an overlay's rectangle for the model's antialiased edge, CSS px. */
const OVERLAY_SLACK_PX = 1;
/**
 * Turning the model at one polar angle changes the camera distance by at most this factor: the
 * distance stays within a band whose far end is the farthest any azimuth needs (in the margins,
 * clear of the overlays) and whose near end is that ÷ this factor. Kept under the 1.15 the view
 * promises, for the azimuths between the ones sampled and the polar angles between grid steps.
 */
export const TURN_ZOOM_BAND = 1.13;
/** Azimuths sampled for the band's far end (the farthest is refined to a quarter step). */
const BAND_AZIMUTHS = 72;
/** The band is computed at polar angles this far apart (from 20°, so 62° is one) and interpolated. */
const BAND_STEP = 3 * DEG;

/** A rectangle on the box, CSS px from its top-left corner: an overlay (legend chip, buttons). */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle in NDC (y up) the model must stay out of. */
export interface NdcRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * The overlays on a `width × height` box as NDC rectangles, each grown by {@link OVERLAY_GAP_PX}
 * (plus a pixel for antialiasing) on every side.
 */
export function overlayRects(
  rects: readonly ScreenRect[],
  width: number,
  height: number,
): NdcRect[] {
  const grow = OVERLAY_GAP_PX + OVERLAY_SLACK_PX;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      minX: ((rect.x - grow) / w) * 2 - 1,
      maxX: ((rect.x + rect.width + grow) / w) * 2 - 1,
      minY: 1 - ((rect.y + rect.height + grow) / h) * 2,
      maxY: 1 - ((rect.y - grow) / h) * 2,
    }));
}

interface Point2 {
  x: number;
  y: number;
}

/** Convex hull of 2D points (monotone chain), counter-clockwise. */
function convexHull(points: Point2[]): Point2[] {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  /** Whether `p` would make the chain's last two points turn clockwise (or go straight). */
  const bends = (chain: Point2[], p: Point2) => {
    const a = chain[chain.length - 2];
    const b = chain[chain.length - 1];
    return a !== undefined && b !== undefined && cross(a, b, p) <= 0;
  };
  const lower: Point2[] = [];
  for (const p of sorted) {
    while (bends(lower, p)) lower.pop();
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (const p of sorted.reverse()) {
    while (bends(upper, p)) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Whether a convex polygon and a rectangle overlap (separating axis test; touching is clear). */
function hullMeetsRect(hull: readonly Point2[], rect: NdcRect): boolean {
  if (hull.length === 0) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of hull) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const eps = 1e-12;
  if (
    maxX <= rect.minX + eps ||
    minX >= rect.maxX - eps ||
    maxY <= rect.minY + eps ||
    minY >= rect.maxY - eps
  ) {
    return false;
  }
  const corners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k];
    const b = hull[(k + 1) % hull.length];
    if (!a || !b) continue;
    // Outward normal of a counter-clockwise edge; the rectangle is outside if all its corners are.
    const nx = b.y - a.y;
    const ny = a.x - b.x;
    const length = Math.hypot(nx, ny);
    if (length === 0) continue;
    if (corners.every((c) => ((c.x - a.x) * nx + (c.y - a.y) * ny) / length >= -eps)) return false;
  }
  return true;
}

/**
 * How an overlay pushes the model away, NDC: the overlay is taken as reaching out past the fit
 * region on the sides it is nearest to (a corner chip as a quadrant, a chip across the whole width
 * as a half-plane), and the model escapes it along `direction`, away from those sides. Moving that
 * way never brings a point back in, so the push needed changes smoothly as the model turns (a
 * shortest escape would jump from one side of the overlay to the other).
 */
interface Escape {
  /** Active bounds of the region: a point is inside when x < maxX, x > minX, y < maxY, y > minY. */
  readonly maxX: number | null;
  readonly minX: number | null;
  readonly maxY: number | null;
  readonly minY: number | null;
  readonly direction: Point2;
}

/** The {@link Escape} from obstacle `o` for a fit region (NDC); null if it covers the region. */
export function escapeFrom(
  o: NdcRect,
  fit: { minX: number; maxX: number; minY: number; maxY: number },
): Escape | null {
  const axis = (lo: number, hi: number, fitLo: number, fitHi: number) => {
    let openLow = lo <= fitLo;
    let openHigh = hi >= fitHi;
    if (!openLow && !openHigh) {
      // Floating: taken as reaching out to the nearer side.
      if (lo - fitLo <= fitHi - hi) openLow = true;
      else openHigh = true;
    }
    // Open towards low values: inside below `hi`, escape upwards (and the other way round).
    if (openLow && openHigh) return { below: null, above: null, sign: 0, depth: 0 };
    if (openLow) return { below: hi, above: null, sign: 1, depth: hi - fitLo };
    return { below: null, above: lo, sign: -1, depth: fitHi - lo };
  };
  const x = axis(o.minX, o.maxX, fit.minX, fit.maxX);
  const y = axis(o.minY, o.maxY, fit.minY, fit.maxY);
  if (x.sign === 0 && y.sign === 0) return null;
  // Mostly across the overlay's thinner reach into the region: a wide chip pushes the model down
  // more than sideways (a little sideways keeps a touch on its end smooth).
  const wx = x.sign === 0 ? 0 : x.sign / Math.max(x.depth, 1e-6);
  const wy = y.sign === 0 ? 0 : y.sign / Math.max(y.depth, 1e-6);
  const length = Math.hypot(wx, wy);
  return {
    maxX: x.below,
    minX: x.above,
    maxY: y.below,
    minY: y.above,
    direction: { x: wx / length, y: wy / length },
  };
}

/**
 * How far `hull` (convex, counter-clockwise), moved by −(`sx`, `sy`), has to move along the
 * escape's direction to leave its region: the largest, over the hull, of each point's time to
 * cross the first bound it crosses. That time is the smaller of (at most) two linear functions, so
 * the largest lies at a vertex or where an edge crosses the line on which the two are equal.
 */
function escapeTime(hull: readonly Point2[], sx: number, sy: number, escape: Escape): number {
  const { direction: u } = escape;
  // Each active bound as: time = (value − coordinate) / speed, on the x or the y axis.
  const bounds: { x: boolean; value: number; speed: number }[] = [];
  if (escape.maxX !== null) bounds.push({ x: true, value: escape.maxX + sx, speed: u.x });
  if (escape.minX !== null) bounds.push({ x: true, value: escape.minX + sx, speed: u.x });
  if (escape.maxY !== null) bounds.push({ x: false, value: escape.maxY + sy, speed: u.y });
  if (escape.minY !== null) bounds.push({ x: false, value: escape.minY + sy, speed: u.y });
  const [first, second] = bounds;
  if (!first) return 0;
  const at = (bound: typeof first, px: number, py: number) =>
    (bound.value - (bound.x ? px : py)) / bound.speed;
  const time = (px: number, py: number) =>
    Math.max(0, second ? Math.min(at(first, px, py), at(second, px, py)) : at(first, px, py));
  let most = 0;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k];
    const b = hull[(k + 1) % hull.length];
    if (!a || !b) continue;
    most = Math.max(most, time(a.x, a.y));
    if (!second) continue;
    const da = at(first, a.x, a.y) - at(second, a.x, a.y);
    const db = at(first, b.x, b.y) - at(second, b.x, b.y);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      most = Math.max(most, time(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return most;
}

/** Whether `hull` moved by −(`sx`, `sy`) meets `rect`. */
function shiftedHullMeetsRect(hull: readonly Point2[], sx: number, sy: number, rect: NdcRect) {
  return hullMeetsRect(hull, {
    minX: rect.minX + sx,
    maxX: rect.maxX + sx,
    minY: rect.minY + sy,
    maxY: rect.maxY + sy,
  });
}

/**
 * The lens shift at which a projected model keeps out of every obstacle and inside the margins,
 * or null. `hull` is the model's projected outline without a shift (convex, counter-clockwise);
 * `allowed` the shifts that keep it inside the margins; `start` the shift to start from (the
 * centring one, held inside `allowed`). The model escapes each overlay in turn along its
 * {@link Escape} direction (a shift `s` moves the model by −`s`), the shift is held inside
 * `allowed` again, and the result counts only if it is clear: otherwise the camera has to back
 * off. Every step is continuous in the model's outline, so turning the model never makes it jump.
 */
export function escapeShift(
  hull: readonly Point2[],
  allowed: NdcRect,
  obstacles: readonly NdcRect[],
  fit: { minX: number; maxX: number; minY: number; maxY: number },
  start: Point2,
): Point2 | null {
  let sx = start.x;
  let sy = start.y;
  for (const o of obstacles) {
    const escape = escapeFrom(o, fit);
    if (!escape) return null;
    const t = escapeTime(hull, sx, sy, escape);
    sx -= t * escape.direction.x;
    sy -= t * escape.direction.y;
  }
  sx = Math.min(allowed.maxX, Math.max(allowed.minX, sx));
  sy = Math.min(allowed.maxY, Math.max(allowed.minY, sy));
  return obstacles.every((o) => !shiftedHullMeetsRect(hull, sx, sy, o)) ? { x: sx, y: sy } : null;
}

/**
 * The points of `points` on their convex hull: all that any perspective projection's extent or
 * outline depends on, a fraction of the points to project per frame. All the points when the hull
 * is flat (coplanar points) or cannot be built.
 */
export function hullVertices(points: readonly Vector3[]): Vector3[] {
  if (points.length < 16) return points.slice();
  try {
    const hull = new ConvexHull().setFromPoints(points.slice());
    const vertices = new Set<Vector3>();
    let volume = 0;
    for (const face of hull.faces) {
      const loop: Vector3[] = [];
      let edge = face.edge;
      do {
        loop.push(edge.head().point);
        edge = edge.next;
      } while (edge !== face.edge && loop.length < 64);
      const first = loop[0];
      for (let k = 1; k + 1 < loop.length; k++) {
        const b = loop[k];
        const c = loop[k + 1];
        if (first && b && c) volume += first.dot(new Vector3().crossVectors(b, c)) / 6;
      }
      for (const v of loop) vertices.add(v);
    }
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of points) {
      min = min.min(p);
      max = max.max(p);
    }
    const size = max.clone().sub(min);
    if (Math.min(size.x, size.y, size.z) <= Math.max(size.x, size.y, size.z) * 1e-9) {
      return points.slice();
    }
    // A hull with (nearly) no volume is a flat set: quickhull may drop points along its outline.
    if (vertices.size >= 4 && volume > size.x * size.y * size.z * 1e-6) return [...vertices];
  } catch {
    // Degenerate input: fall back to every point.
  }
  return points.slice();
}

/** The model keeps at least this fraction of each side of the box, whatever the insets. */
const MIN_FIT_FRACTION = 0.3;

/**
 * The region of the viewport the model may fill, NDC: half-spans `x`, `y` and the centre
 * (`cx`, `cy`) the model is centred on (0, 0 without insets).
 */
export interface FitMargins {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * The fit region of a `width × height` box: each side keeps the default clearance (`inset`,
 * {@link FIT_INSET_PX} unless given, or 12% of a small side), or the page's inset on that side plus
 * {@link OVERLAY_GAP_PX}, whichever is larger. If the two sides of an axis would leave less than
 * 30% of it, both shrink in proportion.
 */
export function fitMargins(
  width: number,
  height: number,
  insets: Insets = NO_INSETS,
  inset: number = FIT_INSET_PX,
): FitMargins {
  const axis = (side: number, a: number, b: number) => {
    const size = Math.max(side, 1);
    const rule = Math.min(inset, size * FIT_INSET_MAX_FRACTION);
    const clear = (inset: number) => Math.max(rule, inset > 0 ? inset + OVERLAY_GAP_PX : 0);
    let near = clear(a);
    let far = clear(b);
    const most = size * (1 - MIN_FIT_FRACTION);
    if (near + far > most) {
      const k = most / (near + far);
      near *= k;
      far *= k;
    }
    // NDC: the region spans 2 − 2(near + far)/size; its centre moves (near − far)/size.
    return { half: 1 - (near + far) / size, centre: (near - far) / size };
  };
  const x = axis(width, insets.left, insets.right);
  // NDC y points up: a top inset moves the centre down.
  const y = axis(height, insets.bottom, insets.top);
  return { x: x.half, y: y.half, cx: x.centre, cy: y.centre };
}

/**
 * Points of a polygon around the vertical axis at height `y` that circumscribes the circle of
 * radius `rho` (so the points enclose the round outline too), appended to `out`.
 */
export function ringPoints(rho: number, y: number, out: Vector3[] = []): Vector3[] {
  if (rho <= 0) {
    out.push(new Vector3(0, y, 0));
    return out;
  }
  const grow = 1 / Math.cos(Math.PI / RING_POINTS);
  for (let k = 0; k < RING_POINTS; k++) {
    const angle = (k / RING_POINTS) * 2 * Math.PI;
    out.push(new Vector3(Math.sin(angle) * rho * grow, y, Math.cos(angle) * rho * grow));
  }
  return out;
}

/** Camera axes for `phi`/`theta` (as `lookAt` builds them with y up): right, up, back. */
function cameraAxes(phi: number, theta: number) {
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  return {
    right: new Vector3(ct, 0, -st),
    up: new Vector3(-cp * st, sp, -cp * ct),
    back: new Vector3(sp * st, cp, sp * ct),
  };
}

/**
 * A point with a box of fixed screen size around it (a marker sprite, or the room the scrub marker
 * needs along the route): how far the box reaches from the point's projection, CSS px.
 */
export interface ScreenBox {
  readonly point: Vector3;
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

/** Projected extent of points, NDC, for a camera `distance` from the pivot (no lens shift). */
interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function projector(
  targetY: number,
  phi: number,
  theta: number,
  fovDeg: number,
  aspect: number,
  viewport: { readonly width: number; readonly height: number },
) {
  const { right, up, back } = cameraAxes(phi, theta);
  const tanY = Math.tan((fovDeg * DEG) / 2);
  const kx = tanY * aspect;
  // NDC per CSS px.
  const perX = 2 / Math.max(1, viewport.width);
  const perY = 2 / Math.max(1, viewport.height);
  const q = new Vector3();
  /**
   * Each point's offset from the pivot along the camera's right, up and back axes (which do not
   * depend on the distance), computed once per list: projecting is then two divisions.
   */
  const cache = new WeakMap<readonly unknown[], Float64Array>();
  const axesOf = <T>(list: readonly T[], point: (item: T) => Vector3): Float64Array => {
    let dots = cache.get(list);
    if (!dots) {
      dots = new Float64Array(list.length * 3);
      for (let k = 0; k < list.length; k++) {
        const item = list[k];
        if (item === undefined) continue;
        const p = point(item);
        q.copy(p).setY(p.y - targetY);
        dots[k * 3] = q.dot(right);
        dots[k * 3 + 1] = q.dot(up);
        dots[k * 3 + 2] = q.dot(back);
      }
      cache.set(list, dots);
    }
    return dots;
  };
  const ofPoints = (points: readonly Vector3[]) => axesOf(points, (p) => p);
  const ofBoxes = (boxes: readonly ScreenBox[]) => axesOf(boxes, (box) => box.point);
  /**
   * Extent of `points` and `boxes` seen from `distance`; null when a point is at or behind the
   * camera.
   */
  const extent = (
    points: readonly Vector3[],
    distance: number,
    boxes: readonly ScreenBox[] = [],
  ): Extent | null => {
    const e: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const dots = ofPoints(points);
    for (let k = 0; k < dots.length; k += 3) {
      const depth = distance - (dots[k + 2] ?? 0);
      if (depth <= 1e-9) return null;
      const x = (dots[k] ?? 0) / (depth * kx);
      const y = (dots[k + 1] ?? 0) / (depth * tanY);
      if (x < e.minX) e.minX = x;
      if (x > e.maxX) e.maxX = x;
      if (y < e.minY) e.minY = y;
      if (y > e.maxY) e.maxY = y;
    }
    const boxDots = ofBoxes(boxes);
    boxes.forEach((box, b) => {
      const k = b * 3;
      const depth = distance - (boxDots[k + 2] ?? 0);
      if (depth <= 1e-9) {
        e.minX = NaN;
        return;
      }
      const x = (boxDots[k] ?? 0) / (depth * kx);
      const y = (boxDots[k + 1] ?? 0) / (depth * tanY);
      e.minX = Math.min(e.minX, x - box.left * perX);
      e.maxX = Math.max(e.maxX, x + box.right * perX);
      e.minY = Math.min(e.minY, y - box.down * perY);
      e.maxY = Math.max(e.maxY, y + box.up * perY);
    });
    return Number.isNaN(e.minX) ? null : e;
  };
  /**
   * Projected points and box corners seen from `distance`, NDC (all in front of the camera): enough
   * for their convex hull. `boxGroups` hold boxes of one size each; only the corners of the boxes
   * on the hull of a group's projected points can be on the overall hull.
   */
  const silhouette = (
    points: readonly Vector3[],
    distance: number,
    boxGroups: readonly (readonly ScreenBox[])[] = [],
  ): Point2[] => {
    const out: Point2[] = [];
    const dots = ofPoints(points);
    for (let k = 0; k < dots.length; k += 3) {
      const depth = distance - (dots[k + 2] ?? 0);
      if (depth > 1e-9) {
        out.push({ x: (dots[k] ?? 0) / (depth * kx), y: (dots[k + 1] ?? 0) / (depth * tanY) });
      }
    }
    for (const group of boxGroups) {
      const first = group[0];
      if (!first) continue;
      const groupDots = ofBoxes(group);
      const centres: Point2[] = [];
      for (let k = 0; k < groupDots.length; k += 3) {
        const depth = distance - (groupDots[k + 2] ?? 0);
        if (depth > 1e-9) {
          centres.push({
            x: (groupDots[k] ?? 0) / (depth * kx),
            y: (groupDots[k + 1] ?? 0) / (depth * tanY),
          });
        }
      }
      for (const c of convexHull(centres)) {
        const l = c.x - first.left * perX;
        const r = c.x + first.right * perX;
        const d = c.y - first.down * perY;
        const u = c.y + first.up * perY;
        out.push({ x: l, y: d }, { x: r, y: d }, { x: r, y: u }, { x: l, y: u });
      }
    }
    return out;
  };
  /** Farthest any point (or box) lies towards the camera from the pivot. */
  const nearest = (points: readonly Vector3[], boxes: readonly ScreenBox[] = []) => {
    let most = -Infinity;
    const boxDots = ofBoxes(boxes);
    for (let k = 2; k < boxDots.length; k += 3) most = Math.max(most, boxDots[k] ?? -Infinity);
    const dots = ofPoints(points);
    for (let k = 2; k < dots.length; k += 3) most = Math.max(most, dots[k] ?? -Infinity);
    return most;
  };
  return { extent, silhouette, nearest };
}

/** What else {@link frameModel} keeps to. */
export interface FrameOptions {
  /** Rectangles (overlays, already grown by their gap) the model must stay out of. */
  readonly obstacles?: readonly NdcRect[];
  /** Never closer than this (the near end of the zoom band). */
  readonly minDistance?: number;
  /** A distance expected to clear everything (the far end of the band): where backing off starts. */
  readonly clearDistance?: number;
  /** The distance a nearby pose needed: backing off looks around it first. */
  readonly hint?: number;
}

/** A framed camera: its distance from the pivot and lens shift (NDC). */
export interface Framing {
  readonly distance: number;
  readonly shiftX: number;
  readonly shiftY: number;
}

/**
 * Frames a model for a camera orbiting the pivot (0, `targetY`, 0) at `phi`/`theta`. The pieces of
 * {@link frameModel}, for the stage's zoom band, which asks many azimuths whether a distance would
 * do before it asks for the closest one:
 *
 * - `fitted()`: the smallest distance at which the projected `fitPoints` and `boxes` span at most
 *   2 × `margins` on each axis (a lens shift can then hold them inside);
 * - `place(distance)`: the lens shift at `distance` nearest to the one that puts the projected
 *   centre of `centrePoints` and `boxes` on the region's centre (`margins.cx`, `margins.cy`) while
 *   keeping them inside the margins and the hull of `fitPoints` and `boxes` out of every obstacle
 *   (off centre only as far as an overlay needs); null when no shift does;
 * - `frame(minDistance, clearDistance, hint)`: the smallest distance from `minDistance` (and
 *   `fitted()`) on at which `place` finds a shift, and that shift: the camera backs off from an
 *   overlay only when no shift clears it. `clearDistance` is a guess of a distance that clears
 *   (where backing off starts looking) and `hint` the distance a nearby pose needed.
 *
 * `centrePoints` (the model) should lie inside the convex hull of `fitPoints` (an envelope of
 * it), so where `fitPoints` span the margins a centred model keeps them. The `boxes` (marker
 * sprites, sizes in CSS px of a `viewport`-sized image) count in all of it.
 */
export function modelFramer(
  fitPoints: readonly Vector3[],
  centrePoints: readonly Vector3[],
  targetY: number,
  phi: number,
  theta: number,
  fovDeg: number,
  aspect: number,
  margins: FitMargins,
  boxes: readonly ScreenBox[] = [],
  viewport: { readonly width: number; readonly height: number } = { width: 1, height: 1 },
  obstacles: readonly NdcRect[] = [],
) {
  const { extent, silhouette, nearest } = projector(targetY, phi, theta, fovDeg, aspect, viewport);
  const centred = centrePoints.length + boxes.length > 0 ? centrePoints : fitPoints;
  const groups = new Map<string, ScreenBox[]>();
  for (const box of boxes) {
    const key = `${String(box.left)} ${String(box.right)} ${String(box.up)} ${String(box.down)}`;
    const group = groups.get(key);
    if (group) group.push(box);
    else groups.set(key, [box]);
  }
  const boxGroups = [...groups.values()];
  const region = {
    minX: margins.cx - margins.x,
    maxX: margins.cx + margins.x,
    minY: margins.cy - margins.y,
    maxY: margins.cy + margins.y,
  };
  /** The centring shift for the extent `c` of the points to centre. */
  const centring = (c: Extent | null): Point2 => ({
    x: (c ? (c.minX + c.maxX) / 2 : 0) - margins.cx,
    y: (c ? (c.minY + c.maxY) / 2 : 0) - margins.cy,
  });
  const place = (distance: number): Point2 | null => {
    const e = extent(fitPoints, distance, boxes);
    // The margins hold the model itself (as the centring sees it), inside the fitted points.
    const c = extent(centred, distance, boxes);
    if (!e || !c) return null;
    let allowed: NdcRect = {
      minX: c.maxX - (margins.cx + margins.x),
      maxX: c.minX - (margins.cx - margins.x),
      minY: c.maxY - (margins.cy + margins.y),
      maxY: c.minY - (margins.cy - margins.y),
    };
    if (allowed.minX > allowed.maxX + 1e-12 || allowed.minY > allowed.maxY + 1e-12) return null;
    allowed = {
      minX: Math.min(allowed.minX, allowed.maxX),
      maxX: Math.max(allowed.minX, allowed.maxX),
      minY: Math.min(allowed.minY, allowed.maxY),
      maxY: Math.max(allowed.minY, allowed.maxY),
    };
    const preferred = centring(c);
    const start = {
      x: Math.min(allowed.maxX, Math.max(allowed.minX, preferred.x)),
      y: Math.min(allowed.maxY, Math.max(allowed.minY, preferred.y)),
    };
    // The model's bounding box clear of every obstacle: so is the model (no outline needed).
    const boxClear = obstacles.every(
      (o) =>
        e.maxX - start.x <= o.minX ||
        e.minX - start.x >= o.maxX ||
        e.maxY - start.y <= o.minY ||
        e.minY - start.y >= o.maxY,
    );
    if (boxClear) return start;
    const hull = convexHull(silhouette(fitPoints, distance, boxGroups));
    return escapeShift(hull, allowed, obstacles, region, start);
  };
  /**
   * 1 ÷ how many times over the margins the model spans, less 1: ≥ 0 where it fits, −1 while a
   * point is at or behind the camera. Nearly linear in the distance (spans shrink as 1 / distance).
   */
  const room = (distance: number) => {
    const e = extent(fitPoints, distance, boxes);
    if (!e) return -1;
    const over = Math.max((e.maxX - e.minX) / (2 * margins.x), (e.maxY - e.minY) / (2 * margins.y));
    return over > 0 ? 1 / over - 1 : Infinity;
  };
  let fittedDistance: number | null = null;
  const fitted = (): number => {
    if (fittedDistance !== null) return fittedDistance;
    // Regula falsi (Illinois) on `room`, to 1e-7 of the distance.
    let lo = Math.max(0, nearest(fitPoints, boxes));
    let atLo = room(lo);
    if (lo > 0 && atLo >= 0) {
      fittedDistance = lo;
      return lo;
    }
    let step = Math.max(lo, 1e-3);
    let hi = lo + step;
    let atHi = room(hi);
    while (atHi < 0 && hi < 1e6) {
      lo = hi;
      atLo = atHi;
      step *= 2;
      hi = lo + step;
      atHi = room(hi);
    }
    let side = 0;
    for (let i = 0; i < 100 && hi - lo > hi * 1e-7 && atHi > 1e-9; i++) {
      let mid = Number.isFinite(atHi) ? hi - (atHi * (hi - lo)) / (atHi - atLo) : (lo + hi) / 2;
      if (!(mid > lo && mid < hi)) mid = (lo + hi) / 2;
      const atMid = room(mid);
      if (atMid >= 0) {
        hi = mid;
        atHi = atMid;
        if (side === 1) atLo /= 2;
        side = 1;
      } else {
        lo = mid;
        atLo = atMid;
        if (side === -1) atHi /= 2;
        side = -1;
      }
    }
    fittedDistance = hi;
    return hi;
  };
  const frame = (minDistance = 0, clearDistance = 0, hint = 0): Framing => {
    let distance = Math.max(fitted(), minDistance);
    let shift = place(distance);
    if (!shift) {
      // No shift clears the overlays here: back off to the nearest distance where one does
      // (bisection, to 1e-4 of it), looking just around `hint` first (the last frame's).
      let closer = distance;
      let far = 0;
      if (hint > distance) {
        const below = Math.max(distance, hint / 1.004);
        const atBelow = below > distance ? place(below) : null;
        if (atBelow) {
          far = below;
          shift = atBelow;
        } else {
          closer = below;
          const above = hint * 1.004;
          const atAbove = place(above);
          if (atAbove) {
            far = above;
            shift = atAbove;
          } else {
            closer = above;
          }
        }
      }
      if (!shift) {
        far = clearDistance > closer ? clearDistance : closer * 1.02;
        shift = place(far);
      }
      while (!shift && far < distance * 100) {
        closer = far;
        far *= 1.1;
        shift = place(far);
      }
      for (let i = 0; i < 24 && shift && far - closer > far * 1e-4; i++) {
        const mid = (closer + far) / 2;
        const at = place(mid);
        if (at) {
          far = mid;
          shift = at;
        } else {
          closer = mid;
        }
      }
      distance = far;
    }
    const { x: shiftX, y: shiftY } = shift ?? centring(extent(centred, distance, boxes));
    return { distance, shiftX, shiftY };
  };
  return { fitted, place, frame };
}

/**
 * Frames a model for a camera orbiting the pivot (0, `targetY`, 0) at `phi`/`theta`
 * ({@link modelFramer}'s `frame`): the smallest distance from `minDistance` on at which the
 * projected `fitPoints` and `boxes` fit inside 2 × `margins` on each axis and a lens shift keeps
 * them out of every obstacle, and that shift: the one nearest to centring `centrePoints` and
 * `boxes` in the region (`margins.cx`, `margins.cy`) that keeps them inside the margins.
 */
export function frameModel(
  fitPoints: readonly Vector3[],
  centrePoints: readonly Vector3[],
  targetY: number,
  phi: number,
  theta: number,
  fovDeg: number,
  aspect: number,
  margins: FitMargins,
  boxes: readonly ScreenBox[] = [],
  viewport: { readonly width: number; readonly height: number } = { width: 1, height: 1 },
  { obstacles = [], minDistance = 0, clearDistance = 0, hint = 0 }: FrameOptions = {},
): Framing {
  return modelFramer(
    fitPoints,
    centrePoints,
    targetY,
    phi,
    theta,
    fovDeg,
    aspect,
    margins,
    boxes,
    viewport,
    obstacles,
  ).frame(minDistance, clearDistance, hint);
}

/**
 * Applies a lens shift to `camera` (a view offset the size of the view): content moves by
 * −`shiftX`, −`shiftY` in NDC, so a model whose projected centre is (shiftX, shiftY) is centred.
 */
export function setLensShift(
  camera: PerspectiveCamera,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
): void {
  camera.setViewOffset(width, height, (shiftX * width) / 2, (-shiftY * height) / 2, width, height);
}

/** A rectangle of an image, output px from its top-left corner. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The arguments of `PerspectiveCamera.setViewOffset`. */
export interface ViewOffset {
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The view offset that draws `tile` of a `width × height` image whose camera has the lens shift
 * (`shiftX`, `shiftY`) (NDC, as {@link setLensShift}): the lens shift is a view offset the size of
 * the image, and a tile is the same offset moved by the tile's corner and cut to its size. Tiles
 * that cover the image therefore stitch into exactly the image drawn whole (the projection is
 * linear in the offset). All lengths in output px; any rectangle works, also past the edges.
 */
export function figureViewOffset(
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
  tile: PixelRect,
): ViewOffset {
  return {
    fullWidth: width,
    fullHeight: height,
    offsetX: (shiftX * width) / 2 + tile.x,
    offsetY: (-shiftY * height) / 2 + tile.y,
    width: tile.width,
    height: tile.height,
  };
}

/** Applies a {@link ViewOffset} to `camera` (and so updates its projection). */
export function applyViewOffset(camera: PerspectiveCamera, view: ViewOffset): void {
  camera.setViewOffset(
    view.fullWidth,
    view.fullHeight,
    view.offsetX,
    view.offsetY,
    view.width,
    view.height,
  );
}

/**
 * One figure render ({@link TerrainStage.renderFigure}): the whole figure's size in output px, how
 * many output px a logical px is (line widths, ridge lines and markers are logical px, so they
 * scale with it), and the part of the figure to draw now.
 */
export interface FigureFrame {
  readonly width: number;
  readonly height: number;
  /** Output px per logical px (the poster's preview or export scale). */
  readonly scale: number;
  /** The part to draw, output px from the figure's top-left corner; the whole figure by default. */
  readonly tile?: PixelRect;
}

/** Where the camera is: on a sphere of `distance` around (0, `targetY`, 0), lens-shifted. */
export interface CameraPose {
  readonly distance: number;
  readonly phi: number;
  readonly theta: number;
  /** Height of the orbit pivot, which sits on the model's vertical axis. */
  readonly targetY: number;
  /** Lens shift, NDC: the model's projected centre without it (0, 0 = no shift). */
  readonly shiftX: number;
  readonly shiftY: number;
}

/** A camera pose relative to the fit: the stage derives distance and pivot from `phi` and `zoom`. */
interface ViewPose {
  readonly phi: number;
  readonly theta: number;
  /** Distance ÷ fitted distance (1 = fitted; < 1 closer). */
  readonly zoom: number;
}

/** The pose for a {@link ViewCamera}: the flat view top-down and north up, angles in range. */
function cameraPose(camera: ViewCamera): ViewPose {
  return camera.view === 'flat'
    ? { phi: FLAT_POLAR, theta: 0, zoom: clampZoom(camera.zoom) }
    : {
        phi: Math.min(MAX_POLAR, Math.max(MIN_POLAR, camera.polar)),
        theta: camera.azimuth,
        zoom: clampZoom(camera.zoom),
      };
}

/** Puts `camera` on the sphere around `target` and points it there. */
export function placeCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  distance: number,
  phi: number,
  theta: number,
): void {
  camera.position.setFromSpherical(new Spherical(distance, phi, theta)).add(target);
  camera.lookAt(target);
}

/** `angle` plus the whole turns that bring it nearest to `near` (to turn the short way round). */
const nearestTurn = (angle: number, near: number) =>
  angle + Math.round((near - angle) / (2 * Math.PI)) * 2 * Math.PI;

interface Tween {
  readonly from: ViewPose;
  readonly to: ViewPose;
  readonly start: number;
  readonly duration: number;
  readonly done?: () => void;
}

export interface StageOptions {
  createRenderer?: RendererFactory;
  palette: TerrainPalette;
  /** Route and marker colours. Default the app's (`--route`, `--white`, `--ink` values). */
  routePalette?: RoutePalette;
  /** Called once per rendered frame with the time spent in `render`, ms (for instrumentation). */
  onFrame?: (renderMs: number) => void;
  /**
   * `false` for an off-screen stage that only draws on request (`renderFigure`): no pointer or
   * wheel handling and no render loop. Default `true` (the View).
   */
  interactive?: boolean;
}

export interface ShowOptions {
  exaggeration: number;
  view: TerrainViewMode;
  /** Skip the intro camera move (prefers-reduced-motion); the view fades instead. */
  reducedMotion: boolean;
  /**
   * Start here instead of the default view, with no intro (back from Poster mode, which keeps the
   * user's angle). Its `view` wins over `view`.
   */
  camera?: ViewCamera;
  /** Called after the first frame with this heightfield has been drawn. */
  onFirstFrame?: () => void;
  /**
   * The route to drape, when it changes together with the heightfield (a GPX without `<ele>` gets
   * its elevations from this very grid): taken before the route is built, so it is built once.
   * Omitted: the track from `setTrack` stays.
   */
  track?: RunTrack | null;
}

const raf = (callback: FrameRequestCallback): number =>
  typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(() => {
        callback(performance.now());
      }, 16);
const cancelRaf = (id: number) => {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id);
  else window.clearTimeout(id);
};

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export class TerrainStage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 100);
  readonly controls: OrbitControls;
  private readonly renderer: StageRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly palette: TerrainPalette;
  private routePalette: RoutePalette;
  private readonly onFrame?: (renderMs: number) => void;
  private mesh: TerrainMesh | null = null;
  private heightfield: Heightfield | null = null;
  private track: RunTrack | null = null;
  private route: RouteLayer | null = null;
  private markers: MarkerLayer | null = null;
  private scrub: number | null = null;
  private insets: Insets = NO_INSETS;
  /** Overlays on the box, CSS px, and as NDC rectangles for the current size (none in exports). */
  private overlays: readonly ScreenRect[] = [];
  private obstacles: NdcRect[] = [];
  private exaggeration = 1;
  private view: TerrainViewMode = 'oblique';
  /** The default oblique polar angle for the current heightfield (more top-down for a long route). */
  private defaultPolar = DEFAULT_POLAR;
  /** The oblique pose Flat map left from, so turning it off goes back there (not the default). */
  private obliqueReturn: ViewPose | null = null;
  private readonly target = new Vector3();
  /** The model's box (for the line fade's depth range). */
  private box = { width: 1, depth: 1, bottom: 0, top: 0 };
  /** Exaggeration-1 outline and edge levels of the current heightfield. */
  private hull: RadialPoint[] = [];
  private edges: EdgeLevels = { north: 0, south: 0, east: 0, west: 0 };
  /** The revolved surface outline at the current exaggeration (for the controls' limits). */
  private surfacePoints: Vector3[] = [];
  /** The surface on a coarse subgrid (exaggeration 1), for centring the model on screen. */
  private surfaceSamples: EdgePoint[] = [];
  /** An envelope of the surface (exaggeration 1), for fitting the model as one azimuth sees it. */
  private envelopeSamples: EdgePoint[] = [];
  /** Points along the grid's edge, for the walls' bottom. */
  private edgeSamples: EdgePoint[] = [];
  /**
   * At the current exaggeration, the convex hull's vertices of the envelope (`fit`) and of the
   * surface subgrid (`centre`), each with the walls' bottom hung one base depth under every edge
   * point; the flat base's corners are added per azimuth ({@link TerrainStage.framePoints}).
   */
  private hulls: {
    heightfield: Heightfield;
    exaggeration: number;
    fit: Vector3[];
    centre: Vector3[];
  } | null = null;
  /** The zoom band's far end at each polar angle step computed so far (index from 20°). */
  private bands = new Map<number, number>();
  private margins: FitMargins = fitMargins(1, 1);
  private size = { width: 1, height: 1 };
  /** Orbit pivot height: half the model's height, on its vertical axis. */
  private pivotY = 0;
  /** Last framing, keyed by the camera angles and band (frames without camera moves reuse it). */
  private framed: {
    phi: number;
    theta: number;
    nearest: number;
    distance: number;
    shiftX: number;
    shiftY: number;
  } | null = null;
  private zoom = 1;
  /** The distance the stage last placed the camera at; a different one means the user zoomed. */
  private placedDistance = 0;
  private tween: Tween | null = null;
  private frameId = 0;
  private reducedMotion = false;
  private firstFrame: (() => void) | null = null;
  private disposed = false;
  /** Marker sprites and the scrub marker's room along the route, at the current exaggeration. */
  private boxes: ScreenBox[] = [];
  /** The terrain's depth for the route's visibility test (created on the first frame with one). */
  private depthTarget: WebGLRenderTarget | null = null;
  private readonly bufferSize = new Vector2();
  private readonly interactive: boolean;
  /** Output px per logical px while drawing a figure (`renderFigure`); null in the View. */
  private figureScale: number | null = null;
  /** The figure size the fit was last computed for (`renderFigure`). */
  private figureKey = '';

  constructor(canvas: HTMLCanvasElement, options: StageOptions) {
    this.canvas = canvas;
    this.palette = options.palette;
    this.routePalette = options.routePalette ?? APP_ROUTE_PALETTE;
    this.onFrame = options.onFrame;
    this.interactive = options.interactive ?? true;
    this.renderer = (options.createRenderer ?? createWebGLRenderer)(canvas);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.enablePan = false;
    controls.minPolarAngle = MIN_POLAR;
    controls.maxPolarAngle = MAX_POLAR;
    controls.rotateSpeed = 0.6;
    if (this.interactive) {
      controls.addEventListener('change', this.requestRender);
    } else {
      // Off-screen: nothing to drag, and the stage draws only when asked.
      controls.disconnect();
    }
    this.controls = controls;
    placeCamera(this.camera, this.target, 3, DEFAULT_POLAR, DEFAULT_AZIMUTH);
  }

  /** Schedules one frame (no-op when one is already pending). */
  readonly requestRender = (): void => {
    if (this.frameId || this.disposed || !this.interactive) return;
    this.frameId = raf(this.drawFrame);
  };

  private readonly drawFrame = () => {
    this.frameId = 0;
    let again = false;
    if (this.tween) {
      // performance.now(), not the rAF timestamp: tweens start on the same clock.
      again = this.stepTween(performance.now());
    } else if (this.controls.enabled) {
      // Damping: update() reports movement until it settles, and fires 'change' (→ requestRender).
      again = this.controls.update();
    }
    this.renderNow();
    if (this.mesh && this.firstFrame) {
      const callback = this.firstFrame;
      this.firstFrame = null;
      callback();
    }
    if (again) this.requestRender();
  };

  /**
   * Draws one frame now, synchronously, with the camera framed for where it is (whatever moved it
   * since the last frame: OrbitControls, a key). Every render goes through here.
   */
  renderNow(): void {
    if (this.disposed) return;
    if (!this.tween && this.controls.enabled) this.followControls();
    this.draw();
  }

  /** Draws the scene with the camera as it is (no refit). */
  private draw() {
    this.markers?.updateOcclusion(this.camera.position);
    if (this.mesh) {
      const bounds = this.boundsCentreRadius();
      updateDepthRange(this.mesh, this.camera, bounds.center, bounds.radius);
    }
    const start = performance.now();
    this.renderTerrainDepth();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(performance.now() - start);
  }

  /**
   * Renders the terrain alone into a depth texture the size of the drawing buffer, and from it the
   * route's per-point visibility (route.ts, visibility.ts). Skipped without a route, or with a
   * renderer that cannot (the tests' fake): the route then draws everywhere.
   */
  private renderTerrainDepth() {
    const { renderer, route, mesh, markers } = this;
    if (!route) return;
    if (!mesh || !hasRenderTargets(renderer)) {
      route.updateVisibility(null);
      return;
    }
    const { x: width, y: height } = renderer.getDrawingBufferSize(this.bufferSize);
    this.depthTarget ??= new WebGLRenderTarget(width, height, {
      depthBuffer: true,
      depthTexture: new DepthTexture(width, height, FloatType),
    });
    this.depthTarget.setSize(width, height);
    const routeVisible = route.group.visible;
    const markersVisible = markers?.group.visible ?? false;
    route.group.visible = false;
    if (markers) markers.group.visible = false;
    mesh.material.colorWrite = false;
    renderer.setRenderTarget(this.depthTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    mesh.material.colorWrite = true;
    route.group.visible = routeVisible;
    if (markers) markers.group.visible = markersVisible;
    const depth = this.depthTarget.depthTexture;
    if (!depth) return;
    route.updateVisibility({
      renderer,
      depth,
      camera: this.camera,
      bufferWidth: width,
      bufferHeight: height,
      pixelRatio: this.figureScale ?? renderer.getPixelRatio(),
    });
  }

  /**
   * The pose OrbitControls left the camera in: its angles, and a changed distance taken as the user
   * zooming (the zoom factor times the change). Changes nothing.
   */
  private livePose(): ViewPose {
    const offset = new Spherical().setFromVector3(this.camera.position.clone().sub(this.target));
    let zoom = this.zoom;
    const placed = this.placedDistance;
    if (
      !this.tween &&
      this.controls.enabled &&
      placed > 0 &&
      Math.abs(offset.radius - placed) > placed * 1e-6
    ) {
      zoom = clampZoom((zoom * offset.radius) / placed);
    }
    return { phi: offset.phi, theta: offset.theta, zoom };
  }

  /**
   * After OrbitControls moved the camera: a changed distance is the user zooming (kept as the zoom
   * factor); then the distance and pivot are refitted for the new polar angle.
   */
  private followControls() {
    if (!this.mesh) return;
    this.setPose(this.livePose());
  }

  private boundsCentreRadius() {
    const { width, depth, bottom, top } = this.box;
    return {
      center: new Vector3(0, (bottom + top) / 2, 0),
      radius: Math.hypot(width, depth, top - bottom) / 2,
    };
  }

  /** Advances the camera tween; true while it is still running. */
  private stepTween(now: number): boolean {
    const tween = this.tween;
    if (!tween) return false;
    const t = tween.duration > 0 ? (now - tween.start) / tween.duration : 1;
    const k = easeOutCubic(t);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    this.setPose({
      phi: lerp(tween.from.phi, tween.to.phi),
      theta: lerp(tween.from.theta, tween.to.theta),
      zoom: lerp(tween.from.zoom, tween.to.zoom),
    });
    if (t < 1) return true;
    this.tween = null;
    this.controls.enabled = true;
    tween.done?.();
    stopControlsMotion(this.controls);
    this.controls.update();
    return false;
  }

  /** The camera's current pose. */
  private pose(): ViewPose {
    const offset = new Spherical().setFromVector3(this.camera.position.clone().sub(this.target));
    return { phi: offset.phi, theta: offset.theta, zoom: this.zoom };
  }

  /** Height of the skirt's flat base seen from azimuth `theta`. */
  private bottomFor(theta: number): number {
    return baseLevel(visibleEdgeLevel(this.edges, theta), this.exaggeration, DEFAULT_BASE_DEPTH);
  }

  /** The convex hulls of the model's points to fit and to centre, at the current exaggeration. */
  private modelHulls() {
    const { heightfield, exaggeration } = this;
    if (!heightfield) return { fit: [], centre: [] };
    const cached = this.hulls;
    if (cached?.heightfield === heightfield && cached.exaggeration === exaggeration) return cached;
    const lift = ({ x, y, z }: EdgePoint) => new Vector3(x, y * exaggeration, z);
    // Under each edge point, one base depth down: where the walls' bottom is when the edge dips
    // under the flat base (above the base, the point lies on the wall, inside the model anyway).
    const dips = this.edgeSamples.map(
      ({ x, y, z }) => new Vector3(x, y * exaggeration - DEFAULT_BASE_DEPTH, z),
    );
    this.hulls = {
      heightfield,
      exaggeration,
      fit: hullVertices([...this.envelopeSamples.map(lift), ...dips]),
      centre: hullVertices([...this.surfaceSamples.map(lift), ...dips]),
    };
    return this.hulls;
  }

  /**
   * Points to fit at azimuth `theta`: the model as this azimuth sees it (`fit`, the surface's
   * envelope and the walls' bottom) and the model itself to centre (`centre`). The flat base's
   * corners at this azimuth's level close the walls' bottom: with the dips under the edge, their
   * hull holds every point of it.
   */
  private framePoints(theta: number) {
    const bottom = this.bottomFor(theta);
    const halfX = this.box.width / 2;
    const halfZ = this.box.depth / 2;
    const corners = [
      new Vector3(-halfX, bottom, -halfZ),
      new Vector3(halfX, bottom, -halfZ),
      new Vector3(halfX, bottom, halfZ),
      new Vector3(-halfX, bottom, halfZ),
    ];
    const { fit, centre } = this.modelHulls();
    return { fit: [...fit, ...corners], centre: [...centre, ...corners] };
  }

  /**
   * The screen boxes the fit keeps inside the box at the current exaggeration: each fixed marker's
   * drawn shape, and the scrub marker's (which also covers the route's halo) around points along
   * the route, wherever the scrub may go.
   */
  private updateBoxes() {
    const boxes: ScreenBox[] = [];
    const ex = this.exaggeration;
    const pad = (extent: { left: number; right: number; up: number; down: number }) => ({
      left: extent.left + MARKER_FIT_SLACK_PX,
      right: extent.right + MARKER_FIT_SLACK_PX,
      up: extent.up + MARKER_FIT_SLACK_PX,
      down: extent.down + MARKER_FIT_SLACK_PX,
    });
    const route = this.route;
    if (route?.group.visible) {
      const { positions } = route;
      const count = positions.length / 3;
      const step = Math.max(1, Math.ceil(count / MAX_ROUTE_BOX_POINTS));
      const scrub = pad(markerExtent('scrub'));
      const points: Vector3[] = [];
      const add = (k: number) => {
        points.push(
          new Vector3(
            positions[k * 3] ?? 0,
            (positions[k * 3 + 1] ?? 0) * ex,
            positions[k * 3 + 2] ?? 0,
          ),
        );
      };
      for (let k = 0; k < count; k += step) add(k);
      if (count > 0 && (count - 1) % step !== 0) add(count - 1);
      // The boxes are all the same size: only the points on the hull can reach out furthest.
      for (const point of hullVertices(points)) boxes.push({ point, ...scrub });
    }
    for (const { kind, position } of this.markers?.fixedMarkers() ?? []) {
      boxes.push({ point: position.setY(position.y * ex), ...pad(markerExtent(kind)) });
    }
    this.boxes = boxes;
  }

  /**
   * The far end of the zoom band at polar angle `phi`: the farthest the camera has to be, at any
   * azimuth, to fit the model inside the margins and clear of the overlays (with the lens shift's
   * help). Sampled every 5° of azimuth, then a quarter and half a step either side of the farthest.
   * An azimuth that the farthest distance so far already frames costs one check, not a search.
   */
  private farthestFit(phi: number): number {
    const { aspect } = this.camera;
    let most = 0;
    let farthest = 0;
    const visit = (theta: number) => {
      const { fit, centre } = this.framePoints(theta);
      const framer = modelFramer(
        fit,
        centre,
        this.pivotY,
        phi,
        theta,
        FOV,
        aspect,
        this.margins,
        this.boxes,
        this.size,
        this.obstacles,
      );
      if (most > 0 && framer.fitted() <= most && framer.place(most)) return;
      most = framer.frame(most, most * 1.05).distance;
      farthest = theta;
    };
    const step = (2 * Math.PI) / BAND_AZIMUTHS;
    for (let k = 0; k < BAND_AZIMUTHS; k++) visit(k * step);
    const top = farthest;
    for (const side of [-0.5, -0.25, 0.25, 0.5]) visit(top + side * step);
    return most;
  }

  /** The band's far end at grid step `index` (polar angle 20° + index × 3°), computed once per fit. */
  private bandEnd(index: number): number {
    let end = this.bands.get(index);
    if (end === undefined) {
      end = this.farthestFit(Math.min(MAX_POLAR, MIN_POLAR + index * BAND_STEP));
      this.bands.set(index, end);
    }
    return end;
  }

  /**
   * The zoom band at polar angle `phi` (camera distances, at zoom 1): `far`, the farthest any
   * azimuth needs, and `near` = far ÷ {@link TURN_ZOOM_BAND}. Between grid steps, interpolated.
   * Below the oblique range (the flat map, where nothing turns) there is no band (0), nor in an
   * off-screen figure (`interactive: false`): it never turns, so the model fills its box at the
   * camera's own azimuth.
   */
  private bandAt(phi: number): { near: number; far: number } {
    if (phi < MIN_POLAR - 1e-6 || !this.interactive) return { near: 0, far: 0 };
    const u = (Math.min(MAX_POLAR, Math.max(MIN_POLAR, phi)) - MIN_POLAR) / BAND_STEP;
    const index = Math.round(u);
    let far: number;
    if (Math.abs(u - index) < 1e-6) {
      far = this.bandEnd(index);
    } else {
      const below = Math.floor(u);
      const t = u - below;
      far = this.bandEnd(below) * (1 - t) + this.bandEnd(below + 1) * t;
    }
    return { near: far / TURN_ZOOM_BAND, far };
  }

  /**
   * The zoom band for the camera at polar angle `phi`: during a tween that changes the polar angle
   * (the intro, Flat map), blended from the band at its start to the one at its end as it goes, so
   * only those two are computed and the camera eases from the flat fit into the band.
   */
  private bandFor(phi: number): { near: number; far: number } {
    const tween = this.tween;
    if (!tween || Math.abs(tween.to.phi - tween.from.phi) < 1e-9) return this.bandAt(phi);
    const from = this.bandAt(tween.from.phi);
    const to = this.bandAt(tween.to.phi);
    const t = Math.min(1, Math.max(0, (phi - tween.from.phi) / (tween.to.phi - tween.from.phi)));
    return { near: from.near + (to.near - from.near) * t, far: Math.max(from.far, to.far) };
  }

  /**
   * The fitted distance and lens shift for a camera at `phi`/`theta`: the closest distance in the
   * zoom band at which the model as this azimuth sees it fits the margins, clear of the overlays,
   * with the lens shift moving it off centre (away from an overlay) before the camera backs off.
   * The band holds the distance within {@link TURN_ZOOM_BAND} at every azimuth: turning the model
   * barely zooms.
   */
  private frame(phi: number, theta: number) {
    const band = this.bandFor(phi);
    const framed = this.framed;
    if (framed?.phi === phi && framed.theta === theta && framed.nearest === band.near) {
      return framed;
    }
    // The last framing (a nearby pose, unless a refit dropped it) is where backing off looks first.
    const hint = framed?.distance ?? 0;
    const { fit, centre } = this.framePoints(theta);
    const result = frameModel(
      fit,
      centre,
      this.pivotY,
      phi,
      theta,
      FOV,
      this.camera.aspect,
      this.margins,
      this.boxes,
      this.size,
      { obstacles: this.obstacles, minDistance: band.near, clearDistance: band.far, hint },
    );
    this.framed = { phi, theta, nearest: band.near, ...result };
    return this.framed;
  }

  /** Forgets every framing computed for the old model, size, overlays or markers. */
  private invalidateFit() {
    this.framed = null;
    this.bands = new Map();
  }

  /** The camera's placement for `pose`. */
  private placement(pose: ViewPose): CameraPose {
    const framed = this.frame(pose.phi, pose.theta);
    return {
      distance: framed.distance * pose.zoom,
      phi: pose.phi,
      theta: pose.theta,
      targetY: this.pivotY,
      shiftX: framed.shiftX,
      shiftY: framed.shiftY,
    };
  }

  private setPose(pose: ViewPose) {
    const { distance, phi, theta, targetY, shiftX, shiftY } = this.placement(pose);
    setLensShift(this.camera, this.size.width, this.size.height, shiftX, shiftY);
    if (this.mesh) {
      const level = visibleEdgeLevel(this.edges, theta);
      setEdgeLevel(this.mesh, level);
      this.box = { ...this.box, bottom: baseLevel(level, this.exaggeration, DEFAULT_BASE_DEPTH) };
    }
    this.zoom = pose.zoom;
    this.target.set(0, targetY, 0);
    this.controls.target.copy(this.target);
    placeCamera(this.camera, this.target, distance, phi, theta);
    this.placedDistance = distance;
  }

  private animateTo(to: ViewPose, duration: number, done?: () => void) {
    // The tween owns the camera now: nothing the user set going (damping, a zoom) carries on.
    stopControlsMotion(this.controls);
    if (this.reducedMotion) {
      // No camera move: jump there.
      this.tween = null;
      this.setPose(to);
      this.controls.enabled = true;
      done?.();
      this.controls.update();
      this.requestRender();
      return;
    }
    this.tween = { from: this.pose(), to, start: performance.now(), duration, done };
    this.controls.enabled = false;
    this.requestRender();
  }

  private applyViewLimits(view: TerrainViewMode) {
    const flat = view === 'flat';
    this.controls.enableRotate = !flat;
    this.controls.minPolarAngle = flat ? 0 : MIN_POLAR;
    this.controls.maxPolarAngle = flat ? 0 : MAX_POLAR;
  }

  /** Refits after the model's shape, the exaggeration or the viewport changed. */
  private updateFit() {
    if (!this.heightfield) return;
    const bounds = modelBounds(this.heightfield, this.exaggeration);
    const bottom = this.bottomFor(this.pose().theta);
    this.box = { width: bounds.width, depth: bounds.depth, bottom, top: bounds.height };
    this.pivotY = bounds.height / 2;
    this.surfacePoints = [];
    for (const { rho, y } of this.hull) ringPoints(rho, y * this.exaggeration, this.surfacePoints);
    this.updateBoxes();
    this.invalidateFit();
    // Zoom limits wide enough that the zoom factor's clamp, not OrbitControls', is the one that
    // binds, at any polar angle and azimuth: from the revolved outline (which fits any azimuth),
    // with room for backing off from the overlays.
    const fits = [FLAT_POLAR, MIN_POLAR, MAX_POLAR].flatMap((phi) =>
      [0, 1, 2, 3].map((k) => {
        const theta = (k * Math.PI) / 2;
        const fit = [...this.surfacePoints, ...this.framePoints(theta).fit];
        const { aspect } = this.camera;
        return frameModel(fit, [], this.pivotY, phi, theta, FOV, aspect, this.margins).distance;
      }),
    );
    this.controls.minDistance = Math.min(...fits) * MIN_ZOOM * 0.75;
    this.controls.maxDistance = Math.max(...fits) * MAX_ZOOM * 2;
    this.camera.near = Math.max(0.001, this.controls.minDistance * 0.05);
    this.camera.far = this.controls.maxDistance * 4;
    this.camera.updateProjectionMatrix();
  }

  /** Keeps the current view (angles and zoom) framed after a refit, unless a tween will. */
  private refit() {
    if (!this.mesh || this.tween) return;
    this.setPose(this.pose());
    this.controls.update();
  }

  /** The pose the stage would place the camera at for `phi`/`theta` at zoom 1 (for tests). */
  fittedPose(phi: number, theta: number): CameraPose {
    return this.placement({ phi, theta, zoom: 1 });
  }

  /** Builds (or drops) the route and markers for the current heightfield and track. */
  private rebuildRoute() {
    this.route?.dispose();
    this.markers?.dispose();
    this.route = null;
    this.markers = null;
    const { heightfield, track } = this;
    if (!heightfield || !track || track.cumulative.length === 0) return;
    const options = { palette: this.routePalette, exaggeration: this.exaggeration };
    this.route = createRouteLayer(heightfield, track, options);
    this.markers = createMarkerLayer(heightfield, track, options);
    this.route.setResolution(this.size.width, this.size.height);
    if (this.figureScale !== null) this.route.setLineScale(this.figureScale);
    this.markers.setViewport(this.size.height, this.camera.fov);
    this.markers.setScrub(this.scrub);
    this.scene.add(this.route.group, this.markers.group);
  }

  /** The route to drape on the terrain (or none). Rebuilds the route and markers. */
  setTrack(track: RunTrack | null): void {
    if (track === this.track) return;
    this.track = track;
    this.rebuildRoute();
    // The markers and the route's room for the scrub marker are part of the fit.
    if (this.mesh) {
      this.updateBoxes();
      this.invalidateFit();
      this.refit();
    }
    this.requestRender();
  }

  /** Moves the scrub marker `d` metres along the route; null hides it. No rebuild. */
  setScrub(d: number | null): void {
    if (d === this.scrub) return;
    this.scrub = d;
    if (!this.markers) return;
    this.markers.setScrub(d);
    this.requestRender();
  }

  setRoutePalette(palette: RoutePalette): void {
    this.routePalette = palette;
    this.route?.setPalette(palette);
    this.markers?.setPalette(palette);
    this.requestRender();
  }

  /** Room reserved for overlays on each side of the box, CSS px; the model is refitted. */
  setInsets(insets: Insets): void {
    const { top, right, bottom, left } = this.insets;
    if (
      insets.top === top &&
      insets.right === right &&
      insets.bottom === bottom &&
      insets.left === left
    ) {
      return;
    }
    this.insets = { ...insets };
    const { width, height } = this.size;
    const inset = this.figureScale === null ? viewInset(width, height) : FIT_INSET_PX;
    this.margins = fitMargins(width, height, this.insets, inset);
    this.invalidateFit();
    if (this.mesh) {
      this.updateFit();
      this.refit();
    }
    this.requestRender();
  }

  /**
   * Overlays that stay on top of the box (legend chip, icon buttons), CSS px from its top-left
   * corner: the model is kept {@link OVERLAY_GAP_PX} clear of each, at every azimuth. Refits.
   */
  setOverlays(rects: readonly ScreenRect[]): void {
    const same =
      rects.length === this.overlays.length &&
      rects.every((rect, k) => {
        const old = this.overlays[k];
        return (
          old?.x === rect.x &&
          old.y === rect.y &&
          old.width === rect.width &&
          old.height === rect.height
        );
      });
    if (same) return;
    this.overlays = rects.map((rect) => ({ ...rect }));
    this.obstacles = overlayRects(this.overlays, this.size.width, this.size.height);
    this.invalidateFit();
    if (this.mesh) {
      this.updateFit();
      this.refit();
    }
    this.requestRender();
  }

  /**
   * Shows a heightfield (or nothing). A new heightfield plays the intro unless reduced motion, or
   * starts at `options.camera`.
   */
  show(heightfield: Heightfield | null, options: ShowOptions): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeTerrainMesh(this.mesh);
      this.mesh = null;
    }
    this.heightfield = heightfield;
    if (options.track !== undefined) this.track = options.track;
    this.tween = null;
    this.obliqueReturn = null;
    this.controls.enabled = true;
    stopControlsMotion(this.controls);
    if (!heightfield) {
      this.rebuildRoute();
      this.requestRender();
      return;
    }
    this.exaggeration = options.exaggeration;
    this.view = options.camera?.view ?? options.view;
    this.reducedMotion = options.reducedMotion;
    this.firstFrame = options.onFirstFrame ?? null;
    this.mesh = createTerrainMesh(heightfield, {
      palette: this.palette,
      exaggeration: options.exaggeration,
      baseDepth: DEFAULT_BASE_DEPTH,
      pixelRatio: this.renderer.getPixelRatio(),
    });
    this.scene.add(this.mesh);
    this.rebuildRoute();
    this.hull = radialHull(heightfield);
    this.edges = edgeLevels(heightfield);
    this.edgeSamples = edgePoints(heightfield);
    this.surfaceSamples = surfaceSamples(heightfield);
    this.envelopeSamples = surfaceEnvelope(heightfield);
    this.defaultPolar = defaultPolarFor(groundExtent(heightfield));
    this.updateFit();
    this.zoom = 1;

    const flat = this.view === 'flat';
    const end: ViewPose = options.camera
      ? cameraPose(options.camera)
      : {
          phi: flat ? FLAT_POLAR : this.defaultPolar,
          theta: flat ? 0 : DEFAULT_AZIMUTH,
          zoom: 1,
        };
    this.applyViewLimits(this.view);
    if (this.reducedMotion || flat || options.camera) {
      this.setPose(end);
      this.controls.update();
      this.requestRender();
      return;
    }
    // Intro: from straight above, north up, to the oblique view.
    this.setPose({ phi: FLAT_POLAR, theta: 0, zoom: 1 });
    this.animateTo(end, INTRO_MS);
  }

  setExaggeration(exaggeration: number): void {
    this.exaggeration = exaggeration;
    this.route?.setExaggeration(exaggeration);
    this.markers?.setExaggeration(exaggeration);
    if (!this.mesh) return;
    setExaggeration(this.mesh, exaggeration);
    // Keep the taller or flatter model framed (a running tween refits every step).
    this.updateFit();
    this.refit();
    this.requestRender();
  }

  /**
   * Oblique (orbitable) or flat (top-down, north up, rotation off). Turning Flat map off goes back
   * to the oblique pose it was turned on from (angles and zoom), or to the default view if the
   * View opened flat.
   */
  setView(view: TerrainViewMode): void {
    if (view === this.view) return;
    this.view = view;
    if (!this.mesh) return;
    const theta = this.pose().theta;
    if (view === 'flat') {
      // Where a running move (the intro, Rotate view) is headed, else where the camera is now.
      this.obliqueReturn = this.tween ? this.tween.to : this.livePose();
      // Turn the short way round to north-up.
      this.animateTo(
        { phi: FLAT_POLAR, theta: nearestTurn(0, theta), zoom: 1 },
        VIEW_CHANGE_MS,
        () => {
          this.applyViewLimits('flat');
        },
      );
    } else {
      const back = this.obliqueReturn ?? {
        phi: this.defaultPolar,
        theta: DEFAULT_AZIMUTH,
        zoom: 1,
      };
      this.obliqueReturn = null;
      this.applyViewLimits('oblique');
      this.animateTo(
        {
          phi: Math.min(MAX_POLAR, Math.max(MIN_POLAR, back.phi)),
          theta: nearestTurn(back.theta, theta),
          zoom: clampZoom(back.zoom),
        },
        VIEW_CHANGE_MS,
      );
    }
  }

  /** Orbits by `radians` around the vertical axis (positive turns the model clockwise from above). */
  rotateBy(radians: number): void {
    if (!this.mesh || this.view === 'flat') return;
    const pose = this.tween ? this.tween.to : this.pose();
    this.animateTo({ ...pose, theta: pose.theta + radians }, VIEW_CHANGE_MS);
  }

  /** Back to the default framing for the current view mode. */
  resetView(): void {
    if (!this.mesh) return;
    const theta = this.pose().theta;
    const flat = this.view === 'flat';
    this.animateTo(
      {
        phi: flat ? FLAT_POLAR : this.defaultPolar,
        theta: nearestTurn(flat ? 0 : DEFAULT_AZIMUTH, theta),
        zoom: 1,
      },
      VIEW_CHANGE_MS,
    );
  }

  /**
   * Arrow keys orbit (Shift: 3× step), + and − zoom. Returns true when the key was handled, so the
   * caller can prevent the page from scrolling.
   */
  handleKey(key: string, shift = false): boolean {
    if (!this.mesh || this.tween) return false;
    const step = shift ? KEY_STEP * 3 : KEY_STEP;
    const rotate = this.controls.enableRotate;
    switch (key) {
      case 'ArrowLeft':
        if (rotate) this.controls.rotateLeft(step);
        break;
      case 'ArrowRight':
        if (rotate) this.controls.rotateLeft(-step);
        break;
      case 'ArrowUp':
        if (rotate) this.controls.rotateUp(step);
        break;
      case 'ArrowDown':
        if (rotate) this.controls.rotateUp(-step);
        break;
      case '+':
      case '=':
        this.controls.dollyIn(KEY_ZOOM);
        break;
      case '-':
      case '_':
        this.controls.dollyOut(KEY_ZOOM);
        break;
      default:
        return false;
    }
    // The controls' methods already moved the camera (and called update()): frame it now, not on
    // the next frame, so nothing (a render, a poster export) ever sees it unframed.
    this.followControls();
    this.requestRender();
    return true;
  }

  /** CSS-pixel size of the canvas. */
  resize(width: number, height: number): void {
    this.applySize(width, height, Math.min(window.devicePixelRatio || 1, 2));
    if (this.mesh) {
      this.updateFit();
      this.refit();
    }
    this.requestRender();
  }

  private applySize(width: number, height: number, pixelRatio: number, overlays = true) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.figureScale = null;
    this.figureKey = '';
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.size = { width: w, height: h };
    setLensShift(this.camera, w, h, 0, 0); // updates the projection; the refit below re-centres
    this.margins = fitMargins(w, h, this.insets, viewInset(w, h));
    // The overlays sit on the page's box, not on an exported image.
    this.obstacles = overlays ? overlayRects(this.overlays, w, h) : [];
    this.invalidateFit();
    this.route?.setResolution(w, h);
    this.route?.setLineScale(1);
    this.markers?.setViewport(h, this.camera.fov);
    if (this.mesh) this.mesh.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  /**
   * The camera as the user left it, for Poster mode ("Make a poster uses the current camera"):
   * its angles and zoom factor, or where a running camera move (Rotate, Flat map) is heading. In
   * the flat view, top-down and north up.
   */
  viewCamera(): ViewCamera {
    const pose = this.tween ? this.tween.to : this.livePose();
    const zoom = clampZoom(pose.zoom);
    if (this.view === 'flat') return { azimuth: 0, polar: FLAT_POLAR, zoom, view: 'flat' };
    return {
      azimuth: normalizeAzimuth(pose.theta),
      polar: Math.min(MAX_POLAR, Math.max(MIN_POLAR, pose.phi)),
      zoom,
      view: 'oblique',
    };
  }

  /**
   * Draws the terrain, route and markers seen from `camera` as a figure of `frame.width ×
   * frame.height` output px (or the part `frame.tile` of it) into the stage's canvas, sized to the
   * part, synchronously; copy the canvas before the task ends. The model is framed for the whole
   * figure in logical px (`width / scale`), exactly as the View frames its box, and every line
   * width and marker size is logical px times `scale`, so a preview and an export at another
   * scale show the same picture. A tile is the whole figure's camera with a view offset
   * ({@link figureViewOffset}). For an off-screen stage (`interactive: false`).
   */
  renderFigure(camera: ViewCamera, frame: FigureFrame): void {
    if (this.disposed) return;
    const width = Math.max(1, Math.round(frame.width));
    const height = Math.max(1, Math.round(frame.height));
    const scale = frame.scale > 0 && Number.isFinite(frame.scale) ? frame.scale : 1;
    const tile = frame.tile ?? { x: 0, y: 0, width, height };
    const tileWidth = Math.max(1, Math.round(tile.width));
    const tileHeight = Math.max(1, Math.round(tile.height));
    const logical = { width: width / scale, height: height / scale };

    this.figureScale = scale;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(tileWidth, tileHeight, false);
    const key = `${String(width)}×${String(height)}@${String(scale)}`;
    if (key !== this.figureKey) {
      this.figureKey = key;
      this.camera.aspect = width / height;
      this.size = logical;
      this.margins = fitMargins(logical.width, logical.height, this.insets);
      this.obstacles = [];
      this.invalidateFit();
      if (this.mesh) this.updateFit();
    }
    // The canvas is drawn at pixel ratio 1, and `Line2` sets its resolution from the renderer's
    // viewport (the drawn part in output px) before each draw: the widths scale instead.
    this.route?.setResolution(tileWidth, tileHeight);
    this.route?.setLineScale(scale);
    this.markers?.setViewport(logical.height, this.camera.fov);
    this.markers?.setTextureScale(markerTextureScale(scale));
    if (this.mesh) this.mesh.material.uniforms.uPixelRatio.value = scale;

    const pose = cameraPose(camera);
    this.view = camera.view;
    let shiftX = 0;
    let shiftY = 0;
    if (this.mesh) {
      this.setPose(pose);
      ({ shiftX, shiftY } = this.frame(pose.phi, pose.theta));
    }
    applyViewOffset(
      this.camera,
      figureViewOffset(width, height, shiftX, shiftY, {
        x: tile.x,
        y: tile.y,
        width: tileWidth,
        height: tileHeight,
      }),
    );
    this.camera.updateMatrixWorld();
    this.draw();
  }

  /**
   * Renders the current view, framed for a `width × height` image at pixel ratio 1, into a new 2D
   * canvas (the start of the poster export: line widths and marker sizes stay in CSS px of that
   * image; tiling for sizes above the GPU's limits is export.ts's job). The view is the camera's
   * pose as it is now (mid-tween or mid-damping included): nothing steps the controls or the tween,
   * and the camera, the controls and the fit are put back exactly as they were, so exports in a row
   * are identical and the visible view does not move. The visible canvas is resized for the draw,
   * restored and redrawn before returning, all in one task, so it never shows the intermediate
   * frame.
   */
  renderToCanvas(width: number, height: number): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(width));
    out.height = Math.max(1, Math.round(height));
    const saved = this.saveView();
    const pose = this.livePose();
    this.applySize(out.width, out.height, 1, false);
    if (this.mesh) {
      this.updateFit();
      this.setPose(pose);
    }
    this.draw();
    out.getContext('2d')?.drawImage(this.canvas, 0, 0, out.width, out.height);
    this.restoreView(saved);
    this.draw();
    return out;
  }

  /** Everything a refit or a pose changes (camera, controls' pivot and limits, the fit). */
  private saveView() {
    const { camera, controls } = this;
    return {
      size: { ...this.size },
      pixelRatio: this.renderer.getPixelRatio(),
      margins: this.margins,
      framed: this.framed,
      bands: this.bands,
      zoom: this.zoom,
      placedDistance: this.placedDistance,
      pivotY: this.pivotY,
      box: this.box,
      surfacePoints: this.surfacePoints,
      boxes: this.boxes,
      target: this.target.clone(),
      controlsTarget: controls.target.clone(),
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      near: camera.near,
      far: camera.far,
      view: camera.view ? { ...camera.view } : null,
      edgeLevel: this.mesh?.material.uniforms.uEdgeLevel.value,
    };
  }

  private restoreView(saved: ReturnType<TerrainStage['saveView']>) {
    const { camera, controls } = this;
    this.applySize(saved.size.width, saved.size.height, saved.pixelRatio);
    this.margins = saved.margins;
    this.framed = saved.framed;
    this.bands = saved.bands;
    this.zoom = saved.zoom;
    this.placedDistance = saved.placedDistance;
    this.pivotY = saved.pivotY;
    this.box = saved.box;
    this.surfacePoints = saved.surfacePoints;
    this.boxes = saved.boxes;
    this.target.copy(saved.target);
    controls.target.copy(saved.controlsTarget);
    controls.minDistance = saved.minDistance;
    controls.maxDistance = saved.maxDistance;
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.near = saved.near;
    camera.far = saved.far;
    const { view } = saved;
    if (view) {
      camera.setViewOffset(
        view.fullWidth,
        view.fullHeight,
        view.offsetX,
        view.offsetY,
        view.width,
        view.height,
      );
    } else {
      camera.clearViewOffset();
    }
    camera.updateMatrixWorld();
    if (this.mesh && saved.edgeLevel !== undefined) setEdgeLevel(this.mesh, saved.edgeLevel);
  }

  /** Releases everything: the loop, the controls' listeners, GPU resources and the GL context. */
  dispose(): void {
    this.disposed = true;
    if (this.frameId) cancelRaf(this.frameId);
    this.frameId = 0;
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.route?.dispose();
    this.markers?.dispose();
    this.route = null;
    this.markers = null;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeTerrainMesh(this.mesh);
      this.mesh = null;
    }
    this.depthTarget?.depthTexture?.dispose();
    this.depthTarget?.dispose();
    this.depthTarget = null;
    // Lose the context now rather than when the canvas is garbage collected: browsers cap live
    // WebGL contexts (16 in Chrome) and warn, then drop the oldest, on remount after remount.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
