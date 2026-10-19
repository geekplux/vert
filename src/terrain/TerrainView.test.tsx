import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import type { GridTrack } from './grid';
import type { Heightfield } from './heightfield';
import type { TerrainMesh } from './mesh';
import type { StageRenderer } from './stage';
import { createRouteLayer } from './route';
import { SceneTerrainView } from './SceneTerrainView';
import { hills, makeTrack, sceneOn } from './testing';
import { TerrainView, type TerrainViewHandle, type TerrainViewProps } from './TerrainView';

// Counts route builds (each rebuild of the route also rebuilds the markers).
vi.mock('./route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./route')>();
  return { ...actual, createRouteLayer: vi.fn(actual.createRouteLayer) };
});

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
  return { renderer, factory: vi.fn(() => renderer as unknown as StageRenderer) };
}

function heightfield(): Heightfield {
  const width = 8;
  const height = 6;
  const elevations = new Float32Array(width * height).map((_, k) => 100 + (k % width) * 5);
  return {
    bounds: { west: 10, south: 46, east: 10.01, north: 46.01 },
    zoom: 13,
    width,
    height,
    elevations,
    min: 100,
    max: 135,
    metresPerSample: { x: 30, y: 30 },
    failedTiles: [],
  };
}

const flushFrames = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

describe('TerrainView', () => {
  it('renders a canvas with role img and the aria-label', () => {
    const { factory } = fakeRenderer();
    render(
      <TerrainView
        heightfield={null}
        exaggeration={1.6}
        ariaLabel="3D terrain around the sample loop"
        createRenderer={factory}
      />,
    );
    expect(screen.getByRole('img', { name: '3D terrain around the sample loop' }).tagName).toBe(
      'CANVAS',
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('lets a vertical swipe scroll the page: pan-y on the canvas, the swipe held from the controls', () => {
    const { factory } = fakeRenderer();
    render(
      <TerrainView
        heightfield={heightfield()}
        exaggeration={1.6}
        ariaLabel="3D terrain"
        createRenderer={factory}
      />,
    );
    const canvas = screen.getByRole('img', { name: '3D terrain' });
    // OrbitControls writes `none` inline; the view puts pan-y back.
    expect(canvas.style.touchAction).toBe('pan-y');
    // jsdom has no pointer capture, which OrbitControls uses.
    Object.assign(canvas, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    const reached: string[] = [];
    const onMove = (event: Event) => reached.push((event as PointerEvent).pointerType);
    document.addEventListener('pointermove', onMove);
    try {
      const send = (type: string, x: number, y: number, pointerType = 'touch') =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 3,
            pointerType,
            clientX: x,
            clientY: y,
          }),
        );
      send('pointerdown', 100, 100);
      send('pointermove', 101, 70);
      send('pointercancel', 101, 70);
      expect(reached).toEqual([]);
      send('pointermove', 101, 40, 'mouse');
      expect(reached).toEqual(['mouse']);
    } finally {
      document.removeEventListener('pointermove', onMove);
    }
  });

  it('gives every stage a canvas of its own, so a remount (StrictMode in dev) never reuses a lost context', async () => {
    const { renderer, factory } = fakeRenderer();
    const onReady = vi.fn();
    const { container, rerender } = render(
      <StrictMode>
        <TerrainView
          heightfield={heightfield()}
          exaggeration={1.6}
          ariaLabel="Terrain"
          createRenderer={factory}
          onReady={onReady}
        />
      </StrictMode>,
    );
    await flushFrames();
    // Mounted, cleaned up (its context lost for good) and mounted again: two canvases asked for.
    expect(factory).toHaveBeenCalledTimes(2);
    const [first, second] = factory.mock.calls.map((call) => (call as unknown[])[0]);
    expect(first).not.toBe(second);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    // Only the live stage's canvas is in the page, and it drew.
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Terrain' })).toBe(second);
    expect(onReady).toHaveBeenCalled();
    // The label follows the prop.
    rerender(
      <StrictMode>
        <TerrainView
          heightfield={heightfield()}
          exaggeration={1.6}
          ariaLabel="Terrain, renamed"
          createRenderer={factory}
        />
      </StrictMode>,
    );
    expect(screen.getByRole('img', { name: 'Terrain, renamed' })).toBe(second);
  });

  it('draws a heightfield, reports ready and makes the canvas visible', async () => {
    const { renderer, factory } = fakeRenderer();
    const onReady = vi.fn();
    render(
      <TerrainView
        heightfield={heightfield()}
        exaggeration={1.6}
        ariaLabel="Terrain"
        createRenderer={factory}
        onReady={onReady}
      />,
    );
    await flushFrames();
    expect(renderer.render).toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'Terrain' })).toHaveProperty('dataset.visible', 'true');
  });

  it('is focusable with a heightfield and describes its keys; arrow keys are handled', async () => {
    const { renderer, factory } = fakeRenderer();
    render(
      <TerrainView
        heightfield={heightfield()}
        exaggeration={1}
        ariaLabel="Terrain"
        createRenderer={factory}
      />,
    );
    await flushFrames();
    const canvas = screen.getByRole('img', { name: 'Terrain' });
    const container = canvas.parentElement;
    if (!container) throw new Error('canvas has no container');
    expect(container.tabIndex).toBe(0);
    expect(container.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/arrow keys rotate/i).id).toBe(
      container.getAttribute('aria-describedby'),
    );
    // Let the intro finish (1.2 s) before orbiting; keys are ignored mid-move.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    renderer.render.mockClear();
    const event = fireEvent.keyDown(container, { key: 'ArrowLeft' });
    expect(event).toBe(false); // default prevented: the page does not scroll
    await flushFrames();
    expect(renderer.render).toHaveBeenCalled();
  });

  it('has no axe violations with a heightfield', async () => {
    const { factory } = fakeRenderer();
    const { container } = render(
      <TerrainView
        heightfield={heightfield()}
        exaggeration={1}
        ariaLabel="Terrain"
        createRenderer={factory}
      />,
    );
    await flushFrames();
    await expectNoAxeViolations(container);
  });

  it('exposes rotate and reset through its ref', async () => {
    const { factory } = fakeRenderer();
    const ref = { current: null as TerrainViewHandle | null };
    render(
      <TerrainView
        ref={ref}
        heightfield={heightfield()}
        exaggeration={1}
        ariaLabel="Terrain"
        createRenderer={factory}
      />,
    );
    await flushFrames();
    expect(ref.current?.stage).not.toBeNull();
    expect(() => {
      ref.current?.rotateBy(Math.PI / 4);
      ref.current?.resetView();
      ref.current?.requestRender();
    }).not.toThrow();
  });

  it('cleans up on unmount: loses the GL context, disposes the renderer, stops rendering', async () => {
    const { renderer, factory } = fakeRenderer();
    const { unmount } = render(
      <TerrainView
        heightfield={heightfield()}
        exaggeration={1}
        ariaLabel="Terrain"
        createRenderer={factory}
      />,
    );
    unmount();
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.dispose.mock.invocationCallOrder[0] ?? 0,
    );
    renderer.render.mockClear();
    await flushFrames();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('drapes the track, moves the scrub marker without rebuilding, and takes insets', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { factory } = fakeRenderer();
    const ref = { current: null as TerrainViewHandle | null };
    const hf = heightfield();
    const track = makeTrack([
      [46.002, 10.002],
      [46.005, 10.005],
      [46.008, 10.004],
    ]);
    const props = {
      heightfield: hf,
      exaggeration: 1,
      ariaLabel: 'Terrain',
      createRenderer: factory,
    };
    const { rerender } = render(<TerrainView ref={ref} {...props} track={track} scrub={100} />);
    await flushFrames();
    const scene = ref.current?.stage?.scene;
    const route = scene?.getObjectByName('route');
    const scrub = scene?.getObjectByName('marker-scrub');
    expect(route).toBeDefined();
    expect(scrub?.visible).toBe(true);
    const before = scrub?.position.clone();
    rerender(
      <TerrainView
        ref={ref}
        {...props}
        track={track}
        scrub={500}
        insets={{ top: 62, right: 0, bottom: 60, left: 0 }}
      />,
    );
    await flushFrames();
    expect(scene?.getObjectByName('route')).toBe(route);
    expect(scene?.getObjectByName('marker-scrub')).toBe(scrub);
    expect(before && scrub?.position.equals(before)).toBe(false);
    rerender(<TerrainView ref={ref} {...props} track={null} />);
    expect(scene?.getObjectByName('route')).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('draws style A’s colours on a host without Vert’s tokens, and the host’s own where it sets them', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const root = document.documentElement;
    const colours = async () => {
      const { factory } = fakeRenderer();
      const ref = { current: null as TerrainViewHandle | null };
      const track = makeTrack([
        [46.002, 10.002],
        [46.008, 10.004],
      ]);
      const view = render(
        <TerrainView
          ref={ref}
          heightfield={heightfield()}
          track={track}
          exaggeration={1}
          ariaLabel="Terrain"
          createRenderer={factory}
        />,
      );
      await flushFrames();
      const scene = ref.current?.stage?.scene;
      const mesh = scene?.getObjectByName('terrain') as TerrainMesh | undefined;
      const hex = (name: string) =>
        `#${(scene?.getObjectByName(name) as Line2 | undefined)?.material.color.getHexString() ?? ''}`;
      const result = {
        surface: `#${mesh?.material.uniforms.uSurface.value.getHexString() ?? ''}`,
        ink: `#${mesh?.material.uniforms.uInk.value.getHexString() ?? ''}`,
        route: hex('route'),
        halo: hex('route-halo'),
      };
      view.unmount();
      return result;
    };
    // No tokens at all (jsdom loads no stylesheet), then an empty and a blank one.
    root.style.setProperty('--surface', '');
    root.style.setProperty('--white', '   ');
    expect(await colours()).toEqual({
      surface: '#e6eaee',
      ink: '#1b2a3a',
      route: '#d9480f',
      halo: '#ffffff',
    });
    root.style.setProperty('--route', '#0b7285');
    root.style.setProperty('--ink', '#222222');
    expect(await colours()).toMatchObject({ surface: '#e6eaee', ink: '#222222', route: '#0b7285' });
    for (const name of ['--surface', '--white', '--route', '--ink'])
      root.style.removeProperty(name);
    vi.restoreAllMocks();
  });

  it('builds the route once when the track changes in the render that brings the heightfield', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const builds = vi.mocked(createRouteLayer);
    builds.mockClear();
    const { factory } = fakeRenderer();
    const points: [number, number][] = [
      [46.002, 10.002],
      [46.005, 10.005],
      [46.008, 10.004],
    ];
    // A GPX without <ele>: the track while the terrain loads, then with the terrain's elevations.
    const unfilled = makeTrack(points);
    const filled = makeTrack(points, [110, 125, 120]);
    const props = { exaggeration: 1, ariaLabel: 'Terrain', createRenderer: factory };
    const { rerender } = render(<TerrainView {...props} heightfield={null} track={unfilled} />);
    await flushFrames();
    expect(builds).not.toHaveBeenCalled();
    rerender(<TerrainView {...props} heightfield={heightfield()} track={filled} />);
    await flushFrames();
    expect(builds).toHaveBeenCalledTimes(1);
    // Built from the filled track (put on the grid once: its own distance and elevation arrays).
    const built = builds.mock.calls[0]?.[1] as GridTrack | undefined;
    expect(built?.cumulative).toBe(filled.cumulative);
    expect(built?.ele).toBe(filled.ele);
    vi.restoreAllMocks();
  });

  describe('with a scene', () => {
    const POINTS: [number, number][] = [
      [10, 20],
      [40, 30],
      [70, 45],
      [100, 60],
    ];

    it('takes a scene or a heightfield and track, never both', () => {
      const scene = sceneOn(hills(), POINTS);
      const base = { exaggeration: 1, ariaLabel: 'Terrain' };
      const ok: TerrainViewProps[] = [
        { ...base, scene },
        { ...base, scene: null },
        { ...base, heightfield: null },
        { ...base, heightfield: heightfield(), track: null },
      ];
      expect(ok).toHaveLength(4);
      // @ts-expect-error -- a scene and a heightfield together
      const both: TerrainViewProps = { ...base, scene, heightfield: heightfield() };
      // @ts-expect-error -- a scene with a track
      const withTrack: TerrainViewProps = { ...base, scene, track: makeTrack([[46, 10]]) };
      // @ts-expect-error -- neither
      const neither: TerrainViewProps = { ...base };
      expect([both, withTrack, neither]).toHaveLength(3);
    });

    it('takes a host’s own colours over its tokens when they mean something else', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      const root = document.documentElement;
      // A dark host: its --ink is light text, its --surface a dark card, its --route its accent.
      root.style.setProperty('--ink', '#f0f0f0');
      root.style.setProperty('--surface', '#101820');
      root.style.setProperty('--route', '#00ff00');
      const { factory } = fakeRenderer();
      const ref = { current: null as TerrainViewHandle | null };
      render(
        <SceneTerrainView
          ref={ref}
          scene={sceneOn(hills(), POINTS)}
          exaggeration={1}
          ariaLabel="Terrain"
          createRenderer={factory}
          palette={{ surface: '#1d3346', ink: '#c9dbe6' }}
          routePalette={{ route: '#ff8a3d', halo: '#0f2233', ink: '#e8f1f5' }}
        />,
      );
      await flushFrames();
      const scene = ref.current?.stage?.scene;
      const mesh = scene?.getObjectByName('terrain') as TerrainMesh | undefined;
      const line = (name: string) =>
        (scene?.getObjectByName(name) as Line2 | undefined)?.material.color.getHexString();
      expect(mesh?.material.uniforms.uSurface.value.getHexString()).toBe('1d3346');
      expect(mesh?.material.uniforms.uInk.value.getHexString()).toBe('c9dbe6');
      expect(line('route')).toBe('ff8a3d');
      expect(line('route-halo')).toBe('0f2233');
      for (const name of ['--ink', '--surface', '--route']) root.style.removeProperty(name);
      vi.restoreAllMocks();
    });

    it.each([
      ['TerrainView', TerrainView],
      ['SceneTerrainView (the library’s)', SceneTerrainView],
    ] as const)(
      '%s drapes the route once per scene, its stored markers, and scrubs in the scene’s metres',
      async (_, View) => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const builds = vi.mocked(createRouteLayer);
        builds.mockClear();
        const { factory } = fakeRenderer();
        const ref = { current: null as TerrainViewHandle | null };
        const onReady = vi.fn();
        const scene = sceneOn(hills(), POINTS, { start: 200, summit: [72, 40] });
        const props = { exaggeration: 1, ariaLabel: 'Terrain', createRenderer: factory, onReady };
        const { rerender, container } = render(
          <View ref={ref} {...props} scene={scene} scrub={null} />,
        );
        await flushFrames();
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(builds).toHaveBeenCalledTimes(1);
        const stage = ref.current?.stage;
        const objects = stage?.scene;
        expect(objects?.getObjectByName('route')).toBeDefined();
        expect(objects?.getObjectByName('marker-start')).toBeDefined();
        expect(objects?.getObjectByName('marker-finish')).toBeDefined();
        expect(objects?.getObjectByName('marker-summit')).toBeDefined();
        expect(screen.getByRole('img', { name: 'Terrain' }).parentElement?.tabIndex).toBe(0);
        const scrub = objects?.getObjectByName('marker-scrub');
        expect(scrub?.visible).toBe(false);

        // Scrub in the scene's metres: the drawn route starts at 200 m, so 200 is its first point
        // and anything before it clamps there.
        rerender(<View ref={ref} {...props} scene={scene} scrub={200} />);
        const atStart = scrub?.position.clone();
        expect(scrub?.visible).toBe(true);
        rerender(<View ref={ref} {...props} scene={scene} scrub={0} />);
        expect(atStart && scrub?.position.equals(atStart)).toBe(true);
        const middle = (scene.route.distance[0] ?? 0) + scene.summary.drawnLength / 2;
        rerender(<View ref={ref} {...props} scene={scene} scrub={middle} />);
        expect(atStart && scrub?.position.equals(atStart)).toBe(false);

        // Re-rendering with the same scene object never rebuilds the route.
        rerender(<View ref={ref} {...props} scene={scene} scrub={middle} exaggeration={2} />);
        await flushFrames();
        expect(builds).toHaveBeenCalledTimes(1);
        await expectNoAxeViolations(container);

        // A loop's scene has no ◉ finish; null draws nothing.
        rerender(<View ref={ref} {...props} scene={sceneOn(hills(), POINTS, { finish: null })} />);
        await flushFrames();
        expect(builds).toHaveBeenCalledTimes(2);
        expect(objects?.getObjectByName('marker-finish')).toBeUndefined();
        rerender(<View ref={ref} {...props} scene={null} />);
        await flushFrames();
        expect(objects?.getObjectByName('route')).toBeUndefined();
        vi.restoreAllMocks();
      },
    );
  });
});
