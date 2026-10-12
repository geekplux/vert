import {
  PerspectiveCamera,
  Spherical,
  Vector3,
  WebGLRenderTarget,
  type Sprite,
  type Vector2,
} from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Heightfield } from './heightfield';
import {
  DEFAULT_BASE_DEPTH,
  STYLE_A_PALETTE,
  baseLevel,
  edgeLevels,
  modelBounds,
  visibleEdgeLevel,
  type TerrainMesh,
} from './mesh';
import {
  DEFAULT_AZIMUTH,
  DEFAULT_POLAR,
  FIT_INSET_PX,
  FLAT_POLAR,
  INTRO_MS,
  MAX_POLAR,
  MIN_POLAR,
  OVERLAY_GAP_PX,
  TerrainStage,
  fitMargins,
  frameModel,
  placeCamera,
  ringPoints,
  setLensShift,
} from './stage';
import { markerExtent, type TerrainMarkerKind } from './markers';
import { makeTrack } from './testing';
import type { RouteLayer } from './route';

const DEG = Math.PI / 180;
const WIDTH = 1060;
const HEIGHT = 700;
/** The clearance the page needs at the box's corners (legend chip, icon buttons). */
const SAFE_INSET = 56;

/** jsdom has no WebGL: a renderer that records calls. */
function fakeRenderer() {
  let pixelRatio = 1;
  const renderer = {
    setPixelRatio: vi.fn((value: number) => {
      pixelRatio = value;
    }),
    getPixelRatio: vi.fn(() => pixelRatio),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  return renderer;
}

/** 120 × 80 samples at 30 m, a high hill near the north-east corner and a valley inside. */
function hills(): Heightfield {
  const width = 120;
  const height = 80;
  const elevations = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = i / (width - 1);
      const y = j / (height - 1);
      const e =
        400 +
        600 * Math.exp(-((x - 0.85) ** 2 + (y - 0.15) ** 2) / 0.03) +
        250 * Math.exp(-((x - 0.3) ** 2 + (y - 0.6) ** 2) / 0.05) -
        150 * Math.exp(-((x - 0.55) ** 2 + (y - 0.45) ** 2) / 0.01);
      elevations[j * width + i] = e;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
  }
  return {
    bounds: { west: -84, south: 34.7, east: -83.96, north: 34.72 },
    zoom: 13,
    width,
    height,
    elevations,
    min,
    max,
    metresPerSample: { x: 30, y: 30 },
    failedTiles: [],
  };
}

/** The edge level the stage's mesh currently hangs its base from. */
function edgeLevelOf(stage: TerrainStage): number {
  const mesh = stage.scene.getObjectByName('terrain') as TerrainMesh | undefined;
  if (!mesh) throw new Error('no terrain mesh');
  return mesh.material.uniforms.uEdgeLevel.value;
}

/** Every grid node at `exaggeration`, plus the walls' bottom under every edge node. */
function modelPoints(hf: Heightfield, exaggeration: number, edge: number): Vector3[] {
  const { width: w, height: h, elevations, min } = hf;
  const { width, depth, scale } = modelBounds(hf, exaggeration);
  const base = baseLevel(edge, exaggeration, DEFAULT_BASE_DEPTH);
  const x = (i: number) => (i / (w - 1) - 0.5) * width;
  const z = (j: number) => (j / (h - 1) - 0.5) * depth;
  const points: Vector3[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const y = ((elevations[j * w + i] ?? min) - min) * scale * exaggeration;
      points.push(new Vector3(x(i), y, z(j)));
      // The wall's bottom: on the flat base, or one base depth below an edge that dips lower.
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1) {
        points.push(new Vector3(x(i), Math.min(base, y - DEFAULT_BASE_DEPTH), z(j)));
      }
    }
  }
  return points;
}

