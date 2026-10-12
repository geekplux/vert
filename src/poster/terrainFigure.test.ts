import { Matrix4, PerspectiveCamera, Spherical, Vector3 } from 'three';
import type { Camera, Object3D, Vector4, WebGLRenderer } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW_CAMERA } from '../terrain/camera';
import type { ViewCamera } from '../terrain/camera';
import { TerrainStage, applyViewOffset, figureViewOffset, setLensShift } from '../terrain/stage';
import type { PixelRect, StageRenderer } from '../terrain/stage';
import { STYLE_A_PALETTE } from '../terrain/mesh';
import { hills, makeTrack } from '../terrain/testing';
import {
  TILE_BLEED,
  TRAIL_SIGN_ROUTE_PALETTE,
  TerrainFigureRenderer,
  bleedRect,
  figurePixelSize,
} from './terrainFigure';
import type { TerrainFigureScene } from './terrainFigure';

/** Where a world point lands, px from the image's (or tile's) top-left corner. */
function pixelOf(
  point: Vector3,
  projection: Matrix4,
  view: Matrix4,
  width: number,
  height: number,
) {
  const p = point.clone().applyMatrix4(view).applyMatrix4(projection);
  return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
}

/** Points spread around the origin, in front of a camera looking at it. */
const POINTS = Array.from({ length: 60 }, (_, k) => {
  const a = k * 2.399;
  return new Vector3(Math.cos(a) * (0.1 + k / 120), ((k % 7) - 3) * 0.05, Math.sin(a) * 0.4);
});

/** A 2 × 2 grid of uneven tiles covering a `width × height` image. */
function quarters(width: number, height: number): PixelRect[] {
  const x = Math.round(width * 0.37);
  const y = Math.round(height * 0.61);
  return [
    { x: 0, y: 0, width: x, height: y },
    { x, y: 0, width: width - x, height: y },
    { x: 0, y, width: x, height: height - y },
    { x, y, width: width - x, height: height - y },
  ];
}

describe('figureViewOffset', () => {
  it('a tile’s camera puts every point on the full frame’s pixel, moved by the tile’s corner', () => {
    const width = 1317;
    const height = 903;
    const [shiftX, shiftY] = [0.12, -0.07];
    const full = new PerspectiveCamera(30, width / height, 0.01, 100);
    full.position.setFromSpherical(new Spherical(3, 1.1, 0.4));
    full.lookAt(0, 0, 0);
    full.updateMatrixWorld();
    // The whole frame: the lens shift alone (as the stage applies it).
    setLensShift(full, width, height, shiftX, shiftY);
    const whole = POINTS.map((p) =>
      pixelOf(p, full.projectionMatrix, full.matrixWorldInverse, width, height),
    );
    // Equal to a "tile" covering the frame.
    const same = full.clone();
    applyViewOffset(
      same,
      figureViewOffset(width, height, shiftX, shiftY, { x: 0, y: 0, width, height }),
    );
    expect(same.projectionMatrix.elements).toEqual(full.projectionMatrix.elements);

    let seen = 0;
    for (const tile of quarters(width, height)) {
      const camera = full.clone();
      applyViewOffset(camera, figureViewOffset(width, height, shiftX, shiftY, tile));
      POINTS.forEach((point, k) => {
        const inTile = pixelOf(
          point,
          camera.projectionMatrix,
          camera.matrixWorldInverse,
          tile.width,
          tile.height,
        );
        const expected = whole[k];
        if (!expected) return;
        expect(inTile.x + tile.x).toBeCloseTo(expected.x, 6);
        expect(inTile.y + tile.y).toBeCloseTo(expected.y, 6);
        const inside =
          expected.x >= tile.x &&
          expected.x < tile.x + tile.width &&
          expected.y >= tile.y &&
          expected.y < tile.y + tile.height;
        if (inside) seen++;
      });
    }
    // The four tiles together hold every point that is in the frame, once.
    const inFrame = whole.filter((p) => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height);
    expect(seen).toBe(inFrame.length);
    expect(inFrame.length).toBeGreaterThan(40);
  });
});

describe('bleedRect', () => {
  it('grows a tile only on the sides inside the figure, and says where the tile sits', () => {
    expect(bleedRect({ x: 0, y: 0, width: 100, height: 50 }, 100, 50, 10)).toEqual({
      rect: { x: 0, y: 0, width: 100, height: 50 },
      offsetX: 0,
      offsetY: 0,
    });
    expect(bleedRect({ x: 40, y: 30, width: 30, height: 20 }, 100, 50, 10)).toEqual({
      rect: { x: 30, y: 20, width: 50, height: 30 },
      offsetX: 10,
      offsetY: 10,
    });
    // Never past the figure's own corner on the left / top.
    expect(bleedRect({ x: 4, y: 0, width: 10, height: 10 }, 100, 50, 10).offsetX).toBe(4);
  });

  it('sizes a whole figure in whole output px', () => {
    expect(figurePixelSize(624.4, 333.2, 1.6)).toEqual({ width: 999, height: 533 });
    expect(figurePixelSize(0.1, 0.1, 0.5)).toEqual({ width: 1, height: 1 });
  });
});

