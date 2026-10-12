import { describe, expect, it } from 'vitest';
import { formatClock, sunrise, sunriseAlongRun } from './sun';
import type { TimedRunTrack } from './sun';

const MINUTE = 60_000;

/** Minutes between two moments. */
const minutesApart = (a: number, b: number) => Math.abs(a - b) / MINUTE;

describe('sunrise', () => {
  // Reference times: NOAA Solar Calculator / timeanddate.com, rounded to the minute.
  it.each([
    // Vogel State Park, Georgia: 07:32 EDT.
    ['Vogel SP, 2026-10-03', Date.UTC(2026, 9, 3), 34.765, -83.925, Date.UTC(2026, 9, 3, 11, 32)],
    // London: 04:43 BST at the June solstice.
    ['London, 2024-06-21', Date.UTC(2024, 5, 21), 51.5074, -0.1278, Date.UTC(2024, 5, 21, 3, 43)],
    // New York: 07:16 EST at the December solstice.
    [
      'New York, 2024-12-21',
      Date.UTC(2024, 11, 21),
      40.7128,
      -74.006,
      Date.UTC(2024, 11, 21, 12, 16),
    ],
    // Sydney: 07:00 AEST, i.e. the previous UTC day.
    ['Sydney, 2024-06-21', Date.UTC(2024, 5, 21), -33.8688, 151.2093, Date.UTC(2024, 5, 20, 21, 0)],
  ])('%s', (_, day, lat, lon, expected) => {
    const time = sunrise(day, lat, lon);
    expect(time).not.toBeNull();
    expect(minutesApart(time ?? 0, expected)).toBeLessThanOrEqual(2);
  });

  it('is null in polar day and polar night', () => {
    expect(sunrise(Date.UTC(2024, 5, 21), 69.65, 18.96)).toBeNull();
    expect(sunrise(Date.UTC(2024, 11, 21), 69.65, 18.96)).toBeNull();
  });
});

/** A straight run at an even pace: `n` points, `metres` long, starting at `start`. */
function evenRun(start: number, seconds: number, metres: number, n = 101): TimedRunTrack {
  return {
    lat: Float64Array.from({ length: n }, (_, i) => 34.75 + (i / (n - 1)) * 0.02),
    lon: Float64Array.from({ length: n }, () => -83.93),
    cumulative: Float64Array.from({ length: n }, (_, i) => (i / (n - 1)) * metres),
    time: Float64Array.from({ length: n }, (_, i) => start + (i / (n - 1)) * seconds * 1000),
  };
}

describe('sunriseAlongRun', () => {
  it('finds sunrise during a pre-dawn run and where the runner was', () => {
    // 05:42 EDT start, 3:12:40 at an even pace over 21.4 km (the canvas's run).
    const start = Date.UTC(2026, 9, 3, 9, 42);
    const seconds = 3 * 3600 + 12 * 60 + 40;
    const result = sunriseAlongRun({ track: evenRun(start, seconds, 21_400) });
    expect(result).not.toBeNull();
    const time = result?.time ?? 0;
    expect(minutesApart(time, Date.UTC(2026, 9, 3, 11, 32))).toBeLessThanOrEqual(2);
    const expectedDistance = ((time - start) / (seconds * 1000)) * 21_400;
    expect(result?.distance).toBeCloseTo(expectedDistance, 0);
    expect(formatClock(time, 'America/New_York')).toMatch(/^07:3[0-3]$/);
  });

  it('is null when the run starts after sunrise or ends before it', () => {
    expect(sunriseAlongRun({ track: evenRun(Date.UTC(2026, 9, 3, 13), 3600, 10_000) })).toBeNull();
    expect(sunriseAlongRun({ track: evenRun(Date.UTC(2026, 9, 3, 9), 3600, 10_000) })).toBeNull();
  });

  it('is null without timestamps', () => {
    const track = { ...evenRun(0, 1, 1), time: null };
    expect(sunriseAlongRun({ track })).toBeNull();
  });

  it('finds the next morning on a run through the night', () => {
    // 18:00 EDT start, 20 hours: the sunrise is the next day's.
    const start = Date.UTC(2026, 9, 3, 22);
    const result = sunriseAlongRun({ track: evenRun(start, 20 * 3600, 100_000) });
    expect(minutesApart(result?.time ?? 0, Date.UTC(2026, 9, 4, 11, 33))).toBeLessThanOrEqual(3);
  });
});

describe('formatClock', () => {
  it('formats a 24-hour clock time in a time zone', () => {
    expect(formatClock(Date.UTC(2026, 9, 3, 11, 31, 20), 'America/New_York')).toBe('07:31');
    expect(formatClock(Date.UTC(2026, 9, 3, 23, 5), 'UTC')).toBe('23:05');
    expect(formatClock(NaN)).toBe('–');
  });
});
