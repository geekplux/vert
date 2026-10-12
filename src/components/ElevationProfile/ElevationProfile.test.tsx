import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { ElevationProfile, type ElevationProfileProps } from './ElevationProfile';
import {
  M_PER_MI,
  VIEW_H,
  Y_BOTTOM,
  Y_FLAT,
  Y_TOP,
  buildTicks,
  defaultValueText,
  describeClimbs,
  elevationAt,
  profilePaths,
  scaleProfile,
} from './profileGeometry';
import { SAMPLE_CLIMBS, SAMPLE_POINTS, SAMPLE_TOTAL } from './sampleProfile';

const labels = (ticks: { label: string }[]) => ticks.map((tick) => tick.label);

describe('profileGeometry', () => {
  const points = [
    { d: 0, ele: 300 },
    { d: 500, ele: 820 },
    { d: 1000, ele: 560 },
  ];

  it('maps distance to 0–1000 and elevation to 110 (min) … 15 (max)', () => {
    const scale = scaleProfile(points);
    expect(scale.total).toBe(1000);
    expect(scale.x(0)).toBe(0);
    expect(scale.x(250)).toBe(250);
    expect(scale.x(1000)).toBe(1000);
    expect(scale.x(-50)).toBe(0);
    expect(scale.x(5000)).toBe(1000);
    expect(scale.y(300)).toBe(Y_BOTTOM);
    expect(scale.y(820)).toBe(Y_TOP);
    expect(scale.y(560)).toBeCloseTo((Y_BOTTOM + Y_TOP) / 2);
  });

  it('builds the line and the area closed along the bottom', () => {
    const { line, area } = profilePaths(points, scaleProfile(points));
    expect(line).toBe('M0,110 L500,15 L1000,62.5');
    expect(area).toBe(`M0,${String(VIEW_H)} L0,110 L500,15 L1000,62.5 L1000,${String(VIEW_H)} Z`);
  });

  it('draws nothing for empty or single-point input, and a centred line when flat', () => {
    expect(profilePaths([], scaleProfile([]))).toEqual({ line: '', area: '' });
    const single = [{ d: 0, ele: 100 }];
    expect(scaleProfile(single).total).toBe(0);
    expect(profilePaths(single, scaleProfile(single)).line).toBe('');
    const flat = [
      { d: 0, ele: 100 },
      { d: 10, ele: 100 },
    ];
    expect(profilePaths(flat, scaleProfile(flat)).line).toBe(
      `M0,${String(Y_FLAT)} L1000,${String(Y_FLAT)}`,
    );
  });

  it('interpolates elevation at a distance and clamps at the ends', () => {
    expect(elevationAt(points, 250)).toBe(560);
    expect(elevationAt(points, 500)).toBe(820);
    expect(elevationAt(points, 750)).toBe(690);
    expect(elevationAt(points, -10)).toBe(300);
    expect(elevationAt(points, 2000)).toBe(560);
    expect(elevationAt([], 10)).toBeNaN();
    expect(elevationAt(SAMPLE_POINTS, 12_225)).toBeCloseTo(
      (elevationAt(SAMPLE_POINTS, 12_200) + elevationAt(SAMPLE_POINTS, 12_250)) / 2,
    );
  });

  it('ticks the canvas sample as 0 km, 5, 10, 15, 21.4', () => {
    const ticks = buildTicks(SAMPLE_TOTAL, 'metric');
    expect(labels(ticks)).toEqual(['0 km', '5', '10', '15', '21.4']);
    expect(ticks.map((tick) => tick.at)).toEqual([0, 5 / 21.4, 10 / 21.4, 15 / 21.4, 1]);
    expect(ticks.map((tick) => tick.align)).toEqual(['start', 'center', 'center', 'center', 'end']);
  });

  it('picks 1/2/5/10 steps so there are 3–6 ticks', () => {
    expect(labels(buildTicks(3_000, 'metric'))).toEqual(['0 km', '1', '2', '3.0']);
    expect(labels(buildTicks(8_000, 'metric'))).toEqual(['0 km', '2', '4', '6', '8.0']);
    expect(labels(buildTicks(42_195, 'metric'))).toEqual(['0 km', '10', '20', '30', '42.2']);
    expect(labels(buildTicks(100_000, 'metric'))).toEqual([
      '0 km',
      '20',
      '40',
      '60',
      '80',
      '100.0',
    ]);
    expect(labels(buildTicks(800, 'metric'))).toEqual(['0 km', '0.2', '0.4', '0.6', '0.8']);
    for (const total of [450, 1_200, 5_500, 13_000, 27_000, 63_000, 160_000]) {
      const count = buildTicks(total, 'metric').length;
      expect(count, `${String(total)} m`).toBeGreaterThanOrEqual(3);
      expect(count, `${String(total)} m`).toBeLessThanOrEqual(6);
    }
  });

  it('drops an interior tick that would crowd the total', () => {
    // 20 sits at 93.5% of 21.4 km.
    expect(labels(buildTicks(21_400, 'metric', { minEndGap: 0.05 }))).toContain('20');
    expect(labels(buildTicks(21_400, 'metric'))).not.toContain('20');
    // 23 km: 20 at 87% is kept at desktop width but would touch "23.0" in a 120px plot.
    expect(labels(buildTicks(23_000, 'metric', { widthPx: 1060 }))).toContain('20');
    expect(labels(buildTicks(23_000, 'metric', { widthPx: 120 }))).not.toContain('20');
  });

  it('ticks in miles when imperial', () => {
    expect(labels(buildTicks(SAMPLE_TOTAL, 'imperial'))).toEqual(['0 mi', '5', '10', '13.3']);
    expect(labels(buildTicks(10 * M_PER_MI, 'imperial'))).toEqual([
      '0 mi',
      '2',
      '4',
      '6',
      '8',
      '10.0',
    ]);
    expect(buildTicks(0, 'metric')).toEqual([]);
  });

  it('formats the default value text', () => {
    expect(defaultValueText(12_200, 640.4, 'metric')).toBe('km 12.2, 640 m');
    expect(defaultValueText(12_200, 640, 'imperial')).toBe('mi 7.6, 2,100 ft');
    expect(defaultValueText(0, Number.NaN, 'metric')).toBe('km 0.0');
  });

  it('describes climbs in text', () => {
    expect(describeClimbs(SAMPLE_CLIMBS, 'metric')).toBe(
      '3 climbs; steepest: climb 2, km 10.7 to 13.7. Climb 1: km 5.6 to 8.4. ' +
        'Climb 2: km 10.7 to 13.7. Climb 3: km 16.8 to 19.0.',
    );
    expect(describeClimbs([{ start: 1000, end: 2000 }], 'metric')).toBe('1 climb: km 1.0 to 2.0.');
    expect(describeClimbs([], 'metric')).toBe('No climbs.');
  });
});

