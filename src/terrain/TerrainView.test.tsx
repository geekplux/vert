import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import type { Heightfield } from './heightfield';
import type { StageRenderer } from './stage';
import { makeTrack } from './testing';
import { TerrainView, type TerrainViewHandle } from './TerrainView';

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
});
