import { describe, expect, it } from 'vitest';
import {
  METRES_PER_FOOT,
  METRES_PER_MILE,
  MISSING,
  distanceUnit,
  formatDateLine,
  formatDistance,
  formatDuration,
  formatElevation,
  formatGrade,
  formatKmRange,
  formatNumber,
  formatPace,
  ftToM,
  kmToMi,
  metresToDistance,
  miToKm,
  mToFt,
  solarOffsetHours,
} from './format';

const MINUS = '−';
const EN_DASH = '–';

describe('unit conversions', () => {
  it('uses the international mile and foot', () => {
    expect(METRES_PER_MILE).toBe(1609.344);
    expect(METRES_PER_FOOT).toBe(0.3048);
  });

  it('converts km ↔ mi', () => {
    expect(kmToMi(1.609344)).toBeCloseTo(1, 12);
    expect(miToKm(1)).toBeCloseTo(1.609344, 12);
    expect(kmToMi(42.195)).toBeCloseTo(26.2188, 4);
    expect(kmToMi(0)).toBe(0);
    expect(miToKm(kmToMi(21.4))).toBeCloseTo(21.4, 12);
  });

  it('converts m ↔ ft', () => {
    expect(mToFt(0.3048)).toBeCloseTo(1, 12);
    expect(ftToM(1)).toBe(0.3048);
    expect(mToFt(1070)).toBeCloseTo(3510.4987, 4);
    expect(ftToM(mToFt(-86))).toBeCloseTo(-86, 12);
  });

  it('expresses metres in the display distance unit', () => {
    expect(metresToDistance(21400, 'metric')).toBe(21.4);
    expect(metresToDistance(1609.344, 'imperial')).toBe(1);
    expect(distanceUnit('metric')).toBe('km');
    expect(distanceUnit('imperial')).toBe('mi');
  });
});

describe('formatNumber', () => {
  it('groups thousands en-US style', () => {
    expect(formatNumber(1070)).toBe('1,070');
    expect(formatNumber(1234567.891, 2)).toBe('1,234,567.89');
    expect(formatNumber(999)).toBe('999');
  });

  it('pads to the requested decimals', () => {
    expect(formatNumber(21, 1)).toBe('21.0');
    expect(formatNumber(0, 2)).toBe('0.00');
  });

  it('rounds half away from zero on the decimal value', () => {
    expect(formatNumber(9.95, 1)).toBe('10.0');
    expect(formatNumber(0.05, 1)).toBe('0.1');
    expect(formatNumber(2.5)).toBe('3');
    expect(formatNumber(-2.5)).toBe(`${MINUS}3`);
    expect(formatNumber(999.5)).toBe('1,000');
  });

  it('uses a real minus and an optional plus', () => {
    expect(formatNumber(-1070)).toBe(`${MINUS}1,070`);
    expect(formatNumber(1070, 0, true)).toBe('+1,070');
    expect(formatNumber(-1070, 0, true)).toBe(`${MINUS}1,070`);
  });

  it('never signs a value that rounds to zero', () => {
    expect(formatNumber(0, 0, true)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-0.04, 1)).toBe('0.0');
    expect(formatNumber(0.4, 0, true)).toBe('0');
    expect(formatNumber(-0.4, 0, true)).toBe('0');
  });

  it('shows an en dash for non-finite values', () => {
    expect(MISSING).toBe(EN_DASH);
    expect(formatNumber(NaN)).toBe(EN_DASH);
    expect(formatNumber(Infinity)).toBe(EN_DASH);
    expect(formatNumber(-Infinity, 1, true)).toBe(EN_DASH);
  });
});

describe('formatDistance', () => {
  it('formats the sample run as 21.4 km / 13.3 mi', () => {
    expect(formatDistance(21400, 'metric')).toEqual({ value: '21.4', unit: 'km', text: '21.4 km' });
    expect(formatDistance(21400, 'imperial')).toEqual({
      value: '13.3',
      unit: 'mi',
      text: '13.3 mi',
    });
  });

  it('rounds at the decimal boundary', () => {
    expect(formatDistance(9950, 'metric').text).toBe('10.0 km');
    expect(formatDistance(9949, 'metric').text).toBe('9.9 km');
    expect(formatDistance(42195, 'metric').text).toBe('42.2 km');
    expect(formatDistance(42195, 'imperial').text).toBe('26.2 mi');
    expect(formatDistance(METRES_PER_MILE * 9.95, 'imperial').text).toBe('10.0 mi');
  });

  it('formats zero and tiny distances', () => {
    expect(formatDistance(0, 'metric').text).toBe('0.0 km');
    expect(formatDistance(49, 'metric').text).toBe('0.0 km');
    expect(formatDistance(50, 'metric').text).toBe('0.1 km');
    expect(formatDistance(0, 'imperial').text).toBe('0.0 mi');
  });

  it('takes a decimals option', () => {
    expect(formatDistance(21400, 'metric', { decimals: 0 }).text).toBe('21 km');
    expect(formatDistance(21437, 'metric', { decimals: 2 }).text).toBe('21.44 km');
    expect(formatDistance(500, 'imperial', { decimals: 2 }).text).toBe('0.31 mi');
  });

  it('groups long distances', () => {
    expect(formatDistance(1_234_567, 'metric').text).toBe('1,234.6 km');
  });

  it('signs negative distances with a real minus', () => {
    expect(formatDistance(-1000, 'metric').text).toBe(`${MINUS}1.0 km`);
  });

  it('drops the unit for a missing value', () => {
    expect(formatDistance(NaN, 'metric')).toEqual({ value: EN_DASH, unit: '', text: EN_DASH });
  });
});

