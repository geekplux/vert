/**
 * The library's `TerrainView` as a host drives it: the handle's stable surface (its keys, the
 * methods' arities and types), the keyboard model a host's own buttons sit beside, and `scrub`
 * (null hides the marker, on the terrain and, with the same null, on the profile).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { Camera, Object3D } from 'three';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { hills, sceneOn } from '../terrain/testing';
import { expectNoAxeViolations } from '../test/axe';
import { ElevationProfile } from './ElevationProfile';
import { TerrainView } from './TerrainView';
import type { TerrainRenderer, TerrainViewHandle, TerrainViewMode, ViewCamera } from './types';

const scene = sceneOn(
  hills(),
  [
    [10, 20],
    [40, 30],
    [70, 45],
    [100, 60],
  ],
  { start: 200, summit: [72, 40] },
);
const START = scene.route.distance[0] ?? 0;
const MIDDLE = START + scene.summary.drawnLength / 2;

/** A renderer for jsdom (no WebGL) that keeps the scene it drew last. */
function fakeRenderer() {
  let pixelRatio = 1;
  const renderer = {
    setPixelRatio: (value: number) => {
      pixelRatio = value;
    },
    getPixelRatio: () => pixelRatio,
    setSize: vi.fn(),
    render: vi.fn<(scene: Object3D, camera: Camera) => void>(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  return {
    createRenderer: () => renderer as unknown as TerrainRenderer,
    scrubMarker: () => renderer.render.mock.lastCall?.[0].getObjectByName('marker-scrub'),
  };
}

const flushFrames = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

/** Sprites need a 2D canvas jsdom lacks; the markers work without one. */
const noCanvas2d = () => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

/** jsdom lays nothing out: give every element the view's box, 640 × 360. */
function boxSize() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TerrainView (library): the handle', () => {
  it('is exactly the five stable methods, with their arities and types', async () => {
    noCanvas2d();
    const ref = { current: null as TerrainViewHandle | null };
    const { createRenderer } = fakeRenderer();
    render(
      <TerrainView
        ref={ref}
        scene={scene}
        exaggeration={1.6}
        ariaLabel="Terrain"
        createRenderer={createRenderer}
      />,
    );
    await flushFrames();
    const handle = ref.current;
    if (!handle) throw new Error('no handle');
    expect(Object.keys(handle).sort()).toEqual([
      'camera',
      'focus',
      'requestRender',
      'resetView',
      'rotateBy',
    ]);
    expect({
      rotateBy: handle.rotateBy.length,
      resetView: handle.resetView.length,
      requestRender: handle.requestRender.length,
      focus: handle.focus.length,
      camera: handle.camera.length,
    }).toEqual({ rotateBy: 1, resetView: 0, requestRender: 0, focus: 0, camera: 0 });
    expectTypeOf(handle.rotateBy).toEqualTypeOf<(radians: number) => void>();
    expectTypeOf(handle.resetView).toEqualTypeOf<() => void>();
    expectTypeOf(handle.requestRender).toEqualTypeOf<() => void>();
    expectTypeOf(handle.focus).toEqualTypeOf<() => void>();
    expectTypeOf(handle.camera).toEqualTypeOf<() => ViewCamera | null>();
    expectTypeOf<ViewCamera>().toEqualTypeOf<{
      readonly azimuth: number;
      readonly polar: number;
      readonly zoom: number;
      readonly view: TerrainViewMode;
    }>();
  });

  it('works as a host’s own buttons use it: Rotate, Flat, Reset, and focus for the keys', async () => {
    noCanvas2d();
    boxSize();
    const ref = { current: null as TerrainViewHandle | null };
    const { createRenderer } = fakeRenderer();
    // The host's three buttons, built from the handle and the `view` prop.
    function Host() {
      const [view, setView] = useState<TerrainViewMode>('oblique');
      return (
        <main>
          <div style={{ width: 640, height: 360 }}>
            <TerrainView
              ref={ref}
              scene={scene}
              view={view}
              exaggeration={1.6}
              ariaLabel="Terrain"
              createRenderer={createRenderer}
              initialCamera={{ azimuth: 0.3, polar: 0.9, zoom: 1, view: 'oblique' }}
            />
          </div>
          <button type="button" onClick={() => ref.current?.rotateBy(Math.PI / 4)}>
            Rotate
          </button>
          <button
            type="button"
            aria-pressed={view === 'flat'}
            onClick={() => {
              setView((v) => (v === 'flat' ? 'oblique' : 'flat'));
            }}
          >
            Flat
          </button>
          <button type="button" onClick={() => ref.current?.resetView()}>
            Reset
          </button>
        </main>
      );
    }
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    const { container } = render(<Host />);
    const settle = async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    };
    await settle();
    const camera = () => ref.current?.camera();
    expect(camera()).toMatchObject({ view: 'oblique', zoom: 1 });
    expect(camera()?.azimuth).toBeCloseTo(0.3, 6);

    // focus(): the wrapper whose keys orbit and zoom.
    act(() => {
      ref.current?.focus();
    });
    const wrapper = screen.getByRole('img', { name: 'Terrain' }).parentElement;
    if (!wrapper) throw new Error('no wrapper');
    expect(document.activeElement).toBe(wrapper);
    expect(wrapper.tabIndex).toBe(0);
    const before = camera()?.azimuth ?? 0;
    // Arrows orbit (the controls ease out, so measure once they settle); Shift: bigger steps.
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' });
    await settle();
    const small = Math.abs((camera()?.azimuth ?? 0) - before);
    expect(small).toBeGreaterThan(0.01);
    const beforeShift = camera()?.azimuth ?? 0;
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft', shiftKey: true });
    await settle();
    expect(Math.abs((camera()?.azimuth ?? 0) - beforeShift)).toBeGreaterThan(2 * small);
    // + zooms in.
    const beforeZoom = camera()?.zoom ?? 0;
    fireEvent.keyDown(wrapper, { key: '+' });
    await settle();
    expect(camera()?.zoom).toBeLessThan(beforeZoom);

    // Rotate: rotateBy(π/4), eased.
    const beforeRotate = camera()?.azimuth ?? 0;
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    await settle();
    expect(camera()?.azimuth).toBeCloseTo(beforeRotate + Math.PI / 4, 4);

    // Reset: the default framing, zoom 1.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await settle();
    expect(camera()?.zoom).toBeCloseTo(1, 6);

    // Flat: the `view` prop, top-down; arrows no longer orbit.
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }));
    await settle();
    expect(camera()?.view).toBe('flat');
    expect(camera()?.polar).toBeCloseTo(0, 3);
    const flatAzimuth = camera()?.azimuth;
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' });
    expect(camera()?.azimuth).toBe(flatAzimuth);
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }));
    await settle();
    expect(camera()?.view).toBe('oblique');
    vi.useRealTimers();
    await expectNoAxeViolations(container);
  });
});

