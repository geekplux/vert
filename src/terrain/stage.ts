/**
 * The imperative half of TerrainView: one renderer, one camera, OrbitControls, the terrain mesh and
 * a render loop that only runs while something moves (a drag, damping, a camera tween). Idle, it
 * schedules nothing.
 *
 * Camera: spherical coordinates around a pivot on the model's vertical axis. `phi` is the polar
 * angle from straight down (0 = top-down map, π/2 = horizon), `theta` the azimuth (0 = looking
 * north from the south, positive = the camera east of south).
 *
 * Framing: the camera distance is fitted to the surface's outline revolved around the vertical
 * axis ({@link radialHull}) plus the walls' bottom edge for the current azimuth, so the model stays
 * inside the box (and clear of the legend chip and the icon buttons in its corners) however it is
 * turned. The surface part, which sets the width, does not depend on the azimuth, so turning the
 * model barely changes the distance. Distance and pivot height follow the camera as the user drags,
 * times a zoom factor the wheel, pinch and + / − keys change. The page can reserve more room on any
 * side for overlays that stay on top of the box (`setInsets`); the model is fitted and centred in
 * what is left. The markers' drawn shapes and the scrub marker's room along the route are fitted
 * too (as boxes of fixed screen size), so they keep the same clearance.
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
import type { RunTrack } from '../page/types';
import type { Heightfield } from './heightfield';
import { createMarkerLayer, markerExtent, type MarkerLayer } from './markers';
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
/** OrbitControls polar limits for the oblique view (prompt: 20°–80°). */
export const MIN_POLAR = 20 * DEG;
export const MAX_POLAR = 80 * DEG;
/** The default oblique view. */
export const DEFAULT_POLAR = 62 * DEG;
/**
 * The default azimuth: the camera 18° east of south (DECISIONS.md's "−18°", a bearing measured the
 * other way round), so the east wall shows its stepped row ends on the right, as in the canvas.
 */
export const DEFAULT_AZIMUTH = 18 * DEG;
/** Top-down, a hair off 0 so `lookAt` keeps north up. */
export const FLAT_POLAR = 1e-4;
export const INTRO_MS = 1200;
export const VIEW_CHANGE_MS = 600;
export const FOV = 30;
/**
 * Clear space between the model and each side of the box, CSS px: the legend chip (≈ 40 px tall)
 * sits in the top-left corner and the 44 px icon buttons in the bottom-right one. On small boxes
 * the inset shrinks to {@link FIT_INSET_MAX_FRACTION} of the side.
 */
export const FIT_INSET_PX = 60;
const FIT_INSET_MAX_FRACTION = 0.12;
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
/** Clear space kept between an overlay's inset and the model, CSS px. */
export const OVERLAY_GAP_PX = 12;
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
 * The fit region of a `width × height` box: each side keeps the default clearance
 * ({@link FIT_INSET_PX}, or 12% of a small side), or the page's inset on that side plus
 * {@link OVERLAY_GAP_PX}, whichever is larger. If the two sides of an axis would leave less than
 * 30% of it, both shrink in proportion.
 */
export function fitMargins(width: number, height: number, insets: Insets = NO_INSETS): FitMargins {
  const axis = (side: number, a: number, b: number) => {
    const size = Math.max(side, 1);
    const rule = Math.min(FIT_INSET_PX, size * FIT_INSET_MAX_FRACTION);
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
  // NDC per CSS px.
  const perX = 2 / Math.max(1, viewport.width);
  const perY = 2 / Math.max(1, viewport.height);
  const q = new Vector3();
  /** NDC of `point` seen from `distance`, into `out`; false when at or behind the camera. */
  const project = (point: Vector3, distance: number, out: { x: number; y: number }) => {
    q.copy(point).setY(point.y - targetY);
    const depth = distance - q.dot(back);
    if (depth <= 1e-9) return false;
    out.x = q.dot(right) / (depth * tanY * aspect);
    out.y = q.dot(up) / (depth * tanY);
    return true;
  };
  const p = { x: 0, y: 0 };
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
    for (const point of points) {
      if (!project(point, distance, p)) return null;
      e.minX = Math.min(e.minX, p.x);
      e.maxX = Math.max(e.maxX, p.x);
      e.minY = Math.min(e.minY, p.y);
      e.maxY = Math.max(e.maxY, p.y);
    }
    for (const box of boxes) {
      if (!project(box.point, distance, p)) return null;
      e.minX = Math.min(e.minX, p.x - box.left * perX);
      e.maxX = Math.max(e.maxX, p.x + box.right * perX);
      e.minY = Math.min(e.minY, p.y - box.down * perY);
      e.maxY = Math.max(e.maxY, p.y + box.up * perY);
    }
    return e;
  };
  /** Farthest any point lies towards the camera from the pivot. */
  const nearest = (points: readonly Vector3[]) => {
    let most = -Infinity;
    for (const point of points)
      most = Math.max(
        most,
        q
          .copy(point)
          .setY(point.y - targetY)
          .dot(back),
      );
    return most;
  };
  return { extent, nearest };
}

