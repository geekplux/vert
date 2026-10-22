import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs, Prefs } from '../page/state';
import {
  POSTER_URL,
  clampSignature,
  elevationNote,
  posterAriaLabel,
  posterContentFromRun,
  posterStatList,
  shareDateLine,
} from './types';

const NAME = SAMPLE_RUN.name;
const ALL = { distance: true, vert: true, time: true, highPoint: true };

function prefs(poster: Partial<PosterPrefs> = {}, rest: Partial<Prefs> = {}): Prefs {
  return { ...INITIAL_PREFS, ...rest, poster: { ...INITIAL_PREFS.poster, ...poster } };
}

describe('posterContentFromRun', () => {
  it('defaults the title to the run name and the subtitle to none', () => {
    const content = posterContentFromRun(SAMPLE_RUN, prefs());
    expect(content.title).toBe(NAME);
    expect(content.date).toBe('SAT · 2026-10-03');
    expect(content.subtitle).toBe('');
    expect(content.signature).toBe('');
    expect(content.isSample).toBe(true);
    expect(content.exaggeration).toBe(1.6);
    expect(content.profile).toBe(SAMPLE_RUN.profile);
  });

  it('uses the edited title, subtitle and signature, trimmed', () => {
    const content = posterContentFromRun(
      SAMPLE_RUN,
      prefs({ title: '  Coosa  ', subtitle: 'Ellijay, GA', signature: ' @geekplux ' }),
    );
    expect(content.title).toBe('Coosa');
    expect(content.subtitle).toBe('Ellijay, GA');
    expect(content.signature).toBe('@geekplux');
    expect(content.date).toBe('SAT · 2026-10-03');
  });

  it('treats a subtitle equal to the date line as none (the date is always shown)', () => {
    const content = posterContentFromRun(SAMPLE_RUN, prefs({ subtitle: 'SAT · 2026-10-03' }));
    expect(content.subtitle).toBe('');
  });

  it('cuts the signature to 40 characters, the last one an ellipsis', () => {
    const content = posterContentFromRun(SAMPLE_RUN, prefs({ signature: `@${'a'.repeat(79)}` }));
    expect(content.signature).toBe(`@${'a'.repeat(38)}…`);
    expect(Array.from(content.signature)).toHaveLength(40);
    expect(clampSignature(`@${'a'.repeat(39)}`)).toBe(`@${'a'.repeat(39)}`);
    expect(clampSignature('👩‍👩‍👧'.repeat(41))).toBe(`${'👩‍👩‍👧'.repeat(39)}…`);
  });

  it('includes only the stats that are switched on (default: distance, vert, time)', () => {
    const content = posterContentFromRun(SAMPLE_RUN, prefs());
    expect(Object.keys(content.stats)).toEqual(['distance', 'vert', 'time']);
    expect(content.stats.distance?.text).toBe('21.5 km');
    expect(content.stats.vert?.text).toBe('+1,102 m');
    expect(content.stats.time).toBe('3:04:58');

    const two = posterContentFromRun(
      SAMPLE_RUN,
      prefs({ stats: { ...ALL, time: false, distance: false } }),
    );
    expect(posterStatList(two.stats)).toEqual([
      ['vert', 'VERT', '+1,102 m'],
      ['highPoint', 'HIGH POINT', '1,267 m'],
    ]);
  });

  it('formats in imperial units', () => {
    const content = posterContentFromRun(SAMPLE_RUN, prefs({ stats: ALL }, { units: 'imperial' }));
    expect(content.units).toBe('imperial');
    expect(content.stats.distance?.text).toBe('13.3 mi');
    expect(content.stats.vert?.text).toBe('+3,615 ft');
    expect(content.stats.highPoint?.text).toBe('4,157 ft');
  });

  it('leaves out time for a run without time data, and the date for one without a start time', () => {
    const run = { ...SAMPLE_RUN, movingTime: 0, startTime: Number.NaN };
    const content = posterContentFromRun(run, prefs({ stats: ALL }));
    expect(content.stats.time).toBeUndefined();
    expect(content.date).toBe('');
    expect(content.subtitle).toBe('');
  });

  it('leaves out vert and high point while the elevation is unknown, never printing "–"', () => {
    const run = {
      ...SAMPLE_RUN,
      hasElevation: false,
      elevationSource: null,
      vert: NaN,
      highPoint: NaN,
    };
    const content = posterContentFromRun(run, prefs({ stats: ALL }));
    expect(content.stats.vert).toBeUndefined();
    expect(content.stats.highPoint).toBeUndefined();
    expect(content.stats.distance?.text).toBe('21.5 km');
    expect(content.distance).toBe(SAMPLE_RUN.distance);
    expect(content.elevationSource).toBeNull();
  });
});

