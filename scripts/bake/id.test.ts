// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Bounds } from '../../src/lib/geo';
import { BakeError, UsageError } from './errors';
import {
  MAX_ID_LENGTH,
  checkDefaultIdTimestamp,
  checkExplicitId,
  checkIdPrivacy,
  coordinateReadings,
  idFromFileName,
} from './id';

describe('idFromFileName', () => {
  it.each([
    ['public/samples/coosa-backcountry.gpx', 'coosa-backcountry'],
    ['Morning Run.GPX', 'morning-run'],
    ['UTMB_CCC 2026.gpx', 'utmb_ccc-2026'],
    ['--Été à Zermatt!!.json', 'ete-a-zermatt'],
    ['a.b.c.gpx', 'a-b-c'],
    [`${'x'.repeat(80)}.gpx`, 'x'.repeat(MAX_ID_LENGTH)],
  ])('%s → %s', (path, id) => {
    expect(idFromFileName(path)).toBe(id);
  });

  it('refuses a name with nothing usable in it', () => {
    expect(() => idFromFileName('日本.gpx')).toThrow(UsageError);
  });
});

describe('checkExplicitId', () => {
  it('accepts a valid id as it is', () => {
    expect(checkExplicitId('hk-ridge_2')).toBe('hk-ridge_2');
  });
  it.each(['', 'Upper', 'with space', '-lead', 'dot.ted', 'x'.repeat(MAX_ID_LENGTH + 1)])(
    'refuses %j',
    (id) => {
      expect(() => checkExplicitId(id)).toThrow(UsageError);
    },
  );
});

/** Run boxes: the Coosa sample, the CCC course and a Hong Kong run (approximate, public areas). */
const BOXES: Record<string, Bounds> = {
  coosa: { west: -83.95, east: -83.89, south: 34.74, north: 34.79 },
  ccc: { west: 6.8, east: 7.25, south: 45.8, north: 46.1 },
  hk: { west: 114.1, east: 114.3, south: 22.2, north: 22.4 },
};
const coosa = BOXES.coosa ?? { west: 0, east: 0, south: 0, north: 0 };
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