describe('formatElevation', () => {
  it('formats the sample run gain as +1,070 m / +3,510 ft', () => {
    expect(formatElevation(1070, 'metric', { signed: true })).toEqual({
      value: '+1,070',
      unit: 'm',
      text: '+1,070 m',
    });
    expect(formatElevation(1070, 'imperial', { signed: true }).text).toBe('+3,510 ft');
  });

  it('is unsigned by default', () => {
    expect(formatElevation(820, 'metric').text).toBe('820 m');
    expect(formatElevation(820, 'imperial').text).toBe('2,690 ft');
  });

  it('rounds to whole units', () => {
    expect(formatElevation(269.5, 'metric', { signed: true }).text).toBe('+270 m');
    expect(formatElevation(269.4, 'metric').text).toBe('269 m');
    expect(formatElevation(999.5, 'metric').text).toBe('1,000 m');
    // 0.3048 m is exactly 1 ft; 0.1524 m is half a foot.
    expect(formatElevation(0.3048, 'imperial').text).toBe('1 ft');
    expect(formatElevation(0.1524, 'imperial').text).toBe('1 ft');
  });

  it('handles zero and below sea level', () => {
    expect(formatElevation(0, 'metric', { signed: true }).text).toBe('0 m');
    expect(formatElevation(0.4, 'metric', { signed: true }).text).toBe('0 m');
    expect(formatElevation(-86, 'metric').text).toBe(`${MINUS}86 m`);
    expect(formatElevation(-86, 'imperial', { signed: true }).text).toBe(`${MINUS}282 ft`);
  });

  it('drops the unit for a missing value', () => {
    expect(formatElevation(NaN, 'imperial').text).toBe(EN_DASH);
  });
});