/** The model's projected extent on the canvas, CSS px from each side. */
function clearance(stage: TerrainStage, points: Vector3[]) {
  stage.camera.updateMatrixWorld();
  let left = Infinity;
  let right = Infinity;
  let top = Infinity;
  let bottom = Infinity;
  const ndc = new Vector3();
  for (const point of points) {
    ndc.copy(point).project(stage.camera);
    const px = ((ndc.x + 1) / 2) * WIDTH;
    const py = ((1 - ndc.y) / 2) * HEIGHT;
    left = Math.min(left, px);
    right = Math.min(right, WIDTH - px);
    top = Math.min(top, py);
    bottom = Math.min(bottom, HEIGHT - py);
  }
  return { left, right, top, bottom };
}

const spherical = (stage: TerrainStage) =>
  new Spherical().setFromVector3(stage.camera.position.clone().sub(stage.controls.target));

function makeStage() {
  const renderer = fakeRenderer();
  const stage = new TerrainStage(document.createElement('canvas'), {
    createRenderer: () => renderer,
    palette: STYLE_A_PALETTE,
  });
  stage.resize(WIDTH, HEIGHT);
  return { stage, renderer };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fitMargins', () => {
  it(`keeps ${String(FIT_INSET_PX)} px clear on each side of the 1440 terrain box`, () => {
    const margins = fitMargins(WIDTH, HEIGHT);
    expect(((1 - margins.x) / 2) * WIDTH).toBeCloseTo(FIT_INSET_PX);
    expect(((1 - margins.y) / 2) * HEIGHT).toBeCloseTo(FIT_INSET_PX);
  });

  it('shrinks the inset on a small box', () => {
    const margins = fitMargins(300, 240);
    expect(((1 - margins.x) / 2) * 300).toBeCloseTo(36);
    expect(((1 - margins.y) / 2) * 240).toBeCloseTo(28.8);
  });
});

describe('frameModel with screen boxes', () => {
  it('backs off until a fixed-size box around a point fits too, and centres on it', () => {
    const points = ringPoints(1, 0);
    const margins = fitMargins(1000, 500);
    const viewport = { width: 1000, height: 500 };
    const plain = frameModel(points, points, 0, DEFAULT_POLAR, 0, 30, 2, margins);
    // The far rim's point (top of the screen from the south) carries a 60 px tall box.
    const box = { point: new Vector3(0, 0, -1), left: 20, right: 20, up: 60, down: 0 };
    const padded = frameModel(points, points, 0, DEFAULT_POLAR, 0, 30, 2, margins, [box], viewport);
    expect(padded.distance).toBeGreaterThan(plain.distance);
    const camera = new PerspectiveCamera(30, 2, 0.01, 100);
    placeCamera(camera, new Vector3(), padded.distance, DEFAULT_POLAR, 0);
    setLensShift(camera, 1000, 500, padded.shiftX, padded.shiftY);
    camera.updateMatrixWorld();
    const top = box.point.clone().project(camera).y + (box.up * 2) / 500;
    const bottom = new Vector3(0, 0, 1).project(camera).y;
    expect(top).toBeLessThanOrEqual(margins.cy + margins.y + 1e-6);
    expect(bottom).toBeGreaterThanOrEqual(margins.cy - margins.y - 1e-6);
  });
});

