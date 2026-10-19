import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PROFILE_POINTS } from '../../gpx/stats';
import type { Scene } from '../../scene/types';
import { hills, sceneOn } from '../../terrain/testing';
import { expectNoAxeViolations } from '../../test/axe';
import { buildTicks, elevationAt } from './profileGeometry';
import { SceneElevationProfile } from './SceneElevationProfile';
import { SCENE_PROFILE_POINTS, sceneProfile } from './sceneProfile';

/** A scene whose drawn route starts 200 m into the run (the default trim), with two climbs. */
function trimmedScene(pointCount = 900): Scene {
  const points = Array.from({ length: pointCount }, (_, k): [number, number] => [
    5 + (110 * k) / (pointCount - 1),
    10 + 60 * Math.abs(Math.sin((k / (pointCount - 1)) * Math.PI)),
  ]);
  const scene = sceneOn(hills(), points, { start: 200 });
  const end = scene.route.distance[pointCount - 1] ?? 0;
  return {
    ...scene,
    climbs: [
      { start: 1_000, end: 1_900, gain: 120, avgGrade: 0.13, steepest: false },
      { start: 2_500, end: end - 100, gain: 200, avgGrade: 0.2, steepest: true },
    ],
  };
}

function Harness({ scene, onChange }: { scene: Scene; onChange?: (d: number) => void }) {
  const [scrub, setScrub] = useState(scene.route.distance[0] ?? 0);
  return (
    <SceneElevationProfile
      scene={scene}
      scrub={scrub}
      onScrub={(d) => {
        setScrub(d);
        onChange?.(d);
      }}
    />
  );
}

describe('sceneProfile', () => {
  it('has as many points as the app’s profile, spanning the drawn route in the scene’s metres', () => {
    expect(SCENE_PROFILE_POINTS).toBe(PROFILE_POINTS);
    const scene = trimmedScene();
    const { origin, points, climbs } = sceneProfile(scene);
    const { distance, elevation } = scene.route;
    expect(origin).toBe(200);
    expect(points).toHaveLength(SCENE_PROFILE_POINTS);
    expect(points[0]).toEqual({ d: 200, ele: elevation[0] });
    expect(points.at(-1)?.d).toBe(distance[distance.length - 1]);
    expect(points.at(-1)?.ele).toBeCloseTo(elevation[elevation.length - 1] ?? 0, 6);
    // Each point lies on the route's own profile.
    const route = Array.from(distance, (d, k) => ({ d, ele: elevation[k] ?? 0 }));
    for (const point of points.slice(0, 50)) {
      expect(point.ele).toBeCloseTo(elevationAt(route, point.d), 3);
    }
    expect(climbs).toEqual([
      { start: 1_000, end: 1_900, steepest: false },
      { start: 2_500, end: (distance[distance.length - 1] ?? 0) - 100, steepest: true },
    ]);
  });

  it('keeps every point of a short route, and is memoised per scene', () => {
    const scene = trimmedScene(40);
    expect(sceneProfile(scene).points).toHaveLength(40);
    expect(sceneProfile(scene)).toBe(sceneProfile(scene));
  });
});

describe('buildTicks with an origin', () => {
  it('labels the start of a trimmed stretch and keeps round distances from the real start', () => {
    // 0.2 km to 21.3 km.
    const ticks = buildTicks(21_076, 'metric', { origin: 200 });
    expect(ticks.map((t) => t.label)).toEqual(['0.2 km', '5', '10', '15', '21.3']);
    expect(ticks[1]?.at).toBeCloseTo(4_800 / 21_076, 9);
    expect(ticks.at(-1)?.at).toBe(1);
  });

  it('drops an interior tick that would crowd the first label', () => {
    expect(buildTicks(10_000, 'metric', { origin: 4_800 }).map((t) => t.label)).toEqual([
      '4.8 km',
      '6',
      '8',
      '10',
      '12',
      '14.8',
    ]);
    expect(buildTicks(10_000, 'metric', { origin: 4_900 }).map((t) => t.label)[1]).toBe('6');
  });

  it('is the plain profile’s ticks at origin 0', () => {
    expect(buildTicks(21_400, 'metric', { origin: 0 })).toEqual(buildTicks(21_400, 'metric'));
  });
});

describe('SceneElevationProfile', () => {
  it('is the profile’s slider over the drawn route, in metres from the run’s real start', () => {
    const scene = trimmedScene();
    const end = scene.route.distance[scene.route.distance.length - 1] ?? 0;
    render(<Harness scene={scene} />);
    const slider = screen.getByRole('slider', { name: 'Elevation profile' });
    expect(slider.tabIndex).toBe(0);
    expect(slider.getAttribute('aria-valuemin')).toBe('200');
    expect(slider.getAttribute('aria-valuemax')).toBe(String(Math.round(end)));
    expect(slider.getAttribute('aria-valuenow')).toBe('200');
    const ele = Math.round(scene.route.elevation[0] ?? 0);
    expect(slider.getAttribute('aria-valuetext')).toBe(`km 0.2, ${String(ele)} m`);
  });

  it('moves by keys in the scene’s metres and reports them', () => {
    const scene = trimmedScene();
    const end = scene.route.distance[scene.route.distance.length - 1] ?? 0;
    const length = end - 200;
    const onChange = vi.fn();
    render(<Harness scene={scene} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(200 + length * 0.01);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange.mock.lastCall?.[0]).toBeCloseTo(200 + length * 0.11, 6);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(end);
    expect(slider.getAttribute('aria-valuenow')).toBe(String(Math.round(end)));
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(200);
  });

  it('ticks from the drawn start, shades and numbers the climbs and describes them', async () => {
    const scene = trimmedScene();
    const { container } = render(<Harness scene={scene} />);
    expect(screen.getByText('0.2 km')).toBeTruthy();
    // Climb numbers 1 and 2 on the bands (a tick may read "2" as well).
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    const slider = screen.getByRole('slider');
    const description = document.getElementById(slider.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toMatch(/^2 climbs; steepest: climb 2, km 2\.5 to /);
    expect(description?.textContent).toContain('Climb 1: km 1.0 to 1.9.');
    await expectNoAxeViolations(container);
  });
});
