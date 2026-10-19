/**
 * The React wrapper around the stage, fed in grid space: a {@link TerrainGrid} and a
 * {@link GridTrack}. It knows nothing of latitude, longitude, tiles or scenes; `TerrainView`
 * (heightfield + track, or a scene) and `SceneTerrainView` (a scene, for the library) put their
 * input on the grid and render this.
 */
import { useEffect, useId, useImperativeHandle, useRef, type Ref } from 'react';
import type { ViewCamera } from './camera';
import type { GridTrack, TerrainGrid } from './grid';
import { holdVerticalTouch } from './holdTouch';
import { readPalette, type TerrainPalette } from './mesh';
import { readRoutePalette, type RoutePalette } from './route';
import {
  NO_INSETS,
  TerrainStage,
  type Insets,
  type RendererFactory,
  type ScreenRect,
  type TerrainViewMode,
} from './stage';
import styles from './TerrainView.module.css';

/** Imperative controls for the page's Rotate button, the poster export and instrumentation. */
export interface TerrainViewHandle {
  /** Orbit by `radians` (eased; instant with reduced motion). Ignored in the flat view. */
  rotateBy: (radians: number) => void;
  /** Back to the default framing of the current view. */
  resetView: () => void;
  /** Redraw after changing something in the scene (on the next animation frame). */
  requestRender: () => void;
  /** Moves keyboard focus to the view (the focusable wrapper whose arrow keys orbit). */
  focus: () => void;
  /**
   * The camera as the user left it (angles, zoom factor, flat or oblique), for "Make a poster"; null
   * before the stage exists.
   */
  camera: () => ViewCamera | null;
  /** The three.js stage (scene and camera) while mounted. */
  readonly stage: TerrainStage | null;
}

/** What every terrain view takes besides what it draws (its grid and route). */
export interface TerrainViewCommonProps {
  /** Vertical exaggeration (1–3 on the page). Updates a uniform; no rebuild. */
  exaggeration: number;
  /** `flat` = top-down map, north up, no orbit ("Flat map" button). */
  view?: TerrainViewMode;
  /**
   * Where the camera starts when a grid (heightfield or scene) is shown, with no intro (the
   * poster's camera, back from Poster mode); its `view` should match `view`. Default: the intro to
   * the default view.
   */
  initialCamera?: ViewCamera;
  /** Fires once the first frame with a new grid (heightfield or scene) has been drawn. */
  onReady?: () => void;
  /** Describes the route and terrain for screen readers (the canvas is `role="img"`). */
  ariaLabel: string;
  className?: string;
  /**
   * Terrain colours; defaults to the style A tokens (`--surface`, `--ink`) as they reach the view
   * (set on `:root` or on any wrapper around it), each falling back to style A's value. Wins over
   * the tokens. Read once, when the view mounts.
   */
  palette?: TerrainPalette;
  /** Renderer factory; tests inject a fake because jsdom has no WebGL. */
  createRenderer?: RendererFactory;
  /** Called after each rendered frame with the time spent in `render`, ms (instrumentation). */
  onRenderFrame?: (renderMs: number) => void;
  /**
   * Scrub position, metres along the route on the track's own scale (a scene's: from the run's
   * real start, so a trimmed route's first point is past 0): moves the scrub marker (no rebuild).
   * Null hides it; values off the drawn route clamp to its ends.
   */
  scrub?: number | null;
  /**
   * Room the page reserves for overlays on top of the box (legend chip, icon buttons), CSS px per
   * side: the model is fitted inside the box minus these (plus a small gap), and never closer to
   * an edge than the default inset.
   */
  insets?: Insets;
  /**
   * Overlays on top of the box (legend chip, icon buttons), CSS px from its top-left corner: the
   * model is fitted to stay 12 px clear of each, at every azimuth, and otherwise fills the box.
   */
  overlays?: readonly ScreenRect[];
  /**
   * Route and marker colours; defaults to `--route`, `--white`, `--ink` as they reach the view
   * (`:root` or a wrapper), each falling back to the app's value. Wins over the tokens.
   */
  routePalette?: RoutePalette;
  ref?: Ref<TerrainViewHandle>;
}

export interface GridTerrainViewProps extends TerrainViewCommonProps {
  /** The grid to draw; null draws nothing (the page shows its loading state). */
  grid: TerrainGrid | null;
  /**
   * The route on that grid, draped with ○ start, ◉ finish and ▲ summit markers; null draws none.
   * Pass the same object while it is unchanged: a new one rebuilds the route.
   */
  gridTrack: GridTrack | null;
}

const NO_OVERLAYS: readonly ScreenRect[] = [];

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The 3D terrain (style A) of a grid and a grid track. Drag to orbit, wheel or pinch to zoom; on
 * a touch screen a vertical one-finger swipe scrolls the page and a sideways drag orbits.
 * Keyboard: focus the view (Tab), then arrow keys orbit (Shift for bigger steps) and + / − zoom;
 * the page's Rotate and Flat map buttons do the rest. With `prefers-reduced-motion` the intro
 * camera move becomes a fade.
 */
