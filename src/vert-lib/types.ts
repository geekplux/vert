/**
 * The library's public types, standalone: they import nothing of Vert's internals (only `react`'s
 * `Ref` and `three`'s `WebGLRenderer`, both the host's own packages), so the published
 * declarations stay small and a change inside the renderer never changes a host's types. The
 * components check at compile time that these fit the internal ones they wrap.
 *
 * Host CSS contract (the custom properties Vert reads, their fallbacks and a dark example):
 * README.md next to this file, shipped as `dist-lib/README.md`.
 */
import type { Ref } from 'react';
import type { WebGLRenderer } from 'three';
import type { Scene } from '../scene/types';

/**
 * Terrain colours, CSS colour strings. Default: `--surface` and `--ink` as they reach the view
 * (style A's `#E6EAEE` and `#1B2A3A` when unset).
 */
export interface TerrainPalette {
  /** Fill of the surface and its side walls. */
  readonly surface: string;
  /** Ridge lines and edges. */
  readonly ink: string;
  /** How far the side walls are blended from `surface` towards `ink`, 0–1 (default 0.09). */
  readonly wallShade?: number;
}

/**
 * Route and marker colours, CSS colour strings. Default: `--route`, `--white` and `--ink` as they
 * reach the view (`#D9480F`, `#FFFFFF`, `#1B2A3A` when unset).
 */
export interface RoutePalette {
  /** Route line and the scrub marker's fill. */
  readonly route: string;
  /** The route's halo, the start marker's fill, the summit's edge, the scrub marker's ring. */
  readonly halo: string;
  /** The start marker's ring and the summit's fill. */
  readonly ink: string;
}

/** `oblique`: the 3D view. `flat`: top-down, north up, no orbit. */
export type TerrainViewMode = 'oblique' | 'flat';

/**
 * A camera pose relative to the model's fit, as `TerrainViewHandle.camera()` returns it and
 * `initialCamera` takes it. No distance: each box fits the model itself.
 */
export interface ViewCamera {
  /**
   * Radians around the vertical axis: 0 = the camera south of the model looking north, positive
   * = east of south.
   */
  readonly azimuth: number;
  /** Radians from straight down: 0 = top-down, π/2 = the horizon (oblique keeps 20°–80°). */
  readonly polar: number;
  /** Distance ÷ the fitted distance: 1 = fitted, below 1 closer. */
  readonly zoom: number;
  readonly view: TerrainViewMode;
}

/** Room reserved along each side of the view's box for the host's overlays, CSS px. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A rectangle on the view's box, CSS px from its top-left corner. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the view needs of a WebGL renderer: a three.js `WebGLRenderer` or a test double. */
export type TerrainRenderer = Pick<
  WebGLRenderer,
  'setPixelRatio' | 'getPixelRatio' | 'setSize' | 'render' | 'dispose' | 'forceContextLoss'
> &
  Partial<Pick<WebGLRenderer, 'setRenderTarget' | 'getDrawingBufferSize'>>;

/**
 * The view's imperative controls: the **stable API** of a mounted `TerrainView` (hosts and their
 * tests may rely on these five; nothing else of the renderer is exposed).
 */
export interface TerrainViewHandle {
  /**
   * Orbits by `radians` around the vertical axis (eased; instant with reduced motion). Ignored in
   * the flat view.
   */
  rotateBy: (radians: number) => void;
  /** Back to the default framing of the current view (oblique or flat). */
  resetView: () => void;
  /** Draws again on the next animation frame (the view draws only while something moves). */
  requestRender: () => void;
  /** Moves keyboard focus to the view (the focusable wrapper whose arrow keys orbit). */
  focus: () => void;
  /** The camera as the user left it; null before the view has mounted. */
  camera: () => ViewCamera | null;
}

export interface TerrainViewProps {
  /**
   * The decoded scene (`decodeScene`), or null to draw nothing. Its route and stored markers (○
   * start, ◉ finish unless a loop, ▲ summit) are draped on its grid. Pass the same object while
   * it is unchanged: it is put on the grid once per scene object.
   */
  scene: Scene | null;
  /** Vertical exaggeration (Vert uses 1–3, 1.6 by default). Changing it does not rebuild. */
  exaggeration: number;
  /** The canvas's accessible name (it is `role="img"`): describe the run and its terrain. */
  ariaLabel: string;
  /** Default `oblique`. */
  view?: TerrainViewMode;
  /** Start at this pose, with no intro move; default: the intro (a fade with reduced motion). */
  initialCamera?: ViewCamera;
  /** Fires once the first frame of a new scene has been drawn. */
  onReady?: () => void;
  /** Added to the view's own class on its wrapper, which fills its parent. */
  className?: string;
  /**
   * Scrub position, metres from the run's real start (the scene's distances, as
   * `ElevationProfile` reports them); moves the scrub marker without rebuilding. Null or absent
   * hides it; values off the drawn route clamp to its ends.
   */
  scrub?: number | null;
  /** Terrain colours, over the tokens. Read once, when the view mounts. */
  palette?: TerrainPalette;
  /** Route and marker colours, over the tokens. */
  routePalette?: RoutePalette;
  /** Room kept free along each side of the box for overlays; the model fits inside the rest. */
  insets?: Insets;
  /** Overlays on the box the model keeps 12 px clear of, at every angle. */
  overlays?: readonly ScreenRect[];
  /**
   * **Testing aid.** Makes the view's renderer instead of a `WebGLRenderer`, so a host's tests can
   * render the view in jsdom, which has no WebGL (pass a stub with these methods). Leave unset in
   * production.
   */
  createRenderer?: (canvas: HTMLCanvasElement) => TerrainRenderer;
  /** **Instrumentation aid.** Called after each drawn frame with the time spent drawing, ms. */
  onRenderFrame?: (renderMs: number) => void;
  ref?: Ref<TerrainViewHandle>;
}

export type Units = 'metric' | 'imperial';

export interface ElevationProfileProps {
  /** The decoded scene: its drawn route's elevations and its climbs are drawn. */
  scene: Scene;
  /** Scrub position, metres from the run's real start (the same metres as `TerrainView`'s). */
  scrub: number;
  /** Called with the new scrub position, same metres, while dragging and on keys. */
  onScrub: (d: number) => void;
  /** Ticks and value text in km and m (default) or mi and ft. */
  units?: Units;
  /** Plot height, px (default 140). */
  height?: number;
  /** The slider's accessible name (default "Elevation profile"). */
  label?: string;
  /** The slider's value text for a distance and elevation (default "km 12.2, 640 m"). */
  valueText?: (d: number, ele: number) => string;
  className?: string;
}