describe('TerrainStage framing', () => {
  it.each([1, 1.6, 3])(
    'holds the model inside the box with the corner insets at every azimuth (×%s)',
    (exaggeration) => {
      const hf = hills();
      const { stage } = makeStage();
      stage.show(hf, { exaggeration, view: 'oblique', reducedMotion: true });
      const distances: number[] = [];
      for (let k = 0; k < 8; k++) {
        const s = spherical(stage);
        expect(s.phi).toBeCloseTo(DEFAULT_POLAR);
        expect(s.theta).toBeCloseTo(
          Math.atan2(
            Math.sin(DEFAULT_AZIMUTH + k * 45 * DEG),
            Math.cos(DEFAULT_AZIMUTH + k * 45 * DEG),
          ),
        );
        const c = clearance(stage, modelPoints(hf, exaggeration, edgeLevelOf(stage)));
        expect(Math.min(c.left, c.right, c.top, c.bottom)).toBeGreaterThanOrEqual(SAFE_INSET);
        expect(Math.abs(c.top - c.bottom)).toBeLessThan(6);
        expect(Math.abs(c.left - c.right)).toBeLessThan(6);
        distances.push(s.radius);
        stage.rotateBy(Math.PI / 4); // reduced motion: jumps
      }
      // Only the walls' bottom depends on the azimuth: turning zooms in or out only a little.
      expect(Math.max(...distances) / Math.min(...distances)).toBeLessThan(1.15);
      stage.dispose();
    },
  );

  it.each([
    ['flat', FLAT_POLAR],
    ['20°', MIN_POLAR],
    ['default', DEFAULT_POLAR],
    ['80°', MAX_POLAR],
  ])('fits and centres the model at azimuths 0°–315° (%s polar angle)', (_, phi) => {
    const hf = hills();
    const { stage } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    let tightest = Infinity;
    for (let degrees = 0; degrees < 360; degrees += 45) {
      const pose = stage.fittedPose(phi, degrees * DEG);
      stage.controls.target.set(0, pose.targetY, 0);
      stage.camera.position
        .setFromSpherical(new Spherical(pose.distance, pose.phi, pose.theta))
        .add(stage.controls.target);
      stage.camera.lookAt(stage.controls.target);
      setLensShift(stage.camera, WIDTH, HEIGHT, pose.shiftX, pose.shiftY);
      // With the base where the mesh hangs it at this azimuth.
      const c = clearance(
        stage,
        modelPoints(hf, 1.6, visibleEdgeLevel(edgeLevels(hf), pose.theta)),
      );
      tightest = Math.min(tightest, c.left, c.right, c.top, c.bottom);
      expect(Math.min(c.left, c.right, c.top, c.bottom)).toBeGreaterThanOrEqual(SAFE_INSET);
      // Centred (the centring uses a subgrid of the surface, so allow a few pixels).
      expect(Math.abs(c.top - c.bottom)).toBeLessThan(6);
      expect(Math.abs(c.left - c.right)).toBeLessThan(6);
    }
    // Not framed absurdly small either: some side comes within 3× the inset.
    expect(tightest).toBeLessThan(3 * FIT_INSET_PX);
    stage.dispose();
  });

  it('keeps the model framed when the user drags to about 45°', () => {
    const hf = hills();
    const { stage } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    stage.controls.enableDamping = false;
    stage.controls.rotateLeft(-27 * DEG); // 18° + 27° = 45°
    stage.requestRender();
    vi.advanceTimersByTime(100);
    expect(spherical(stage).theta).toBeCloseTo(45 * DEG, 3);
    const c = clearance(stage, modelPoints(hf, 1.6, edgeLevelOf(stage)));
    expect(Math.min(c.left, c.right, c.top, c.bottom)).toBeGreaterThanOrEqual(SAFE_INSET);
    stage.dispose();
  });

  it('keeps the zoom factor through refits (exaggeration, resize)', () => {
    const hf = hills();
    const { stage } = makeStage();
    stage.show(hf, { exaggeration: 1, view: 'oblique', reducedMotion: true });
    vi.advanceTimersByTime(100);
    const fitted = spherical(stage).radius;
    expect(stage.handleKey('+')).toBe(true);
    vi.advanceTimersByTime(1000);
    const zoomed = spherical(stage).radius;
    expect(zoomed / fitted).toBeCloseTo(0.9, 2);
    stage.setExaggeration(3);
    vi.advanceTimersByTime(100);
    const ratio =
      spherical(stage).radius / stage.fittedPose(DEFAULT_POLAR, DEFAULT_AZIMUTH).distance;
    expect(ratio).toBeCloseTo(0.9, 2);
    stage.resetView();
    vi.advanceTimersByTime(100);
    expect(spherical(stage).radius).toBeCloseTo(
      stage.fittedPose(DEFAULT_POLAR, DEFAULT_AZIMUTH).distance,
    );
    stage.dispose();
  });
});