/** jsdom has no WebGL: a renderer that records each draw's camera matrices. */
function recordingRenderer() {
  let pixelRatio = 1;
  const draws: { projection: Matrix4; view: Matrix4 }[] = [];
  const renderer = {
    setPixelRatio: vi.fn((value: number) => {
      pixelRatio = value;
    }),
    getPixelRatio: vi.fn(() => pixelRatio),
    setSize: vi.fn(),
    render: vi.fn((_scene: Object3D, camera: Camera) => {
      draws.push({
        projection: camera.projectionMatrix.clone(),
        view: camera.matrixWorldInverse.clone(),
      });
    }),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  return { renderer, draws };
}

function quietCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // jsdom logs "not implemented" for getContext; the figure copes with no 2D context.
  canvas.getContext = (() => null) as typeof canvas.getContext;
  return canvas;
}

function figureRenderer() {
  const { renderer, draws } = recordingRenderer();
  const createRenderer = vi.fn(() => renderer as unknown as StageRenderer);
  const figures = new TerrainFigureRenderer({ createRenderer, createCanvas: quietCanvas });
  return { figures, renderer, draws, createRenderer };
}

const TRACK = makeTrack([
  [34.705, -83.995],
  [34.71, -83.985],
  [34.715, -83.975],
  [34.712, -83.968],
]);

function scene(camera: ViewCamera = DEFAULT_VIEW_CAMERA): TerrainFigureScene {
  return { heightfield: HILLS, track: TRACK, camera, exaggeration: 1.6 };
}
const HILLS = hills();

