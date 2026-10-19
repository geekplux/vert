/**
 * The library's profile as a host drives it: `onScrub` for every way the user moves the scrub,
 * Escape → null, `scrub={null}` (no position, a valid slider all the same), controlled and
 * uncontrolled.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElevationProfile as AppElevationProfile } from '../components/ElevationProfile/ElevationProfile';
import type { Scene } from '../scene/types';
import { hills, sceneOn } from '../terrain/testing';
import { expectNoAxeViolations } from '../test/axe';
import { ElevationProfile } from './ElevationProfile';
import type { ElevationProfileProps } from './types';

/** A drawn route from 200 m (the default trim), no climbs: the dot is the plot's only <span>. */
const scene: Scene = sceneOn(
  hills(),
  Array.from({ length: 300 }, (_, k): [number, number] => [5 + k / 3, 10 + 50 * Math.sin(k / 95)]),
  { start: 200 },
);
const START = 200;
const END = scene.route.distance[scene.route.distance.length - 1] ?? 0;
const LENGTH = END - START;

const slider = () => screen.getByRole('slider', { name: 'Elevation profile' });
const valueNow = () => Number(slider().getAttribute('aria-valuenow'));
const valueText = () => slider().getAttribute('aria-valuetext');
/** The scrub's marks on the plot: its line and its dot (both aria-hidden). */
const marks = () => ({
  line: slider().querySelector('svg line') !== null,
  dot: slider().querySelectorAll(':scope > span').length === 1,
});

/** A host that keeps the scrub in its state, as Activities does, and records what it was told. */
function Host({
  initial,
  onScrub,
  ...rest
}: { initial: number | null } & Omit<ElevationProfileProps, 'scene' | 'scrub'>) {
  const [scrub, setScrub] = useState<number | null>(initial);
  return (
    <main>
      <ElevationProfile
        {...rest}
        scene={scene}
        scrub={scrub}
        onScrub={(metres) => {
          setScrub(metres);
          onScrub?.(metres);
        }}
      />
      <p>Host: {scrub === null ? 'none' : String(Math.round(scrub))}</p>
    </main>
  );
}

describe('ElevationProfile (library): onScrub', () => {
  const rect = { left: 100, top: 0, width: 500, height: 140, right: 600, bottom: 140 };
  beforeEach(() => {
    // jsdom has no pointer capture.
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    vi.restoreAllMocks();
  });

  it('fires for every key, in metres from the run’s real start', () => {
    const onScrub = vi.fn();
    render(<Host initial={START} onScrub={onScrub} />);
    const keys: [string, boolean][] = [
      ['ArrowRight', false],
      ['ArrowUp', false],
      ['ArrowRight', true],
      ['ArrowLeft', false],
      ['ArrowDown', false],
      ['ArrowLeft', true],
      ['PageUp', false],
      ['PageDown', false],
      ['End', false],
      ['Home', false],
    ];
    for (const [key, shiftKey] of keys) fireEvent.keyDown(slider(), { key, shiftKey });
    expect(onScrub.mock.calls.map(([m]) => Number(m) - START)).toEqual(
      [0.01, 0.02, 0.12, 0.11, 0.1, 0, 0.1, 0, 1, 0].map((f): unknown =>
        expect.closeTo(f * LENGTH, 6),
      ),
    );
    // Keys it does not use report nothing.
    fireEvent.keyDown(slider(), { key: 'a' });
    expect(onScrub).toHaveBeenCalledTimes(keys.length);
  });

  it('fires on pointer press and while dragging, not when the pointer leaves or focus goes', () => {
    const onScrub = vi.fn();
    render(<Host initial={START} onScrub={onScrub} />);
    vi.spyOn(slider(), 'getBoundingClientRect').mockReturnValue({
      ...rect,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    });
    fireEvent.pointerDown(slider(), {
      pointerId: 1,
      clientX: 350,
      button: 0,
      pointerType: 'mouse',
    });
    expect(onScrub).toHaveBeenLastCalledWith(START + LENGTH / 2);
    fireEvent.pointerMove(slider(), { pointerId: 1, clientX: 600 });
    expect(onScrub).toHaveBeenLastCalledWith(END);
    fireEvent.pointerUp(slider(), { pointerId: 1, clientX: 600 });
    fireEvent.pointerLeave(slider(), { pointerId: 1 });
    fireEvent.pointerMove(slider(), { pointerId: 1, clientX: 100 });
    fireEvent.blur(slider());
    expect(onScrub).toHaveBeenCalledTimes(2);
    expect(valueNow()).toBe(Math.round(END));
  });

  it('fires null on Escape, which hides the line and dot; Escape with no position is the page’s', () => {
    const onScrub = vi.fn();
    render(<Host initial={START + 1000} onScrub={onScrub} />);
    expect(marks()).toEqual({ line: true, dot: true });
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(false);
    expect(onScrub).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.getByText('Host: none')).toBeDefined();
    expect(marks()).toEqual({ line: false, dot: false });
    // Nothing to clear: not reported, not consumed (a dialog around it may close).
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(true);
    expect(onScrub).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the host changes scrub, nor for a move that goes nowhere', () => {
    const onScrub = vi.fn();
    const { rerender } = render(
      <ElevationProfile scene={scene} scrub={START + 500} onScrub={onScrub} />,
    );
    rerender(<ElevationProfile scene={scene} scrub={START + 900} onScrub={onScrub} />);
    rerender(<ElevationProfile scene={scene} scrub={null} onScrub={onScrub} />);
    rerender(<ElevationProfile scene={scene} scrub={END} onScrub={onScrub} />);
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(onScrub).not.toHaveBeenCalled();
  });
});

