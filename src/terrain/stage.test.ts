import { Spherical, Vector3 } from 'three';
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
  TerrainStage,
  fitMargins,
  setLensShift,
} from './stage';

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