describe('elevationNote', () => {
  it('says when the elevations come from the terrain', () => {
    expect(elevationNote({ isSample: false, exaggeration: 1.6, elevationSource: 'terrain' })).toBe(
      'ELEVATION FROM TERRAIN DATA · ELEVATION ×1.6',
    );
    expect(elevationNote({ isSample: false, exaggeration: 1.6, elevationSource: 'mixed' })).toBe(
      'ELEVATION PARTLY FROM TERRAIN DATA · ELEVATION ×1.6',
    );
    expect(
      elevationNote({ isSample: false, exaggeration: 1.6, elevationSource: 'interpolated' }),
    ).toBe('ELEVATION GAPS INTERPOLATED · ELEVATION ×1.6');
    expect(elevationNote({ isSample: false, exaggeration: 1.6, elevationSource: 'gpx' })).toBe(
      'ELEVATION ×1.6',
    );
  });

  it('adds the subtitle between the sample note and the elevation', () => {
    expect(elevationNote({ isSample: true, exaggeration: 1.6, subtitle: 'Vogel SP' })).toBe(
      'SAMPLE DATA · Vogel SP · ELEVATION ×1.6',
    );
    expect(elevationNote({ isSample: false, exaggeration: 1.6, subtitle: 'Vogel SP' })).toBe(
      'Vogel SP · ELEVATION ×1.6',
    );
  });

  it('says SAMPLE DATA only for the sample', () => {
    expect(elevationNote({ isSample: true, exaggeration: 1.6 })).toBe(
      'SAMPLE DATA · ELEVATION ×1.6',
    );
    expect(elevationNote({ isSample: false, exaggeration: 2 })).toBe('ELEVATION ×2.0');
  });
});

describe('shareDateLine', () => {
  it('puts the subtitle after the date', () => {
    expect(shareDateLine({ date: 'SAT · 2026-10-03', subtitle: 'Vogel SP' })).toBe(
      'SAT · 2026-10-03 · Vogel SP',
    );
    expect(shareDateLine({ date: 'SAT · 2026-10-03', subtitle: '' })).toBe('SAT · 2026-10-03');
    expect(shareDateLine({ date: '', subtitle: 'Vogel SP' })).toBe('Vogel SP');
  });
});

describe('posterAriaLabel', () => {
  it('summarises the poster', () => {
    const content = posterContentFromRun(
      SAMPLE_RUN,
      prefs({ signature: '@geekplux', subtitle: 'Vogel SP' }),
    );
    expect(posterAriaLabel(content)).toBe(
      `Poster: ${NAME}, SAT · 2026-10-03, Vogel SP. Distance 21.5 km, vert +1,102 m, time 3:04:58. Sample data. By @geekplux.`,
    );
  });

  it('omits the stats sentence and sample note when there are none', () => {
    const run = { ...SAMPLE_RUN, isSample: false };
    const none = { distance: false, vert: false, time: false, highPoint: false };
    const content = posterContentFromRun(run, prefs({ stats: none, subtitle: 'Georgia' }));
    expect(posterAriaLabel(content)).toBe(`Poster: ${NAME}, SAT · 2026-10-03, Georgia.`);
  });

  it('says when the elevation gaps were interpolated', () => {
    const run = { ...SAMPLE_RUN, isSample: false, elevationSource: 'interpolated' as const };
    const none = { distance: false, vert: false, time: false, highPoint: false };
    const content = posterContentFromRun(run, prefs({ stats: none }));
    expect(posterAriaLabel(content)).toBe(
      `Poster: ${NAME}, SAT · 2026-10-03. Elevation gaps interpolated.`,
    );
  });

  it('has a site URL for posters without a signature', () => {
    expect(POSTER_URL).toBe('VERT.GEEKPLUX.COM');
  });
});
