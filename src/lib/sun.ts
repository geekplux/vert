/**
 * Sunrise from the NOAA solar position equations (the NOAA Solar Calculator spreadsheet, after
 * Meeus, "Astronomical Algorithms"): accurate to about a minute between ±72° latitude, which is
 * all a poster line needs. Pure maths: no time-zone database, no network.
 */
import { solarOffsetHours } from './format';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** Zenith of the sun's centre at sunrise: 90° + 34′ refraction + 16′ semi-diameter. */
const SUNRISE_ZENITH = 90.833;

/** Julian centuries since J2000.0 for a time in ms since the Unix epoch. */
function julianCentury(ms: number): number {
  const julianDay = ms / MS_PER_DAY + 2440587.5;
  return (julianDay - 2451545) / 36525;
}

interface SolarTerms {
  /** Solar declination, degrees. */
  declination: number;
  /** Equation of time, minutes. */
  equationOfTime: number;
}

/** Declination and equation of time at a moment (NOAA spreadsheet formulas). */
function solarTerms(ms: number): SolarTerms {
  const t = julianCentury(ms);
  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * RAD;
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparentLong = (trueLong - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLong)) * DEG;
  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = meanLong * RAD;
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m));
  return { declination, equationOfTime };
}

/**
 * Sunrise on a local calendar day at a place, as ms since the Unix epoch, or `null` when the sun
 * does not rise or set that day (polar day or night).
 *
 * @param dayUtcMs 00:00 UTC of the local calendar date (e.g. `Date.UTC(2026, 9, 3)`); the result
 *   is that date's morning at `lon`, which may fall on the previous UTC day far east.
 * @param lat latitude, degrees north
 * @param lon longitude, degrees east
 */
export function sunrise(dayUtcMs: number, lat: number, lon: number): number | null {
  // Start from 06:00 local mean time and refine twice at the estimate (the sun moves ~1°/day).
  let minutes = 360 - 4 * lon;
  for (let pass = 0; pass < 3; pass++) {
    const { declination, equationOfTime } = solarTerms(dayUtcMs + minutes * MS_PER_MINUTE);
    const phi = lat * RAD;
    const delta = declination * RAD;
    const cosHourAngle =
      Math.cos(SUNRISE_ZENITH * RAD) / (Math.cos(phi) * Math.cos(delta)) -
      Math.tan(phi) * Math.tan(delta);
    if (!Number.isFinite(cosHourAngle) || cosHourAngle < -1 || cosHourAngle > 1) return null;
    const hourAngle = Math.acos(cosHourAngle) * DEG;
    minutes = 720 - 4 * (lon + hourAngle) - equationOfTime;
  }
  return dayUtcMs + minutes * MS_PER_MINUTE;
}

/** The track fields `sunriseAlongRun` reads. */
export interface TimedRunTrack {
  readonly lat: ArrayLike<number>;
  readonly lon: ArrayLike<number>;
  readonly cumulative: ArrayLike<number>;
  readonly time: ArrayLike<number> | null;
}

export interface SunriseOnRun {
  /** Sunrise, ms since the Unix epoch. */
  readonly time: number;
  /** Distance from the start where the runner was at sunrise, metres. */
  readonly distance: number;
}

/** Index of the last point at or before `time` (times are non-decreasing). */
function pointBefore(times: ArrayLike<number>, time: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((times[mid] ?? Infinity) <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Distance along the track at `time`, interpolated between the two points around it. */
function distanceAt(track: TimedRunTrack, times: ArrayLike<number>, time: number): number {
  const i = pointBefore(times, time);
  const t0 = times[i] ?? time;
  const t1 = times[i + 1] ?? t0;
  const d0 = track.cumulative[i] ?? 0;
  const d1 = track.cumulative[i + 1] ?? d0;
  const f = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
  return d0 + (d1 - d0) * Math.min(1, Math.max(0, f));
}

/**
 * The first sunrise during the run, and how far along the route it came, or `null` when the run
 * has no timestamps or no sunrise falls between its first and last timestamp. Sunrise is computed
 * where the runner was at the time (the start's sunrise locates the point; that point's sunrise is
 * the answer), on each local day the run spans (local days from {@link solarOffsetHours}).
 */
export function sunriseAlongRun(run: { readonly track: TimedRunTrack }): SunriseOnRun | null {
  const { track } = run;
  const times = track.time;
  const n = times?.length ?? 0;
  if (!times || n < 2 || track.lat.length < n || track.lon.length < n) return null;
  const start = times[0] ?? NaN;
  const end = times[n - 1] ?? NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const lat0 = track.lat[0] ?? 0;
  const lon0 = track.lon[0] ?? 0;
  const offset = solarOffsetHours(lon0) * 3_600_000;
  const firstDay = Math.floor((start + offset) / MS_PER_DAY) * MS_PER_DAY;
  for (let day = firstDay - MS_PER_DAY; day <= end + offset + MS_PER_DAY; day += MS_PER_DAY) {
    const estimate = sunrise(day, lat0, lon0);
    if (estimate === null) continue;
    // Recompute where the runner was at that moment (matters on long point-to-point runs).
    const i = pointBefore(times, Math.min(end, Math.max(start, estimate)));
    const time = sunrise(day, track.lat[i] ?? lat0, track.lon[i] ?? lon0) ?? estimate;
    if (time >= start && time <= end) return { time, distance: distanceAt(track, times, time) };
  }
  return null;
}

/**
 * A moment as a 24-hour clock time, "07:31", in `timeZone` (an IANA name), or in the browser's
 * time zone when omitted. GPX times are UTC and carry no zone, and there is no time-zone database
 * for coordinates in the bundle, so the viewer's own zone (normally the runner's) is the best
 * guess for a wall-clock time.
 */
export function formatClock(ms: number, timeZone?: string): string {
  if (!Number.isFinite(ms)) return '–';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
}
