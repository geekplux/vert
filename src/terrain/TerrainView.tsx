import { useEffect, useId, useImperativeHandle, useRef, type Ref } from 'react';
import type { Heightfield } from './heightfield';
import { readPalette, type TerrainPalette } from './mesh';
import { TerrainStage, type RendererFactory, type TerrainViewMode } from './stage';
import styles from './TerrainView.module.css';

/** Imperative controls for the page's Rotate button and, in task 3b, the route layer. */
export interface TerrainViewHandle {
  /** Orbit by `radians` (eased; instant with reduced motion). Ignored in the flat view. */
  rotateBy: (radians: number) => void;
  /** Back to the default framing of the current view. */
  resetView: () => void;
  /** Redraw after changing something in the scene (e.g. the route). */
  requestRender: () => void;
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
  ref?: Ref<TerrainViewHandle>;
}

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
  onReady,
  ariaLabel,
  className,
  palette,
  createRenderer,
  onRenderFrame,
  ref,
}: TerrainViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<TerrainStage | null>(null);
  const hintId = useId();

  // Latest values for callbacks and for the heightfield effect, without re-running effects.
  const latest = useRef({ exaggeration, view, onReady, onRenderFrame });
  useEffect(() => {
    latest.current = { exaggeration, view, onReady, onRenderFrame };
  });

  // One stage per mount: renderer, camera, controls, resize observer, key handling.
  const paletteRef = useRef(palette);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;
    const stage = new TerrainStage(canvas, {
      createRenderer,
      palette: paletteRef.current ?? readPalette(getComputedStyle(document.documentElement)),
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
    };
  }, [createRenderer]);

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
      reducedMotion,
      onFirstFrame: () => {
        canvas.dataset.visible = 'true';
        latest.current.onReady?.();
      },
    });
  }, [heightfield, createRenderer]);

  useEffect(() => {
    stageRef.current?.setExaggeration(exaggeration);
  }, [exaggeration]);

  useEffect(() => {
    stageRef.current?.setView(view);
  }, [view]);

  useImperativeHandle(
    ref,
    () => ({
      rotateBy: (radians) => stageRef.current?.rotateBy(radians),
      resetView: () => stageRef.current?.resetView(),
      requestRender: () => stageRef.current?.requestRender(),
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
      {/* A drawing, not a control: the text alternative is the label (and the page's aside). */}
      {/* eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role -- see above */}
      <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={ariaLabel} />
      <p id={hintId} className={styles.hint}>
        Arrow keys rotate the terrain; plus and minus zoom.
      </p>
    </div>
  );
}