export function GridTerrainView({
  grid,
  gridTrack,
  exaggeration,
  view = 'oblique',
  initialCamera,
  onReady,
  ariaLabel,
  className,
  palette,
  createRenderer,
  onRenderFrame,
  scrub = null,
  insets = NO_INSETS,
  overlays = NO_OVERLAYS,
  routePalette,
  ref,
}: GridTerrainViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<TerrainStage | null>(null);
  const hintId = useId();

  // Latest values for callbacks and for the grid effect, without re-running effects.
  const latest = useRef({
    exaggeration,
    view,
    initialCamera,
    onReady,
    onRenderFrame,
    gridTrack,
    ariaLabel,
  });
  useEffect(() => {
    latest.current = {
      exaggeration,
      view,
      initialCamera,
      onReady,
      onRenderFrame,
      gridTrack,
      ariaLabel,
    };
  });

  // One stage per mount: renderer, camera, controls, resize observer, key handling.
  const paletteRef = useRef(palette);
  const routePaletteRef = useRef(routePalette);
  //
  // Each stage gets a canvas of its own, made here and removed with it: `dispose` loses the GL
  // context for good (browsers cap live contexts), and a lost context's canvas never gives another.
  // React re-runs this effect on the same DOM (StrictMode in `pnpm dev` mounts, cleans up and mounts
  // again), and a stage on the old canvas failed: "This browser couldn't draw the 3D terrain".
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas ?? '';
    // A drawing, not a control: the text alternative is the label (and the page's aside).
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', latest.current.ariaLabel);
    container.prepend(canvas);
    canvasRef.current = canvas;
    // Colours from the tokens as they reach the view itself, not the document root: a host can
    // set Vert's tokens on a wrapper around it (its own `--ink` meaning something else elsewhere),
    // and the terrain follows them as the profile's CSS does. In the app they sit on :root, which
    // the container inherits, so nothing changes there.
    const tokens = getComputedStyle(container);
    const stage = new TerrainStage(canvas, {
      createRenderer,
      palette: paletteRef.current ?? readPalette(tokens),
      routePalette: routePaletteRef.current ?? readRoutePalette(tokens),
      onFrame: (ms) => latest.current.onRenderFrame?.(ms),
    });
    stageRef.current = stage;
    stage.resize(container.clientWidth, container.clientHeight);
    // Touch: a vertical one-finger swipe scrolls the page; a sideways drag orbits, two fingers
    // zoom. OrbitControls has just set `touch-action: none` inline on the canvas: put the CSS
    // value back, and hold a swipe's first moves back from the controls until it is sideways.
    canvas.style.touchAction = 'pan-y';
    const releaseTouch = holdVerticalTouch(container);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box) stage.resize(box.width, box.height);
      });
      observer.observe(container);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== container || event.altKey || event.ctrlKey || event.metaKey) return;
      if (stage.handleKey(event.key, event.shiftKey)) event.preventDefault();
    };
    container.addEventListener('keydown', onKeyDown);

    return () => {
      releaseTouch();
      container.removeEventListener('keydown', onKeyDown);
      observer?.disconnect();
      stage.dispose();
      stageRef.current = null;
      canvas.remove();
      if (canvasRef.current === canvas) canvasRef.current = null;
    };
  }, [createRenderer]);

  useEffect(() => {
    canvasRef.current?.setAttribute('aria-label', ariaLabel);
  }, [ariaLabel, createRenderer]);

  // A new grid: rebuild the mesh and play the intro (or fade, with reduced motion).
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    delete canvas.dataset.visible;
    const reducedMotion = prefersReducedMotion();
    canvas.dataset.motion = reducedMotion ? 'fade' : 'move';
    stage.show(grid, {
      exaggeration: latest.current.exaggeration,
      view: latest.current.view,
      camera: latest.current.initialCamera,
      reducedMotion,
      // The current track, so a track that changed in the same render (terrain elevations for a
      // GPX without <ele>) builds the route once, here, and setTrack below finds nothing to do.
      track: latest.current.gridTrack,
      onFirstFrame: () => {
        canvas.dataset.visible = 'true';
        latest.current.onReady?.();
      },
    });
  }, [grid, createRenderer]);

  useEffect(() => {
    stageRef.current?.setExaggeration(exaggeration);
  }, [exaggeration]);

  // After the grid effect, so a new grid and track build the route once each (and a
  // track that arrived with the grid was already taken by show()).
  useEffect(() => {
    stageRef.current?.setTrack(gridTrack);
  }, [gridTrack, createRenderer]);

  useEffect(() => {
    stageRef.current?.setScrub(scrub);
  }, [scrub, createRenderer]);

  useEffect(() => {
    if (routePalette) stageRef.current?.setRoutePalette(routePalette);
  }, [routePalette]);

  const { top, right, bottom, left } = insets;
  useEffect(() => {
    stageRef.current?.setInsets({ top, right, bottom, left });
  }, [top, right, bottom, left, createRenderer]);

  // The stage compares by value: an equal array of rects changes nothing.
  useEffect(() => {
    stageRef.current?.setOverlays(overlays);
  }, [overlays, createRenderer]);

  useEffect(() => {
    stageRef.current?.setView(view);
  }, [view]);

  useImperativeHandle(
    ref,
    () => ({
      rotateBy: (radians) => stageRef.current?.rotateBy(radians),
      resetView: () => stageRef.current?.resetView(),
      requestRender: () => stageRef.current?.requestRender(),
      focus: () => containerRef.current?.focus(),
      camera: () => stageRef.current?.viewCamera() ?? null,
      get stage() {
        return stageRef.current;
      },
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={[styles.view, className].filter(Boolean).join(' ')}
      // Focusable so arrow keys can orbit; the canvas inside carries the accessible name and the
      // hint says which keys work. A plain wrapper: it has no widget role of its own to claim.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard orbit target
      tabIndex={grid ? 0 : -1}
      aria-describedby={hintId}
    >
      {/* The canvas (`role="img"` with `ariaLabel`) is inserted here by the stage effect. */}
      <p id={hintId} className={styles.hint}>
        Arrow keys rotate the terrain; plus and minus zoom.
      </p>
    </div>
  );
}