describe('TerrainStage camera moves', () => {
  it(`plays the intro from top-down to the oblique view in ${String(INTRO_MS)} ms`, () => {
    expect(INTRO_MS).toBe(1200);
    const hf = hills();
    const { stage } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: false });
    expect(spherical(stage).phi).toBeLessThan(1 * DEG);
    expect(stage.controls.enabled).toBe(false);
    vi.advanceTimersByTime(600);
    const mid = spherical(stage).phi;
    expect(mid).toBeGreaterThan(30 * DEG);
    expect(mid).toBeLessThan(DEFAULT_POLAR - 0.5 * DEG);
    vi.advanceTimersByTime(560); // 1160 ms: still moving
    expect(stage.controls.enabled).toBe(false);
    vi.advanceTimersByTime(100); // 1260 ms: done
    expect(stage.controls.enabled).toBe(true);
    expect(spherical(stage).phi).toBeCloseTo(DEFAULT_POLAR);
    expect(spherical(stage).theta).toBeCloseTo(DEFAULT_AZIMUTH);
    stage.dispose();
  });

  it('with reduced motion, shows the final view at once and jumps on rotate (no tween)', () => {
    const hf = hills();
    const { stage, renderer } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    expect(stage.controls.enabled).toBe(true);
    expect(spherical(stage).phi).toBeCloseTo(DEFAULT_POLAR);
    expect(spherical(stage).theta).toBeCloseTo(DEFAULT_AZIMUTH);
    stage.rotateBy(Math.PI / 4);
    expect(stage.controls.enabled).toBe(true);
    expect(spherical(stage).theta).toBeCloseTo(DEFAULT_AZIMUTH + Math.PI / 4);
    vi.advanceTimersByTime(1000);
    // A frame or two (the jump, controls settling), never a 600 ms move.
    expect(renderer.render.mock.calls.length).toBeLessThanOrEqual(3);
    stage.dispose();
  });

  it('limits the polar angle to 20°–80° in the oblique view', () => {
    const hf = hills();
    const { stage } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    expect(stage.controls.minPolarAngle).toBeCloseTo(MIN_POLAR);
    expect(stage.controls.maxPolarAngle).toBeCloseTo(MAX_POLAR);
    expect(MIN_POLAR).toBeCloseTo(20 * DEG);
    expect(MAX_POLAR).toBeCloseTo(80 * DEG);
    for (let k = 0; k < 20; k++) {
      stage.handleKey('ArrowUp', true);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(2000);
    expect(spherical(stage).phi).toBeGreaterThanOrEqual(MIN_POLAR - 1e-6);
    expect(spherical(stage).phi).toBeLessThan(MIN_POLAR + 1 * DEG);
    for (let k = 0; k < 20; k++) {
      stage.handleKey('ArrowDown', true);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(2000);
    expect(spherical(stage).phi).toBeLessThanOrEqual(MAX_POLAR + 1e-6);
    expect(spherical(stage).phi).toBeGreaterThan(MAX_POLAR - 1 * DEG);
    stage.dispose();
  });

  it('loses the GL context before disposing the renderer, and stops drawing', () => {
    const hf = hills();
    const { stage, renderer } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: false });
    vi.advanceTimersByTime(100);
    stage.dispose();
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.dispose.mock.invocationCallOrder[0] ?? 0,
    );
    renderer.render.mockClear();
    vi.advanceTimersByTime(2000);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});