describe('formatDuration', () => {
  it('formats h:mm:ss from an hour', () => {
    expect(formatDuration(11560)).toBe('3:12:40');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(36_000 * 10)).toBe('100:00:00');
  });

  it('formats m:ss under an hour', () => {
    expect(formatDuration(2885)).toBe('48:05');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('rounds to the nearest second before choosing the layout', () => {
    expect(formatDuration(59.96)).toBe('1:00');
    expect(formatDuration(59.4)).toBe('0:59');
    expect(formatDuration(0.4)).toBe('0:00');
    expect(formatDuration(3599.4)).toBe('59:59');
    expect(formatDuration(3599.5)).toBe('1:00:00');
    expect(formatDuration(11559.6)).toBe('3:12:40');
  });

  it('shows an en dash for negative or non-finite durations', () => {
    expect(formatDuration(-1)).toBe(EN_DASH);
    expect(formatDuration(NaN)).toBe(EN_DASH);
    expect(formatDuration(Infinity)).toBe(EN_DASH);
  });
});

describe('formatPace', () => {
  it('formats per kilometre', () => {
    expect(formatPace(408, 'metric')).toEqual({ value: '6:48', unit: '/km', text: '6:48 /km' });
    expect(formatPace(300, 'metric').text).toBe('5:00 /km');
  });

  it('converts to per mile', () => {
    // 408 s/km × 1.609344 = 656.6 s/mi.
    expect(formatPace(408, 'imperial')).toEqual({ value: '10:57', unit: '/mi', text: '10:57 /mi' });
    expect(formatPace((1000 / METRES_PER_MILE) * 480, 'imperial').text).toBe('8:00 /mi');
  });

  it('rounds to the nearest second, carrying into minutes', () => {
    expect(formatPace(359.5, 'metric').text).toBe('6:00 /km');
    expect(formatPace(359.4, 'metric').text).toBe('5:59 /km');
    expect(formatPace(59.96, 'metric').text).toBe('1:00 /km');
  });

  it('keeps very slow paces in minutes', () => {
    expect(formatPace(4500, 'metric').text).toBe('75:00 /km');
  });

  it('shows an en dash when stopped or without time data', () => {
    const missing = { value: EN_DASH, unit: '', text: EN_DASH };
    expect(formatPace(Infinity, 'metric')).toEqual(missing);
    expect(formatPace(NaN, 'imperial')).toEqual(missing);
    expect(formatPace(0, 'metric')).toEqual(missing);
    expect(formatPace(-300, 'metric')).toEqual(missing);
  });
});

describe('formatGrade', () => {
  it('formats whole percentages', () => {
    expect(formatGrade(0.18)).toBe('18%');
    expect(formatGrade(0.184)).toBe('18%');
    expect(formatGrade(1)).toBe('100%');
  });

  it('uses a real minus for descents', () => {
    expect(formatGrade(-0.06)).toBe(`${MINUS}6%`);
    expect(formatGrade(-0.06)).not.toContain('-');
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(formatGrade(0.125)).toBe('13%');
    expect(formatGrade(-0.125)).toBe(`${MINUS}13%`);
    expect(formatGrade(0.005)).toBe('1%');
    expect(formatGrade(-0.005)).toBe(`${MINUS}1%`);
  });

  it('shows flat ground as 0% without a sign', () => {
    expect(formatGrade(0)).toBe('0%');
    expect(formatGrade(-0.004)).toBe('0%');
    expect(formatGrade(0.004)).toBe('0%');
  });

  it('shows an en dash for non-finite grades', () => {
    expect(formatGrade(NaN)).toBe(EN_DASH);
    expect(formatGrade(Infinity)).toBe(EN_DASH);
  });
});

describe('solarOffsetHours', () => {
  it('rounds longitude / 15 to whole hours', () => {
    expect(solarOffsetHours(0)).toBe(0);
    expect(solarOffsetHours(-83.926)).toBe(-6);
    expect(solarOffsetHours(139.69)).toBe(9);
    expect(solarOffsetHours(7.4)).toBe(0);
    expect(solarOffsetHours(7.5)).toBe(1);
    expect(solarOffsetHours(-7.6)).toBe(-1);
  });

  it('returns +0, never −0', () => {
    expect(Object.is(solarOffsetHours(-1), 0)).toBe(true);
    expect(Object.is(solarOffsetHours(-7.5), 0)).toBe(true);
  });

  it('stays within ±12', () => {
    expect(solarOffsetHours(180)).toBe(12);
    expect(solarOffsetHours(-180)).toBe(-12);
    expect(solarOffsetHours(400)).toBe(12);
  });

  it('falls back to UTC for a non-finite longitude', () => {
    expect(solarOffsetHours(NaN)).toBe(0);
  });
});

describe('formatDateLine', () => {
  const GEORGIA = -83.926;
  const TOKYO = 139.69;

  it('formats the weekday and ISO date', () => {
    expect(formatDateLine(new Date('2026-10-03T13:30:00Z'), GEORGIA)).toBe('SAT · 2026-10-03');
  });

  it('uses the run’s local date, not the UTC date', () => {
    // 21:00 on Saturday in Georgia is already Sunday in UTC.
    expect(formatDateLine(new Date('2026-10-04T03:00:00Z'), GEORGIA)).toBe('SAT · 2026-10-03');
    // 07:00 on Sunday in Tokyo is still Saturday in UTC.
    expect(formatDateLine(new Date('2026-10-03T22:00:00Z'), TOKYO)).toBe('SUN · 2026-10-04');
  });

  it('uses the UTC date at the prime meridian', () => {
    expect(formatDateLine(new Date('2026-10-03T23:59:59Z'), 0)).toBe('SAT · 2026-10-03');
    expect(formatDateLine(new Date('2026-10-04T00:00:00Z'), 0)).toBe('SUN · 2026-10-04');
  });

  it('crosses month and year boundaries', () => {
    expect(formatDateLine(new Date('2027-01-01T02:00:00Z'), GEORGIA)).toBe('THU · 2026-12-31');
    expect(formatDateLine(new Date('2024-02-28T20:00:00Z'), TOKYO)).toBe('THU · 2024-02-29');
  });

  it('names every weekday', () => {
    const names = Array.from({ length: 7 }, (_, i) =>
      formatDateLine(new Date(Date.UTC(2026, 9, 4 + i, 12)), 0).slice(0, 3),
    );
    expect(names).toEqual(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
  });

  it('separates weekday and date with a middle dot', () => {
    expect(formatDateLine(new Date('2026-10-03T12:00:00Z'), 0)).toMatch(
      /^[A-Z]{3} · \d{4}-\d{2}-\d{2}$/,
    );
  });

  it('throws for an invalid date', () => {
    expect(() => formatDateLine(new Date('not a date'), 0)).toThrow(RangeError);
  });
});

describe('formatKmRange', () => {
  it('formats a climb range in km and mi', () => {
    expect(formatKmRange(5600, 8400, 'metric')).toBe('km 5.6 → 8.4');
    expect(formatKmRange(5600, 8400, 'imperial')).toBe('mi 3.5 → 5.2');
  });

  it('starts at 0.0 and rounds each end', () => {
    expect(formatKmRange(0, 949, 'metric')).toBe('km 0.0 → 0.9');
    expect(formatKmRange(9950, 12_345, 'metric')).toBe('km 10.0 → 12.3');
  });

  it('uses a real arrow', () => {
    expect(formatKmRange(0, 1000, 'metric')).toContain('→');
  });
});
