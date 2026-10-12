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
 * times a zoom factor the wheel, pinch and + / − keys change.
 */
import { PerspectiveCamera, Scene, Spherical, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Heightfield } from './heightfield';
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

/** The renderer methods the stage uses; tests inject a fake (jsdom has no WebGL). */
export type StageRenderer = Pick<
  WebGLRenderer,
  'setPixelRatio' | 'getPixelRatio' | 'setSize' | 'render' | 'dispose' | 'forceContextLoss'
>;

export type RendererFactory = (canvas: HTMLCanvasElement) => StageRenderer;

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

export const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Fractions of the viewport (in NDC, per axis) the model may fill. */
export interface FitMargins {
  readonly x: number;
  readonly y: number;
}

/** The NDC margins that keep {@link FIT_INSET_PX} clear on each side of a `width × height` box. */
export function fitMargins(width: number, height: number): FitMargins {
  const margin = (side: number) => {
    const inset = Math.min(FIT_INSET_PX, side * FIT_INSET_MAX_FRACTION);
    return 1 - (2 * inset) / Math.max(side, 1);
  };
  return { x: margin(width), y: margin(height) };
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

/** Projected extent of points, NDC, for a camera `distance` from the pivot (no lens shift). */
interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function projector(targetY: number, phi: number, theta: number, fovDeg: number, aspect: number) {
  const { right, up, back } = cameraAxes(phi, theta);
  const tanY = Math.tan((fovDeg * DEG) / 2);
  const q = new Vector3();
  /** Extent of `points` seen from `distance`; null when a point is at or behind the camera. */
  const extent = (points: readonly Vector3[], distance: number): Extent | null => {
    const e: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const point of points) {
      q.copy(point).setY(point.y - targetY);
      const depth = distance - q.dot(back);
      if (depth <= 1e-9) return null;
      const x = q.dot(right) / (depth * tanY * aspect);
      const y = q.dot(up) / (depth * tanY);
      e.minX = Math.min(e.minX, x);
      e.maxX = Math.max(e.maxX, x);
      e.minY = Math.min(e.minY, y);
      e.maxY = Math.max(e.maxY, y);
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
 * - `distance`: the smallest at which the projected extent of `fitPoints` spans at most
 *   2 × `margins` on each axis (a lens shift can then centre it, so only the span matters);
 * - `shiftX`/`shiftY`: the projected centre of `centrePoints` at that distance, for the lens shift
 *   that centres them on screen.
 *
 * When `centrePoints` lie inside the convex hull of `fitPoints` (the real model inside its
 * revolved outline), their extent is no larger, so once centred they keep the margins too.
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
): { distance: number; shiftX: number; shiftY: number } {
  const { extent, nearest } = projector(targetY, phi, theta, fovDeg, aspect);
  const fits = (distance: number) => {
    const e = extent(fitPoints, distance);
    return e !== null && e.maxX - e.minX <= 2 * margins.x && e.maxY - e.minY <= 2 * margins.y;
  };
  let lo = Math.max(0, nearest(fitPoints));
  let hi = lo + 1;
  while (!fits(hi) && hi < 1e6) hi = lo + (hi - lo) * 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const e = centrePoints.length > 0 ? extent(centrePoints, hi) : null;
  return {
    distance: hi,
    shiftX: e ? (e.minX + e.maxX) / 2 : 0,
    shiftY: e ? (e.minY + e.maxY) / 2 : 0,
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
  private readonly palette: TerrainPalette;
  private readonly onFrame?: (renderMs: number) => void;
  private mesh: TerrainMesh | null = null;
  private heightfield: Heightfield | null = null;
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

  constructor(canvas: HTMLCanvasElement, options: StageOptions) {
    this.palette = options.palette;
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
      this.followControls();
    }
    if (this.mesh) {
      const bounds = this.boundsCentreRadius();
      updateDepthRange(this.mesh, this.camera, bounds.center, bounds.radius);
    }
    const start = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(performance.now() - start);
    if (this.mesh && this.firstFrame) {
      const callback = this.firstFrame;
      this.firstFrame = null;
      callback();
    }
    if (again) this.requestRender();
  };

  /**
   * After OrbitControls moved the camera: a changed distance is the user zooming (kept as the zoom
   * factor); then the distance and pivot are refitted for the new polar angle.
   */
  private followControls() {
    if (!this.mesh) return;
    const offset = new Spherical().setFromVector3(this.camera.position.clone().sub(this.target));
    const placed = this.placedDistance;
    if (placed > 0 && Math.abs(offset.radius - placed) > placed * 1e-6) {
      this.zoom = clampZoom((this.zoom * offset.radius) / placed);
    }
    this.setPose({ phi: offset.phi, theta: offset.theta, zoom: this.zoom });
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

  /** The fitted distance and lens shift for a camera at `phi`/`theta`. */
  private frame(phi: number, theta: number) {
    const framed = this.framed;
    if (framed?.phi === phi && framed.theta === theta) return framed;
    const { fit, centre } = this.framePoints(theta);
    const { aspect } = this.camera;
    const result = frameModel(fit, centre, this.pivotY, phi, theta, FOV, aspect, this.margins);
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
    this.requestRender();
    return true;
  }

  /** CSS-pixel size of the canvas. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.size = { width: w, height: h };
    setLensShift(this.camera, w, h, 0, 0); // updates the projection; the refit below re-centres
    this.margins = fitMargins(w, h);
    this.framed = null;
    if (this.mesh) {
      this.mesh.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
      this.updateFit();
      this.refit();
    }
    this.requestRender();
  }

  /** Releases everything: the loop, the controls' listeners, GPU resources and the GL context. */
  dispose(): void {
    this.disposed = true;
    if (this.frameId) cancelRaf(this.frameId);
    this.frameId = 0;
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeTerrainMesh(this.mesh);
      this.mesh = null;
    }
    // Lose the context now rather than when the canvas is garbage collected: browsers cap live
    // WebGL contexts (16 in Chrome) and warn, then drop the oldest, on remount after remount.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }
}
