/**
 * Units and display formatting for the copy in DESIGN-SPEC §3: "21.4 km", "+1,070 m", "3:12:40",
 * "6:48 /km", "SAT · 2026-10-03", "km 5.6 → 8.4", "18%".
 *
 * Inputs are always SI (metres, seconds, fractions); the `units` argument only picks the display
 * unit. Numbers use en-US grouping and round half away from zero on the decimal value (9.95 km
 * shows as "10.0 km"). Negative numbers use a real minus sign (U+2212), and a value that rounds
 * to zero never shows a sign. Missing or meaningless values show an en dash ("–").
 */

/** Display unit system. */
export type Units = 'metric' | 'imperial';

/** A formatted quantity with its number and unit apart (for StatTile) and joined (for prose). */
export interface Formatted {
  /** The number as displayed, e.g. "21.4" or "+1,070". */
  readonly value: string;
  /** The unit as displayed, e.g. "km", "ft", "/mi"; empty when the value is missing. */
  readonly unit: string;
  /** Value and unit joined by a space, e.g. "21.4 km"; just the value when the unit is empty. */
  readonly text: string;
}

/** Metres in one international mile. */
export const METRES_PER_MILE = 1609.344;
/** Metres in one international foot. */
export const METRES_PER_FOOT = 0.3048;

/** Shown in place of a value that is missing, infinite or meaningless. */
export const MISSING = '–';

const MINUS = '−';

/** Kilometres to miles. */
export const kmToMi = (km: number): number => (km * 1000) / METRES_PER_MILE;
/** Miles to kilometres. */
export const miToKm = (mi: number): number => (mi * METRES_PER_MILE) / 1000;
/** Metres to feet. */
export const mToFt = (m: number): number => m / METRES_PER_FOOT;
/** Feet to metres. */
export const ftToM = (ft: number): number => ft * METRES_PER_FOOT;

/** The distance unit label for a unit system: "km" or "mi". */
export const distanceUnit = (units: Units): 'km' | 'mi' => (units === 'imperial' ? 'mi' : 'km');

/** A distance in metres expressed in the unit system's distance unit (km or mi). */
export const metresToDistance = (metres: number, units: Units): number =>
  units === 'imperial' ? metres / METRES_PER_MILE : metres / 1000;

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormats = new Map<number, Intl.NumberFormat>([[0, integerFormat]]);

/** A cached en-US formatter with exactly `decimals` fraction digits. */
function numberFormat(decimals: number): Intl.NumberFormat {
  let format = decimalFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    decimalFormats.set(decimals, format);
  }
  return format;
}

/**
 * Format a finite number with en-US grouping, `decimals` fraction digits, a real minus for
 * negatives and, when `signed`, a "+" for positives. Values that round to zero get no sign.
 */
export function formatNumber(value: number, decimals = 0, signed = false): string {
  if (!Number.isFinite(value)) return MISSING;
  const digits = numberFormat(decimals).format(Math.abs(value));
  if (!/[1-9]/.test(digits)) return digits;
  if (value < 0) return MINUS + digits;
  return signed ? `+${digits}` : digits;
}

function formatted(value: string, unit: string): Formatted {
  if (value === MISSING) return { value, unit: '', text: value };
  return { value, unit, text: `${value} ${unit}` };
}

/**
 * A distance in the unit system's distance unit: "21.4 km" or "13.3 mi".
 *
 * @param metres distance in metres
 * @param options.decimals fraction digits, default 1
 */
export function formatDistance(
  metres: number,
  units: Units,
  { decimals = 1 }: { decimals?: number } = {},
): Formatted {
  return formatted(formatNumber(metresToDistance(metres, units), decimals), distanceUnit(units));
}

/**
 * An elevation or elevation change in whole metres or feet: "820 m", "+1,070 m", "+3,510 ft".
 *
 * @param metres elevation in metres
 * @param options.signed prefix positive values with "+" (for gains), default false
 */