describe('ElevationProfile (library): no position', () => {
  it('is still a slider: its value at the drawn start, its value text “No position selected”', async () => {
    const { container } = render(
      <main>
        <ElevationProfile scene={scene} scrub={null} onScrub={() => undefined} />
      </main>,
    );
    expect(slider().getAttribute('aria-valuemin')).toBe(String(START));
    expect(slider().getAttribute('aria-valuemax')).toBe(String(Math.round(END)));
    expect(valueNow()).toBe(START);
    expect(valueText()).toBe('No position selected');
    expect(marks()).toEqual({ line: false, dot: false });
    await expectNoAxeViolations(container);
  });

  it('moves from the drawn start on the first key or press, and reports even a move to the start', () => {
    const onScrub = vi.fn();
    render(<Host initial={null} onScrub={onScrub} />);
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(onScrub).toHaveBeenLastCalledWith(START);
    expect(marks()).toEqual({ line: true, dot: true });
    expect(valueText()).toMatch(/^km 0\.2, \d+ m$/);

    fireEvent.keyDown(slider(), { key: 'Escape' });
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(onScrub.mock.lastCall?.[0]).toBeCloseTo(START + LENGTH * 0.01, 6);
    fireEvent.keyDown(slider(), { key: 'Escape' });
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(onScrub).toHaveBeenLastCalledWith(END);
  });

  it('treats a scrub that is not a finite number as no position', () => {
    render(<ElevationProfile scene={scene} scrub={Number.NaN} onScrub={() => undefined} />);
    expect(valueText()).toBe('No position selected');
    expect(marks()).toEqual({ line: false, dot: false });
  });

  it('has no axe violations with a position either', async () => {
    const { container } = render(<Host initial={START + 2000} />);
    expect(valueText()).toMatch(/^km 2\.2, \d+ m$/);
    await expectNoAxeViolations(container);
  });
});