/**
 * Frames a model for a camera orbiting the pivot (0, `targetY`, 0) at `phi`/`theta`:
 *
 * - `distance`: the smallest at which the projected extent of `fitPoints` and `boxes` spans at
 *   most 2 × `margins` on each axis (a lens shift can then centre it, so only the span matters);
 * - `shiftX`/`shiftY`: the lens shift that puts the projected centre of `centrePoints` and `boxes`
 *   at that distance on the region's centre (`margins.cx`, `margins.cy`).
 *
 * When `centrePoints` lie inside the convex hull of `fitPoints` (the real model inside its
 * revolved outline), their extent is no larger, so once centred they keep the margins too. The
 * `boxes` (marker sprites, sizes in CSS px of a `viewport`-sized image) count in both.
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
): { distance: number; shiftX: number; shiftY: number } {
  const { extent, nearest } = projector(targetY, phi, theta, fovDeg, aspect, viewport);
  const fits = (distance: number) => {
    const e = extent(fitPoints, distance, boxes);
    return e !== null && e.maxX - e.minX <= 2 * margins.x && e.maxY - e.minY <= 2 * margins.y;
  };
  let lo = Math.max(0, nearest(fitPoints), nearest(boxes.map((box) => box.point)));
  let hi = lo + 1;
  while (!fits(hi) && hi < 1e6) hi = lo + (hi - lo) * 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const e = centrePoints.length + boxes.length > 0 ? extent(centrePoints, hi, boxes) : null;
  return {
    distance: hi,
    shiftX: (e ? (e.minX + e.maxX) / 2 : 0) - margins.cx,
    shiftY: (e ? (e.minY + e.maxY) / 2 : 0) - margins.cy,
  };
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
}

export interface ShowOptions {
  exaggeration: number;
  view: TerrainViewMode;
  /** Skip the intro camera move (prefers-reduced-motion); the view fades instead. */
  reducedMotion: boolean;
  /** Called after the first frame with this heightfield has been drawn. */
  onFirstFrame?: () => void;
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
  private exaggeration = 1;
  private view: TerrainViewMode = 'oblique';
  private readonly target = new Vector3();
  /** The model's box (for the line fade's depth range). */
  private box = { width: 1, depth: 1, bottom: 0, top: 0 };
  /** Exaggeration-1 outline and edge levels of the current heightfield. */
  private hull: RadialPoint[] = [];
  private edges: EdgeLevels = { north: 0, south: 0, east: 0, west: 0 };
  /** The revolved surface outline at the current exaggeration (the base ring is added per pose). */
  private surfacePoints: Vector3[] = [];
  /** The surface on a coarse subgrid (exaggeration 1), for centring the model on screen. */
  private surfaceSamples: EdgePoint[] = [];
  /** Points along the grid's edge, for the walls' bottom. */
  private edgeSamples: EdgePoint[] = [];
  private margins: FitMargins = fitMargins(1, 1);
  private size = { width: 1, height: 1 };
  /** Orbit pivot height: half the model's height, on its vertical axis. */
  private pivotY = 0;
  /** Last framing, keyed by the camera angles (frames without camera moves reuse it). */
  private framed: {
    phi: number;
    theta: number;
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

  constructor(canvas: HTMLCanvasElement, options: StageOptions) {
    this.canvas = canvas;
    this.palette = options.palette;
    this.routePalette = options.routePalette ?? APP_ROUTE_PALETTE;
    this.onFrame = options.onFrame;
    this.renderer = (options.createRenderer ?? createWebGLRenderer)(canvas);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.enablePan = false;
    controls.minPolarAngle = MIN_POLAR;
    controls.maxPolarAngle = MAX_POLAR;
    controls.rotateSpeed = 0.6;
    controls.addEventListener('change', this.requestRender);
    this.controls = controls;
    placeCamera(this.camera, this.target, 3, DEFAULT_POLAR, DEFAULT_AZIMUTH);
  }

  /** Schedules one frame (no-op when one is already pending). */
  readonly requestRender = (): void => {
    if (this.frameId || this.disposed) return;
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
      pixelRatio: renderer.getPixelRatio(),
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

  /** The walls' bottom edge with the flat base at `bottom`. */
  private wallBottom(bottom: number): Vector3[] {
    return this.edgeSamples.map(
      ({ x, y, z }) =>
        new Vector3(x, Math.min(bottom, y * this.exaggeration - DEFAULT_BASE_DEPTH), z),
    );
  }

  /** Points to fit (the revolved outline) and to centre (the model itself) at azimuth `theta`. */
  private framePoints(theta: number) {
    const bottom = this.wallBottom(this.bottomFor(theta));
    const surface = this.surfaceSamples.map(
      ({ x, y, z }) => new Vector3(x, y * this.exaggeration, z),
    );
    return { fit: [...this.surfacePoints, ...bottom], centre: [...surface, ...bottom] };
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
      const add = (k: number) => {
        const point = new Vector3(
          positions[k * 3] ?? 0,
          (positions[k * 3 + 1] ?? 0) * ex,
          positions[k * 3 + 2] ?? 0,
        );
        boxes.push({ point, ...scrub });
      };
      for (let k = 0; k < count; k += step) add(k);
      if (count > 0 && (count - 1) % step !== 0) add(count - 1);
    }
    for (const { kind, position } of this.markers?.fixedMarkers() ?? []) {
      boxes.push({ point: position.setY(position.y * ex), ...pad(markerExtent(kind)) });
    }
    this.boxes = boxes;
  }

  /** The fitted distance and lens shift for a camera at `phi`/`theta`. */
  private frame(phi: number, theta: number) {
    const framed = this.framed;
    if (framed?.phi === phi && framed.theta === theta) return framed;
    const { fit, centre } = this.framePoints(theta);
    const { aspect } = this.camera;
    const result = frameModel(
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
    );
    this.framed = { phi, theta, ...result };
    return this.framed;
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
    this.framed = null;
    // Zoom limits wide enough that the zoom factor's clamp, not OrbitControls', is the one that
    // binds, at any polar angle and azimuth.
    const fits = [FLAT_POLAR, MIN_POLAR, MAX_POLAR].flatMap((phi) =>
      [0, 1, 2, 3].map((k) => {
        const theta = (k * Math.PI) / 2;
        const { fit } = this.framePoints(theta);
        const { aspect } = this.camera;
        return frameModel(fit, [], this.pivotY, phi, theta, FOV, aspect, this.margins).distance;
      }),
    );
    this.controls.minDistance = Math.min(...fits) * MIN_ZOOM * 0.75;
    this.controls.maxDistance = Math.max(...fits) * MAX_ZOOM * 1.3;
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
      this.framed = null;
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
    this.margins = fitMargins(this.size.width, this.size.height, this.insets);
    this.framed = null;
    if (this.mesh) {
      this.updateFit();
      this.refit();
    }
    this.requestRender();
  }

  /** Shows a heightfield (or nothing). A new heightfield plays the intro unless reduced motion. */
  show(heightfield: Heightfield | null, options: ShowOptions): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeTerrainMesh(this.mesh);
      this.mesh = null;
    }
    this.heightfield = heightfield;
    this.tween = null;
    this.controls.enabled = true;
    if (!heightfield) {
      this.rebuildRoute();
      this.requestRender();
      return;
    }
    this.exaggeration = options.exaggeration;
    this.view = options.view;
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
    this.updateFit();
    this.zoom = 1;

    const flat = this.view === 'flat';
    const end: ViewPose = {
      phi: flat ? FLAT_POLAR : DEFAULT_POLAR,
      theta: flat ? 0 : DEFAULT_AZIMUTH,
      zoom: 1,
    };
    this.applyViewLimits(this.view);
    if (this.reducedMotion || flat) {
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

  /** Oblique (orbitable) or flat (top-down, north up, rotation off). */
  setView(view: TerrainViewMode): void {
    if (view === this.view) return;
    this.view = view;
    if (!this.mesh) return;
    const theta = this.pose().theta;
    if (view === 'flat') {
      // Turn the short way round to north-up.
      this.animateTo(
        { phi: FLAT_POLAR, theta: nearestTurn(0, theta), zoom: 1 },
        VIEW_CHANGE_MS,
        () => {
          this.applyViewLimits('flat');
        },
      );
    } else {
      this.applyViewLimits('oblique');
      this.animateTo(
        { phi: DEFAULT_POLAR, theta: nearestTurn(DEFAULT_AZIMUTH, theta), zoom: 1 },
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
        phi: flat ? FLAT_POLAR : DEFAULT_POLAR,
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

  private applySize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.size = { width: w, height: h };
    setLensShift(this.camera, w, h, 0, 0); // updates the projection; the refit below re-centres
    this.margins = fitMargins(w, h, this.insets);
    this.framed = null;
    this.route?.setResolution(w, h);
    this.markers?.setViewport(h, this.camera.fov);
    if (this.mesh) this.mesh.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
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
    this.applySize(out.width, out.height, 1);
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