describe('fitMargins with insets', () => {
  it('keeps the larger of the default inset and the overlay plus a gap on each side', () => {
    const margins = fitMargins(WIDTH, HEIGHT, { top: 62, right: 0, bottom: 44, left: 0 });
    // Top: 62 + 12 = 74 px; bottom: max(60, 44 + 12) = 60 px; left and right: 60 px.
    expect(((1 - margins.y) * HEIGHT) / 2).toBeCloseTo((74 + 60) / 2);
    expect(margins.cy).toBeCloseTo((60 - 74) / HEIGHT);
    expect(margins.x).toBeCloseTo(fitMargins(WIDTH, HEIGHT).x);
    expect(margins.cx).toBeCloseTo(0);
    const right = fitMargins(WIDTH, HEIGHT, { top: 0, right: 200, bottom: 0, left: 0 });
    expect(right.cx).toBeCloseTo((60 - 212) / WIDTH);
  });

  it('never leaves the model less than 30% of a side', () => {
    const margins = fitMargins(400, 300, { top: 200, right: 0, bottom: 200, left: 0 });
    expect(margins.y).toBeCloseTo(0.3);
    expect(margins.cy).toBeCloseTo(0);
  });
});

describe('TerrainStage framing with insets', () => {
  const insets = { top: 62, right: 0, bottom: 60, left: 120 };
  const clear = { top: 62 + OVERLAY_GAP_PX, right: 60, bottom: 60 + OVERLAY_GAP_PX, left: 132 };

  it.each([0, 45, 90, 135, 180, 225, 270, 315])(
    'fits the model inside the box minus the insets, centred in what is left (azimuth %s°)',
    (degrees) => {
      const hf = hills();
      const { stage } = makeStage();
      stage.setInsets(insets);
      stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
      stage.rotateBy(degrees * DEG - DEFAULT_AZIMUTH); // reduced motion: jumps
      const c = clearance(stage, modelPoints(hf, 1.6, edgeLevelOf(stage)));
      const slack = FIT_INSET_PX - SAFE_INSET;
      expect(c.top).toBeGreaterThanOrEqual(clear.top - slack);
      expect(c.right).toBeGreaterThanOrEqual(clear.right - slack);
      expect(c.bottom).toBeGreaterThanOrEqual(clear.bottom - slack);
      expect(c.left).toBeGreaterThanOrEqual(clear.left - slack);
      // Centred in the region: equal spare room on opposite sides.
      expect(Math.abs(c.top - clear.top - (c.bottom - clear.bottom))).toBeLessThan(6);
      expect(Math.abs(c.left - clear.left - (c.right - clear.right))).toBeLessThan(6);
      stage.dispose();
    },
  );

  it('refits when the insets change after the model is shown', () => {
    const hf = hills();
    const { stage } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    const before = clearance(stage, modelPoints(hf, 1.6, edgeLevelOf(stage)));
    stage.setInsets({ top: 150, right: 0, bottom: 0, left: 0 });
    const after = clearance(stage, modelPoints(hf, 1.6, edgeLevelOf(stage)));
    expect(before.top).toBeLessThan(150);
    expect(after.top).toBeGreaterThanOrEqual(150 + OVERLAY_GAP_PX - 4);
    stage.dispose();
  });
});

