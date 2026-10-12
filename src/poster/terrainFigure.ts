/**
 * Style A's terrain figure (DESIGN-SPEC §4 "Trail Sign"): the run's terrain, route and markers
 * drawn by three.js into a canvas at any size and scale, for the live preview now and the tiled
 * export later. Part of the lazy terrain code (three.js); the page loads it with
 * `loadTerrainFigure` (`terrainFigureChunk.ts`).
 *
 * One off-screen `TerrainStage` (no controls, no overlays, no render loop) is reused between
 * renders: a new heightfield rebuilds its mesh, a new track its route, anything else is a uniform
 * or the camera. `releaseTerrainFigure` (or `dispose`) frees it and loses its WebGL context.
 *
 * Sizes: the figure box is `width × height` logical px (what the poster's `onFigureBox` reports)
 * and `pixelScale` output px per logical px (the preview's scale, or the export's). The model is
 * framed for the logical box as the View frames its own box, and every line width and marker size
 * is logical px × `pixelScale` (route core 4, halo 9, ridge lines 1, ○ 22, ▲ 28 × 24), so a preview
 * and an export look the same. A tile of the figure is the same camera with a view offset
 * (`figureViewOffset`), drawn with a margin so the route's per-point visibility near the tile's
 * edge sees the same neighbours as in the whole figure.
 */
import type { RunTrack } from '../page/types';
import type { ViewCamera } from '../terrain/camera';
import type { Heightfield } from '../terrain/heightfield';
import { DEFAULT_WALL_SHADE } from '../terrain/mesh';
import type { TerrainPalette } from '../terrain/mesh';
import type { RoutePalette } from '../terrain/route';
import { TerrainStage } from '../terrain/stage';
import type { PixelRect, RendererFactory } from '../terrain/stage';
import type { FigureTile } from './export/rasterize';
import { POSTER_STYLES } from './styles';

const STYLE_A = POSTER_STYLES.find((style) => style.id === 'A');
if (!STYLE_A) throw new Error('Poster style A is missing');

/** Ridge rows: `--surface`-like paper fill and 1 px ink lines (the poster's paper and ink). */
export const TRAIL_SIGN_TERRAIN_PALETTE: TerrainPalette = {
  surface: STYLE_A.paper,
  ink: STYLE_A.ink,
  wallShade: DEFAULT_WALL_SHADE,
};

/** The print-safe route (#C2410C) with its white halo; ○ start and ▲ summit in the poster's ink. */
export const TRAIL_SIGN_ROUTE_PALETTE: RoutePalette = {
  route: STYLE_A.accent,
  halo: '#FFFFFF',
  ink: STYLE_A.ink,
};

/** What the figure shows. */
export interface TerrainFigureScene {
  readonly heightfield: Heightfield;
  /** The route as drawn: the run's track with the hidden ends cut off (`trimTrack`), or none. */
  readonly track: RunTrack | null;
  /** The View's camera ("Make a poster uses the current camera"). */
  readonly camera: ViewCamera;
  /** Vertical exaggeration, 1–3. */
  readonly exaggeration: number;
}

/** The whole figure: the box in logical px and the output scale. */
export interface TerrainFigureInput extends TerrainFigureScene {
  /** The figure box, logical px (`onFigureBox`). */
  readonly width: number;
  readonly height: number;
  /** Output px per logical px. */
  readonly pixelScale: number;
}

/**
 * Logical px drawn past a tile's inner edges and cut off again: the route's visibility clean-up
 * looks 4 px along the line and the halo is 4.5 px wide, so 24 px keeps every verdict and stroke
 * near a seam as it is in the whole figure.
 */
export const TILE_BLEED = 24;

/** The output size of a whole figure: the box × the scale, in whole px (at least 1). */
export function figurePixelSize(width: number, height: number, pixelScale: number) {
  return {
    width: Math.max(1, Math.round(width * pixelScale)),
    height: Math.max(1, Math.round(height * pixelScale)),
  };
}

/**
 * The part of the figure to draw for `tile`: the tile grown by `bleed` output px on every side
 * that is inside the figure (the figure's own edges need no margin), and where the tile sits in it.
 */
export function bleedRect(
  tile: PixelRect,
  boxWidth: number,
  boxHeight: number,
  bleed: number,
): { rect: PixelRect; offsetX: number; offsetY: number } {
  const left = tile.x > 0 ? Math.min(bleed, tile.x) : 0;
  const top = tile.y > 0 ? Math.min(bleed, tile.y) : 0;
  const right = tile.x + tile.width < boxWidth ? bleed : 0;
  const bottom = tile.y + tile.height < boxHeight ? bleed : 0;
  return {
    rect: {
      x: tile.x - left,
      y: tile.y - top,
      width: tile.width + left + right,
      height: tile.height + top + bottom,
    },
    offsetX: left,
    offsetY: top,
  };
}

export interface TerrainFigureRendererOptions {
  /** Tests inject a fake (jsdom has no WebGL). */
  createRenderer?: RendererFactory;
  palette?: TerrainPalette;
  routePalette?: RoutePalette;
  /** Where the 2D copies come from (tests); `document.createElement('canvas')` by default. */
  createCanvas?: () => HTMLCanvasElement;
}