describe('checkIdPrivacy (every id)', () => {
  it.each([
    ['hike-34766', 'decimal degrees in one run'],
    ['coosa-34_7663-83_9251', 'decimal degrees split by "_"'],
    ['34-7663-83-9251', 'the default id of "34.7663_-83.9251.gpx"'],
    ['n34d7663w83d9251', 'split by letters'],
    ['at-83p914', 'longitude split by "p"'],
    ['34-dot7663', 'a 4-character separator'],
    ['34point7663', 'a 5-character separator'],
    ['0034-7663', 'zero-padded degrees'],
    ['34-45', 'degrees and minutes'],
    ['34d45m58s', 'degrees, minutes, seconds'],
    ['34-45-58-85-36-16', 'DMS pairs (about 30 m)'],
    ['n34-45-966w85-36-123', 'degrees and decimal minutes (about 2 m)'],
    [idFromFileName(`track 34°45'58"N 85°36'16"W.gpx`), 'the default id of a DMS file name'],
    ['f-abc-34766', 'digits beside a short hex-looking word'],
    ['347663839251', 'latitude and longitude run together'],
    ['839251347663', 'longitude and latitude run together'],
    ['p34766383925199', 'run together, more digits'],
    ['34d45966', 'decimal minutes run together'],
  ])('refuses %s (%s)', (id) => {
    expect(() => {
      checkIdPrivacy(id, coosa);
    }).toThrow(/read as a coordinate of this run/);
  });

  const accepted = [
    'run-2026-10-03',
    'ccc-2026-08-29',
    '12345678901',
    '4123456789',
    `f-${sha1('activity 1')}`,
    'coosa-backcountry',
    'lavaredo-20k',
    'eiger-e51',
    'hk-hilly',
    'utmb-ccc-2026',
  ];
  for (const [name, box] of Object.entries(BOXES)) {
    it(`accepts ordinary ids for the ${name} box`, () => {
      for (const id of accepted) {
        expect(() => {
          checkIdPrivacy(id, box);
        }, id).not.toThrow();
      }
    });
  }

  it("accepts Activities' file ids (f-<sha1>) for every box: a hash is not numbers", () => {
    for (let i = 0; i < 500; i++) {
      for (const box of Object.values(BOXES)) {
        expect(() => {
          checkIdPrivacy(`f-${sha1(String(i))}`, box);
        }).not.toThrow();
      }
    }
  });

  it('a date that collides with the run box by chance is refused, asking for another id', () => {
    const trinidad: Bounds = { west: -61.6, east: -61.5, south: 10.0, north: 10.1 };
    expect(() => {
      checkIdPrivacy('lap-10-03', trinidad);
    }).toThrow(/by chance\); pass another with --id/);
  });

  it('treats a box across the equator as reaching zero', () => {
    const equator: Bounds = { west: 36.8, east: 36.9, south: -0.05, north: 0.05 };
    expect(() => {
      checkIdPrivacy('trail-00312', equator);
    }).toThrow(BakeError);
  });

  it('skips UUIDs as it skips hashes', () => {
    expect(coordinateReadings('3f9c1e2a-34d7-4663-8a83-925134766383')).toEqual([]);
    expect(coordinateReadings('run_3f9c1e2a_34d7_4663_8a83_925134766383')).toEqual([]);
  });

  it('refuses at most 1% of hash-like ids by chance (5000 random each, three boxes)', () => {
    let state = 12345;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const hex = (n: number) =>
      Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(random() * 16)]).join('');
    const families: Record<string, () => string> = {
      'f-<sha1>': () => `f-${sha1(String(random()))}`,
      UUID: () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`,
    };
    for (const [family, make] of Object.entries(families)) {
      const ids = Array.from({ length: 5000 }, make);
      for (const [name, box] of Object.entries(BOXES)) {
        const refused = ids.filter((id) => {
          try {
            checkIdPrivacy(id, box, { explicit: true });
            return false;
          } catch {
            return true;
          }
        }).length;
        expect(refused / ids.length, `${family} on the ${name} box`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('never refuses a bare-digit explicit --id: Strava ids swept in time order', () => {
    const boxes: Record<string, Bounds> = {
      ...BOXES,
      lavaredo: { west: 12.17, east: 12.33, south: 46.58, north: 46.66 },
      taveuni: { west: -180.03, east: -179.97, south: -16.88, north: -16.84 },
    };
    for (const [name, box] of Object.entries(boxes)) {
      // 10 digits (1.0e9–1.0e10) and 11 digits (1.0e10–2.0e10), every millionth id.
      for (let id = 1e9; id <= 2e10; id += 1e6) {
        expect(
          () => {
            checkIdPrivacy(String(id), box, { explicit: true });
          },
          `${String(id)} on the ${name} box`,
        ).not.toThrow();
      }
    }
  });

  it('a bare-digit id still gets every reading when it is not an explicit --id of 10+ digits', () => {
    const hk = BOXES.hk ?? coosa;
    // 11,413,500,000 reads as 114.135… (inside the Hong Kong box) from its 3-digit prefix.
    expect(() => {
      checkIdPrivacy('11413500000', hk, { explicit: true });
    }).not.toThrow();
    expect(() => {
      checkIdPrivacy('11413500000', hk); // a default id from "11413500000.gpx"
    }).toThrow(/coordinate/);
    expect(() => {
      checkIdPrivacy('a-11413500000', hk, { explicit: true }); // not digits alone
    }).toThrow(/coordinate/);
    expect(() => {
      checkIdPrivacy('34766', coosa, { explicit: true }); // fewer than 10 digits
    }).toThrow(/coordinate/);
    // The accepted residual: concatenated coordinates typed as a bare-digit --id.
    expect(() => {
      checkIdPrivacy('347663839251', coosa, { explicit: true });
    }).not.toThrow();
    expect(() => {
      checkIdPrivacy('347663839251', coosa);
    }).toThrow(/coordinate/);
  });

  it('reads the digit groups every way it says', () => {
    expect(coordinateReadings('34d45m58s')).toEqual(
      expect.arrayContaining([34.75, 34 + 45 / 60 + 58 / 3600, 34 + 45.58 / 60]),
    );
    expect(coordinateReadings('0034-7663')).toContain(34.7663);
    expect(coordinateReadings(`f-${sha1('x')}`)).toEqual([]);
    expect(coordinateReadings('run-2026-10-03')).toEqual([10.05]);
  });
});

describe('checkDefaultIdTimestamp (ids made from a file name only)', () => {
  it.each([
    ['1607437156744', /epoch milliseconds/],
    ['run-1607437157', /epoch seconds/],
    ['activity-946684800', /epoch seconds/],
    ['1607437156744000', /epoch microseconds/],
    ['26790619', /epoch minutes/],
    ['run-20201208', /\(a date, YYYYMMDD\)/],
  ])('refuses %s', (id, unit) => {
    expect(() => {
      checkDefaultIdTimestamp(id);
    }).toThrow(UsageError);
    expect(() => {
      checkDefaultIdTimestamp(id);
    }).toThrow(unit);
    expect(() => {
      checkDefaultIdTimestamp(id);
    }).toThrow(/This file name looks like a timestamp .*; pass --id\./);
  });

  it.each(['coosa-backcountry', 'morning-run-2026-10-03', '12345678', 'run-42', 'hk-hilly'])(
    'accepts %s',
    (id) => {
      expect(() => {
        checkDefaultIdTimestamp(id);
      }).not.toThrow();
    },
  );
});