export function formatElevation(
  metres: number,
  units: Units,
  { signed = false }: { signed?: boolean } = {},
): Formatted {
  const imperial = units === 'imperial';
  return formatted(
    formatNumber(imperial ? mToFt(metres) : metres, 0, signed),
    imperial ? 'ft' : 'm',
  );
}

/** Whole seconds as "m:ss" under an hour, "h:mm:ss" from an hour. */
function clock(totalSeconds: number, withHours: boolean): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds / 60) - (withHours ? h * 60 : 0);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, '0');
  return withHours ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

/**
 * A duration as "h:mm:ss" ("3:12:40"), or "m:ss" under an hour ("48:05"). Rounds to the nearest
 * second first, so 59.96 s is "1:00" and 3,599.5 s is "1:00:00". Negative or non-finite input
 * gives "–".
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return MISSING;
  const total = Math.round(seconds);
  return clock(total, total >= 3600);
}

/**
 * A pace per kilometre or per mile: "6:48 /km", "10:57 /mi". Minutes are not rolled into hours
 * ("75:00 /km"). Zero, negative or non-finite pace (stopped, no time data) gives "–".
 *
 * @param secondsPerKm pace in seconds per kilometre, whatever the display units
 */
export function formatPace(secondsPerKm: number, units: Units): Formatted {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return formatted(MISSING, '');
  const perUnit = units === 'imperial' ? (secondsPerKm * METRES_PER_MILE) / 1000 : secondsPerKm;
  return formatted(clock(Math.round(perUnit), false), `/${distanceUnit(units)}`);
}

/**
 * A grade as a whole percentage: 0.18 → "18%", −0.06 → "−6%" (real minus). Rounds half away from
 * zero; values that round to 0 show "0%". Non-finite input gives "–".
 *
 * @param fraction rise over run, e.g. 0.18 for 18%
 */
export function formatGrade(fraction: number): string {
  const digits = formatNumber(fraction * 100, 0);
  return digits === MISSING ? MISSING : `${digits}%`;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * Hours a run's local clock is ahead of UTC, estimated from longitude as round(lon / 15) and
 * clamped to −12…+12. This is mean solar time to the nearest hour, not the legal time zone (there
 * is no time-zone database in the browser bundle), so it can be an hour or two off the wall clock
 * (DST, wide zones such as China's) but it keeps daytime on the right calendar day.
 */
export function solarOffsetHours(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  // `+ 0` turns −0 (from rounding small negative longitudes) into 0.
  return Math.max(-12, Math.min(12, Math.round(lon / 15))) + 0;
}

/**
 * The run's local weekday and date: "SAT · 2026-10-03".
 *
 * GPX timestamps are UTC, and the local date is what a runner remembers. The offset comes from
 * {@link solarOffsetHours} for the run's longitude, so the result is the same in every viewer's
 * time zone and correct for any run that happens in daylight, anywhere. Only a run within an hour
 * or two of local midnight can land on the neighbouring day.
 *
 * @param date the run's start time
 * @param lonForOffset a longitude on the run (the start point is fine), degrees east
 * @throws RangeError when `date` is invalid.
 */
export function formatDateLine(date: Date, lonForOffset: number): string {
  const time = date.getTime();
  if (Number.isNaN(time)) throw new RangeError('formatDateLine needs a valid date');
  const local = new Date(time + solarOffsetHours(lonForOffset) * 3_600_000);
  const yyyy = String(local.getUTCFullYear()).padStart(4, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  // getUTCDay() is always 0–6.
  const weekday = WEEKDAYS[local.getUTCDay()] as string;
  return `${weekday} · ${yyyy}-${mm}-${dd}`;
}

/**
 * A stretch of the route by distance from the start, with one decimal: "km 5.6 → 8.4" or
 * "mi 3.5 → 5.2".
 */
export function formatKmRange(fromMetres: number, toMetres: number, units: Units): string {
  const from = formatNumber(metresToDistance(fromMetres, units), 1);
  const to = formatNumber(metresToDistance(toMetres, units), 1);
  return `${distanceUnit(units)} ${from} → ${to}`;
}