describe('TerrainView (library): scrub', () => {
  it('shows the marker at a position, hides it for null or a number that is not finite', async () => {
    noCanvas2d();
    const { createRenderer, scrubMarker } = fakeRenderer();
    const props = { scene, exaggeration: 1.6, ariaLabel: 'Terrain', createRenderer };
    const { rerender } = render(<TerrainView {...props} scrub={MIDDLE} />);
    await flushFrames();
    expect(scrubMarker()?.visible).toBe(true);
    rerender(<TerrainView {...props} scrub={null} />);
    await flushFrames();
    expect(scrubMarker()?.visible).toBe(false);
    rerender(<TerrainView {...props} scrub={START} />);
    await flushFrames();
    expect(scrubMarker()?.visible).toBe(true);
    rerender(<TerrainView {...props} scrub={Number.NaN} />);
    await flushFrames();
    expect(scrubMarker()?.visible).toBe(false);
    rerender(<TerrainView {...props} />);
    await flushFrames();
    expect(scrubMarker()?.visible).toBe(false);
  });

  it('with the profile: one null hides both marks, Escape in the profile clears both', async () => {
    noCanvas2d();
    const { createRenderer, scrubMarker } = fakeRenderer();
    const onScrub = vi.fn();
    function Host() {
      const [scrub, setScrub] = useState<number | null>(MIDDLE);
      return (
        <main>
          <TerrainView
            scene={scene}
            exaggeration={1.6}
            scrub={scrub}
            ariaLabel="Terrain"
            createRenderer={createRenderer}
          />
          <ElevationProfile
            scene={scene}
            scrub={scrub}
            onScrub={(metres) => {
              setScrub(metres);
              onScrub(metres);
            }}
          />
        </main>
      );
    }
    const { container } = render(<Host />);
    await flushFrames();
    const slider = screen.getByRole('slider', { name: 'Elevation profile' });
    const dot = () => slider.querySelectorAll(':scope > span').length > 0;
    expect(scrubMarker()?.visible).toBe(true);
    expect(dot()).toBe(true);
    await expectNoAxeViolations(container);

    fireEvent.keyDown(slider, { key: 'Escape' });
    await flushFrames();
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(scrubMarker()?.visible).toBe(false);
    expect(dot()).toBe(false);
    expect(slider.getAttribute('aria-valuetext')).toBe('No position selected');
    await expectNoAxeViolations(container);

    fireEvent.keyDown(slider, { key: 'Home' });
    await flushFrames();
    expect(onScrub).toHaveBeenLastCalledWith(START);
    expect(scrubMarker()?.visible).toBe(true);
    expect(dot()).toBe(true);
  });
});