describe('TerrainStage renders only framed views', () => {
  /** Distance and lens shift the stage would use for the camera's current angles and zoom. */
  function expectFramed(stage: TerrainStage, zoom = 1) {
    const s = spherical(stage);
    const pose = stage.fittedPose(s.phi, s.theta);
    expect(s.radius).toBeCloseTo(pose.distance * zoom, 6);
    expect(stage.controls.target.y).toBeCloseTo(pose.targetY, 9);
    expect(stage.camera.view?.offsetX).toBeCloseTo((pose.shiftX * WIDTH) / 2, 6);
    expect(stage.camera.view?.offsetY).toBeCloseTo((-pose.shiftY * HEIGHT) / 2, 6);
  }

  it('frames the camera as soon as a key orbits or zooms, before any frame', () => {
    const hf = hills();
    const { stage, renderer } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    vi.advanceTimersByTime(100);
    renderer.render.mockClear();
    stage.controls.enableDamping = false;
    expect(stage.handleKey('ArrowLeft', true)).toBe(true);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(spherical(stage).theta).toBeCloseTo(DEFAULT_AZIMUTH - 15 * DEG, 6);
    expectFramed(stage);
    stage.handleKey('+');
    expectFramed(stage, 0.9);
    stage.dispose();
  });

  it('refits in renderNow after the controls moved the camera directly', () => {
    const hf = hills();
    const { stage, renderer } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    vi.advanceTimersByTime(100);
    stage.controls.enableDamping = false;
    stage.controls.rotateLeft(-50 * DEG); // OrbitControls updates the camera itself
    const seen: { radius: number; fitted: number }[] = [];
    renderer.render.mockImplementation(() => {
      const s = spherical(stage);
      seen.push({ radius: s.radius, fitted: stage.fittedPose(s.phi, s.theta).distance });
    });
    stage.renderNow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.radius).toBeCloseTo(seen[0]?.fitted ?? 0, 6);
    expectFramed(stage);
    stage.dispose();
  });

  it('renders an image of another size framed for it, and restores the view', () => {
    const hf = hills();
    const { stage, renderer } = makeStage();
    stage.show(hf, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    vi.advanceTimersByTime(100);
    renderer.setSize.mockClear();
    const aspects: number[] = [];
    renderer.render.mockImplementation(() => {
      aspects.push(stage.camera.aspect);
    });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const image = stage.renderToCanvas(1080, 1350);
    expect([image.width, image.height]).toEqual([1080, 1350]);
    expect(renderer.setSize.mock.calls).toEqual([
      [1080, 1350, false],
      [WIDTH, HEIGHT, false],
    ]);
    expect(aspects).toEqual([1080 / 1350, WIDTH / HEIGHT]);
    expectFramed(stage);
    getContext.mockRestore();
    stage.dispose();
  });
});

describe('TerrainStage exports', () => {
  /** Everything that says where the camera is and how it projects. */
  const cameraState = (stage: TerrainStage) => [
    ...stage.camera.position.toArray(),
    ...stage.camera.quaternion.toArray(),
    ...stage.camera.projectionMatrix.elements,
    ...stage.controls.target.toArray(),
    stage.controls.minDistance,
    stage.controls.maxDistance,
  ];

  it.each([
    ['mid-tween', false],
    ['with damping pending', true],
  ])('renders the same image twice in a row %s, without moving the camera', (_, damping) => {
    const { stage, renderer } = makeStage();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: damping });
    if (damping) {
      vi.advanceTimersByTime(100);
      // A drag's leftover: OrbitControls would apply it bit by bit on update().
      stage.controls.rotateLeft(20 * DEG);
    } else {
      vi.advanceTimersByTime(300); // the intro is easing
      expect(spherical(stage).phi).toBeLessThan(DEFAULT_POLAR - 5 * DEG);
    }
    const update = vi.spyOn(stage.controls, 'update');
    const before = cameraState(stage);
    const drawn: number[][] = [];
    renderer.render.mockImplementation(() => {
      drawn.push(cameraState(stage));
    });
    stage.renderToCanvas(1080, 1350);
    stage.renderToCanvas(1080, 1350);
    expect(update).not.toHaveBeenCalled();
    expect(cameraState(stage)).toEqual(before);
    // Export, screen, export, screen: the exports match, and the screen frames are unchanged.
    expect(drawn).toHaveLength(4);
    expect(drawn[2]).toEqual(drawn[0]);
    expect(drawn[0]).not.toEqual(before);
    expect(drawn[1]).toEqual(before);
    expect(drawn[3]).toEqual(before);
    getContext.mockRestore();
    stage.dispose();
  });
});