describe('ElevationProfile (library): controlled and uncontrolled', () => {
  it('controlled: shows the host’s value, whatever the user does, until the host passes it back', () => {
    const onScrub = vi.fn();
    const { rerender } = render(
      <ElevationProfile scene={scene} scrub={START + 500} onScrub={onScrub} />,
    );
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(onScrub).toHaveBeenLastCalledWith(END);
    expect(valueNow()).toBe(START + 500);
    fireEvent.keyDown(slider(), { key: 'Escape' });
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(marks()).toEqual({ line: true, dot: true });
    // A host that keeps null keeps it, keys or not.
    rerender(<ElevationProfile scene={scene} scrub={null} onScrub={onScrub} />);
    fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(onScrub.mock.lastCall?.[0]).toBeCloseTo(START + LENGTH * 0.1, 6);
    expect(valueText()).toBe('No position selected');
    // Passing a value back moves it.
    rerender(<ElevationProfile scene={scene} scrub={END} onScrub={onScrub} />);
    expect(valueNow()).toBe(Math.round(END));
  });

  it('controlled without onScrub: follows the host’s value only', () => {
    const { rerender } = render(<ElevationProfile scene={scene} scrub={START + 100} />);
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(valueNow()).toBe(START + 100);
    rerender(<ElevationProfile scene={scene} scrub={START + 300} />);
    expect(valueNow()).toBe(START + 300);
  });

  it('uncontrolled: keeps its own position, from none, and still reports each move', () => {
    const onScrub = vi.fn();
    render(<ElevationProfile scene={scene} onScrub={onScrub} />);
    expect(valueText()).toBe('No position selected');
    expect(marks()).toEqual({ line: false, dot: false });
    fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(onScrub.mock.lastCall?.[0]).toBeCloseTo(START + LENGTH * 0.1, 6);
    expect(valueNow()).toBe(Math.round(START + LENGTH * 0.1));
    expect(marks()).toEqual({ line: true, dot: true });
    fireEvent.keyDown(slider(), { key: 'Escape' });
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(valueText()).toBe('No position selected');
    expect(marks()).toEqual({ line: false, dot: false });
  });

  it('uncontrolled without onScrub works as well, Escape included', () => {
    render(<ElevationProfile scene={scene} />);
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(valueNow()).toBe(Math.round(END));
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(false);
    expect(valueText()).toBe('No position selected');
  });

  it('uncontrolled: a new scene starts at no position, unreported; the same scene keeps it', () => {
    const onScrub = vi.fn();
    const { rerender } = render(<ElevationProfile scene={scene} onScrub={onScrub} />);
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(onScrub).toHaveBeenCalledTimes(1);
    rerender(<ElevationProfile scene={scene} onScrub={onScrub} height={120} />);
    expect(valueNow()).toBe(Math.round(END));
    const other = sceneOn(
      hills(),
      [
        [10, 10],
        [90, 60],
      ],
      { start: 0 },
    );
    rerender(<ElevationProfile scene={other} onScrub={onScrub} />);
    expect(valueText()).toBe('No position selected');
    expect(valueNow()).toBe(0);
    expect(marks()).toEqual({ line: false, dot: false });
    // Back to the first scene: its old position does not come back either.
    rerender(<ElevationProfile scene={scene} onScrub={onScrub} />);
    expect(valueText()).toBe('No position selected');
    expect(onScrub).toHaveBeenCalledTimes(1);
  });

  it('controlled: a new scene keeps the host’s value', () => {
    const other = sceneOn(
      hills(),
      [
        [10, 10],
        [90, 60],
      ],
      { start: 0 },
    );
    const { rerender } = render(<ElevationProfile scene={scene} scrub={START + 300} />);
    rerender(<ElevationProfile scene={other} scrub={300} />);
    expect(valueNow()).toBe(300);
  });
});

describe('ElevationProfile (library): Escape and a dialog around it', () => {
  /**
   * A modal dialog that, as a browser's does, closes on an Escape keydown whose default nothing
   * prevented (jsdom has no dialog behaviour of its own).
   */
  function DialogAround({ children }: { children: ReactNode }) {
    return (
      <dialog open aria-label="Run details">
        {children}
      </dialog>
    );
  }
  let seen: { defaultPrevented: boolean }[];
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    seen.push({ defaultPrevented: event.defaultPrevented });
    if (!event.defaultPrevented) document.querySelector('dialog')?.removeAttribute('open');
  };
  beforeEach(() => {
    seen = [];
    document.addEventListener('keydown', closeOnEscape);
  });
  afterEach(() => {
    document.removeEventListener('keydown', closeOnEscape);
  });
  const dialogOpen = () => document.querySelector('dialog')?.hasAttribute('open');

  it('read-only (controlled, no onScrub): Escape is left alone, so the dialog closes', () => {
    render(
      <DialogAround>
        <ElevationProfile scene={scene} scrub={START + 1000} />
      </DialogAround>,
    );
    const plot = slider();
    expect(marks()).toEqual({ line: true, dot: true });
    expect(fireEvent.keyDown(plot, { key: 'Escape' })).toBe(true);
    expect(seen).toEqual([{ defaultPrevented: false }]);
    expect(dialogOpen()).toBe(false);
    // The position stays (the dialog, now closed, hides it from the accessibility tree).
    expect(plot.querySelector('svg line')).not.toBeNull();
  });

  it('synced: the first Escape clears (prevented, still propagated), the next closes the dialog', () => {
    const onScrub = vi.fn();
    render(
      <DialogAround>
        <Host initial={START + 1000} onScrub={onScrub} />
      </DialogAround>,
    );
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(false);
    expect(onScrub).toHaveBeenCalledExactlyOnceWith(null);
    expect(seen).toEqual([{ defaultPrevented: true }]);
    expect(dialogOpen()).toBe(true);
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(true);
    expect(seen).toEqual([{ defaultPrevented: true }, { defaultPrevented: false }]);
    expect(dialogOpen()).toBe(false);
    expect(onScrub).toHaveBeenCalledTimes(1);
  });
});

describe('the app’s own ElevationProfile', () => {
  it('keeps its API: Escape does nothing without onClear', () => {
    const onScrub = vi.fn();
    render(
      <AppElevationProfile
        points={[
          { d: 0, ele: 100 },
          { d: 1000, ele: 150 },
        ]}
        scrub={500}
        onScrub={onScrub}
      />,
    );
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(true);
    expect(onScrub).not.toHaveBeenCalled();
    expect(valueNow()).toBe(500);
  });
});