/** A controlled wrapper so key presses and drags update the slider like the page will. */
function Harness(props: Partial<ElevationProfileProps> & { onChange?: (d: number) => void }) {
  const { onChange, scrub: initial = 12_200, ...rest } = props;
  const [scrub, setScrub] = useState(initial);
  return (
    <ElevationProfile
      points={SAMPLE_POINTS}
      climbs={SAMPLE_CLIMBS}
      {...rest}
      scrub={scrub}
      onScrub={(d) => {
        setScrub(d);
        onChange?.(d);
      }}
    />
  );
}

const noop = () => undefined;

const valueNow = () => Number(screen.getByRole('slider').getAttribute('aria-valuenow'));

describe('ElevationProfile', () => {
  it('is a labelled slider with the route as its range', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Elevation profile' });
    expect(slider.tabIndex).toBe(0);
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('21400');
    expect(slider.getAttribute('aria-valuenow')).toBe('12200');
    const ele = Math.round(elevationAt(SAMPLE_POINTS, 12_200));
    expect(slider.getAttribute('aria-valuetext')).toBe(`km 12.2, ${String(ele)} m`);
  });

  it('takes a custom label and value text', () => {
    render(
      <Harness
        label="Route profile"
        valueText={(d, ele) => `${String(Math.round(d))} m along, ${String(Math.round(ele))} m up`}
        scrub={0}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Route profile' });
    const ele = Math.round(elevationAt(SAMPLE_POINTS, 0));
    expect(slider.getAttribute('aria-valuetext')).toBe(`0 m along, ${String(ele)} m up`);
  });

  it('describes the climbs for assistive tech', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider');
    const id = slider.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? '')?.textContent).toMatch(
      /^3 climbs; steepest: climb 2, km 10\.7 to 13\.7\./,
    );
  });

  it('numbers each climb band and ticks the distance', () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll('rect')).toHaveLength(3);
    const text = container.textContent;
    expect(text).toContain('0 km');
    expect(text).toContain('21.4');
    for (const n of ['1', '2', '3']) expect(screen.getByText(n)).toBeTruthy();
  });

  it('moves 1% per arrow, 10% with Shift or PageUp/PageDown, and jumps with Home/End', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(valueNow()).toBe(12_414);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(valueNow()).toBe(12_200);
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(valueNow()).toBe(12_414);
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(valueNow()).toBe(12_200);
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(valueNow()).toBe(14_340);
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(valueNow()).toBe(12_200);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(valueNow()).toBe(14_340);
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(valueNow()).toBe(12_200);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(valueNow()).toBe(21_400);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(valueNow()).toBe(21_400);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(valueNow()).toBe(0);
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true });
    expect(valueNow()).toBe(0);
    fireEvent.keyDown(slider, { key: 'a' });
    expect(onChange.mock.calls.map(([d]) => Math.round(Number(d)))).toEqual([
      12_414, 12_200, 12_414, 12_200, 14_340, 12_200, 14_340, 12_200, 21_400, 0,
    ]);
  });

  describe('pointer', () => {
    const rect = { left: 100, top: 0, width: 500, height: 140, right: 600, bottom: 140 };
    let capture: ReturnType<typeof vi.fn>;
    const mockRect = (element: HTMLElement) =>
      vi
        .spyOn(element, 'getBoundingClientRect')
        .mockReturnValue({ ...rect, x: rect.left, y: rect.top, toJSON: () => rect });

    beforeEach(() => {
      capture = vi.fn();
      // jsdom has no pointer capture; stub it like a browser would provide it.
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        configurable: true,
        value: capture,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
      vi.restoreAllMocks();
    });

    it('scrubs on pointerdown and while dragging, from the rect read at pointerdown', () => {
      render(<Harness scrub={0} />);
      const slider = screen.getByRole('slider');
      const getRect = mockRect(slider);

      fireEvent.pointerDown(slider, {
        pointerId: 1,
        clientX: 350,
        button: 0,
        pointerType: 'touch',
      });
      expect(capture).toHaveBeenCalledWith(1);
      expect(valueNow()).toBe(10_700);

      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 600 });
      expect(valueNow()).toBe(21_400);
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 0 });
      expect(valueNow()).toBe(0);
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 225 });
      expect(valueNow()).toBe(5_350);
      // Layout is read once per drag, not per move.
      expect(getRect).toHaveBeenCalledTimes(1);

      fireEvent.pointerUp(slider, { pointerId: 1, clientX: 225 });
      fireEvent.pointerMove(slider, { pointerId: 1, clientX: 600 });
      expect(valueNow()).toBe(5_350);
    });

    it('ignores other pointers and non-primary mouse buttons', () => {
      render(<Harness scrub={0} />);
      const slider = screen.getByRole('slider');
      mockRect(slider);
      fireEvent.pointerDown(slider, {
        pointerId: 1,
        clientX: 350,
        button: 2,
        pointerType: 'mouse',
      });
      expect(valueNow()).toBe(0);
      fireEvent.pointerDown(slider, {
        pointerId: 1,
        clientX: 350,
        button: 0,
        pointerType: 'mouse',
      });
      expect(valueNow()).toBe(10_700);
      fireEvent.pointerMove(slider, { pointerId: 2, clientX: 600 });
      expect(valueNow()).toBe(10_700);
    });

    it('still scrubs without pointer capture', () => {
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
      render(<Harness scrub={0} />);
      const slider = screen.getByRole('slider');
      mockRect(slider);
      fireEvent.pointerDown(slider, { pointerId: 1, clientX: 600, button: 0, pointerType: 'pen' });
      expect(valueNow()).toBe(21_400);
    });
  });

  it('renders empty and single-point input without crashing', () => {
    const onScrub = vi.fn();
    const { rerender, container } = render(
      <ElevationProfile points={[]} scrub={5} onScrub={onScrub} />,
    );
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemax')).toBe('0');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelector('path')).toBeNull();
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onScrub).not.toHaveBeenCalled();
    rerender(<ElevationProfile points={[{ d: 0, ele: 100 }]} scrub={0} onScrub={onScrub} />);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('km 0.0, 100 m');
  });

  it('draws a flat profile as a centred line', () => {
    const flat = [
      { d: 0, ele: 50 },
      { d: 5000, ele: 50 },
    ];
    const { container } = render(<ElevationProfile points={flat} scrub={0} onScrub={noop} />);
    const line = container.querySelectorAll('path')[1];
    expect(line?.getAttribute('d')).toBe('M0,60 L1000,60');
  });

  it('does not rebuild the paths when only the scrub changes', () => {
    const { container, rerender } = render(
      <ElevationProfile points={SAMPLE_POINTS} scrub={0} onScrub={noop} />,
    );
    const before = container.querySelectorAll('path')[1];
    rerender(<ElevationProfile points={SAMPLE_POINTS} scrub={9000} onScrub={noop} />);
    expect(container.querySelectorAll('path')[1]).toBe(before);
    expect(container.querySelector('line')?.getAttribute('x1')).toBe(
      String((9000 / SAMPLE_TOTAL) * 1000),
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });

  it('has no axe violations when imperial and empty', async () => {
    const { container } = render(
      <>
        <Harness units="imperial" />
        <ElevationProfile points={[]} scrub={0} onScrub={noop} label="Empty profile" />
      </>,
    );
    expect(container.textContent).toContain('0 mi');
    await expectNoAxeViolations(container);
  });
});