describe('TerrainStage route and markers', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const track = makeTrack(
    [
      [34.705, -83.99],
      [34.71, -83.985],
      [34.716, -83.965],
      [34.706, -83.97],
      [34.7051, -83.9899],
    ],
    [500, 600, 950, 700, 501],
  );

  const routeOf = (stage: TerrainStage) =>
    stage.scene.getObjectByName('route') as Line2 | undefined;

  it('drapes the route once both the heightfield and the track are there', () => {
    const { stage } = makeStage();
    stage.setTrack(track);
    expect(routeOf(stage)).toBeUndefined();
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    const route = routeOf(stage);
    expect(route).toBeDefined();
    expect(stage.scene.getObjectByName('route-halo')).toBeDefined();
    expect(stage.scene.getObjectByName('marker-start')).toBeDefined();
    expect(stage.scene.getObjectByName('marker-summit')).toBeDefined();
    expect(stage.scene.getObjectByName('marker-finish')).toBeUndefined(); // a loop
    expect(route?.material.uniforms.uExaggeration?.value).toBe(1.6);
    stage.setExaggeration(2.2);
    expect(route?.material.uniforms.uExaggeration?.value).toBe(2.2);
    stage.dispose();
  });

  it('moves the scrub marker without rebuilding anything', () => {
    const { stage, renderer } = makeStage();
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    stage.setTrack(track);
    vi.advanceTimersByTime(100);
    const route = routeOf(stage);
    const scrub = stage.scene.getObjectByName('marker-scrub');
    if (!scrub) throw new Error('no scrub marker');
    expect(scrub.visible).toBe(false);
    renderer.render.mockClear();
    stage.setScrub(800);
    expect(scrub.visible).toBe(true);
    const first = scrub.position.clone();
    stage.setScrub(1600);
    expect(scrub.position.equals(first)).toBe(false);
    vi.advanceTimersByTime(100);
    expect(renderer.render).toHaveBeenCalledTimes(1); // both moves in one frame
    expect(routeOf(stage)).toBe(route);
    expect(stage.scene.getObjectByName('marker-scrub')).toBe(scrub);
    stage.setScrub(null);
    expect(scrub.visible).toBe(false);
    stage.dispose();
  });

  it.each([0, 45, 90, 135, 180, 225, 270, 315])(
    'keeps the markers and the scrub marker’s room inside the fit region (azimuth %s°)',
    (degrees) => {
      // Summit on the high hill near the north-east corner.
      const summitTrack = makeTrack(
        [
          [34.705, -83.995],
          [34.712, -83.975],
          [34.717, -83.966],
        ],
        [420, 700, 990],
      );
      const { stage } = makeStage();
      stage.show(hills(), { exaggeration: 3, view: 'oblique', reducedMotion: true });
      stage.setTrack(summitTrack);
      stage.rotateBy(degrees * DEG - DEFAULT_AZIMUTH); // reduced motion: jumps
      stage.camera.updateMatrixWorld();
      const ndc = new Vector3();
      let tightest = Infinity;
      const check = (point: Vector3, kind: TerrainMarkerKind) => {
        const e = markerExtent(kind);
        ndc.copy(point).project(stage.camera);
        const x = ((ndc.x + 1) / 2) * WIDTH;
        const y = ((1 - ndc.y) / 2) * HEIGHT;
        tightest = Math.min(
          tightest,
          x - e.left,
          WIDTH - x - e.right,
          y - e.up,
          HEIGHT - y - e.down,
        );
      };
      for (const kind of ['start', 'finish', 'summit'] as const) {
        const sprite = stage.scene.getObjectByName(`marker-${kind}`);
        if (!sprite) throw new Error(`no ${kind} marker`);
        check(sprite.position, kind);
      }
      // The scrub marker can be anywhere on the route.
      const route = (stage as unknown as { route: RouteLayer }).route;
      const p = route.positions;
      for (let k = 0; k < p.length; k += 3) {
        check(new Vector3(p[k], (p[k + 1] ?? 0) * 3, p[k + 2]), 'scrub');
      }
      expect(tightest).toBeGreaterThanOrEqual(FIT_INSET_PX - 0.5);
      stage.dispose();
    },
  );

  it('renders the terrain depth and the route visibility before each frame, then the scene', () => {
    const renderer = {
      ...fakeRenderer(),
      setRenderTarget: vi.fn(),
      getDrawingBufferSize: vi.fn((target: { set: (x: number, y: number) => unknown }) =>
        target.set(WIDTH * 2, HEIGHT * 2),
      ),
    };
    const stage = new TerrainStage(document.createElement('canvas'), {
      createRenderer: () => renderer as unknown as ReturnType<typeof fakeRenderer>,
      palette: STYLE_A_PALETTE,
    });
    stage.resize(WIDTH, HEIGHT);
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    stage.setTrack(track);
    vi.advanceTimersByTime(100);
    const route = routeOf(stage);
    const mesh = stage.scene.getObjectByName('terrain') as TerrainMesh | undefined;
    if (!route || !mesh) throw new Error('no route');
    const seen: { target: unknown; routeShown: boolean; colour: boolean }[] = [];
    let target: unknown = null;
    renderer.setRenderTarget.mockImplementation((value: unknown) => {
      target = value;
    });
    renderer.render.mockImplementation(() => {
      seen.push({
        target,
        routeShown: route.parent?.visible ?? false,
        colour: mesh.material.colorWrite,
      });
    });
    stage.renderNow();
    // Terrain depth, five route visibility passes (route.ts, visibility.ts), the scene.
    expect(seen).toHaveLength(7);
    const depthTarget = seen[0]?.target;
    expect(depthTarget).toBeInstanceOf(WebGLRenderTarget);
    expect(seen[0]).toMatchObject({ routeShown: false, colour: false });
    for (const pass of seen.slice(1, 6)) {
      expect(pass.target).toBeInstanceOf(WebGLRenderTarget);
      expect(pass.target).not.toBe(depthTarget);
    }
    expect(seen[6]).toEqual({ target: null, routeShown: true, colour: true });
    if (!(depthTarget instanceof WebGLRenderTarget)) throw new Error('no depth target');
    expect([depthTarget.width, depthTarget.height]).toEqual([WIDTH * 2, HEIGHT * 2]);
    const visibility = seen[1]?.target as WebGLRenderTarget;
    expect(route.material.uniforms.uRouteVisibility?.value).toBe(visibility.texture);
    expect(route.material.uniforms.uRouteVisibilityOn?.value).toBe(1);
    expect((route.material.uniforms.uRouteBuffer?.value as Vector2).toArray()).toEqual([
      WIDTH * 2,
      HEIGHT * 2,
    ]);
    const dispose = vi.spyOn(depthTarget, 'dispose');
    stage.dispose();
    expect(dispose).toHaveBeenCalled();
  });

  it('keeps the scrub position across a rebuild for a new heightfield', () => {
    const { stage } = makeStage();
    stage.setTrack(track);
    stage.setScrub(1200);
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    expect(stage.scene.getObjectByName('marker-scrub')?.visible).toBe(true);
    stage.dispose();
  });

  it('frees the route and markers on a new heightfield, a cleared track and dispose', () => {
    const { stage } = makeStage();
    stage.setTrack(track);
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    const spiesFor = () => {
      const route = routeOf(stage);
      const halo = stage.scene.getObjectByName('route-halo') as Line2 | undefined;
      const sprites = ['start', 'summit', 'scrub'].map(
        (kind) => stage.scene.getObjectByName(`marker-${kind}`) as Sprite | undefined,
      );
      if (!route || !halo) throw new Error('no route');
      return [
        vi.spyOn(route.geometry, 'dispose'),
        vi.spyOn(route.material, 'dispose'),
        vi.spyOn(halo.material, 'dispose'),
        ...sprites.flatMap((sprite) => {
          if (!sprite?.material.map) throw new Error('no sprite');
          return [vi.spyOn(sprite.material, 'dispose'), vi.spyOn(sprite.material.map, 'dispose')];
        }),
      ];
    };
    let spies = spiesFor();
    stage.show(hills(), { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(routeOf(stage)).toBeDefined();

    spies = spiesFor();
    stage.setTrack(null);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(routeOf(stage)).toBeUndefined();
    expect(stage.scene.getObjectByName('marker-layer')).toBeUndefined();

    stage.setTrack(track);
    spies = spiesFor();
    stage.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
