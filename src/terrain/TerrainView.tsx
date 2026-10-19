import { useEffect, useId, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import type { RunTrack } from '../page/types';
import type { ViewCamera } from './camera';
import { gridTrackFromRun } from './gridTrack';
import type { Heightfield } from './heightfield';
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

export interface TerrainViewProps {
  /** The grid to draw; null draws nothing (the page shows its loading state). */
  heightfield: Heightfield | null;
  /** Vertical exaggeration (1–3 on the page). Updates a uniform; no rebuild. */
  exaggeration: number;
  /** `flat` = top-down map, north up, no orbit ("Flat map" button). */
  view?: TerrainViewMode;
  /**
   * Where the camera starts when a heightfield is shown, with no intro (the poster's camera, back
   * from Poster mode); its `view` should match `view`. Default: the intro to the default view.
   */
  initialCamera?: ViewCamera;
  /** Fires once the first frame with a new heightfield has been drawn. */
  onReady?: () => void;
  /** Describes the route and terrain for screen readers (the canvas is `role="img"`). */
  ariaLabel: string;
  className?: string;
  /** Terrain colours; defaults to the style A tokens (`--surface`, `--ink`) read from the page. */
  palette?: TerrainPalette;
  /** Renderer factory; tests inject a fake because jsdom has no WebGL. */
  createRenderer?: RendererFactory;
  /** Called after each rendered frame with the time spent in `render`, ms (instrumentation). */
  onRenderFrame?: (renderMs: number) => void;
  /** The run's points: the route is draped on the terrain with ○ start and ▲ summit markers. */
  track?: RunTrack | null;
  /** Scrub position, metres along the route: moves the scrub marker (no rebuild). Null hides it. */
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
  /** Route and marker colours; defaults to `--route`, `--white`, `--ink` read from the page. */
  routePalette?: RoutePalette;
  ref?: Ref<TerrainViewHandle>;
}

const NO_OVERLAYS: readonly ScreenRect[] = [];

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The 3D terrain (style A). Drag to orbit, wheel or pinch to zoom. Keyboard: focus the view (Tab),
 * then arrow keys orbit (Shift for bigger steps) and + / − zoom; the page's Rotate and Flat map
 * buttons do the rest. With `prefers-reduced-motion` the intro camera move becomes a fade.
 */
export function TerrainView({
  heightfield,
  exaggeration,
  view = 'oblique',
  initialCamera,
  onReady,
  ariaLabel,
  className,
  palette,
  createRenderer,
  onRenderFrame,
  track = null,
  scrub = null,
  insets = NO_INSETS,
  overlays = NO_OVERLAYS,
  routePalette,
  ref,
}: TerrainViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<TerrainStage | null>(null);
  const hintId = useId();

  // The track on this heightfield's grid: the one lon/lat → grid conversion, once per heightfield
  // and track (the stage and everything under it work in grid space). Memoised, so the route is
  // still built once per new heightfield or track: show() and setTrack() below get the same object.
  const gridTrack = useMemo(
    () => (heightfield && track ? gridTrackFromRun(heightfield, track) : null),
    [heightfield, track],
  );

  // Latest values for callbacks and for the heightfield effect, without re-running effects.
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
    const stage = new TerrainStage(canvas, {
      createRenderer,
      palette: paletteRef.current ?? readPalette(getComputedStyle(document.documentElement)),
      routePalette:
        routePaletteRef.current ?? readRoutePalette(getComputedStyle(document.documentElement)),
      onFrame: (ms) => latest.current.onRenderFrame?.(ms),
    });
    stageRef.current = stage;
    stage.resize(container.clientWidth, container.clientHeight);

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

  // A new heightfield: rebuild the mesh and play the intro (or fade, with reduced motion).
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    delete canvas.dataset.visible;
    const reducedMotion = prefersReducedMotion();
    canvas.dataset.motion = reducedMotion ? 'fade' : 'move';
    stage.show(heightfield, {
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
  }, [heightfield, createRenderer]);

  useEffect(() => {
    stageRef.current?.setExaggeration(exaggeration);
  }, [exaggeration]);

  // After the heightfield effect, so a new heightfield and track build the route once each (and a
  // track that arrived with the heightfield was already taken by show()).
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
      tabIndex={heightfield ? 0 : -1}
      aria-describedby={hintId}
    >
      {/* The canvas (`role="img"` with `ariaLabel`) is inserted here by the stage effect. */}
      <p id={hintId} className={styles.hint}>
        Arrow keys rotate the terrain; plus and minus zoom.
      </p>
    </div>
  );
}