/** Draws terrain figures with one reused off-screen stage. */
export class TerrainFigureRenderer {
  private stage: TerrainStage | null = null;
  private stageCanvas: HTMLCanvasElement | null = null;
  private heightfield: Heightfield | null = null;
  private exaggeration = NaN;
  private disposed = false;
  private readonly options: TerrainFigureRendererOptions;

  constructor(options: TerrainFigureRendererOptions = {}) {
    this.options = options;
  }

  private newCanvas(): HTMLCanvasElement {
    return this.options.createCanvas?.() ?? document.createElement('canvas');
  }

  /** The stage, showing `scene` (built on first use; throws where WebGL is unavailable). */
  private prepare(scene: TerrainFigureScene): { stage: TerrainStage; canvas: HTMLCanvasElement } {
    if (this.disposed) throw new Error('The terrain figure renderer was disposed');
    if (!this.stage || !this.stageCanvas) {
      this.stageCanvas = this.newCanvas();
      this.stage = new TerrainStage(this.stageCanvas, {
        createRenderer: this.options.createRenderer,
        palette: this.options.palette ?? TRAIL_SIGN_TERRAIN_PALETTE,
        routePalette: this.options.routePalette ?? TRAIL_SIGN_ROUTE_PALETTE,
        interactive: false,
      });
    }
    const { stage } = this;
    if (scene.heightfield !== this.heightfield) {
      this.heightfield = scene.heightfield;
      this.exaggeration = scene.exaggeration;
      stage.show(scene.heightfield, {
        exaggeration: scene.exaggeration,
        view: scene.camera.view,
        reducedMotion: true,
      });
    } else if (scene.exaggeration !== this.exaggeration) {
      this.exaggeration = scene.exaggeration;
      stage.setExaggeration(scene.exaggeration);
    }
    stage.setTrack(scene.track);
    return { stage, canvas: this.stageCanvas };
  }

  /**
   * The whole figure at `pixelScale`, as a 2D canvas of `figurePixelSize(...)` px (drawn into
   * `into` when given, resized to fit).
   */
  render(input: TerrainFigureInput, into?: HTMLCanvasElement): HTMLCanvasElement {
    const { width, height } = figurePixelSize(input.width, input.height, input.pixelScale);
    return this.renderTile(
      input,
      {
        x: 0,
        y: 0,
        width,
        height,
        scale: input.pixelScale,
        boxWidth: width,
        boxHeight: height,
      },
      into,
    );
  }

  /**
   * One tile of a figure: `tile` in output px of the whole figure box (`boxWidth × boxHeight`,
   * the box at `tile.scale`), as the export plans it. The result is `tile.width × tile.height`.
   */
  renderTile(
    scene: TerrainFigureScene,
    tile: FigureTile,
    into?: HTMLCanvasElement,
  ): HTMLCanvasElement {
    const { stage, canvas } = this.prepare(scene);
    const out = into ?? this.newCanvas();
    const width = Math.max(1, Math.round(tile.width));
    const height = Math.max(1, Math.round(tile.height));
    const bleed = Math.ceil(TILE_BLEED * tile.scale);
    const { rect, offsetX, offsetY } = bleedRect(
      { x: tile.x, y: tile.y, width, height },
      tile.boxWidth,
      tile.boxHeight,
      bleed,
    );
    stage.renderFigure(scene.camera, {
      width: tile.boxWidth,
      height: tile.boxHeight,
      scale: tile.scale,
      tile: rect,
    });
    if (out.width !== width) out.width = width;
    if (out.height !== height) out.height = height;
    const context = out.getContext('2d');
    if (context) {
      context.clearRect(0, 0, width, height);
      // Same task as the draw: the WebGL buffer is still there without preserveDrawingBuffer.
      context.drawImage(canvas, offsetX, offsetY, width, height, 0, 0, width, height);
    }
    return out;
  }

  /** Frees the stage, its GPU memory and its WebGL context. */
  dispose(): void {
    this.disposed = true;
    this.stage?.dispose();
    this.stage = null;
    if (this.stageCanvas) {
      this.stageCanvas.width = 0;
      this.stageCanvas.height = 0;
    }
    this.stageCanvas = null;
    this.heightfield = null;
  }
}

let shared: TerrainFigureRenderer | null = null;

function sharedRenderer(): TerrainFigureRenderer {
  shared ??= new TerrainFigureRenderer();
  return shared;
}

/** Renders a whole figure with the shared renderer (see {@link TerrainFigureRenderer.render}). */
export function renderTerrainFigure(
  input: TerrainFigureInput,
  into?: HTMLCanvasElement,
): HTMLCanvasElement {
  return sharedRenderer().render(input, into);
}

/** Renders one tile with the shared renderer (see {@link TerrainFigureRenderer.renderTile}). */
export function renderTerrainFigureTile(
  scene: TerrainFigureScene,
  tile: FigureTile,
  into?: HTMLCanvasElement,
): HTMLCanvasElement {
  return sharedRenderer().renderTile(scene, tile, into);
}

/** Disposes the shared renderer (Poster mode closing); the next render makes a new one. */
export function releaseTerrainFigure(): void {
  shared?.dispose();
  shared = null;
}