describe('TerrainFigureRenderer', () => {
  it('uses style A’s poster palettes: paper and ink rows, the print-safe route', () => {
    expect(TRAIL_SIGN_ROUTE_PALETTE).toEqual({
      route: '#C2410C',
      halo: '#FFFFFF',
      ink: '#1B2A3A',
    });
    expect(STYLE_A_PALETTE.surface).toBe('#E6EAEE');
  });

  it('renders a whole figure at the box × scale, from the handed-off camera, on one reused stage', () => {
    const { figures, renderer, draws, createRenderer } = figureRenderer();
    const camera: ViewCamera = { azimuth: 1.2, polar: 0.9, zoom: 1, view: 'oblique' };
    const canvas = figures.render({ ...scene(camera), width: 600, height: 400, pixelScale: 1.5 });
    expect([canvas.width, canvas.height]).toEqual([900, 600]);
    expect(renderer.setSize).toHaveBeenLastCalledWith(900, 600, false);
    const view = draws.at(-1)?.view;
    if (!view) throw new Error('nothing drawn');
    // The camera sits at the handed-off angles around the pivot.
    const eye = new Vector3().setFromMatrixPosition(new Matrix4().copy(view).invert());
    const offset = new Spherical().setFromVector3(eye.setY(eye.y - pivotY(view)));
    expect(offset.theta).toBeCloseTo(1.2, 6);

    figures.render({ ...scene(camera), exaggeration: 2, width: 300, height: 200, pixelScale: 1 });
    expect(createRenderer).toHaveBeenCalledTimes(1);
    figures.dispose();
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('draws tiles that stitch into the whole figure exactly (camera matrices)', () => {
    const { figures, draws } = figureRenderer();
    const camera: ViewCamera = { azimuth: -0.6, polar: 1.05, zoom: 0.9, view: 'oblique' };
    const scale = 3.25;
    const box = figurePixelSize(624, 380, scale);
    figures.render({ ...scene(camera), width: 624, height: 380, pixelScale: scale });
    const whole = draws.at(-1);
    if (!whole) throw new Error('nothing drawn');
    const wholePx = POINTS.map((p) =>
      pixelOf(p, whole.projection, whole.view, box.width, box.height),
    );

    const bleed = Math.ceil(TILE_BLEED * scale);
    for (const tile of quarters(box.width, box.height)) {
      figures.renderTile(scene(camera), {
        ...tile,
        scale,
        boxWidth: box.width,
        boxHeight: box.height,
      });
      const drawn = draws.at(-1);
      if (!drawn) throw new Error('nothing drawn');
      // Drawn with its bleed margin: the rect handed to the stage.
      const { rect } = bleedRect(tile, box.width, box.height, bleed);
      expect(drawn.view.elements).toEqual(whole.view.elements);
      POINTS.forEach((point, k) => {
        const p = pixelOf(point, drawn.projection, drawn.view, rect.width, rect.height);
        expect(p.x + rect.x).toBeCloseTo(wholePx[k]?.x ?? NaN, 5);
        expect(p.y + rect.y).toBeCloseTo(wholePx[k]?.y ?? NaN, 5);
      });
    }
  });

  it('scales line widths with the output scale (ridge lines, route widths)', () => {
    const { figures } = figureRenderer();
    figures.render({ ...scene(), width: 400, height: 300, pixelScale: 2.5 });
    const stage = (figures as unknown as { stage: TerrainStage }).stage;
    let pixelRatio: unknown;
    stage.scene.traverse((object) => {
      const material = (object as { material?: { uniforms?: Record<string, { value: unknown }> } })
        .material;
      if (material?.uniforms?.uPixelRatio) pixelRatio = material.uniforms.uPixelRatio.value;
    });
    expect(pixelRatio).toBe(2.5);
    const lines = routeLines(stage);
    // Output px over the drawn canvas, as Line2 sets it: a 4 px core is 10 output px.
    expect(lines.core.material.resolution.toArray()).toEqual([1000, 750]);
    expect(lines.core.material.linewidth).toBe(10);
    expect(lines.halo.material.linewidth).toBe(22.5);
    expect(lines.hidden.material.linewidth).toBe(5);
    expect(lines.core.material.uniforms.uRouteCutInset?.value).toBe(6.25);
  });

  it('keeps the route’s output px per logical px constant at every scale and in tiles', () => {
    const box = { width: 300, height: 200 };
    for (const scale of [1, 2, 4, 7.5]) {
      const { figures, renderer } = figureRenderer();
      const { width, height } = figurePixelSize(box.width, box.height, scale);
      const tiles: PixelRect[] = [{ x: 0, y: 0, width, height }, ...quarters(width, height)];
      for (const tile of tiles) {
        figures.renderTile(scene(), {
          ...tile,
          scale,
          boxWidth: width,
          boxHeight: height,
        });
        const [drawnWidth, drawnHeight] = renderer.setSize.mock.lastCall as [number, number];
        const stage = (figures as unknown as { stage: TerrainStage }).stage;
        const lines = routeLines(stage);
        for (const [line, logicalPx] of [
          [lines.core, 4],
          [lines.halo, 9],
          [lines.hidden, 2],
        ] as const) {
          // What three does before each draw: the resolution is the viewport (pixel ratio 1).
          line.onBeforeRender({
            getViewport: (target: Vector4) => target.set(0, 0, drawnWidth, drawnHeight),
          } as unknown as WebGLRenderer);
          const { resolution, linewidth } = line.material;
          // LineMaterial offsets by linewidth / resolution.y of the clip height = output px.
          const outputPx = (linewidth / resolution.y) * drawnHeight;
          expect(outputPx / scale).toBeCloseTo(logicalPx, 9);
        }
      }
      figures.dispose();
    }
  });
});

/** The stage's route lines. */
function routeLines(stage: TerrainStage) {
  const found: Record<string, Line2> = {};
  stage.scene.traverse((object) => {
    if (object instanceof Line2) found[object.name] = object;
  });
  const core = found.route;
  const halo = found['route-halo'];
  const hidden = found['route-hidden'];
  if (!core || !halo || !hidden) throw new Error('no route');
  return { core, halo, hidden };
}

describe('TerrainStage.viewCamera', () => {
  function viewStage() {
    const { renderer } = recordingRenderer();
    const stage = new TerrainStage(quietCanvas(), {
      createRenderer: () => renderer,
      palette: STYLE_A_PALETTE,
    });
    stage.resize(800, 500);
    stage.show(HILLS, { exaggeration: 1.6, view: 'oblique', reducedMotion: true });
    return stage;
  }

  it('reads the View’s default camera, a rotation, and the flat map', () => {
    const stage = viewStage();
    const start = stage.viewCamera();
    expect(start.view).toBe('oblique');
    expect(start.azimuth).toBeCloseTo(DEFAULT_VIEW_CAMERA.azimuth, 6);
    expect(start.polar).toBeCloseTo(DEFAULT_VIEW_CAMERA.polar, 6);
    expect(start.zoom).toBeCloseTo(1, 6);

    stage.rotateBy(Math.PI / 2);
    expect(stage.viewCamera().azimuth).toBeCloseTo(DEFAULT_VIEW_CAMERA.azimuth + Math.PI / 2, 6);

    stage.setView('flat');
    expect(stage.viewCamera()).toMatchObject({ view: 'flat', azimuth: 0 });
    stage.dispose();
  });
});

/** The orbit pivot's height: where the view's forward axis meets the vertical axis. */
function pivotY(view: Matrix4): number {
  const world = new Matrix4().copy(view).invert();
  const eye = new Vector3().setFromMatrixPosition(world);
  const forward = new Vector3(0, 0, -1).transformDirection(world);
  const t = -(eye.x * forward.x + eye.z * forward.z) / (forward.x ** 2 + forward.z ** 2);
  return eye.y + forward.y * t;
}
